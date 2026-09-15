-- CreateEnum
CREATE TYPE "OrchestrationRequestStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "OrchestrationEvaluationStatus" AS ENUM ('EVALUATED', 'ELIGIBLE', 'INELIGIBLE', 'ERROR', 'SKIPPED');

-- CreateTable
CREATE TABLE "OrchestrationRequest" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "requestedByUserId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "OrchestrationRequestStatus" NOT NULL,
    "failureReason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrchestrationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrchestrationEvaluation" (
    "id" UUID NOT NULL,
    "orchestrationRequestId" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "providerServiceId" UUID,
    "providerCode" TEXT NOT NULL,
    "providerServiceCode" TEXT,
    "status" "OrchestrationEvaluationStatus" NOT NULL,
    "serviceable" BOOLEAN,
    "availabilityKnown" BOOLEAN,
    "available" BOOLEAN,
    "availableDriverCount" INTEGER,
    "quoteAvailable" BOOLEAN,
    "quoteAmount" DECIMAL(12,2),
    "quoteCurrency" TEXT,
    "estimatedDeliveryAt" TIMESTAMP(3),
    "eligibilityReasons" JSONB NOT NULL DEFAULT '[]',
    "exclusionReasons" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "score" DECIMAL(8,4),
    "scoreBreakdown" JSONB,
    "normalizedResult" JSONB,
    "providerMetadata" JSONB,
    "errorCategory" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrchestrationEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrchestrationOption" (
    "id" UUID NOT NULL,
    "orchestrationRequestId" UUID NOT NULL,
    "evaluationId" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "providerServiceId" UUID,
    "providerCode" TEXT NOT NULL,
    "providerServiceCode" TEXT,
    "score" DECIMAL(8,4) NOT NULL,
    "scoreBreakdown" JSONB NOT NULL,
    "selectionReason" TEXT NOT NULL,
    "quoteSnapshot" JSONB NOT NULL,
    "availabilitySnapshot" JSONB,
    "etaSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrchestrationOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrchestrationRequest_deliveryId_attemptNumber_key" ON "OrchestrationRequest"("deliveryId", "attemptNumber");
CREATE INDEX "OrchestrationRequest_deliveryId_idx" ON "OrchestrationRequest"("deliveryId");
CREATE INDEX "OrchestrationRequest_status_idx" ON "OrchestrationRequest"("status");
CREATE INDEX "OrchestrationRequest_createdAt_idx" ON "OrchestrationRequest"("createdAt");
CREATE UNIQUE INDEX "OrchestrationRequest_one_running_per_delivery" ON "OrchestrationRequest"("deliveryId") WHERE "status" = 'RUNNING';

CREATE INDEX "OrchestrationEvaluation_orchestrationRequestId_idx" ON "OrchestrationEvaluation"("orchestrationRequestId");
CREATE INDEX "OrchestrationEvaluation_providerId_idx" ON "OrchestrationEvaluation"("providerId");
CREATE INDEX "OrchestrationEvaluation_status_idx" ON "OrchestrationEvaluation"("status");

CREATE UNIQUE INDEX "OrchestrationOption_orchestrationRequestId_key" ON "OrchestrationOption"("orchestrationRequestId");
CREATE UNIQUE INDEX "OrchestrationOption_evaluationId_key" ON "OrchestrationOption"("evaluationId");
CREATE INDEX "OrchestrationOption_providerId_idx" ON "OrchestrationOption"("providerId");

-- AddForeignKey
ALTER TABLE "OrchestrationRequest" ADD CONSTRAINT "OrchestrationRequest_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrchestrationRequest" ADD CONSTRAINT "OrchestrationRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrchestrationEvaluation" ADD CONSTRAINT "OrchestrationEvaluation_orchestrationRequestId_fkey" FOREIGN KEY ("orchestrationRequestId") REFERENCES "OrchestrationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrchestrationOption" ADD CONSTRAINT "OrchestrationOption_orchestrationRequestId_fkey" FOREIGN KEY ("orchestrationRequestId") REFERENCES "OrchestrationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrchestrationOption" ADD CONSTRAINT "OrchestrationOption_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "OrchestrationEvaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
