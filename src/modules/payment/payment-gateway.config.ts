import type { PaymentGatewayCode } from "@prisma/client";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import { env, isCashfreeConfigured } from "../../config/env.js";

export function resolveActivePaymentGatewayCode(): PaymentGatewayCode {
  const selected = env.PAYMENT_GATEWAY ?? "stub";
  if (selected === "cashfree") {
    return "CASHFREE";
  }
  return "STUB";
}

export function assertPaymentGatewayReady(code: PaymentGatewayCode): void {
  if (code === "CASHFREE" && !isCashfreeConfigured()) {
    throw new AppError(
      "Cashfree payment gateway is selected but sandbox credentials are not configured.",
      {
        statusCode: 503,
        code: ErrorCodes.PAYMENT_GATEWAY_NOT_CONFIGURED,
      },
    );
  }
}
