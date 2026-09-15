import type {
  OrchestrationEvaluationStatus,
  OrchestrationRequestStatus,
} from "@prisma/client";
import type { AvailabilityResult } from "../provider/contracts/availability.js";
import type { NormalizedQuote } from "../provider/contracts/quote.js";
import type { NormalizedServiceabilityResult } from "../provider/contracts/serviceability.js";

export type ScoreBreakdown = {
  price: number | null;
  eta: number | null;
  availability: number | null;
  providerPriority: number | null;
  serviceQuality: number | null;
  applicableWeightSum: number;
  rawWeightedScore: number;
};

export type ProviderEvaluationCompatibility = {
  weightCompatible: boolean;
  dimensionsCompatible: boolean;
  requirementsCompatible: boolean;
  scheduleCompatible: boolean;
};

export type ProviderEvaluationSignals = {
  providerId: string;
  providerCode: string;
  providerServiceId: string | null;
  providerServiceCode: string | null;
  serviceability: NormalizedServiceabilityResult | null;
  availability: AvailabilityResult | null;
  quote: NormalizedQuote | null;
  compatibility: ProviderEvaluationCompatibility;
  warnings: string[];
  providerMetadata: Record<string, unknown>;
};

export type ProviderEvaluationOutcome = {
  status: OrchestrationEvaluationStatus;
  signals: ProviderEvaluationSignals;
  exclusionReasons: string[];
  eligibilityReasons: string[];
  errorCategory: string | null;
  score: number | null;
  scoreBreakdown: ScoreBreakdown | null;
};

export type CreateOrchestrationEvaluationInput = {
  orchestrationRequestId: string;
  providerId: string;
  providerServiceId: string | null;
  providerCode: string;
  providerServiceCode: string | null;
  status: OrchestrationEvaluationStatus;
  serviceable: boolean | null;
  availabilityKnown: boolean | null;
  available: boolean | null;
  availableDriverCount: number | null;
  quoteAvailable: boolean | null;
  quoteAmount: number | null;
  quoteCurrency: string | null;
  estimatedDeliveryAt: Date | null;
  eligibilityReasons: string[];
  exclusionReasons: string[];
  warnings: string[];
  score: number | null;
  scoreBreakdown: ScoreBreakdown | null;
  normalizedResult: Record<string, unknown> | null;
  providerMetadata: Record<string, unknown> | null;
  errorCategory: string | null;
};

export type OrchestrationEvaluationDto = CreateOrchestrationEvaluationInput & {
  id: string;
  createdAt: Date;
};

export type OrchestrationOptionDto = {
  id: string;
  orchestrationRequestId: string;
  evaluationId: string;
  providerId: string;
  providerServiceId: string | null;
  providerCode: string;
  providerServiceCode: string | null;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  selectionReason: string;
  quoteSnapshot: Record<string, unknown>;
  availabilitySnapshot: Record<string, unknown> | null;
  etaSnapshot: Record<string, unknown> | null;
  createdAt: Date;
};

export type OrchestrationRequestDto = {
  id: string;
  deliveryId: string;
  requestedByUserId: string;
  attemptNumber: number;
  status: OrchestrationRequestStatus;
  failureReason: string | null;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  evaluations: OrchestrationEvaluationDto[];
  selectedOption: OrchestrationOptionDto | null;
};

export type CustomerSelectedOptionDto = {
  providerCode: string;
  serviceCode: string | null;
  quote: {
    amount: number;
    currency: string;
  };
  estimatedDeliveryAt: string | null;
  availability: {
    known: boolean;
    available?: boolean;
    availableDriverCount?: number | null;
    reason?: string | null;
  };
  selectionReason: string;
};

export type CustomerOrchestrationResultDto = {
  deliveryId: string;
  status: string;
  orchestration: {
    id: string;
    attemptNumber: number;
    completedAt: string | null;
    selectedOption: CustomerSelectedOptionDto | null;
  };
};

export type AdminEvaluationDto = {
  id: string;
  providerCode: string;
  providerServiceCode: string | null;
  status: OrchestrationEvaluationStatus;
  serviceable: boolean | null;
  availabilityKnown: boolean | null;
  available: boolean | null;
  availableDriverCount: number | null;
  quoteAvailable: boolean | null;
  quoteAmount: number | null;
  quoteCurrency: string | null;
  estimatedDeliveryAt: string | null;
  exclusionReasons: string[];
  eligibilityReasons: string[];
  warnings: string[];
  score: number | null;
  scoreBreakdown: ScoreBreakdown | null;
  errorCategory: string | null;
};

export type AdminOrchestrationResultDto = CustomerOrchestrationResultDto & {
  orchestration: CustomerOrchestrationResultDto["orchestration"] & {
    status: OrchestrationRequestStatus;
    failureReason: string | null;
    evaluations: AdminEvaluationDto[];
  };
};
