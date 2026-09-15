-- CreateEnum
CREATE TYPE "ProviderBookingStatus" AS ENUM ('PENDING', 'BOOKING', 'BOOKED', 'FAILED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "ProviderBooking" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "orchestrationRequestId" UUID NOT NULL,
    "orchestrationOptionId" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "providerServiceId" UUID,
    "providerCode" TEXT NOT NULL,
    "providerServiceCode" TEXT,
    "status" "ProviderBookingStatus" NOT NULL,
    "correlationReference" TEXT NOT NULL,
    "providerOrderId" TEXT,
    "providerReference" TEXT,
    "providerStatus" TEXT,
    "quotedAmount" DECIMAL(12,2),
    "quotedCurrency" TEXT,
    "bookedAmount" DECIMAL(12,2),
    "bookedCurrency" TEXT,
    "providerQuoteId" TEXT,
    "quoteSnapshot" JSONB NOT NULL,
    "unknownOutcome" BOOLEAN NOT NULL DEFAULT false,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "requestId" TEXT,
    "bookedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingConfirmIdempotencyKey" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "deliveryId" UUID NOT NULL,
    "responsePayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingConfirmIdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderBooking_deliveryId_attemptNumber_key" ON "ProviderBooking"("deliveryId", "attemptNumber");
CREATE UNIQUE INDEX "ProviderBooking_correlationReference_key" ON "ProviderBooking"("correlationReference");
CREATE INDEX "ProviderBooking_deliveryId_idx" ON "ProviderBooking"("deliveryId");
CREATE INDEX "ProviderBooking_providerId_idx" ON "ProviderBooking"("providerId");
CREATE INDEX "ProviderBooking_status_idx" ON "ProviderBooking"("status");
CREATE INDEX "ProviderBooking_providerOrderId_idx" ON "ProviderBooking"("providerOrderId");
CREATE INDEX "ProviderBooking_createdAt_idx" ON "ProviderBooking"("createdAt");
CREATE UNIQUE INDEX "ProviderBooking_one_active_per_delivery" ON "ProviderBooking"("deliveryId") WHERE "status" IN ('PENDING', 'BOOKING');
CREATE UNIQUE INDEX "ProviderBooking_providerOrderId_unique" ON "ProviderBooking"("providerOrderId") WHERE "providerOrderId" IS NOT NULL;

CREATE UNIQUE INDEX "BookingConfirmIdempotencyKey_customerId_key_key" ON "BookingConfirmIdempotencyKey"("customerId", "key");
CREATE INDEX "BookingConfirmIdempotencyKey_customerId_idx" ON "BookingConfirmIdempotencyKey"("customerId");
CREATE INDEX "BookingConfirmIdempotencyKey_deliveryId_idx" ON "BookingConfirmIdempotencyKey"("deliveryId");

-- AddForeignKey
ALTER TABLE "ProviderBooking" ADD CONSTRAINT "ProviderBooking_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BookingConfirmIdempotencyKey" ADD CONSTRAINT "BookingConfirmIdempotencyKey_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
