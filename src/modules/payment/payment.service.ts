import type { PaymentGatewayCode, PaymentStatus, UserRole } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { logger } from "../../config/logger.js";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import type { QuoteSnapshot } from "../booking/booking.types.js";
import { resolveCustomerPayableAmount } from "../pricing/customer-delivery-pricing.js";
import { loadAuthorizedDelivery } from "../delivery/delivery-access.js";
import {
  deliveryRepository,
  type IDeliveryRepository,
} from "../delivery/delivery.repository.js";
import {
  deliveryContactPhoneFallback,
  resolveGatewayCustomerPhone,
} from "./gateway-customer-phone.js";
import {
  orchestrationRepository,
  type IOrchestrationRepository,
} from "../orchestration/orchestration.repository.js";
import { authRepository } from "../auth/auth.repository.js";
import { getPaymentGateway } from "./gateways/payment-gateway.registry.js";
import {
  assertPaymentGatewayReady,
  resolveActivePaymentGatewayCode,
} from "./payment-gateway.config.js";
import {
  DEFAULT_PAYMENT_CURRENCY,
  PAYMENT_READY_DELIVERY_STATUSES,
  ledgerIdempotencyKeyForPaymentSuccess,
  ledgerIdempotencyKeyForRefund,
} from "./payment.constants.js";
import { toCustomerPaymentDto } from "./payment.mapper.js";
import {
  isPositiveMoney,
  isRefundWithinPaidAmount,
  toMoneyDecimal,
} from "./payment.money.js";
import { paymentRepository, type IPaymentRepository } from "./payment.repository.js";
import type {
  PaymentCreateResponsePayload,
  PaymentDto,
  PaymentPricingSource,
  RefundDto,
} from "./payment.types.js";
import { canTransitionPayment, canTransitionRefund } from "./payment.transitions.js";

const ACTIVE_CREATE_STATUSES = new Set<PaymentStatus>(["CREATED", "PENDING"]);

export class PaymentService {
  constructor(
    private readonly paymentRepo: IPaymentRepository = paymentRepository,
    private readonly deliveryRepo: IDeliveryRepository = deliveryRepository,
    private readonly orchestrationRepo: IOrchestrationRepository = orchestrationRepository,
    private readonly gatewayCode: PaymentGatewayCode = "STUB",
  ) {}

  async createPaymentForDelivery(input: {
    deliveryId: string;
    userId: string;
    role: UserRole;
    requestId: string;
    idempotencyKey?: string;
    requestHash: string;
  }) {
    if (input.idempotencyKey) {
      const cached = await this.paymentRepo.findCreateIdempotency(
        input.userId,
        input.idempotencyKey,
      );
      if (cached) {
        if (
          cached.requestHash !== input.requestHash ||
          cached.deliveryId !== input.deliveryId
        ) {
          throw new AppError("Idempotency key reused with a different request.", {
            statusCode: 409,
            code: ErrorCodes.IDEMPOTENCY_CONFLICT,
          });
        }
        return { success: true as const, data: cached.responsePayload };
      }
    }

    const delivery = await loadAuthorizedDelivery(
      this.deliveryRepo,
      input.deliveryId,
      input.userId,
      input.role,
    );

    if (
      !PAYMENT_READY_DELIVERY_STATUSES.includes(
        delivery.status as (typeof PAYMENT_READY_DELIVERY_STATUSES)[number],
      )
    ) {
      throw new AppError("Delivery is not ready for payment.", {
        statusCode: 422,
        code: ErrorCodes.PAYMENT_NOT_ALLOWED,
      });
    }

    if (delivery.customerId !== input.userId && input.role !== "ADMIN") {
      throw new AppError("Forbidden.", {
        statusCode: 403,
        code: ErrorCodes.FORBIDDEN,
      });
    }

    const pricing = await this.resolveAuthoritativePricing(input.deliveryId);

    assertPaymentGatewayReady(this.gatewayCode);

    let existing = await this.paymentRepo.findByDeliveryId(input.deliveryId);
    if (existing) {
      if (ACTIVE_CREATE_STATUSES.has(existing.status) || existing.status === "PAID") {
        if (this.needsCheckoutCompletion(existing)) {
          existing = await this.ensureGatewayCheckout({
            payment: existing,
            deliveryId: input.deliveryId,
            amount: pricing.amount,
            currency: pricing.currency,
            customerId: delivery.customerId,
            customerReference: delivery.reference,
            customerPhoneFallback: deliveryContactPhoneFallback(delivery),
          });
        }
        const latestAttempt = await this.paymentRepo.findLatestAttempt(existing.id);
        const response = this.buildCreateResponse(existing, latestAttempt);
        await this.persistCreateIdempotency(input, response);
        return { success: true as const, data: response };
      }
      throw new AppError("Payment already exists for this delivery.", {
        statusCode: 409,
        code: ErrorCodes.PAYMENT_ALREADY_EXISTS,
      });
    }

    let payment = await this.paymentRepo.withTransaction(async (tx) => {
      const created = await this.paymentRepo.createPayment(
        {
          deliveryId: input.deliveryId,
          customerId: delivery.customerId,
          amount: pricing.amount,
          currency: pricing.currency,
          gateway: this.gatewayCode,
          pricingSource: pricing.pricingSource,
        },
        tx,
      );
      const refreshed = await this.paymentRepo.findById(created.id, tx);
      if (!refreshed) {
        throw new AppError("Payment not found after creation.", {
          statusCode: 500,
          code: ErrorCodes.INTERNAL_ERROR,
        });
      }
      return refreshed;
    });

    payment = await this.ensureGatewayCheckout({
      payment,
      deliveryId: input.deliveryId,
      amount: pricing.amount,
      currency: pricing.currency,
      customerId: delivery.customerId,
      customerReference: delivery.reference,
      customerPhoneFallback: deliveryContactPhoneFallback(delivery),
    });

    const latestAttempt = await this.paymentRepo.findLatestAttempt(payment.id);
    const response = this.buildCreateResponse(payment, latestAttempt);
    await this.persistCreateIdempotency(input, response);

    logger.info(
      {
        requestId: input.requestId,
        paymentId: payment.id,
        deliveryId: input.deliveryId,
        amount: payment.amount,
      },
      "payment_created",
    );

    return { success: true as const, data: response };
  }

  async getPaymentForDelivery(input: {
    deliveryId: string;
    userId: string;
    role: UserRole;
  }) {
    await loadAuthorizedDelivery(
      this.deliveryRepo,
      input.deliveryId,
      input.userId,
      input.role,
    );

    const payment = await this.paymentRepo.findByDeliveryId(input.deliveryId);
    if (!payment) {
      throw new AppError("Payment not found.", {
        statusCode: 404,
        code: ErrorCodes.PAYMENT_NOT_FOUND,
      });
    }

    const latestAttempt = await this.paymentRepo.findLatestAttempt(payment.id);
    return {
      success: true as const,
      data: { payment: toCustomerPaymentDto(payment, latestAttempt) },
    };
  }

  async markPaymentPending(input: { paymentId: string; gatewayOrderId?: string }) {
    return this.transitionPayment({
      paymentId: input.paymentId,
      toStatus: "PENDING",
      allowedFrom: ["CREATED"],
      gatewayOrderId: input.gatewayOrderId,
    });
  }

  async markPaymentPaid(input: {
    paymentId: string;
    gatewayPaymentId?: string | null;
    paymentMethod?: string | null;
    idempotencyKey?: string;
  }) {
    const payment = await this.paymentRepo.findById(input.paymentId);
    if (!payment) {
      throw new AppError("Payment not found.", {
        statusCode: 404,
        code: ErrorCodes.PAYMENT_NOT_FOUND,
      });
    }

    if (payment.status === "PAID") {
      return payment;
    }

    if (!canTransitionPayment(payment.status, "PAID")) {
      throw new AppError("Invalid payment status transition.", {
        statusCode: 409,
        code: ErrorCodes.PAYMENT_INVALID_TRANSITION,
      });
    }

    const ledgerKey =
      input.idempotencyKey ?? ledgerIdempotencyKeyForPaymentSuccess(payment.id);
    const existingLedger = await this.paymentRepo.findLedgerByIdempotencyKey(ledgerKey);
    if (existingLedger) {
      return payment;
    }

    const now = new Date();
    const latestAttempt = await this.paymentRepo.findLatestAttempt(payment.id);

    try {
      return await this.paymentRepo.withTransaction(async (tx) => {
        const updated = await this.paymentRepo.updatePaymentStatus(
          {
            paymentId: payment.id,
            fromStatuses: ["PENDING"],
            toStatus: "PAID",
            paidAt: now,
          },
          tx,
        );
        if (!updated) {
          const current = await this.paymentRepo.findById(payment.id);
          if (current?.status === "PAID") {
            return current;
          }
          throw new AppError("Invalid payment status transition.", {
            statusCode: 409,
            code: ErrorCodes.PAYMENT_INVALID_TRANSITION,
          });
        }

        if (latestAttempt) {
          await this.paymentRepo.updateAttempt(
            {
              attemptId: latestAttempt.id,
              status: "SUCCEEDED",
              gatewayPaymentId: input.gatewayPaymentId ?? null,
              paymentMethod: input.paymentMethod ?? null,
              completedAt: now,
            },
            tx,
          );
        }

        await this.paymentRepo.createLedgerEntry(
          {
            deliveryId: payment.deliveryId,
            paymentId: payment.id,
            type: "CUSTOMER_PAYMENT",
            direction: "CREDIT",
            amount: payment.amount,
            currency: payment.currency,
            description: "Customer payment captured",
            idempotencyKey: ledgerKey,
          },
          tx,
        );

        return updated;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const current = await this.paymentRepo.findById(payment.id);
        if (current) {
          return current;
        }
      }
      throw error;
    }
  }

  async markPaymentFailed(input: {
    paymentId: string;
    failureCode?: string | null;
    failureMessage?: string | null;
  }) {
    const payment = await this.transitionPayment({
      paymentId: input.paymentId,
      toStatus: "FAILED",
      allowedFrom: ["CREATED", "PENDING"],
      failedAt: new Date(),
    });

    const latestAttempt = await this.paymentRepo.findLatestAttempt(payment.id);
    if (latestAttempt) {
      await this.paymentRepo.updateAttempt({
        attemptId: latestAttempt.id,
        status: "FAILED",
        failureCode: input.failureCode ?? null,
        failureMessage: input.failureMessage ?? null,
        completedAt: new Date(),
      });
    }

    return payment;
  }

  async markPaymentExpired(input: { paymentId: string }) {
    return this.transitionPayment({
      paymentId: input.paymentId,
      toStatus: "EXPIRED",
      allowedFrom: ["CREATED", "PENDING"],
      expiredAt: new Date(),
    });
  }

  async requestRefund(input: {
    paymentId: string;
    amount: number;
    idempotencyKey: string;
    reasonCode?: string | null;
    reason?: string | null;
    refundNote?: string | null;
  }): Promise<RefundDto> {
    const payment = await this.paymentRepo.findById(input.paymentId);
    if (!payment) {
      throw new AppError("Payment not found.", {
        statusCode: 404,
        code: ErrorCodes.PAYMENT_NOT_FOUND,
      });
    }

    if (payment.status !== "PAID" && payment.status !== "PARTIALLY_REFUNDED") {
      throw new AppError("Refund is not allowed for this payment.", {
        statusCode: 422,
        code: ErrorCodes.REFUND_NOT_ALLOWED,
      });
    }

    if (!isPositiveMoney(toMoneyDecimal(input.amount))) {
      throw new AppError("Invalid refund amount.", {
        statusCode: 422,
        code: ErrorCodes.PAYMENT_INVALID_AMOUNT,
      });
    }

    const existing = await this.paymentRepo.findRefundByIdempotencyKey(
      input.idempotencyKey,
    );
    if (existing) {
      return existing;
    }

    if (!payment.gatewayOrderId) {
      throw new AppError("Payment has no gateway order to refund.", {
        statusCode: 422,
        code: ErrorCodes.REFUND_NOT_ALLOWED,
      });
    }

    const reserved = await this.paymentRepo.sumActiveRefundAmounts(payment.id);
    const paidDecimal = toMoneyDecimal(payment.amount);
    const requestedDecimal = toMoneyDecimal(input.amount);
    const reservedDecimal = toMoneyDecimal(reserved);

    if (
      !isRefundWithinPaidAmount({
        paidAmount: paidDecimal,
        alreadyReserved: reservedDecimal,
        requested: requestedDecimal,
      })
    ) {
      throw new AppError("Refund amount exceeds paid amount.", {
        statusCode: 422,
        code: ErrorCodes.REFUND_EXCEEDS_PAID,
      });
    }

    const refund = await this.paymentRepo.createRefund({
      paymentId: payment.id,
      deliveryId: payment.deliveryId,
      amount: input.amount,
      currency: payment.currency,
      idempotencyKey: input.idempotencyKey,
      reasonCode: input.reasonCode ?? null,
      reason: input.reason ?? null,
      status: "REQUESTED",
    });

    const merchantRefundId = buildMerchantRefundId(refund.id);
    const gateway = getPaymentGateway(payment.gateway);

    try {
      const gatewayResult = await gateway.createRefund({
        paymentId: payment.id,
        gatewayOrderId: payment.gatewayOrderId,
        amount: input.amount,
        currency: payment.currency,
        merchantRefundId,
        idempotencyKey: input.idempotencyKey,
        refundNote: input.refundNote ?? input.reason ?? null,
      });

      const pending = await this.paymentRepo.updateRefundStatus({
        refundId: refund.id,
        fromStatuses: ["REQUESTED"],
        toStatus: "PENDING",
        gatewayRefundId: gatewayResult.gatewayRefundId,
        gatewayRefundReference: gatewayResult.gatewayRefundReference ?? null,
      });

      if (gatewayResult.status === "SUCCESS") {
        return this.markRefundSuccessful({
          refundId: refund.id,
          gatewayRefundId: gatewayResult.gatewayRefundId,
          gatewayRefundReference: gatewayResult.gatewayRefundReference ?? null,
        });
      }

      if (gatewayResult.status === "FAILED") {
        return this.markRefundFailed({
          refundId: refund.id,
          reason: "Gateway reported refund failure.",
        });
      }

      return pending ?? (await this.paymentRepo.findRefundById(refund.id))!;
    } catch (error) {
      await this.markRefundFailed({
        refundId: refund.id,
        reason: error instanceof Error ? error.message : "Gateway refund failed.",
      }).catch(() => null);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError("Payment gateway refund failed.", {
        statusCode: 502,
        code: ErrorCodes.PAYMENT_GATEWAY_ERROR,
      });
    }
  }

  async reconcileRefundStatus(refundId: string): Promise<RefundDto> {
    const refund = await this.paymentRepo.findRefundById(refundId);
    if (!refund) {
      throw new AppError("Refund not found.", {
        statusCode: 404,
        code: ErrorCodes.REFUND_NOT_FOUND,
      });
    }
    if (refund.status === "SUCCESS" || refund.status === "FAILED") {
      return refund;
    }
    if (!refund.gatewayRefundId) {
      return refund;
    }

    const payment = await this.paymentRepo.findById(refund.paymentId);
    if (!payment?.gatewayOrderId) {
      return refund;
    }

    const gateway = getPaymentGateway(payment.gateway);
    const status = await gateway.getRefundStatus({
      gatewayOrderId: payment.gatewayOrderId,
      gatewayRefundId: refund.gatewayRefundId,
    });

    if (status.status === "SUCCESS") {
      return this.markRefundSuccessful({
        refundId: refund.id,
        gatewayRefundId: status.gatewayRefundId,
        gatewayRefundReference: status.gatewayRefundReference ?? null,
      });
    }
    if (status.status === "FAILED") {
      return this.markRefundFailed({
        refundId: refund.id,
        reason: "Gateway reported refund failure on reconcile.",
      });
    }
    return refund;
  }

  async markRefundSuccessful(input: {
    refundId: string;
    gatewayRefundId?: string | null;
    gatewayRefundReference?: string | null;
  }): Promise<RefundDto> {
    try {
      return await this.paymentRepo.withTransaction(
        (tx) => this.finalizeRefundSuccessInTransaction(tx, input),
        { maxWait: 10_000, timeout: 15_000 },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const refund = await this.paymentRepo.findRefundById(input.refundId);
        if (refund?.status === "SUCCESS") {
          return refund;
        }
      }
      throw error;
    }
  }

  private async finalizeRefundSuccessInTransaction(
    tx: Prisma.TransactionClient,
    input: {
      refundId: string;
      gatewayRefundId?: string | null;
      gatewayRefundReference?: string | null;
    },
  ): Promise<RefundDto> {
    const refund = await this.paymentRepo.findRefundById(input.refundId, tx);
    if (!refund) {
      throw new AppError("Refund not found.", {
        statusCode: 404,
        code: ErrorCodes.REFUND_NOT_FOUND,
      });
    }

    const ledgerKey = ledgerIdempotencyKeyForRefund(refund.id);
    const existingLedger = await this.paymentRepo.findLedgerByIdempotencyKey(
      ledgerKey,
      tx,
    );

    if (refund.status === "SUCCESS") {
      return this.reconcileSuccessfulRefundRecord({
        refund,
        existingLedger,
        tx,
        ledgerKey,
      });
    }

    if (!canTransitionRefund(refund.status, "SUCCESS")) {
      throw new AppError("Invalid refund status transition.", {
        statusCode: 409,
        code: ErrorCodes.REFUND_INVALID_TRANSITION,
      });
    }

    const payment = await this.paymentRepo.findById(refund.paymentId, tx);
    if (!payment) {
      throw new AppError("Payment not found.", {
        statusCode: 404,
        code: ErrorCodes.PAYMENT_NOT_FOUND,
      });
    }

    const newRefundedTotal = payment.refundedAmount + refund.amount;
    if (
      !isRefundWithinPaidAmount({
        paidAmount: toMoneyDecimal(payment.amount),
        alreadyReserved: toMoneyDecimal(payment.refundedAmount),
        requested: toMoneyDecimal(refund.amount),
      })
    ) {
      throw new AppError("Refund exceeds paid amount.", {
        statusCode: 409,
        code: ErrorCodes.REFUND_EXCEEDS_PAID,
      });
    }

    const nextPaymentStatus: PaymentStatus =
      newRefundedTotal >= payment.amount ? "REFUNDED" : "PARTIALLY_REFUNDED";

    if (!canTransitionPayment(payment.status, nextPaymentStatus)) {
      throw new AppError("Invalid payment status transition.", {
        statusCode: 409,
        code: ErrorCodes.PAYMENT_INVALID_TRANSITION,
      });
    }

    const now = new Date();
    const updatedRefund = await this.paymentRepo.updateRefundStatus(
      {
        refundId: refund.id,
        fromStatuses: ["REQUESTED", "PENDING"],
        toStatus: "SUCCESS",
        gatewayRefundId: input.gatewayRefundId ?? null,
        gatewayRefundReference: input.gatewayRefundReference ?? null,
        processedAt: now,
      },
      tx,
    );

    if (!updatedRefund) {
      const current = await this.paymentRepo.findRefundById(refund.id, tx);
      if (current?.status === "SUCCESS") {
        return this.reconcileSuccessfulRefundRecord({
          refund: current,
          existingLedger:
            existingLedger ??
            (await this.paymentRepo.findLedgerByIdempotencyKey(ledgerKey, tx)),
          tx,
          ledgerKey,
        });
      }
      throw new AppError("Invalid refund status transition.", {
        statusCode: 409,
        code: ErrorCodes.REFUND_INVALID_TRANSITION,
      });
    }

    const updatedPayment = await this.paymentRepo.updatePaymentStatus(
      {
        paymentId: payment.id,
        fromStatuses: ["PAID", "PARTIALLY_REFUNDED"],
        toStatus: nextPaymentStatus,
        refundedAmount: newRefundedTotal,
      },
      tx,
    );

    if (!updatedPayment) {
      const currentPayment = await this.paymentRepo.findById(payment.id, tx);
      if (
        currentPayment &&
        currentPayment.refundedAmount === newRefundedTotal &&
        currentPayment.status === nextPaymentStatus
      ) {
        await this.ensureRefundLedgerEntry({
          payment: currentPayment,
          refund: updatedRefund,
          ledgerKey,
          tx,
        });
        return updatedRefund;
      }
      throw new AppError("Payment state could not be updated for refund.", {
        statusCode: 409,
        code: ErrorCodes.PAYMENT_INVALID_TRANSITION,
      });
    }

    await this.ensureRefundLedgerEntry({
      payment: updatedPayment,
      refund: updatedRefund,
      ledgerKey,
      tx,
    });

    return updatedRefund;
  }

  private async reconcileSuccessfulRefundRecord(input: {
    refund: RefundDto;
    existingLedger: Awaited<
      ReturnType<IPaymentRepository["findLedgerByIdempotencyKey"]>
    >;
    ledgerKey: string;
    tx: Prisma.TransactionClient;
  }): Promise<RefundDto> {
    if (input.existingLedger) {
      return input.refund;
    }

    const payment = await this.paymentRepo.findById(input.refund.paymentId, input.tx);
    if (!payment) {
      throw new AppError("Payment not found.", {
        statusCode: 404,
        code: ErrorCodes.PAYMENT_NOT_FOUND,
      });
    }

    const successTotal = await this.paymentRepo.sumSuccessfulRefundAmounts(
      payment.id,
      input.tx,
    );
    const targetStatus: PaymentStatus =
      successTotal >= payment.amount ? "REFUNDED" : "PARTIALLY_REFUNDED";

    if (payment.refundedAmount !== successTotal || payment.status !== targetStatus) {
      if (!canTransitionPayment(payment.status, targetStatus)) {
        throw new AppError("Invalid payment status transition.", {
          statusCode: 409,
          code: ErrorCodes.PAYMENT_INVALID_TRANSITION,
        });
      }
      const repaired = await this.paymentRepo.updatePaymentStatus(
        {
          paymentId: payment.id,
          fromStatuses: ["PAID", "PARTIALLY_REFUNDED"],
          toStatus: targetStatus,
          refundedAmount: successTotal,
        },
        input.tx,
      );
      if (!repaired) {
        const current = await this.paymentRepo.findById(payment.id, input.tx);
        if (
          !current ||
          current.refundedAmount !== successTotal ||
          current.status !== targetStatus
        ) {
          throw new AppError("Payment state could not be reconciled for refund.", {
            statusCode: 409,
            code: ErrorCodes.PAYMENT_INVALID_TRANSITION,
          });
        }
      }
    }

    const paymentForLedger =
      (await this.paymentRepo.findById(payment.id, input.tx)) ?? payment;

    await this.ensureRefundLedgerEntry({
      payment: paymentForLedger,
      refund: input.refund,
      ledgerKey: input.ledgerKey,
      tx: input.tx,
    });

    return input.refund;
  }

  private async ensureRefundLedgerEntry(input: {
    payment: PaymentDto;
    refund: RefundDto;
    ledgerKey: string;
    tx: Prisma.TransactionClient;
  }): Promise<void> {
    const existing = await this.paymentRepo.findLedgerByIdempotencyKey(
      input.ledgerKey,
      input.tx,
    );
    if (existing) {
      return;
    }

    try {
      await this.paymentRepo.createLedgerEntry(
        {
          deliveryId: input.payment.deliveryId,
          paymentId: input.payment.id,
          refundId: input.refund.id,
          type: "REFUND",
          direction: "DEBIT",
          amount: input.refund.amount,
          currency: input.refund.currency,
          description: "Customer refund processed",
          idempotencyKey: input.ledgerKey,
        },
        input.tx,
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const ledger = await this.paymentRepo.findLedgerByIdempotencyKey(
          input.ledgerKey,
          input.tx,
        );
        if (ledger) {
          return;
        }
      }
      throw error;
    }
  }

  async markRefundFailed(input: { refundId: string; reason?: string | null }) {
    const updated = await this.paymentRepo.updateRefundStatus({
      refundId: input.refundId,
      fromStatuses: ["REQUESTED", "PENDING"],
      toStatus: "FAILED",
      processedAt: new Date(),
    });
    if (!updated) {
      throw new AppError("Invalid refund status transition.", {
        statusCode: 409,
        code: ErrorCodes.REFUND_INVALID_TRANSITION,
      });
    }
    return updated;
  }

  private async transitionPayment(input: {
    paymentId: string;
    toStatus: PaymentStatus;
    allowedFrom: PaymentStatus[];
    gatewayOrderId?: string;
    paidAt?: Date;
    failedAt?: Date;
    expiredAt?: Date;
    refundedAmount?: number;
  }): Promise<PaymentDto> {
    const current = await this.paymentRepo.findById(input.paymentId);
    if (!current) {
      throw new AppError("Payment not found.", {
        statusCode: 404,
        code: ErrorCodes.PAYMENT_NOT_FOUND,
      });
    }

    if (!canTransitionPayment(current.status, input.toStatus)) {
      throw new AppError("Invalid payment status transition.", {
        statusCode: 409,
        code: ErrorCodes.PAYMENT_INVALID_TRANSITION,
      });
    }

    const updated = await this.paymentRepo.updatePaymentStatus({
      paymentId: input.paymentId,
      fromStatuses: input.allowedFrom,
      toStatus: input.toStatus,
      gatewayOrderId: input.gatewayOrderId,
      paidAt: input.paidAt,
      failedAt: input.failedAt,
      expiredAt: input.expiredAt,
      refundedAmount: input.refundedAmount,
    });

    if (!updated) {
      throw new AppError("Invalid payment status transition.", {
        statusCode: 409,
        code: ErrorCodes.PAYMENT_INVALID_TRANSITION,
      });
    }

    return updated;
  }

  private async resolveAuthoritativePricing(deliveryId: string): Promise<{
    amount: number;
    currency: typeof DEFAULT_PAYMENT_CURRENCY;
    pricingSource: PaymentPricingSource;
  }> {
    const orchestration =
      await this.orchestrationRepo.findLatestCompletedByDeliveryId(deliveryId);
    const selectedOption = orchestration?.selectedOption;
    if (!orchestration || !selectedOption) {
      throw new AppError("No selected orchestration option found for delivery.", {
        statusCode: 422,
        code: ErrorCodes.PAYMENT_NOT_ALLOWED,
      });
    }

    const quoteSnapshot = selectedOption.quoteSnapshot as QuoteSnapshot;
    if (quoteSnapshot.amount == null || !quoteSnapshot.currency) {
      throw new AppError("Selected option quote snapshot is invalid.", {
        statusCode: 422,
        code: ErrorCodes.PAYMENT_NOT_ALLOWED,
      });
    }

    const customerPayableAmount = resolveCustomerPayableAmount(quoteSnapshot);

    if (!isPositiveMoney(toMoneyDecimal(customerPayableAmount))) {
      throw new AppError("Invalid payment amount.", {
        statusCode: 422,
        code: ErrorCodes.PAYMENT_INVALID_AMOUNT,
      });
    }

    const currency =
      quoteSnapshot.currency === "INR"
        ? DEFAULT_PAYMENT_CURRENCY
        : DEFAULT_PAYMENT_CURRENCY;

    if (quoteSnapshot.currency !== "INR") {
      throw new AppError("Unsupported payment currency.", {
        statusCode: 422,
        code: ErrorCodes.PAYMENT_NOT_ALLOWED,
      });
    }

    return {
      amount: customerPayableAmount,
      currency,
      pricingSource: {
        orchestrationRequestId: orchestration.id,
        orchestrationOptionId: selectedOption.id,
        quoteSnapshot,
      },
    };
  }

  private buildCreateResponse(
    payment: PaymentDto,
    latestAttempt: Awaited<ReturnType<IPaymentRepository["findLatestAttempt"]>>,
  ): PaymentCreateResponsePayload {
    return { payment: toCustomerPaymentDto(payment, latestAttempt) };
  }

  private needsCheckoutCompletion(payment: PaymentDto): boolean {
    if (payment.gateway !== "CASHFREE") {
      return payment.status === "CREATED";
    }
    return (
      (payment.status === "CREATED" || payment.status === "PENDING") &&
      (!payment.gatewayOrderId || !payment.gatewayPaymentSessionId)
    );
  }

  private async loadGatewayCustomer(customerId: string, phoneFallback?: string) {
    const user = await authRepository.findUserById(customerId);
    const phone = resolveGatewayCustomerPhone(user, phoneFallback);
    return {
      customerId,
      email: user?.email,
      phone,
    };
  }

  private async ensureGatewayCheckout(input: {
    payment: PaymentDto;
    deliveryId: string;
    amount: number;
    currency: typeof DEFAULT_PAYMENT_CURRENCY;
    customerId: string;
    customerReference: string;
    customerPhoneFallback?: string;
  }): Promise<PaymentDto> {
    if (
      input.payment.gatewayOrderId &&
      input.payment.gatewayPaymentSessionId &&
      input.payment.status === "PENDING"
    ) {
      return input.payment;
    }

    if (
      input.payment.gatewayOrderId &&
      input.payment.gatewayPaymentSessionId &&
      input.payment.status === "CREATED"
    ) {
      const pending = await this.paymentRepo.updatePaymentStatus({
        paymentId: input.payment.id,
        fromStatuses: ["CREATED"],
        toStatus: "PENDING",
      });
      return pending ?? input.payment;
    }

    const gateway = getPaymentGateway(this.gatewayCode);
    // STUB does not need auth DB lookup; delivery contact phone is enough.
    const customer =
      this.gatewayCode === "STUB"
        ? {
            customerId: input.customerId,
            email: undefined as string | undefined,
            phone: input.customerPhoneFallback,
          }
        : await this.loadGatewayCustomer(input.customerId, input.customerPhoneFallback);

    let order;
    try {
      order = await gateway.createPaymentOrder({
        paymentId: input.payment.id,
        deliveryId: input.deliveryId,
        amount: input.amount,
        currency: input.currency,
        customerReference: input.customerReference,
        customer,
        existingGatewayOrderId: input.payment.gatewayOrderId,
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError("Payment gateway order creation failed.", {
        statusCode: 502,
        code: ErrorCodes.PAYMENT_GATEWAY_ERROR,
      });
    }

    const latestAttempt = await this.paymentRepo.findLatestAttempt(input.payment.id);

    const refreshed = await this.paymentRepo.withTransaction(async (tx) => {
      const updated = await this.paymentRepo.updatePaymentStatus(
        {
          paymentId: input.payment.id,
          fromStatuses: ["CREATED", "PENDING"],
          toStatus: "PENDING",
          gatewayOrderId: order.gatewayOrderId,
          gatewayPaymentSessionId: order.paymentSessionId ?? null,
        },
        tx,
      );
      if (!updated) {
        const current = await this.paymentRepo.findById(input.payment.id, tx);
        if (current) {
          return current;
        }
        throw new AppError("Payment not found after gateway checkout.", {
          statusCode: 500,
          code: ErrorCodes.INTERNAL_ERROR,
        });
      }

      if (!latestAttempt) {
        await this.paymentRepo.createAttempt(
          {
            paymentId: input.payment.id,
            attemptNumber: 1,
            amount: input.amount,
            currency: input.currency,
            gatewayOrderId: order.gatewayOrderId,
            status: "PENDING",
          },
          tx,
        );
      }

      const current = await this.paymentRepo.findById(input.payment.id, tx);
      if (!current) {
        throw new AppError("Payment not found after gateway checkout.", {
          statusCode: 500,
          code: ErrorCodes.INTERNAL_ERROR,
        });
      }
      return current;
    });

    // STUB settles instantly so local/mock booking can require PAID without Cashfree.
    if (this.gatewayCode === "STUB" && refreshed.status === "PENDING") {
      return this.markPaymentPaid({
        paymentId: refreshed.id,
        paymentMethod: "STUB",
      });
    }

    return refreshed;
  }

  private async persistCreateIdempotency(
    input: {
      userId: string;
      idempotencyKey?: string;
      requestHash: string;
      deliveryId: string;
    },
    response: PaymentCreateResponsePayload,
  ) {
    if (!input.idempotencyKey) {
      return;
    }
    await this.paymentRepo.saveCreateIdempotency({
      customerId: input.userId,
      key: input.idempotencyKey,
      requestHash: input.requestHash,
      deliveryId: input.deliveryId,
      responsePayload: response,
    });
  }
}

/** Cashfree merchant refund_id: 3–40 alphanumeric. */
export function buildMerchantRefundId(refundId: string): string {
  const compact = refundId.replace(/-/g, "");
  return compact.length >= 3 ? compact.slice(0, 40) : `rf${compact}xx`;
}

export const paymentService = new PaymentService(
  paymentRepository,
  deliveryRepository,
  orchestrationRepository,
  resolveActivePaymentGatewayCode(),
);
