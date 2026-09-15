-- CreateEnum
CREATE TYPE "ProviderWebhookProcessingStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateTable
CREATE TABLE "ProviderWebhookEvent" (
    "id" UUID NOT NULL,
    "providerCode" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "providerEventKey" TEXT NOT NULL,
    "providerOrderId" TEXT,
    "providerDeliveryId" TEXT,
    "eventDatetime" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signatureVerified" BOOLEAN NOT NULL,
    "processingStatus" "ProviderWebhookProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,
    "payloadHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "normalizedEvent" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderWebhookEvent_providerEventKey_key" ON "ProviderWebhookEvent"("providerEventKey");

-- CreateIndex
CREATE INDEX "ProviderWebhookEvent_providerCode_idx" ON "ProviderWebhookEvent"("providerCode");

-- CreateIndex
CREATE INDEX "ProviderWebhookEvent_providerOrderId_idx" ON "ProviderWebhookEvent"("providerOrderId");

-- CreateIndex
CREATE INDEX "ProviderWebhookEvent_providerDeliveryId_idx" ON "ProviderWebhookEvent"("providerDeliveryId");

-- CreateIndex
CREATE INDEX "ProviderWebhookEvent_eventType_idx" ON "ProviderWebhookEvent"("eventType");

-- CreateIndex
CREATE INDEX "ProviderWebhookEvent_receivedAt_idx" ON "ProviderWebhookEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "ProviderWebhookEvent_processingStatus_idx" ON "ProviderWebhookEvent"("processingStatus");
