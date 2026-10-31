import type {
  LedgerDirection,
  LedgerEntryType,
  PaymentAttemptStatus,
  PaymentCurrency,
  PaymentGatewayCode,
  PaymentStatus,
  ProviderBookingStatus,
  RefundStatus,
} from "@prisma/client";

export type FinanceWindowDto = {
  from: string;
  toExclusive: string;
  timeZone: typeof import("./admin-finance.constants.js").FINANCE_BUSINESS_TIMEZONE;
};

export type AdminFinancePricingBreakdownDto = {
  label: "Pricing Breakdown";
  providerQuoteAmount: string;
  platformFeePercent: number;
  platformFeeAmount: string;
  subtotal: string;
  gstPercent: number;
  gstAmount: string;
  customerPayableAmount: string;
  currency: string;
  orchestrationRequestId: string | null;
  orchestrationOptionId: string | null;
  snapshotMetadata: Record<string, unknown> | null;
  revenueDisclaimer: string;
};

export type AdminPaymentListItemDto = {
  id: string;
  deliveryId: string;
  deliveryReference: string;
  customerName: string | null;
  status: PaymentStatus;
  amount: string;
  currency: PaymentCurrency;
  refundedAmount: string;
  gateway: PaymentGatewayCode;
  gatewayOrderId: string | null;
  paidAt: string | null;
  createdAt: string;
};

export type AdminPaymentListDto = {
  items: AdminPaymentListItemDto[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type AdminFinanceAttemptDto = {
  id: string;
  attemptNumber: number;
  status: PaymentAttemptStatus;
  amount: string;
  currency: PaymentCurrency;
  gatewayPaymentId: string | null;
  paymentMethod: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type AdminFinanceRefundDto = {
  id: string;
  paymentId: string;
  deliveryId: string;
  deliveryReference: string;
  amount: string;
  currency: PaymentCurrency;
  status: RefundStatus;
  reasonCode: string | null;
  gatewayRefundId: string | null;
  requestedAt: string;
  processedAt: string | null;
};

export type AdminFinanceLedgerDto = {
  id: string;
  type: LedgerEntryType;
  direction: LedgerDirection;
  amount: string;
  currency: PaymentCurrency;
  refundId: string | null;
  idempotencyKey: string;
  description: string | null;
  createdAt: string;
};

export type AdminProviderQuoteBookedDto = {
  label: string;
  quotedAmount: string | null;
  quotedCurrency: string | null;
  bookedAmount: string | null;
  bookedCurrency: string | null;
  bookingStatus: ProviderBookingStatus | null;
  providerCode: string | null;
  disclaimer: string;
};

export type AdminPaymentDetailDto = {
  id: string;
  deliveryId: string;
  deliveryReference: string;
  status: PaymentStatus;
  amount: string;
  currency: PaymentCurrency;
  refundedAmount: string;
  successfulRefundTotal: string;
  refundedAmountMatchesSuccessfulRefunds: boolean;
  gateway: PaymentGatewayCode;
  gatewayOrderId: string | null;
  gatewayPaymentSessionId: string | null;
  paidAt: string | null;
  failedAt: string | null;
  expiredAt: string | null;
  createdAt: string;
  updatedAt: string;
  pricingBreakdown: AdminFinancePricingBreakdownDto | null;
  providerQuoteBooked: AdminProviderQuoteBookedDto | null;
  attempts: AdminFinanceAttemptDto[];
  refunds: AdminFinanceRefundDto[];
  ledgerEntries: AdminFinanceLedgerDto[];
};

export type AdminFinanceAmountCountDto = {
  count: number;
  totalAmount: string;
  currency: PaymentCurrency;
};

export type AdminFinanceSummaryDto = {
  window: FinanceWindowDto;
  collections: AdminFinanceAmountCountDto;
  successfulRefunds: AdminFinanceAmountCountDto;
  pendingRefunds: AdminFinanceAmountCountDto;
  failedRefunds: AdminFinanceAmountCountDto;
  netActivityInPeriod: {
    amount: string;
    currency: PaymentCurrency;
    formula: "collectionsInPeriod minus successfulRefundsProcessedInPeriod";
  };
  lifetime: {
    totalCollected: string;
    totalSuccessfulRefunds: string;
    net: string;
    currency: PaymentCurrency;
    formula: "lifetime gross collected (PAID, PARTIALLY_REFUNDED, REFUNDED with paidAt) minus lifetime SUCCESS refund amounts";
  };
};

export type AdminRefundListDto = {
  items: AdminFinanceRefundDto[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type FinanceTimeseriesGranularity = "day" | "week" | "month";

export type AdminFinanceTimeseriesPointDto = {
  bucketStart: string;
  bucketLabel: string;
  collections: string;
  successfulRefunds: string;
  net: string;
};

export type AdminFinanceTimeseriesDto = {
  window: FinanceWindowDto;
  granularity: FinanceTimeseriesGranularity;
  currency: PaymentCurrency;
  points: AdminFinanceTimeseriesPointDto[];
};

export type ReconciliationSeverity = "error" | "warning";

export type ReconciliationIssueDto = {
  severity: ReconciliationSeverity;
  type: string;
  paymentId: string | null;
  refundId: string | null;
  ledgerEntryId: string | null;
  deliveryId: string | null;
  expectedAmount: string | null;
  actualAmount: string | null;
  explanation: string;
};

export type AdminFinanceReconciliationDto = {
  window: FinanceWindowDto | null;
  scannedPayments: number;
  scannedRefunds: number;
  scannedLedgerEntries: number;
  issueCount: number;
  truncated: boolean;
  issues: ReconciliationIssueDto[];
  disclaimer: "Internal database reconciliation only; not Cashfree settlement reconciliation.";
};
