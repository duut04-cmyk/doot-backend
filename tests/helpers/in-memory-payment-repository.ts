import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type {
  IPaymentRepository,
  PaymentCreateIdempotencyRecord,
} from "../../src/modules/payment/payment.repository.js";
import type {
  LedgerEntryDto,
  PaymentAttemptDto,
  PaymentDto,
  PaymentPricingSource,
  RefundDto,
} from "../../src/modules/payment/payment.types.js";

export class InMemoryPaymentRepository implements IPaymentRepository {
  payments = new Map<string, PaymentDto>();
  paymentsByDelivery = new Map<string, string>();
  attempts = new Map<string, PaymentAttemptDto>();
  refunds = new Map<string, RefundDto>();
  refundsByKey = new Map<string, string>();
  ledger = new Map<string, LedgerEntryDto>();
  idempotency = new Map<string, PaymentCreateIdempotencyRecord>();

  async withTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return fn({} as Prisma.TransactionClient);
  }

  async findByDeliveryId(deliveryId: string): Promise<PaymentDto | null> {
    const id = this.paymentsByDelivery.get(deliveryId);
    return id ? (this.payments.get(id) ?? null) : null;
  }

  async findById(paymentId: string): Promise<PaymentDto | null> {
    return this.payments.get(paymentId) ?? null;
  }

  async findByGatewayOrderId(gatewayOrderId: string): Promise<PaymentDto | null> {
    for (const payment of this.payments.values()) {
      if (payment.gatewayOrderId === gatewayOrderId) {
        return payment;
      }
    }
    return null;
  }

  async findLatestAttempt(paymentId: string): Promise<PaymentAttemptDto | null> {
    const list = [...this.attempts.values()]
      .filter((a) => a.paymentId === paymentId)
      .sort((a, b) => b.attemptNumber - a.attemptNumber);
    return list[0] ?? null;
  }

  async findRefundById(refundId: string): Promise<RefundDto | null> {
    return this.refunds.get(refundId) ?? null;
  }

  async findRefundByIdempotencyKey(key: string): Promise<RefundDto | null> {
    const id = this.refundsByKey.get(key);
    return id ? (this.refunds.get(id) ?? null) : null;
  }

  async findLedgerByIdempotencyKey(key: string): Promise<LedgerEntryDto | null> {
    return this.ledger.get(key) ?? null;
  }

  async sumActiveRefundAmounts(paymentId: string): Promise<number> {
    return [...this.refunds.values()]
      .filter(
        (r) =>
          r.paymentId === paymentId &&
          (r.status === "REQUESTED" ||
            r.status === "PENDING" ||
            r.status === "SUCCESS"),
      )
      .reduce((sum, r) => sum + r.amount, 0);
  }

  async findCreateIdempotency(
    customerId: string,
    key: string,
  ): Promise<PaymentCreateIdempotencyRecord | null> {
    return this.idempotency.get(`${customerId}:${key}`) ?? null;
  }

  async saveCreateIdempotency(input: PaymentCreateIdempotencyRecord): Promise<void> {
    this.idempotency.set(`${input.customerId}:${input.key}`, input);
  }

  async createPayment(input: {
    deliveryId: string;
    customerId: string;
    amount: number;
    currency: PaymentDto["currency"];
    gateway: PaymentDto["gateway"];
    pricingSource: PaymentPricingSource;
  }): Promise<PaymentDto> {
    const payment: PaymentDto = {
      id: randomUUID(),
      deliveryId: input.deliveryId,
      customerId: input.customerId,
      amount: input.amount,
      currency: input.currency,
      status: "CREATED",
      gateway: input.gateway,
      gatewayOrderId: null,
      gatewayPaymentSessionId: null,
      pricingSource: input.pricingSource,
      paidAt: null,
      failedAt: null,
      expiredAt: null,
      refundedAmount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.payments.set(payment.id, payment);
    this.paymentsByDelivery.set(input.deliveryId, payment.id);
    return payment;
  }

  async updatePaymentStatus(input: {
    paymentId: string;
    fromStatuses: PaymentDto["status"][];
    toStatus: PaymentDto["status"];
    gatewayOrderId?: string | null;
    gatewayPaymentSessionId?: string | null;
    paidAt?: Date | null;
    failedAt?: Date | null;
    expiredAt?: Date | null;
    refundedAmount?: number;
  }): Promise<PaymentDto | null> {
    const current = this.payments.get(input.paymentId);
    if (!current || !input.fromStatuses.includes(current.status)) {
      return null;
    }
    const updated: PaymentDto = {
      ...current,
      status: input.toStatus,
      gatewayOrderId:
        input.gatewayOrderId !== undefined
          ? input.gatewayOrderId
          : current.gatewayOrderId,
      gatewayPaymentSessionId:
        input.gatewayPaymentSessionId !== undefined
          ? input.gatewayPaymentSessionId
          : current.gatewayPaymentSessionId,
      paidAt: input.paidAt !== undefined ? input.paidAt : current.paidAt,
      failedAt: input.failedAt !== undefined ? input.failedAt : current.failedAt,
      expiredAt: input.expiredAt !== undefined ? input.expiredAt : current.expiredAt,
      refundedAmount:
        input.refundedAmount !== undefined
          ? input.refundedAmount
          : current.refundedAmount,
      updatedAt: new Date(),
    };
    this.payments.set(updated.id, updated);
    return updated;
  }

  async createAttempt(input: {
    paymentId: string;
    attemptNumber: number;
    amount: number;
    currency: PaymentAttemptDto["currency"];
    gatewayOrderId?: string | null;
    status?: PaymentAttemptDto["status"];
    startedAt?: Date;
  }): Promise<PaymentAttemptDto> {
    const attempt: PaymentAttemptDto = {
      id: randomUUID(),
      paymentId: input.paymentId,
      attemptNumber: input.attemptNumber,
      gatewayPaymentId: null,
      gatewayOrderId: input.gatewayOrderId ?? null,
      status: input.status ?? "CREATED",
      amount: input.amount,
      currency: input.currency,
      paymentMethod: null,
      failureCode: null,
      failureMessage: null,
      metadata: null,
      startedAt: input.startedAt ?? new Date(),
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.attempts.set(attempt.id, attempt);
    return attempt;
  }

  async updateAttempt(input: {
    attemptId: string;
    status: PaymentAttemptDto["status"];
    gatewayPaymentId?: string | null;
    paymentMethod?: string | null;
    failureCode?: string | null;
    failureMessage?: string | null;
    completedAt?: Date | null;
  }): Promise<PaymentAttemptDto> {
    const current = this.attempts.get(input.attemptId);
    if (!current) {
      throw new Error("Attempt not found");
    }
    const updated = {
      ...current,
      status: input.status,
      gatewayPaymentId:
        input.gatewayPaymentId !== undefined
          ? input.gatewayPaymentId
          : current.gatewayPaymentId,
      paymentMethod:
        input.paymentMethod !== undefined ? input.paymentMethod : current.paymentMethod,
      failureCode:
        input.failureCode !== undefined ? input.failureCode : current.failureCode,
      failureMessage:
        input.failureMessage !== undefined
          ? input.failureMessage
          : current.failureMessage,
      completedAt:
        input.completedAt !== undefined ? input.completedAt : current.completedAt,
      updatedAt: new Date(),
    };
    this.attempts.set(updated.id, updated);
    return updated;
  }

  async createRefund(input: {
    paymentId: string;
    deliveryId: string;
    amount: number;
    currency: RefundDto["currency"];
    idempotencyKey: string;
    reasonCode?: string | null;
    reason?: string | null;
    status?: RefundDto["status"];
  }): Promise<RefundDto> {
    const refund: RefundDto = {
      id: randomUUID(),
      paymentId: input.paymentId,
      deliveryId: input.deliveryId,
      amount: input.amount,
      currency: input.currency,
      status: input.status ?? "REQUESTED",
      reasonCode: input.reasonCode ?? null,
      reason: input.reason ?? null,
      gatewayRefundId: null,
      gatewayRefundReference: null,
      idempotencyKey: input.idempotencyKey,
      requestedAt: new Date(),
      processedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.refunds.set(refund.id, refund);
    this.refundsByKey.set(refund.idempotencyKey, refund.id);
    return refund;
  }

  async updateRefundStatus(input: {
    refundId: string;
    fromStatuses: RefundDto["status"][];
    toStatus: RefundDto["status"];
    gatewayRefundId?: string | null;
    gatewayRefundReference?: string | null;
    processedAt?: Date | null;
  }): Promise<RefundDto | null> {
    const current = this.refunds.get(input.refundId);
    if (!current || !input.fromStatuses.includes(current.status)) {
      return null;
    }
    const updated = {
      ...current,
      status: input.toStatus,
      gatewayRefundId:
        input.gatewayRefundId !== undefined
          ? input.gatewayRefundId
          : current.gatewayRefundId,
      gatewayRefundReference:
        input.gatewayRefundReference !== undefined
          ? input.gatewayRefundReference
          : current.gatewayRefundReference,
      processedAt:
        input.processedAt !== undefined ? input.processedAt : current.processedAt,
      updatedAt: new Date(),
    };
    this.refunds.set(updated.id, updated);
    return updated;
  }

  async createLedgerEntry(input: {
    deliveryId: string;
    paymentId: string;
    refundId?: string | null;
    type: LedgerEntryDto["type"];
    direction: LedgerEntryDto["direction"];
    amount: number;
    currency: LedgerEntryDto["currency"];
    description?: string | null;
    idempotencyKey: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<LedgerEntryDto> {
    if (this.ledger.has(input.idempotencyKey)) {
      throw new Error("Duplicate ledger idempotency key");
    }
    const entry: LedgerEntryDto = {
      id: randomUUID(),
      deliveryId: input.deliveryId,
      paymentId: input.paymentId,
      refundId: input.refundId ?? null,
      type: input.type,
      direction: input.direction,
      amount: input.amount,
      currency: input.currency,
      description: input.description ?? null,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata ?? null,
      createdAt: new Date(),
    };
    this.ledger.set(input.idempotencyKey, entry);
    return entry;
  }
}
