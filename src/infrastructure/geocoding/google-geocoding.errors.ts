import { ProviderAdapterError } from "../../modules/provider/contracts/provider-error.js";

export class GeocodingValidationError extends Error {
  readonly safeMessage: string;

  constructor(safeMessage: string) {
    super(safeMessage);
    this.name = "GeocodingValidationError";
    this.safeMessage = safeMessage;
  }
}

export function toGeocodingIneligibleError(
  providerCode: string,
  safeMessage: string,
  requestId: string | null,
): ProviderAdapterError {
  return new ProviderAdapterError({
    providerCode,
    operation: "checkServiceability",
    category: "PROVIDER_VALIDATION_ERROR",
    safeMessage,
    retryable: false,
    requestId,
  });
}
