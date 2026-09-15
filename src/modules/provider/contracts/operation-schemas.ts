import type { AdapterOperation } from "../adapters/provider-adapter.types.js";
import { availabilityResultSchema } from "./availability.js";
import { normalizedBookingResultSchema } from "./booking.js";
import { normalizedCancellationResultSchema } from "./cancellation.js";
import { normalizedQuoteSchema } from "./quote.js";
import { normalizedServiceabilityResultSchema } from "./serviceability.js";
import { normalizedTrackingResultSchema } from "./tracking.js";
import { normalizedProviderWebhookEventSchema } from "./webhook.js";

export const healthCheckResultSchema = {
  parse: (value: unknown) => {
    const parsed = value as {
      healthy: boolean;
      checkedAt: string;
      message: string | null;
    };
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.healthy !== "boolean" ||
      typeof parsed.checkedAt !== "string"
    ) {
      throw new Error("Invalid health check result");
    }
    return parsed;
  },
};

export const ADAPTER_OPERATION_OUTPUT_SCHEMAS: Record<
  AdapterOperation,
  { parse: (value: unknown) => unknown }
> = {
  checkServiceability: normalizedServiceabilityResultSchema,
  getAvailability: availabilityResultSchema,
  getQuote: normalizedQuoteSchema,
  createBooking: normalizedBookingResultSchema,
  getBooking: normalizedBookingResultSchema,
  cancelBooking: normalizedCancellationResultSchema,
  getTracking: normalizedTrackingResultSchema,
  parseWebhook: normalizedProviderWebhookEventSchema,
  healthCheck: healthCheckResultSchema,
};

export function validateAdapterOperationOutput<T extends AdapterOperation>(
  operation: T,
  output: unknown,
): void {
  ADAPTER_OPERATION_OUTPUT_SCHEMAS[operation].parse(output);
}
