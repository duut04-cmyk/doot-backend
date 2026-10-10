import { CERT_SIMULATED_CF_PAYMENT_PREFIX } from "./constants.js";

export type PaidTier = "NONE" | "SIMULATED" | "LIVE_E2E";

export function classifyPaidTier(input: {
  paymentStatus: string | null | undefined;
  gatewayPaymentId: string | null | undefined;
}): PaidTier {
  if (input.paymentStatus !== "PAID") {
    return "NONE";
  }
  const gid = input.gatewayPaymentId?.trim() ?? "";
  if (!gid) {
    return "LIVE_E2E";
  }
  if (gid.startsWith(CERT_SIMULATED_CF_PAYMENT_PREFIX)) {
    return "SIMULATED";
  }
  return "LIVE_E2E";
}

export function isSimulatedGatewayPaymentId(
  gatewayPaymentId: string | null | undefined,
): boolean {
  return Boolean(gatewayPaymentId?.trim().startsWith(CERT_SIMULATED_CF_PAYMENT_PREFIX));
}
