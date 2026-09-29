import type {
  LedgerDirection,
  LedgerEntryType,
  PaymentAttemptStatus,
  PaymentCurrency,
  PaymentGatewayCode,
  PaymentStatus,
  Prisma,
  RefundStatus,
} from "@prisma/client";
import { Prisma as PrismaNamespace } from "@prisma/client";
import { getPrismaClient } from "../../config/database.js";
import { moneyToNumber, toMoneyDecimal } from "./payment.money.js";
import type {
  LedgerEntryDto,
  PaymentAttemptDto,
  PaymentCreateResponsePayload,
  PaymentDto,
  PaymentPricingSource,
  RefundDto,
} from "./payment.types.js";

export type PaymentDbClient =
  Prisma.TransactionClient | ReturnType<typeof getPrismaClient>;

function mapPayment(row: {
  id: string;
  deliveryId: string;
  customerId: string;
  amount: PrismaNamespace.Decimal;
  currency: PaymentCurrency;
  status: PaymentStatus;
  gateway: PaymentGatewayCode;
  gatewayOrderId: string | null;
  gatewayPaymentSessionId: string | null;
  pricingSource: unknown;
  paidAt: Date | null;
  failedAt: Date | null;
  expiredAt: Date | null;
  refundedAmount: PrismaNamespace.Decimal;
  createdAt: Date;
  updatedAt: Date;
}): PaymentDto {
  return {
    id: row.id,
    deliveryId: row.deliveryId,
    customerId: row.customerId,
    amount: moneyToNumber(row.amount),
    currency: row.currency,
    status: row.status,
    gateway: row.gateway,
    gatewayOrderId: row.gatewayOrderId,
    gatewayPaymentSessionId: row.gatewayPaymentSessionId,
    pricingSource: row.pricingSource as PaymentPricingSource,
    paidAt: row.paidAt,
    failedAt: row.failedAt,
    expiredAt: row.expiredAt,
    refundedAmount: moneyToNumber(row.refundedAmount),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapAttempt(row: {
  id: string;
  paymentId: string;
  attemptNumber: number;
  gatewayPaymentId: string | null;
  gatewayOrderId: string | null;
  status: PaymentAttemptStatus;
  amount: PrismaNamespace.Decimal;
  currency: PaymentCurrency;
  paymentMethod: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  metadata: unknown;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): PaymentAttemptDto {
  return {
    id: row.id,
    paymentId: row.paymentId,
    attemptNumber: row.attemptNumber,
    gatewayPaymentId: row.gatewayPaymentId,
    gatewayOrderId: row.gatewayOrderId,
    status: row.status,
    amount: moneyToNumber(row.amount),
    currency: row.currency,
    paymentMethod: row.paymentMethod,
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapRefund(row: {
  id: string;
  paymentId: string;
  deliveryId: string;
  amount: PrismaNamespace.Decimal;
  currency: PaymentCurrency;
  status: RefundStatus;
  reasonCode: string | null;
  reason: string | null;
  gatewayRefundId: string | null;
  gatewayRefundReference: string | null;
  idempotencyKey: string;
  requestedAt: Date;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): RefundDto {
  return {
    id: row.id,
    paymentId: row.paymentId,
    deliveryId: row.deliveryId,
    amount: moneyToNumber(row.amount),
    currency: row.currency,
    status: row.status,
    reasonCode: row.reasonCode,
    reason: row.reason,
    gatewayRefundId: row.gatewayRefundId,
    gatewayRefundReference: row.gatewayRefundReference,
    idempotencyKey: row.idempotencyKey,
    requestedAt: row.requestedAt,
    processedAt: row.processedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapLedger(row: {
  id: string;
  deliveryId: string;
  paymentId: string;
  refundId: string | null;
  type: LedgerEntryType;
  direction: LedgerDirection;
  amount: PrismaNamespace.Decimal;
  currency: PaymentCurrency;
  description: string | null;
  idempotencyKey: string;
  metadata: unknown;
  createdAt: Date;
}): LedgerEntryDto {
  return {
    id: row.id,
    deliveryId: row.deliveryId,
    paymentId: row.paymentId,
    refundId: row.refundId,
    type: row.type,
    direction: row.direction,
    amount: moneyToNumber(row.amount),
    currency: row.currency,
    description: row.description,
    idempotencyKey: row.idempotencyKey,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt,
  };
}

export type PaymentCreateIdempotencyRecord = {
  customerId: string;
  key: string;
  requestHash: string;
  deliveryId: string;
  responsePayload: PaymentCreateResponsePayload;
};

export interface IPaymentRepository {
  withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
  findByDeliveryId(deliveryId: string): Promise<PaymentDto | null>;
  findById(paymentId: string, client?: PaymentDbClient): Promise<PaymentDto | null>;
  findByGatewayOrderId(gatewayOrderId: string): Promise<PaymentDto | null>;
  findLatestAttempt(paymentId: string): Promise<PaymentAttemptDto | null>;
  findRefundById(refundId: string): Promise<RefundDto | null>;
  findRefundByIdempotencyKey(key: string): Promise<RefundDto | null>;
  findLedgerByIdempotencyKey(key: string): Promise<LedgerEntryDto | null>;
  sumActiveRefundAmounts(paymentId: string): Promise<number>;
  findCreateIdempotency(
    customerId: string,
    key: string,
  ): Promise<PaymentCreateIdempotencyRecord | null>;
  saveCreateIdempotency(input: PaymentCreateIdempotencyRecord): Promise<void>;
  createPayment(
    input: {
      deliveryId: string;
      customerId: string;
      amount: number;
      currency: PaymentCurrency;
      gateway: PaymentGatewayCode;
      pricingSource: PaymentPricingSource;
    },
    client?: PaymentDbClient,
  ): Promise<PaymentDto>;
  updatePaymentStatus(
    input: {
      paymentId: string;
      fromStatuses: PaymentStatus[];
      toStatus: PaymentStatus;
      gatewayOrderId?: string | null;
      gatewayPaymentSessionId?: string | null;
      paidAt?: Date | null;
      failedAt?: Date | null;
      expiredAt?: Date | null;
      refundedAmount?: number;
    },
    client?: PaymentDbClient,
  ): Promise<PaymentDto | null>;
  createAttempt(
    input: {
      paymentId: string;
      attemptNumber: number;
      amount: number;
      currency: PaymentCurrency;
      gatewayOrderId?: string | null;
      status?: PaymentAttemptStatus;
      startedAt?: Date;
    },
    client?: PaymentDbClient,
  ): Promise<PaymentAttemptDto>;
  updateAttempt(
    input: {
      attemptId: string;
      status: PaymentAttemptStatus;
      gatewayPaymentId?: string | null;
      paymentMethod?: string | null;
      failureCode?: string | null;
      failureMessage?: string | null;
      completedAt?: Date | null;
    },
    client?: PaymentDbClient,
  ): Promise<PaymentAttemptDto>;
  createRefund(
    input: {
      paymentId: string;
      deliveryId: string;
      amount: number;
      currency: PaymentCurrency;
      idempotencyKey: string;
      reasonCode?: string | null;
      reason?: string | null;
      status?: RefundStatus;
    },
    client?: PaymentDbClient,
  ): Promise<RefundDto>;
  updateRefundStatus(
    input: {
      refundId: string;
      fromStatuses: RefundStatus[];
      toStatus: RefundStatus;
      gatewayRefundId?: string | null;
      gatewayRefundReference?: string | null;
      processedAt?: Date | null;
    },
    client?: PaymentDbClient,
  ): Promise<RefundDto | null>;
  createLedgerEntry(
    input: {
      deliveryId: string;
      paymentId: string;
      refundId?: string | null;
      type: LedgerEntryType;
      direction: LedgerDirection;
      amount: number;
      currency: PaymentCurrency;
      description?: string | null;
      idempotencyKey: string;
      metadata?: Record<string, unknown> | null;
    },
    client?: PaymentDbClient,
  ): Promise<LedgerEntryDto>;
}

export class PrismaPaymentRepository implements IPaymentRepository {
  private db(client?: PaymentDbClient) {
    return client ?? getPrismaClient();
  }

  withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return getPrismaClient().$transaction(fn);
  }

  async findByDeliveryId(deliveryId: string): Promise<PaymentDto | null> {
    const row = await getPrismaClient().payment.findUnique({ where: { deliveryId } });
    return row ? mapPayment(row) : null;
  }

  async findById(
    paymentId: string,
    client?: PaymentDbClient,
  ): Promise<PaymentDto | null> {
    const row = await this.db(client).payment.findUnique({ where: { id: paymentId } });
    return row ? mapPayment(row) : null;
  }

  async findByGatewayOrderId(gatewayOrderId: string): Promise<PaymentDto | null> {
    const row = await getPrismaClient().payment.findUnique({
      where: { gatewayOrderId },
    });
    return row ? mapPayment(row) : null;
  }

  async findLatestAttempt(paymentId: string): Promise<PaymentAttemptDto | null> {
    const row = await getPrismaClient().paymentAttempt.findFirst({
      where: { paymentId },
      orderBy: { attemptNumber: "desc" },
    });
    return row ? mapAttempt(row) : null;
  }

  async findRefundById(refundId: string): Promise<RefundDto | null> {
    const row = await getPrismaClient().refund.findUnique({ where: { id: refundId } });
    return row ? mapRefund(row) : null;
  }

  async findRefundByIdempotencyKey(key: string): Promise<RefundDto | null> {
    const row = await getPrismaClient().refund.findUnique({
      where: { idempotencyKey: key },
    });
    return row ? mapRefund(row) : null;
  }

  async findLedgerByIdempotencyKey(key: string): Promise<LedgerEntryDto | null> {
    const row = await getPrismaClient().ledgerEntry.findUnique({
      where: { idempotencyKey: key },
    });
    return row ? mapLedger(row) : null;
  }

  async sumActiveRefundAmounts(paymentId: string): Promise<number> {
    const rows = await getPrismaClient().refund.findMany({
      where: {
        paymentId,
        status: { in: ["REQUESTED", "PENDING", "SUCCESS"] },
      },
      select: { amount: true },
    });
    return rows.reduce((sum, row) => sum + moneyToNumber(row.amount), 0);
  }

  async findCreateIdempotency(
    customerId: string,
    key: string,
  ): Promise<PaymentCreateIdempotencyRecord | null> {
    const row = await getPrismaClient().paymentCreateIdempotencyKey.findUnique({
      where: { customerId_key: { customerId, key } },
    });
    if (!row) return null;
    return {
      customerId: row.customerId,
      key: row.key,
      requestHash: row.requestHash,
      deliveryId: row.deliveryId,
      responsePayload: row.responsePayload as PaymentCreateResponsePayload,
    };
  }

  async saveCreateIdempotency(input: PaymentCreateIdempotencyRecord): Promise<void> {
    await getPrismaClient().paymentCreateIdempotencyKey.create({
      data: {
        customerId: input.customerId,
        key: input.key,
        requestHash: input.requestHash,
        deliveryId: input.deliveryId,
        responsePayload: input.responsePayload as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async createPayment(
    input: {
      deliveryId: string;
      customerId: string;
      amount: number;
      currency: PaymentCurrency;
      gateway: PaymentGatewayCode;
      pricingSource: PaymentPricingSource;
    },
    client?: PaymentDbClient,
  ): Promise<PaymentDto> {
    const row = await this.db(client).payment.create({
      data: {
        deliveryId: input.deliveryId,
        customerId: input.customerId,
        amount: toMoneyDecimal(input.amount),
        currency: input.currency,
        gateway: input.gateway,
        pricingSource: input.pricingSource as unknown as Prisma.InputJsonValue,
        status: "CREATED",
      },
    });
    return mapPayment(row);
  }

  async updatePaymentStatus(
    input: {
      paymentId: string;
      fromStatuses: PaymentStatus[];
      toStatus: PaymentStatus;
      gatewayOrderId?: string | null;
      gatewayPaymentSessionId?: string | null;
      paidAt?: Date | null;
      failedAt?: Date | null;
      expiredAt?: Date | null;
      refundedAmount?: number;
    },
    client?: PaymentDbClient,
  ): Promise<PaymentDto | null> {
    const result = await this.db(client).payment.updateMany({
      where: { id: input.paymentId, status: { in: input.fromStatuses } },
      data: {
        status: input.toStatus,
        gatewayOrderId: input.gatewayOrderId,
        gatewayPaymentSessionId: input.gatewayPaymentSessionId,
        paidAt: input.paidAt,
        failedAt: input.failedAt,
        expiredAt: input.expiredAt,
        refundedAmount:
          input.refundedAmount !== undefined
            ? toMoneyDecimal(input.refundedAmount)
            : undefined,
      },
    });
    if (result.count === 0) {
      return null;
    }
    const row = await this.db(client).payment.findUnique({
      where: { id: input.paymentId },
    });
    return row ? mapPayment(row) : null;
  }

  async createAttempt(
    input: {
      paymentId: string;
      attemptNumber: number;
      amount: number;
      currency: PaymentCurrency;
      gatewayOrderId?: string | null;
      status?: PaymentAttemptStatus;
      startedAt?: Date;
    },
    client?: PaymentDbClient,
  ): Promise<PaymentAttemptDto> {
    const row = await this.db(client).paymentAttempt.create({
      data: {
        paymentId: input.paymentId,
        attemptNumber: input.attemptNumber,
        amount: toMoneyDecimal(input.amount),
        currency: input.currency,
        gatewayOrderId: input.gatewayOrderId ?? null,
        status: input.status ?? "CREATED",
        startedAt: input.startedAt ?? new Date(),
      },
    });
    return mapAttempt(row);
  }

  async updateAttempt(
    input: {
      attemptId: string;
      status: PaymentAttemptStatus;
      gatewayPaymentId?: string | null;
      paymentMethod?: string | null;
      failureCode?: string | null;
      failureMessage?: string | null;
      completedAt?: Date | null;
    },
    client?: PaymentDbClient,
  ): Promise<PaymentAttemptDto> {
    const row = await this.db(client).paymentAttempt.update({
      where: { id: input.attemptId },
      data: {
        status: input.status,
        gatewayPaymentId: input.gatewayPaymentId,
        paymentMethod: input.paymentMethod,
        failureCode: input.failureCode,
        failureMessage: input.failureMessage,
        completedAt: input.completedAt,
      },
    });
    return mapAttempt(row);
  }

  async createRefund(
    input: {
      paymentId: string;
      deliveryId: string;
      amount: number;
      currency: PaymentCurrency;
      idempotencyKey: string;
      reasonCode?: string | null;
      reason?: string | null;
      status?: RefundStatus;
    },
    client?: PaymentDbClient,
  ): Promise<RefundDto> {
    const row = await this.db(client).refund.create({
      data: {
        paymentId: input.paymentId,
        deliveryId: input.deliveryId,
        amount: toMoneyDecimal(input.amount),
        currency: input.currency,
        idempotencyKey: input.idempotencyKey,
        reasonCode: input.reasonCode ?? null,
        reason: input.reason ?? null,
        status: input.status ?? "REQUESTED",
      },
    });
    return mapRefund(row);
  }

  async updateRefundStatus(
    input: {
      refundId: string;
      fromStatuses: RefundStatus[];
      toStatus: RefundStatus;
      gatewayRefundId?: string | null;
      gatewayRefundReference?: string | null;
      processedAt?: Date | null;
    },
    client?: PaymentDbClient,
  ): Promise<RefundDto | null> {
    const result = await this.db(client).refund.updateMany({
      where: { id: input.refundId, status: { in: input.fromStatuses } },
      data: {
        status: input.toStatus,
        gatewayRefundId: input.gatewayRefundId,
        gatewayRefundReference: input.gatewayRefundReference,
        processedAt: input.processedAt,
      },
    });
    if (result.count === 0) {
      return null;
    }
    const row = await this.db(client).refund.findUnique({
      where: { id: input.refundId },
    });
    return row ? mapRefund(row) : null;
  }

  async createLedgerEntry(
    input: {
      deliveryId: string;
      paymentId: string;
      refundId?: string | null;
      type: LedgerEntryType;
      direction: LedgerDirection;
      amount: number;
      currency: PaymentCurrency;
      description?: string | null;
      idempotencyKey: string;
      metadata?: Record<string, unknown> | null;
    },
    client?: PaymentDbClient,
  ): Promise<LedgerEntryDto> {
    const row = await this.db(client).ledgerEntry.create({
      data: {
        deliveryId: input.deliveryId,
        paymentId: input.paymentId,
        refundId: input.refundId ?? null,
        type: input.type,
        direction: input.direction,
        amount: toMoneyDecimal(input.amount),
        currency: input.currency,
        description: input.description ?? null,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata
          ? (input.metadata as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });
    return mapLedger(row);
  }
}

export const paymentRepository = new PrismaPaymentRepository();
