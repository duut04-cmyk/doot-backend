-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM (
  'CREATED',
  'ORCHESTRATING',
  'OPTION_READY',
  'BOOKING',
  'BOOKED',
  'DRIVER_ASSIGNED',
  'PICKUP_OTP_PENDING',
  'PICKED_UP',
  'IN_TRANSIT',
  'DELIVERY_OTP_PENDING',
  'DELIVERED',
  'CANCELLED',
  'FAILED'
);

-- CreateEnum
CREATE TYPE "PackageType" AS ENUM ('MEDICINE', 'FOOD', 'DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "PackageSizeTier" AS ENUM ('SMALL', 'MEDIUM', 'LARGE');

-- CreateEnum
CREATE TYPE "HandlingRequirement" AS ENUM ('HANDLE_WITH_CARE', 'FRAGILE', 'KEEP_UPRIGHT');

-- CreateEnum
CREATE TYPE "ScheduleMode" AS ENUM ('ASAP', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "StatusEventSource" AS ENUM (
  'SYSTEM',
  'CUSTOMER',
  'ADMIN',
  'PROVIDER',
  'WEBHOOK',
  'ORCHESTRATION',
  'BOOKING',
  'OTP',
  'TRACKING'
);

-- Concurrency-safe delivery reference sequence (never COUNT(*) / MAX)
CREATE SEQUENCE "delivery_reference_seq" START WITH 1000 INCREMENT BY 1;

-- CreateTable
CREATE TABLE "Delivery" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'CREATED',
    "specialInstructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryPickup" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "addressText" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "instructions" TEXT,

    CONSTRAINT "DeliveryPickup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryDrop" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "addressText" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "instructions" TEXT,

    CONSTRAINT "DeliveryDrop_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryPackage" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "packageType" "PackageType" NOT NULL,
    "description" TEXT,
    "weightKg" DECIMAL(10,3) NOT NULL,
    "lengthCm" DECIMAL(10,2),
    "widthCm" DECIMAL(10,2),
    "heightCm" DECIMAL(10,2),
    "sizeTier" "PackageSizeTier" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DeliveryPackage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryPackagePhoto" (
    "id" UUID NOT NULL,
    "packageId" UUID NOT NULL,
    "objectKey" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'PENDING',
    "mimeType" TEXT,
    "fileSizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryPackagePhoto_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryHandlingRequirement" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "requirement" "HandlingRequirement" NOT NULL,

    CONSTRAINT "DeliveryHandlingRequirement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliverySchedule" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "mode" "ScheduleMode" NOT NULL,
    "timezone" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),

    CONSTRAINT "DeliverySchedule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryCompliance" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryCompliance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryStatusEvent" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "fromStatus" "DeliveryStatus",
    "toStatus" "DeliveryStatus" NOT NULL,
    "source" "StatusEventSource" NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryStatusEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryIdempotencyKey" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "deliveryId" UUID NOT NULL,
    "responsePayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryIdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- Indexes & uniques
CREATE UNIQUE INDEX "Delivery_reference_key" ON "Delivery"("reference");
CREATE INDEX "Delivery_customerId_idx" ON "Delivery"("customerId");
CREATE INDEX "Delivery_status_idx" ON "Delivery"("status");
CREATE INDEX "Delivery_createdAt_idx" ON "Delivery"("createdAt");
CREATE INDEX "Delivery_customerId_createdAt_idx" ON "Delivery"("customerId", "createdAt");

CREATE UNIQUE INDEX "DeliveryPickup_deliveryId_key" ON "DeliveryPickup"("deliveryId");
CREATE UNIQUE INDEX "DeliveryDrop_deliveryId_key" ON "DeliveryDrop"("deliveryId");
CREATE UNIQUE INDEX "DeliveryPackage_deliveryId_key" ON "DeliveryPackage"("deliveryId");
CREATE INDEX "DeliveryPackagePhoto_packageId_idx" ON "DeliveryPackagePhoto"("packageId");
CREATE UNIQUE INDEX "DeliveryPackagePhoto_packageId_objectKey_key" ON "DeliveryPackagePhoto"("packageId", "objectKey");
CREATE UNIQUE INDEX "DeliveryHandlingRequirement_deliveryId_requirement_key" ON "DeliveryHandlingRequirement"("deliveryId", "requirement");
CREATE INDEX "DeliveryHandlingRequirement_deliveryId_idx" ON "DeliveryHandlingRequirement"("deliveryId");
CREATE UNIQUE INDEX "DeliverySchedule_deliveryId_key" ON "DeliverySchedule"("deliveryId");
CREATE UNIQUE INDEX "DeliveryCompliance_deliveryId_key" ON "DeliveryCompliance"("deliveryId");
CREATE INDEX "DeliveryStatusEvent_deliveryId_idx" ON "DeliveryStatusEvent"("deliveryId");
CREATE INDEX "DeliveryStatusEvent_createdAt_idx" ON "DeliveryStatusEvent"("createdAt");
CREATE UNIQUE INDEX "DeliveryIdempotencyKey_deliveryId_key" ON "DeliveryIdempotencyKey"("deliveryId");
CREATE UNIQUE INDEX "DeliveryIdempotencyKey_customerId_key_key" ON "DeliveryIdempotencyKey"("customerId", "key");
CREATE INDEX "DeliveryIdempotencyKey_customerId_idx" ON "DeliveryIdempotencyKey"("customerId");

-- Foreign keys
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeliveryPickup" ADD CONSTRAINT "DeliveryPickup_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryDrop" ADD CONSTRAINT "DeliveryDrop_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryPackage" ADD CONSTRAINT "DeliveryPackage_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryPackagePhoto" ADD CONSTRAINT "DeliveryPackagePhoto_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "DeliveryPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryHandlingRequirement" ADD CONSTRAINT "DeliveryHandlingRequirement_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliverySchedule" ADD CONSTRAINT "DeliverySchedule_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryCompliance" ADD CONSTRAINT "DeliveryCompliance_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryStatusEvent" ADD CONSTRAINT "DeliveryStatusEvent_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryIdempotencyKey" ADD CONSTRAINT "DeliveryIdempotencyKey_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
