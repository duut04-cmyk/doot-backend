import { describe, expect, it } from "vitest";
import {
  ProviderAdapterError,
  isRetryableProviderError,
} from "../src/modules/provider/contracts/provider-error.js";

describe("Provider adapter error normalization", () => {
  it("classifies timeout as retryable", () => {
    const error = new ProviderAdapterError({
      providerCode: "MOCK",
      operation: "getQuote",
      category: "PROVIDER_TIMEOUT",
      safeMessage: "Timed out.",
    });
    expect(error.retryable).toBe(true);
    expect(isRetryableProviderError("PROVIDER_TIMEOUT")).toBe(true);
  });

  it("classifies validation as non-retryable", () => {
    const error = new ProviderAdapterError({
      providerCode: "MOCK",
      operation: "createBooking",
      category: "PROVIDER_VALIDATION_ERROR",
      safeMessage: "Invalid payload.",
    });
    expect(error.retryable).toBe(false);
  });

  it("classifies authentication as non-retryable", () => {
    expect(isRetryableProviderError("PROVIDER_AUTHENTICATION_ERROR")).toBe(false);
  });

  it("classifies rate limit as retryable", () => {
    expect(isRetryableProviderError("PROVIDER_RATE_LIMITED")).toBe(true);
  });

  it("does not expose secrets in safeMessage", () => {
    const error = new ProviderAdapterError({
      providerCode: "MOCK",
      operation: "getQuote",
      category: "PROVIDER_AUTHENTICATION_ERROR",
      safeMessage: "Authentication failed.",
      providerErrorCode: "401",
    });
    expect(error.safeMessage).not.toMatch(/key|secret|token/i);
  });
});
