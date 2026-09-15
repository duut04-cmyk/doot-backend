import type { ProviderBookingStatus } from "@prisma/client";

export type QuoteSnapshot = {
  amount: number;
  currency: string;
  providerQuoteId?: string | null;
  quotedAt?: string | null;
};

export type ProviderBookingDto = {
  id: string;
  deliveryId: string;
  attemptNumber: number;
  orchestrationRequestId: string;
  orchestrationOptionId: string;
  providerId: string;
  providerServiceId: string | null;
  providerCode: string;
  providerServiceCode: string | null;
  status: ProviderBookingStatus;
  correlationReference: string;
  providerOrderId: string | null;
  providerReference: string | null;
  providerStatus: string | null;
  quotedAmount: number | null;
  quotedCurrency: string | null;
  bookedAmount: number | null;
  bookedCurrency: string | null;
  providerQuoteId: string | null;
  quoteSnapshot: QuoteSnapshot;
  unknownOutcome: boolean;
  failureCode: string | null;
  failureMessage: string | null;
  requestId: string | null;
  bookedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};


export type CustomerBookingQuoteDto = {
  amount: number;
  currency: string;
};

export type CustomerBookingDto = {
  id: string;
  providerCode: string;
  serviceCode: string | null;
  status: ProviderBookingStatus;
  providerReference: string | null;
  quote: CustomerBookingQuoteDto;
  bookedAt: string | null;
};

export type CustomerConfirmResultDto = {
  delivery: {
    id: string;
    reference: string;
    status: string;
  };
  booking: CustomerBookingDto;
};

export type AdminBookingDto = CustomerBookingDto & {
  attemptNumber: number;
  orchestrationRequestId: string;
  orchestrationOptionId: string;
  providerId: string;
  providerServiceId: string | null;
  correlationReference: string;
  providerOrderId: string | null;
  providerStatus: string | null;
  quotedAmount: number | null;
  quotedCurrency: string | null;
  bookedAmount: number | null;
  bookedCurrency: string | null;
  providerQuoteId: string | null;
  quoteSnapshot: QuoteSnapshot;
  unknownOutcome: boolean;
  failureCode: string | null;
  failureMessage: string | null;
  requestId: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminConfirmResultDto = {
  delivery: {
    id: string;
    reference: string;
    status: string;
  };
  booking: AdminBookingDto;
};

export type BookingConfirmResponsePayload =
  | CustomerConfirmResultDto
  | AdminConfirmResultDto;
