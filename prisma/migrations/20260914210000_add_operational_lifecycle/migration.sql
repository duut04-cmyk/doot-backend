-- CreateEnum
CREATE TYPE "DriverAssignmentStatus" AS ENUM ('PENDING', 'ASSIGNED', 'UNASSIGNED', 'UNKNOWN');
CREATE TYPE "OperationalDataSource" AS ENUM ('PROVIDER_POLL', 'PROVIDER_WEBHOOK', 'BOOKING_RESPONSE', 'SYSTEM');
CREATE TYPE "DeliveryOtpType" AS ENUM ('PICKUP', 'DELIVERY');
CREATE TYPE "CancellationStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'CANCELLED', 'REJECTED', 'UNKNOWN');
CREATE TYPE "TrackingPointSource" AS ENUM ('PROVIDER_POLL', 'PROVIDER_WEBHOOK', 'SYSTEM');

-- CreateTable
CREATE TABLE "DriverAssignment" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "providerBookingId" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "providerDriverId" TEXT,
    "driverName" TEXT,
    "driverPhone" TEXT,
    "driverPhotoUrl" TEXT,
    "providerRating" DECIMAL(4,2),
    "vehicleType" TEXT,
    "vehicleNumber" TEXT,
    "assignedAt" TIMESTAMP(3),
    "status" "DriverAssignmentStatus" NOT NULL,
    "source" "OperationalDataSource" NOT NULL,
    "providerStatus" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryOtp" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "type" "DeliveryOtpType" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryOtp_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryTrackingPoint" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "providerBookingId" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "providerEventId" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "accuracyMeters" INTEGER,
    "providerTimestamp" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "eta" TIMESTAMP(3),
    "providerStatus" TEXT,
    "normalizedStatus" TEXT,
    "trackingUrl" TEXT,
    "source" "TrackingPointSource" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryTrackingPoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryCancellation" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "providerBookingId" UUID,
    "providerId" UUID,
    "reasonCode" TEXT NOT NULL,
    "reasonMessage" TEXT,
    "status" "CancellationStatus" NOT NULL,
    "correlationReference" TEXT NOT NULL,
    "providerCancellationReference" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryCancellation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CancellationIdempotencyKey" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "deliveryId" UUID NOT NULL,
    "responsePayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CancellationIdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "DriverAssignment_deliveryId_idx" ON "DriverAssignment"("deliveryId");
CREATE INDEX "DriverAssignment_providerBookingId_idx" ON "DriverAssignment"("providerBookingId");
CREATE INDEX "DriverAssignment_status_idx" ON "DriverAssignment"("status");
CREATE UNIQUE INDEX "DriverAssignment_one_active_per_delivery" ON "DriverAssignment"("deliveryId") WHERE "status" = 'ASSIGNED';

CREATE INDEX "DeliveryOtp_deliveryId_type_idx" ON "DeliveryOtp"("deliveryId", "type");
CREATE INDEX "DeliveryOtp_expiresAt_idx" ON "DeliveryOtp"("expiresAt");
CREATE UNIQUE INDEX "DeliveryOtp_one_active_per_type" ON "DeliveryOtp"("deliveryId", "type") WHERE "consumedAt" IS NULL;

CREATE INDEX "DeliveryTrackingPoint_deliveryId_createdAt_idx" ON "DeliveryTrackingPoint"("deliveryId", "createdAt");
CREATE INDEX "DeliveryTrackingPoint_providerBookingId_idx" ON "DeliveryTrackingPoint"("providerBookingId");
CREATE UNIQUE INDEX "DeliveryTrackingPoint_provider_event_unique" ON "DeliveryTrackingPoint"("providerId", "providerEventId") WHERE "providerEventId" IS NOT NULL;

CREATE INDEX "DeliveryCancellation_deliveryId_idx" ON "DeliveryCancellation"("deliveryId");
CREATE INDEX "DeliveryCancellation_status_idx" ON "DeliveryCancellation"("status");
CREATE UNIQUE INDEX "DeliveryCancellation_correlationReference_key" ON "DeliveryCancellation"("correlationReference");

CREATE UNIQUE INDEX "CancellationIdempotencyKey_customerId_key_key" ON "CancellationIdempotencyKey"("customerId", "key");
CREATE INDEX "CancellationIdempotencyKey_deliveryId_idx" ON "CancellationIdempotencyKey"("deliveryId");

-- ForeignKeys
ALTER TABLE "DriverAssignment" ADD CONSTRAINT "DriverAssignment_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryOtp" ADD CONSTRAINT "DeliveryOtp_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryTrackingPoint" ADD CONSTRAINT "DeliveryTrackingPoint_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryCancellation" ADD CONSTRAINT "DeliveryCancellation_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CancellationIdempotencyKey" ADD CONSTRAINT "CancellationIdempotencyKey_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
