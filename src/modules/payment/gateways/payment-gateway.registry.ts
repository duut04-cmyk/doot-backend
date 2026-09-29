import type { PaymentGatewayCode } from "@prisma/client";
import { cashfreePaymentGateway } from "./cashfree-payment.gateway.js";
import type { PaymentGateway } from "./payment-gateway.interface.js";
import { stubPaymentGateway } from "./stub-payment.gateway.js";

const gateways = new Map<PaymentGatewayCode, PaymentGateway>([
  ["STUB", stubPaymentGateway],
  ["CASHFREE", cashfreePaymentGateway],
]);

export function getPaymentGateway(code: PaymentGatewayCode): PaymentGateway {
  const gateway = gateways.get(code);
  if (!gateway) {
    throw new Error(`Payment gateway not registered: ${code}`);
  }
  return gateway;
}
