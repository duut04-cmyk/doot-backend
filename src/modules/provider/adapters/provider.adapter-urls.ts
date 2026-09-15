import type { ProviderEnvironment } from "@prisma/client";
import { AppError } from "../../../core/errors/app-error.js";
import { ErrorCodes } from "../../../core/errors/error-codes.js";

/**
 * Trusted base URLs for provider adapters.
 * Phase 4 adds real provider hosts here — never accept arbitrary URLs from requests.
 */
const TRUSTED_PROVIDER_BASE_URLS: Record<
  string,
  Partial<Record<ProviderEnvironment, string>>
> = {
  MOCK: {
    SANDBOX: "https://mock-provider.test/sandbox",
    LIVE: "https://mock-provider.test/live",
  },
  BORZO: {
    SANDBOX: "https://robotapitest-in.borzodelivery.com/api/business/1.8",
  },
};

export function resolveTrustedProviderBaseUrl(
  providerCode: string,
  environment: ProviderEnvironment,
): string {
  const entry = TRUSTED_PROVIDER_BASE_URLS[providerCode];
  const url = entry?.[environment];
  if (!url) {
    throw new AppError(
      `No trusted base URL configured for provider ${providerCode} (${environment}).`,
      {
        statusCode: 422,
        code: ErrorCodes.PROVIDER_CONFIGURATION_INVALID,
      },
    );
  }
  validateTrustedUrl(url);
  return url;
}

export function validateTrustedUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError("Provider base URL is invalid.", {
      statusCode: 422,
      code: ErrorCodes.PROVIDER_CONFIGURATION_INVALID,
    });
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new AppError("Provider base URL must use http or https.", {
      statusCode: 422,
      code: ErrorCodes.PROVIDER_CONFIGURATION_INVALID,
    });
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    throw new AppError("Provider base URL host is not allowed.", {
      statusCode: 422,
      code: ErrorCodes.PROVIDER_CONFIGURATION_INVALID,
    });
  }
}

/** @internal test helper */
export function registerTrustedProviderBaseUrlForTests(
  providerCode: string,
  environment: ProviderEnvironment,
  url: string,
): void {
  TRUSTED_PROVIDER_BASE_URLS[providerCode] = {
    ...TRUSTED_PROVIDER_BASE_URLS[providerCode],
    [environment]: url,
  };
}
