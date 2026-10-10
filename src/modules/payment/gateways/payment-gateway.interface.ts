import type {
  GatewayCreateOrderInput,
  GatewayCreateOrderResult,
  GatewayPaymentStatusResult,
  GatewayRefundInput,
  GatewayRefundResult,
  GatewayRefundStatusInput,
} from "./payment-gateway.types.js";

export interface PaymentGateway {
  readonly code: string;

  createPaymentOrder(input: GatewayCreateOrderInput): Promise<GatewayCreateOrderResult>;

  getPaymentStatus(input: {
    gatewayOrderId: string;
  }): Promise<GatewayPaymentStatusResult>;

  verifyPayment(input: {
    gatewayOrderId: string;
    gatewayPaymentId?: string | null;
  }): Promise<GatewayPaymentStatusResult>;

  createRefund(input: GatewayRefundInput): Promise<GatewayRefundResult>;

  getRefundStatus(input: GatewayRefundStatusInput): Promise<GatewayRefundResult>;
}
