-- Phase 2A: Cashfree gateway support (sandbox adapter)
ALTER TYPE "PaymentGatewayCode" ADD VALUE IF NOT EXISTS 'CASHFREE';

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "gatewayPaymentSessionId" TEXT;
