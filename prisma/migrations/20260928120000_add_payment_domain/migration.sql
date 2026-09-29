-- Payment domain Phase 1 (provider-neutral)

CREATE TYPE "PaymentCurrency" AS ENUM ('INR');

CREATE TYPE "PaymentStatus" AS ENUM (
  'CREATED',
  'PENDING',
  'PAID',
  'FAILED',
  'EXPIRED',
  'PARTIALLY_REFUNDED',
  'REFUNDED'
);

CREATE TYPE "PaymentAttemptStatus" AS ENUM ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED');

CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'PENDING', 'SUCCESS', 'FAILED', 'CANCELLED');

CREATE TYPE "LedgerEntryType" AS ENUM (
  'CUSTOMER_PAYMENT',
  'REFUND',
  'CANCELLATION_FEE',
  'PROVIDER_PAYABLE',
  'PLATFORM_REVENUE',
  'MANUAL_ADJUSTMENT'
);

CREATE TYPE "LedgerDirection" AS ENUM ('CREDIT', 'DEBIT');

CREATE TYPE "PaymentGatewayCode" AS ENUM ('STUB');

CREATE TABLE "Payment" (
  "id" UUID NOT NULL,
  "deliveryId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" "PaymentCurrency" NOT NULL DEFAULT 'INR',
  "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
  "gateway" "PaymentGatewayCode" NOT NULL DEFAULT 'STUB',
  "gatewayOrderId" TEXT,
  "pricingSource" JSONB NOT NULL,
  "paidAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "expiredAt" TIMESTAMP(3),
  "refundedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentAttempt" (
  "id" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "attemptNumber" INT NOT NULL,
  "gatewayPaymentId" TEXT,
  "gatewayOrderId" TEXT,
  "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'CREATED',
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" "PaymentCurrency" NOT NULL DEFAULT 'INR',
  "paymentMethod" TEXT,
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "metadata" JSONB,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Refund" (
  "id" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "deliveryId" UUID NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" "PaymentCurrency" NOT NULL DEFAULT 'INR',
  "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
  "reasonCode" TEXT,
  "reason" TEXT,
  "gatewayRefundId" TEXT,
  "gatewayRefundReference" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LedgerEntry" (
  "id" UUID NOT NULL,
  "deliveryId" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "refundId" UUID,
  "type" "LedgerEntryType" NOT NULL,
  "direction" "LedgerDirection" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" "PaymentCurrency" NOT NULL DEFAULT 'INR',
  "description" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentCreateIdempotencyKey" (
  "id" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "deliveryId" UUID NOT NULL,
  "responsePayload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PaymentCreateIdempotencyKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Payment_deliveryId_key" ON "Payment"("deliveryId");
CREATE UNIQUE INDEX "Payment_gatewayOrderId_key" ON "Payment"("gatewayOrderId");
CREATE INDEX "Payment_customerId_idx" ON "Payment"("customerId");
CREATE INDEX "Payment_status_idx" ON "Payment"("status");
CREATE INDEX "Payment_createdAt_idx" ON "Payment"("createdAt");

CREATE UNIQUE INDEX "PaymentAttempt_paymentId_attemptNumber_key" ON "PaymentAttempt"("paymentId", "attemptNumber");
CREATE INDEX "PaymentAttempt_paymentId_idx" ON "PaymentAttempt"("paymentId");
CREATE INDEX "PaymentAttempt_status_idx" ON "PaymentAttempt"("status");

CREATE UNIQUE INDEX "Refund_idempotencyKey_key" ON "Refund"("idempotencyKey");
CREATE INDEX "Refund_paymentId_idx" ON "Refund"("paymentId");
CREATE INDEX "Refund_deliveryId_idx" ON "Refund"("deliveryId");
CREATE INDEX "Refund_status_idx" ON "Refund"("status");

CREATE UNIQUE INDEX "LedgerEntry_idempotencyKey_key" ON "LedgerEntry"("idempotencyKey");
CREATE INDEX "LedgerEntry_deliveryId_idx" ON "LedgerEntry"("deliveryId");
CREATE INDEX "LedgerEntry_paymentId_idx" ON "LedgerEntry"("paymentId");
CREATE INDEX "LedgerEntry_refundId_idx" ON "LedgerEntry"("refundId");
CREATE INDEX "LedgerEntry_type_idx" ON "LedgerEntry"("type");

CREATE UNIQUE INDEX "PaymentCreateIdempotencyKey_customerId_key_key" ON "PaymentCreateIdempotencyKey"("customerId", "key");
CREATE INDEX "PaymentCreateIdempotencyKey_deliveryId_idx" ON "PaymentCreateIdempotencyKey"("deliveryId");

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaymentCreateIdempotencyKey" ADD CONSTRAINT "PaymentCreateIdempotencyKey_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_refunded_amount_valid" CHECK ("refundedAmount" >= 0 AND "refundedAmount" <= "amount");
