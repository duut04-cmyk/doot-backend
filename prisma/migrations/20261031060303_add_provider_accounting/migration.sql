-- CreateEnum
CREATE TYPE "ProviderAccountingCurrency" AS ENUM ('INR');

-- CreateEnum
CREATE TYPE "ProviderInvoiceStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'DISPUTED', 'VOID');

-- CreateEnum
CREATE TYPE "ProviderInvoiceLineKind" AS ENUM ('DELIVERY_CHARGE', 'WAITING_FEE', 'RTO_CHARGE', 'SURCHARGE', 'HEADER_VARIANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "ProviderInvoiceHeaderVarianceResolution" AS ENUM ('PENDING', 'LINES_CORRECTED', 'VARIANCE_ADJUSTMENT', 'RESOLVED_AT_APPROVAL');

-- CreateEnum
CREATE TYPE "ProviderPayableStatus" AS ENUM ('APPROVED', 'PARTIALLY_SETTLED', 'SETTLED', 'DISPUTED', 'VOID');

-- CreateEnum
CREATE TYPE "ProviderPayableSettlementKind" AS ENUM ('PAYOUT', 'CREDIT', 'MIXED', 'ADJUSTMENT_ONLY');

-- CreateEnum
CREATE TYPE "ProviderPayableAttributionStatus" AS ENUM ('FULLY_ATTRIBUTED', 'PARTIALLY_ATTRIBUTED', 'UNATTRIBUTED');

-- CreateEnum
CREATE TYPE "ProviderPayoutStatus" AS ENUM ('DRAFT', 'INITIATED', 'CONFIRMED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ProviderPayoutMethod" AS ENUM ('BANK_TRANSFER', 'UPI', 'NEFT', 'IMPS', 'RTGS', 'CHEQUE', 'OTHER');

-- CreateEnum
CREATE TYPE "ProviderPayoutAllocationState" AS ENUM ('PLANNED', 'EFFECTIVE', 'VOID');

-- CreateEnum
CREATE TYPE "ProviderCreditNoteStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CONFIRMED', 'DISPUTED', 'VOID');

-- CreateEnum
CREATE TYPE "ProviderCreditNoteLineKind" AS ENUM ('DELIVERY_CREDIT', 'RTO_CREDIT', 'SURCHARGE_REVERSAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ProviderCreditApplicationState" AS ENUM ('PLANNED', 'CONFIRMED', 'VOID');

-- CreateEnum
CREATE TYPE "ProviderAccountingAdjustmentType" AS ENUM ('PAYABLE_INCREASE', 'PAYABLE_DECREASE', 'INVOICE_CORRECTION', 'HEADER_VARIANCE', 'WRITE_OFF', 'OTHER');

-- CreateEnum
CREATE TYPE "ProviderAccountingAdjustmentStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'VOID');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminAuditAction" ADD VALUE 'PROVIDER_INVOICE_UPLOADED';
ALTER TYPE "AdminAuditAction" ADD VALUE 'PROVIDER_INVOICE_SUBMITTED';
ALTER TYPE "AdminAuditAction" ADD VALUE 'PROVIDER_INVOICE_APPROVED';
ALTER TYPE "AdminAuditAction" ADD VALUE 'PROVIDER_INVOICE_DISPUTED';
ALTER TYPE "AdminAuditAction" ADD VALUE 'PROVIDER_INVOICE_VOIDED';
ALTER TYPE "AdminAuditAction" ADD VALUE 'PROVIDER_PAYABLE_APPROVED';
ALTER TYPE "AdminAuditAction" ADD VALUE 'PROVIDER_PAYOUT_CREATED';
ALTER TYPE "AdminAuditAction" ADD VALUE 'PROVIDER_PAYOUT_CONFIRMED';
ALTER TYPE "AdminAuditAction" ADD VALUE 'PROVIDER_PAYOUT_ALLOCATED';
ALTER TYPE "AdminAuditAction" ADD VALUE 'PROVIDER_PAYOUT_REVERSED';
ALTER TYPE "AdminAuditAction" ADD VALUE 'PROVIDER_CREDIT_NOTE_CONFIRMED';
ALTER TYPE "AdminAuditAction" ADD VALUE 'PROVIDER_CREDIT_APPLICATION_CONFIRMED';
ALTER TYPE "AdminAuditAction" ADD VALUE 'PROVIDER_ACCOUNTING_ADJUSTMENT_CREATED';
ALTER TYPE "AdminAuditAction" ADD VALUE 'PROVIDER_ACCOUNTING_ADJUSTMENT_APPROVED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminAuditResourceType" ADD VALUE 'PROVIDER_INVOICE';
ALTER TYPE "AdminAuditResourceType" ADD VALUE 'PROVIDER_INVOICE_LINE';
ALTER TYPE "AdminAuditResourceType" ADD VALUE 'PROVIDER_PAYABLE';
ALTER TYPE "AdminAuditResourceType" ADD VALUE 'PROVIDER_PAYOUT';
ALTER TYPE "AdminAuditResourceType" ADD VALUE 'PROVIDER_CREDIT_NOTE';
ALTER TYPE "AdminAuditResourceType" ADD VALUE 'PROVIDER_ACCOUNTING_ADJUSTMENT';

-- CreateTable
CREATE TABLE "ProviderAccountingEvidence" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL DEFAULT 'PENDING',
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "uploadedByUserId" UUID NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderAccountingEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderInvoice" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "invoiceReference" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "receivedDate" DATE,
    "currency" "ProviderAccountingCurrency" NOT NULL DEFAULT 'INR',
    "status" "ProviderInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "headerGrossReported" DECIMAL(12,2) NOT NULL,
    "lineNetTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lineTaxTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lineGrossTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "replacesInvoiceId" UUID,
    "disputeReason" TEXT,
    "voidReason" TEXT,
    "reviewNotes" TEXT,
    "uploadedByUserId" UUID NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" UUID,
    "voidedAt" TIMESTAMP(3),
    "voidedByUserId" UUID,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderInvoiceHeaderVariance" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "headerGrossReported" DECIMAL(12,2) NOT NULL,
    "calculatedGross" DECIMAL(12,2) NOT NULL,
    "varianceAmount" DECIMAL(12,2) NOT NULL,
    "resolution" "ProviderInvoiceHeaderVarianceResolution" NOT NULL DEFAULT 'PENDING',
    "resolutionNotes" TEXT,
    "resolvedByUserId" UUID,
    "resolvedAt" TIMESTAMP(3),
    "resolutionAdjustmentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderInvoiceHeaderVariance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderInvoiceDocument" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,

    CONSTRAINT "ProviderInvoiceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderInvoiceLine" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "kind" "ProviderInvoiceLineKind" NOT NULL DEFAULT 'DELIVERY_CHARGE',
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "unitAmountExTax" DECIMAL(12,2) NOT NULL,
    "lineNet" DECIMAL(12,2) NOT NULL,
    "lineTax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxRateBps" INTEGER,
    "lineGross" DECIMAL(12,2) NOT NULL,
    "currency" "ProviderAccountingCurrency" NOT NULL DEFAULT 'INR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderInvoiceLineAllocation" (
    "id" UUID NOT NULL,
    "lineId" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "providerBookingId" UUID,
    "attributedAmount" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderInvoiceLineAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderPayable" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "providerInvoiceId" UUID NOT NULL,
    "providerInvoiceLineId" UUID NOT NULL,
    "currency" "ProviderAccountingCurrency" NOT NULL DEFAULT 'INR',
    "sourceAmount" DECIMAL(12,2) NOT NULL,
    "approvedAmount" DECIMAL(12,2) NOT NULL,
    "status" "ProviderPayableStatus" NOT NULL DEFAULT 'APPROVED',
    "settlementKind" "ProviderPayableSettlementKind",
    "attributionStatus" "ProviderPayableAttributionStatus" NOT NULL DEFAULT 'UNATTRIBUTED',
    "attributedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "providerLevelOverrideReason" TEXT,
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "approvedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderPayable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderPayout" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "payoutReference" TEXT NOT NULL,
    "status" "ProviderPayoutStatus" NOT NULL DEFAULT 'DRAFT',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" "ProviderAccountingCurrency" NOT NULL DEFAULT 'INR',
    "method" "ProviderPayoutMethod" NOT NULL,
    "bankReference" TEXT,
    "paymentDate" DATE NOT NULL,
    "notes" TEXT,
    "createdByUserId" UUID NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" UUID,
    "failedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "reversedByUserId" UUID,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderPayoutDocument" (
    "id" UUID NOT NULL,
    "payoutId" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,

    CONSTRAINT "ProviderPayoutDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderPayoutReversal" (
    "id" UUID NOT NULL,
    "payoutId" UUID NOT NULL,
    "bankReturnReference" TEXT,
    "reason" TEXT NOT NULL,
    "reversedByUserId" UUID NOT NULL,
    "reversedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidenceId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderPayoutReversal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderPayoutAllocation" (
    "id" UUID NOT NULL,
    "payoutId" UUID NOT NULL,
    "payableId" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "currency" "ProviderAccountingCurrency" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "state" "ProviderPayoutAllocationState" NOT NULL DEFAULT 'PLANNED',
    "idempotencyKey" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderPayoutAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderCreditNote" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "creditReference" TEXT NOT NULL,
    "creditDate" DATE NOT NULL,
    "receivedDate" DATE,
    "currency" "ProviderAccountingCurrency" NOT NULL DEFAULT 'INR',
    "status" "ProviderCreditNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "grossTotal" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" UUID,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderCreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderCreditNoteDocument" (
    "id" UUID NOT NULL,
    "creditNoteId" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,

    CONSTRAINT "ProviderCreditNoteDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderCreditNoteLine" (
    "id" UUID NOT NULL,
    "creditNoteId" UUID NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "kind" "ProviderCreditNoteLineKind" NOT NULL DEFAULT 'DELIVERY_CREDIT',
    "description" TEXT NOT NULL,
    "lineGross" DECIMAL(12,2) NOT NULL,
    "currency" "ProviderAccountingCurrency" NOT NULL DEFAULT 'INR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderCreditNoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderCreditApplication" (
    "id" UUID NOT NULL,
    "creditNoteId" UUID NOT NULL,
    "payableId" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "currency" "ProviderAccountingCurrency" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "state" "ProviderCreditApplicationState" NOT NULL DEFAULT 'PLANNED',
    "idempotencyKey" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderCreditApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderAccountingAdjustment" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "payableId" UUID NOT NULL,
    "providerInvoiceId" UUID,
    "providerPayoutId" UUID,
    "type" "ProviderAccountingAdjustmentType" NOT NULL,
    "status" "ProviderAccountingAdjustmentStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" "ProviderAccountingCurrency" NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceId" UUID,
    "createdByUserId" UUID NOT NULL,
    "approvedByUserId" UUID,
    "approvedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderAccountingAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderAccountingEvidence_providerId_idx" ON "ProviderAccountingEvidence"("providerId");

-- CreateIndex
CREATE INDEX "ProviderAccountingEvidence_uploadedAt_idx" ON "ProviderAccountingEvidence"("uploadedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderAccountingEvidence_providerId_contentSha256_key" ON "ProviderAccountingEvidence"("providerId", "contentSha256");

-- CreateIndex
CREATE INDEX "ProviderInvoice_providerId_status_idx" ON "ProviderInvoice"("providerId", "status");

-- CreateIndex
CREATE INDEX "ProviderInvoice_invoiceDate_idx" ON "ProviderInvoice"("invoiceDate");

-- CreateIndex
CREATE INDEX "ProviderInvoice_createdAt_idx" ON "ProviderInvoice"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderInvoice_providerId_invoiceReference_key" ON "ProviderInvoice"("providerId", "invoiceReference");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderInvoice_providerId_idempotencyKey_key" ON "ProviderInvoice"("providerId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderInvoiceHeaderVariance_invoiceId_key" ON "ProviderInvoiceHeaderVariance"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderInvoiceHeaderVariance_resolutionAdjustmentId_key" ON "ProviderInvoiceHeaderVariance"("resolutionAdjustmentId");

-- CreateIndex
CREATE INDEX "ProviderInvoiceHeaderVariance_resolution_idx" ON "ProviderInvoiceHeaderVariance"("resolution");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderInvoiceDocument_evidenceId_key" ON "ProviderInvoiceDocument"("evidenceId");

-- CreateIndex
CREATE INDEX "ProviderInvoiceDocument_invoiceId_idx" ON "ProviderInvoiceDocument"("invoiceId");

-- CreateIndex
CREATE INDEX "ProviderInvoiceLine_invoiceId_idx" ON "ProviderInvoiceLine"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderInvoiceLine_invoiceId_lineNumber_key" ON "ProviderInvoiceLine"("invoiceId", "lineNumber");

-- CreateIndex
CREATE INDEX "ProviderInvoiceLineAllocation_lineId_idx" ON "ProviderInvoiceLineAllocation"("lineId");

-- CreateIndex
CREATE INDEX "ProviderInvoiceLineAllocation_deliveryId_idx" ON "ProviderInvoiceLineAllocation"("deliveryId");

-- CreateIndex
CREATE INDEX "ProviderInvoiceLineAllocation_providerBookingId_idx" ON "ProviderInvoiceLineAllocation"("providerBookingId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderPayable_providerInvoiceLineId_key" ON "ProviderPayable"("providerInvoiceLineId");

-- CreateIndex
CREATE INDEX "ProviderPayable_providerId_status_idx" ON "ProviderPayable"("providerId", "status");

-- CreateIndex
CREATE INDEX "ProviderPayable_providerInvoiceId_idx" ON "ProviderPayable"("providerInvoiceId");

-- CreateIndex
CREATE INDEX "ProviderPayout_providerId_status_idx" ON "ProviderPayout"("providerId", "status");

-- CreateIndex
CREATE INDEX "ProviderPayout_paymentDate_idx" ON "ProviderPayout"("paymentDate");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderPayout_providerId_payoutReference_key" ON "ProviderPayout"("providerId", "payoutReference");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderPayout_providerId_idempotencyKey_key" ON "ProviderPayout"("providerId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderPayoutDocument_evidenceId_key" ON "ProviderPayoutDocument"("evidenceId");

-- CreateIndex
CREATE INDEX "ProviderPayoutDocument_payoutId_idx" ON "ProviderPayoutDocument"("payoutId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderPayoutReversal_payoutId_key" ON "ProviderPayoutReversal"("payoutId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderPayoutReversal_evidenceId_key" ON "ProviderPayoutReversal"("evidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderPayoutAllocation_idempotencyKey_key" ON "ProviderPayoutAllocation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProviderPayoutAllocation_payableId_idx" ON "ProviderPayoutAllocation"("payableId");

-- CreateIndex
CREATE INDEX "ProviderPayoutAllocation_payoutId_idx" ON "ProviderPayoutAllocation"("payoutId");

-- CreateIndex
CREATE INDEX "ProviderPayoutAllocation_providerId_idx" ON "ProviderPayoutAllocation"("providerId");

-- CreateIndex
CREATE INDEX "ProviderPayoutAllocation_state_idx" ON "ProviderPayoutAllocation"("state");

-- CreateIndex
CREATE INDEX "ProviderCreditNote_providerId_status_idx" ON "ProviderCreditNote"("providerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderCreditNote_providerId_creditReference_key" ON "ProviderCreditNote"("providerId", "creditReference");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderCreditNote_providerId_idempotencyKey_key" ON "ProviderCreditNote"("providerId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderCreditNoteDocument_evidenceId_key" ON "ProviderCreditNoteDocument"("evidenceId");

-- CreateIndex
CREATE INDEX "ProviderCreditNoteDocument_creditNoteId_idx" ON "ProviderCreditNoteDocument"("creditNoteId");

-- CreateIndex
CREATE INDEX "ProviderCreditNoteLine_creditNoteId_idx" ON "ProviderCreditNoteLine"("creditNoteId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderCreditNoteLine_creditNoteId_lineNumber_key" ON "ProviderCreditNoteLine"("creditNoteId", "lineNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderCreditApplication_idempotencyKey_key" ON "ProviderCreditApplication"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProviderCreditApplication_creditNoteId_idx" ON "ProviderCreditApplication"("creditNoteId");

-- CreateIndex
CREATE INDEX "ProviderCreditApplication_payableId_idx" ON "ProviderCreditApplication"("payableId");

-- CreateIndex
CREATE INDEX "ProviderCreditApplication_providerId_idx" ON "ProviderCreditApplication"("providerId");

-- CreateIndex
CREATE INDEX "ProviderCreditApplication_state_idx" ON "ProviderCreditApplication"("state");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderAccountingAdjustment_idempotencyKey_key" ON "ProviderAccountingAdjustment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProviderAccountingAdjustment_payableId_idx" ON "ProviderAccountingAdjustment"("payableId");

-- CreateIndex
CREATE INDEX "ProviderAccountingAdjustment_providerId_status_idx" ON "ProviderAccountingAdjustment"("providerId", "status");

-- CreateIndex
CREATE INDEX "ProviderAccountingAdjustment_providerInvoiceId_idx" ON "ProviderAccountingAdjustment"("providerInvoiceId");

-- AddForeignKey
ALTER TABLE "ProviderAccountingEvidence" ADD CONSTRAINT "ProviderAccountingEvidence_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAccountingEvidence" ADD CONSTRAINT "ProviderAccountingEvidence_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderInvoice" ADD CONSTRAINT "ProviderInvoice_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderInvoice" ADD CONSTRAINT "ProviderInvoice_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderInvoice" ADD CONSTRAINT "ProviderInvoice_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderInvoice" ADD CONSTRAINT "ProviderInvoice_voidedByUserId_fkey" FOREIGN KEY ("voidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderInvoice" ADD CONSTRAINT "ProviderInvoice_replacesInvoiceId_fkey" FOREIGN KEY ("replacesInvoiceId") REFERENCES "ProviderInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderInvoiceHeaderVariance" ADD CONSTRAINT "ProviderInvoiceHeaderVariance_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ProviderInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderInvoiceHeaderVariance" ADD CONSTRAINT "ProviderInvoiceHeaderVariance_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderInvoiceHeaderVariance" ADD CONSTRAINT "ProviderInvoiceHeaderVariance_resolutionAdjustmentId_fkey" FOREIGN KEY ("resolutionAdjustmentId") REFERENCES "ProviderAccountingAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderInvoiceDocument" ADD CONSTRAINT "ProviderInvoiceDocument_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ProviderInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderInvoiceDocument" ADD CONSTRAINT "ProviderInvoiceDocument_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "ProviderAccountingEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderInvoiceLine" ADD CONSTRAINT "ProviderInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ProviderInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderInvoiceLineAllocation" ADD CONSTRAINT "ProviderInvoiceLineAllocation_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ProviderInvoiceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderInvoiceLineAllocation" ADD CONSTRAINT "ProviderInvoiceLineAllocation_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderInvoiceLineAllocation" ADD CONSTRAINT "ProviderInvoiceLineAllocation_providerBookingId_fkey" FOREIGN KEY ("providerBookingId") REFERENCES "ProviderBooking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderPayable" ADD CONSTRAINT "ProviderPayable_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderPayable" ADD CONSTRAINT "ProviderPayable_providerInvoiceId_fkey" FOREIGN KEY ("providerInvoiceId") REFERENCES "ProviderInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderPayable" ADD CONSTRAINT "ProviderPayable_providerInvoiceLineId_fkey" FOREIGN KEY ("providerInvoiceLineId") REFERENCES "ProviderInvoiceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderPayable" ADD CONSTRAINT "ProviderPayable_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderPayout" ADD CONSTRAINT "ProviderPayout_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderPayout" ADD CONSTRAINT "ProviderPayout_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderPayout" ADD CONSTRAINT "ProviderPayout_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderPayout" ADD CONSTRAINT "ProviderPayout_reversedByUserId_fkey" FOREIGN KEY ("reversedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderPayoutDocument" ADD CONSTRAINT "ProviderPayoutDocument_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "ProviderPayout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderPayoutDocument" ADD CONSTRAINT "ProviderPayoutDocument_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "ProviderAccountingEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderPayoutReversal" ADD CONSTRAINT "ProviderPayoutReversal_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "ProviderPayout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderPayoutReversal" ADD CONSTRAINT "ProviderPayoutReversal_reversedByUserId_fkey" FOREIGN KEY ("reversedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderPayoutReversal" ADD CONSTRAINT "ProviderPayoutReversal_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "ProviderAccountingEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderPayoutAllocation" ADD CONSTRAINT "ProviderPayoutAllocation_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "ProviderPayout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderPayoutAllocation" ADD CONSTRAINT "ProviderPayoutAllocation_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "ProviderPayable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderPayoutAllocation" ADD CONSTRAINT "ProviderPayoutAllocation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCreditNote" ADD CONSTRAINT "ProviderCreditNote_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCreditNote" ADD CONSTRAINT "ProviderCreditNote_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCreditNoteDocument" ADD CONSTRAINT "ProviderCreditNoteDocument_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "ProviderCreditNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCreditNoteDocument" ADD CONSTRAINT "ProviderCreditNoteDocument_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "ProviderAccountingEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCreditNoteLine" ADD CONSTRAINT "ProviderCreditNoteLine_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "ProviderCreditNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCreditApplication" ADD CONSTRAINT "ProviderCreditApplication_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "ProviderCreditNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCreditApplication" ADD CONSTRAINT "ProviderCreditApplication_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "ProviderPayable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCreditApplication" ADD CONSTRAINT "ProviderCreditApplication_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAccountingAdjustment" ADD CONSTRAINT "ProviderAccountingAdjustment_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAccountingAdjustment" ADD CONSTRAINT "ProviderAccountingAdjustment_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "ProviderPayable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAccountingAdjustment" ADD CONSTRAINT "ProviderAccountingAdjustment_providerInvoiceId_fkey" FOREIGN KEY ("providerInvoiceId") REFERENCES "ProviderInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAccountingAdjustment" ADD CONSTRAINT "ProviderAccountingAdjustment_providerPayoutId_fkey" FOREIGN KEY ("providerPayoutId") REFERENCES "ProviderPayout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAccountingAdjustment" ADD CONSTRAINT "ProviderAccountingAdjustment_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "ProviderAccountingEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAccountingAdjustment" ADD CONSTRAINT "ProviderAccountingAdjustment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAccountingAdjustment" ADD CONSTRAINT "ProviderAccountingAdjustment_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
