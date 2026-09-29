import { randomUUID } from "node:crypto";
import type { PaymentGatewayCode } from "@prisma/client";
import type { PaymentGateway } from "./payment-gateway.interface.js";
import type {
  GatewayCreateOrderInput,
  GatewayCreateOrderResult,
  GatewayPaymentStatusResult,
  GatewayRefundInput,
  GatewayRefundResult,
} from "./payment-gateway.types.js";

export class StubPaymentGateway implements PaymentGateway {
  readonly code: PaymentGatewayCode = "STUB";

  async createPaymentOrder(
    input: GatewayCreateOrderInput,
  ): Promise<GatewayCreateOrderResult> {
    return {
      gatewayOrderId: `stub_order_${input.paymentId.replace(/-/g, "").slice(0, 12)}`,
      metadata: { stub: true, deliveryId: input.deliveryId },
    };
  }

  async getPaymentStatus(input: {
    gatewayOrderId: string;
  }): Promise<GatewayPaymentStatusResult> {
    return {
      status: "PENDING",
      gatewayPaymentId: null,
      metadata: { gatewayOrderId: input.gatewayOrderId },
    };
  }

  async verifyPayment(input: {
    gatewayOrderId: string;
    gatewayPaymentId?: string | null;
  }): Promise<GatewayPaymentStatusResult> {
    return {
      status: "PENDING",
      gatewayPaymentId: input.gatewayPaymentId ?? null,
      metadata: { gatewayOrderId: input.gatewayOrderId },
    };
  }

  async createRefund(input: GatewayRefundInput): Promise<GatewayRefundResult> {
    return {
      gatewayRefundId: `stub_refund_${randomUUID()}`,
      gatewayRefundReference: input.idempotencyKey,
      status: "PENDING",
    };
  }

  async getRefundStatus(input: {
    gatewayRefundId: string;
  }): Promise<GatewayRefundResult> {
    return {
      gatewayRefundId: input.gatewayRefundId,
      status: "PENDING",
    };
  }
}

export const stubPaymentGateway = new StubPaymentGateway();
