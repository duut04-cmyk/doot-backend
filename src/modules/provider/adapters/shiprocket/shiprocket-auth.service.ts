import { env } from "../../../../config/env.js";
import { logger } from "../../../../config/logger.js";
import { AppError } from "../../../../core/errors/app-error.js";
import { ErrorCodes } from "../../../../core/errors/error-codes.js";
import {
  type IProviderAuthTokenRepository,
  type ProviderAuthTokenRow,
  providerAuthTokenRepository,
} from "../../provider-auth-token.repository.js";
import { decryptCredential, encryptCredential } from "../../provider.crypto.js";
import { ProviderAdapterError } from "../../contracts/provider-error.js";
import type { ProviderRuntimeConfig } from "../provider-config.types.js";
import { ProviderHttpClient } from "../provider-http-client.js";
import {
  createShiprocketAuthRefreshLeaseToken,
  type IShiprocketAuthRefreshLock,
  shiprocketAuthRefreshLock,
} from "./shiprocket-auth-refresh.lock.js";
import {
  SHIPROCKET_AUTH_PATH,
  SHIPROCKET_TOKEN_REFRESH_IF_REMAINING_MS,
} from "./shiprocket.constants.js";
import {
  resolveShiprocketTokenExpiresAt,
  sanitizeShiprocketAuthRefreshError,
  shouldRefreshShiprocketToken,
} from "./shiprocket-token-expiry.util.js";
import { shiprocketLoginResponseSchema } from "./shiprocket.types.js";

type MemoryCachedToken = {
  providerId: string;
  token: string;
  expiresAt: number;
};

type TokenPersistenceMode = { kind: "lease"; leaseToken: string } | { kind: "initial" };

const memoryCacheByProviderId = new Map<string, MemoryCachedToken>();

const REFRESH_WAIT_TIMEOUT_MS = 30_000;
const REFRESH_WAIT_POLL_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractToken(body: unknown): string {
  const parsed = shiprocketLoginResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new ProviderAdapterError({
      providerCode: "SHIPROCKET",
      operation: "healthCheck",
      category: "PROVIDER_UNKNOWN_ERROR",
      safeMessage: "Shiprocket login returned an unexpected response.",
    });
  }
  const token = parsed.data.token ?? parsed.data.data?.token;
  if (!token) {
    throw new ProviderAdapterError({
      providerCode: "SHIPROCKET",
      operation: "healthCheck",
      category: "PROVIDER_UNKNOWN_ERROR",
      safeMessage: "Shiprocket login did not return a token.",
    });
  }
  return token;
}

function decryptStoredToken(row: {
  tokenCiphertext: string;
  tokenIv: string;
  tokenAuthTag: string;
}): string {
  return decryptCredential({
    ciphertext: row.tokenCiphertext,
    iv: row.tokenIv,
    authTag: row.tokenAuthTag,
  });
}

function setMemoryCache(providerId: string, token: string, expiresAt: Date): void {
  memoryCacheByProviderId.set(providerId, {
    providerId,
    token,
    expiresAt: expiresAt.getTime(),
  });
}

function readMemoryCache(providerId: string, now: number): string | null {
  const cached = memoryCacheByProviderId.get(providerId);
  if (!cached) {
    return null;
  }
  if (
    shouldRefreshShiprocketToken(
      new Date(cached.expiresAt),
      new Date(now),
      SHIPROCKET_TOKEN_REFRESH_IF_REMAINING_MS,
    )
  ) {
    return null;
  }
  return cached.token;
}

function rowNeedsRefresh(row: ProviderAuthTokenRow, now: Date = new Date()): boolean {
  return shouldRefreshShiprocketToken(
    row.expiresAt,
    now,
    SHIPROCKET_TOKEN_REFRESH_IF_REMAINING_MS,
  );
}

function tokenFromRowIfFresh(
  providerId: string,
  row: ProviderAuthTokenRow | null,
): string | null {
  if (!row || rowNeedsRefresh(row)) {
    return null;
  }
  const token = decryptStoredToken(row);
  setMemoryCache(providerId, token, row.expiresAt);
  return token;
}

export class ShiprocketAuthService {
  constructor(
    private readonly http: ProviderHttpClient = new ProviderHttpClient(),
    private readonly tokenRepository: IProviderAuthTokenRepository = providerAuthTokenRepository,
    private readonly refreshLock: IShiprocketAuthRefreshLock = shiprocketAuthRefreshLock,
  ) {}

  clearCacheForTests(): void {
    memoryCacheByProviderId.clear();
  }

  invalidateMemoryCache(providerId: string): void {
    memoryCacheByProviderId.delete(providerId);
  }

  async getBearerToken(input: {
    config: ProviderRuntimeConfig;
    requestId: string;
    forceRefresh?: boolean;
  }): Promise<string> {
    if (!env.SHIPROCKET_ENABLED && env.NODE_ENV !== "test") {
      throw new AppError("Shiprocket integration is disabled.", {
        statusCode: 503,
        code: ErrorCodes.PROVIDER_NOT_READY,
      });
    }

    const providerId = input.config.providerId;
    const now = Date.now();

    if (input.forceRefresh) {
      this.invalidateMemoryCache(providerId);
    } else {
      const memoryToken = readMemoryCache(providerId, now);
      if (memoryToken) {
        return memoryToken;
      }
    }

    const stored = await this.tokenRepository.findByProviderId(providerId);
    if (stored && !input.forceRefresh && !rowNeedsRefresh(stored, new Date(now))) {
      const token = decryptStoredToken(stored);
      setMemoryCache(providerId, token, stored.expiresAt);
      return token;
    }

    return this.refreshWithConcurrencyGuard({
      config: input.config,
      requestId: input.requestId,
      previousRow: stored,
    });
  }

  private async refreshWithConcurrencyGuard(input: {
    config: ProviderRuntimeConfig;
    requestId: string;
    previousRow: ProviderAuthTokenRow | null;
  }): Promise<string> {
    const providerId = input.config.providerId;
    const started = Date.now();

    while (Date.now() - started < REFRESH_WAIT_TIMEOUT_MS) {
      const current = await this.tokenRepository.findByProviderId(providerId);
      const freshToken = tokenFromRowIfFresh(providerId, current);
      if (freshToken) {
        return freshToken;
      }

      if (current) {
        const leaseToken = createShiprocketAuthRefreshLeaseToken();
        const leaseAcquired = await this.tokenRepository.tryAcquireRefreshLease({
          providerId,
          leaseToken,
        });

        if (leaseAcquired) {
          try {
            const afterLock = await this.tokenRepository.findByProviderId(providerId);
            const reused = tokenFromRowIfFresh(providerId, afterLock);
            if (reused) {
              return reused;
            }

            return await this.loginPersistAndCache({
              config: input.config,
              requestId: input.requestId,
              previousRow: afterLock ?? input.previousRow,
              persistence: { kind: "lease", leaseToken },
            });
          } finally {
            await this.tokenRepository.releaseRefreshLease({ providerId, leaseToken });
          }
        }

        await sleep(REFRESH_WAIT_POLL_MS);
        continue;
      }

      const firstLoginResult = await this.refreshLock.runFirstLoginExclusive(
        providerId,
        async () => {
          const afterLock = await this.tokenRepository.findByProviderId(providerId);
          const reused = tokenFromRowIfFresh(providerId, afterLock);
          if (reused) {
            return reused;
          }

          return this.loginPersistAndCache({
            config: input.config,
            requestId: input.requestId,
            previousRow: afterLock ?? input.previousRow,
            persistence: { kind: "initial" },
          });
        },
      );

      if (firstLoginResult != null) {
        return firstLoginResult;
      }

      await sleep(REFRESH_WAIT_POLL_MS);
    }

    throw new ProviderAdapterError({
      providerCode: "SHIPROCKET",
      operation: "healthCheck",
      category: "PROVIDER_SERVICE_UNAVAILABLE",
      safeMessage:
        "Shiprocket authentication refresh timed out while waiting for lease.",
    });
  }

  private async resolveAfterLostPersistence(input: {
    providerId: string;
    previousRow: ProviderAuthTokenRow | null;
  }): Promise<string> {
    const current = await this.tokenRepository.findByProviderId(input.providerId);
    const reused = tokenFromRowIfFresh(input.providerId, current);
    if (reused) {
      return reused;
    }

    if (current && current.expiresAt.getTime() > Date.now()) {
      const token = decryptStoredToken(current);
      setMemoryCache(input.providerId, token, current.expiresAt);
      return token;
    }

    if (input.previousRow && input.previousRow.expiresAt.getTime() > Date.now()) {
      const token = decryptStoredToken(input.previousRow);
      setMemoryCache(input.providerId, token, input.previousRow.expiresAt);
      return token;
    }

    throw new ProviderAdapterError({
      providerCode: "SHIPROCKET",
      operation: "healthCheck",
      category: "PROVIDER_SERVICE_UNAVAILABLE",
      safeMessage:
        "Shiprocket authentication refresh conflicted with another instance.",
      retryable: true,
    });
  }

  private async loginPersistAndCache(input: {
    config: ProviderRuntimeConfig;
    requestId: string;
    previousRow: ProviderAuthTokenRow | null;
    persistence: TokenPersistenceMode;
  }): Promise<string> {
    const email = env.SHIPROCKET_AUTH_EMAIL;
    const password = env.SHIPROCKET_AUTH_PASSWORD;
    if (!email || !password) {
      throw new AppError("Shiprocket credentials are not configured.", {
        statusCode: 503,
        code: ErrorCodes.PROVIDER_NOT_READY,
      });
    }

    const providerId = input.config.providerId;
    const leaseToken =
      input.persistence.kind === "lease" ? input.persistence.leaseToken : undefined;

    try {
      if (leaseToken) {
        await this.tokenRepository.renewRefreshLease({ providerId, leaseToken });
      }

      const response = await this.http.request({
        config: input.config,
        operation: "healthCheck",
        requestId: input.requestId,
        request: {
          method: "POST",
          path: SHIPROCKET_AUTH_PATH,
          body: { email, password },
        },
        allowErrorResponseBody: true,
      });

      if (response.status === 498) {
        throw new ProviderAdapterError({
          providerCode: "SHIPROCKET",
          operation: "healthCheck",
          category: "PROVIDER_SERVICE_UNAVAILABLE",
          safeMessage: "Shiprocket access was denied by edge infrastructure.",
          retryable: false,
        });
      }

      if (response.status === 401 || response.status === 403) {
        throw new ProviderAdapterError({
          providerCode: "SHIPROCKET",
          operation: "healthCheck",
          category: "PROVIDER_AUTHENTICATION_ERROR",
          safeMessage: "Shiprocket authentication failed.",
        });
      }

      if (response.status < 200 || response.status >= 300) {
        throw new ProviderAdapterError({
          providerCode: "SHIPROCKET",
          operation: "healthCheck",
          category: "PROVIDER_SERVICE_UNAVAILABLE",
          safeMessage: "Shiprocket authentication is temporarily unavailable.",
        });
      }

      const token = extractToken(response.data);
      const issuedAt = new Date();
      const expiresAt = resolveShiprocketTokenExpiresAt({
        loginBody: response.data,
        token,
        issuedAt,
      });
      const encrypted = encryptCredential(token);
      const refreshedAt = new Date();

      if (input.persistence.kind === "lease") {
        const saveResult = await this.tokenRepository.saveSuccessfulTokenWithLease({
          providerId,
          leaseToken: input.persistence.leaseToken,
          encrypted,
          expiresAt,
          issuedAt,
          refreshedAt,
        });
        if (saveResult === "lease_lost") {
          return this.resolveAfterLostPersistence({
            providerId,
            previousRow: input.previousRow,
          });
        }
      } else {
        const createResult = await this.tokenRepository.createSuccessfulTokenIfAbsent({
          providerId,
          encrypted,
          expiresAt,
          issuedAt,
          refreshedAt,
        });
        if (createResult === "already_exists") {
          return this.resolveAfterLostPersistence({
            providerId,
            previousRow: input.previousRow,
          });
        }
      }

      setMemoryCache(providerId, token, expiresAt);

      logger.info(
        {
          providerCode: "SHIPROCKET",
          providerId,
          requestId: input.requestId,
          tokenExpiresAt: expiresAt.toISOString(),
        },
        "shiprocket_auth_token_persisted",
      );

      return token;
    } catch (error) {
      if (
        error instanceof ProviderAdapterError &&
        error.category === "PROVIDER_SERVICE_UNAVAILABLE" &&
        error.safeMessage.includes("conflicted with another instance")
      ) {
        throw error;
      }

      const previous = input.previousRow;
      if (previous && previous.expiresAt.getTime() > Date.now()) {
        const safeError = sanitizeShiprocketAuthRefreshError(
          error instanceof Error ? error.message : "Refresh failed",
        );
        await this.tokenRepository.markRefreshFailed({
          providerId,
          error: safeError,
          leaseToken,
        });
        const token = decryptStoredToken(previous);
        setMemoryCache(providerId, token, previous.expiresAt);
        return token;
      }

      if (previous) {
        await this.tokenRepository.markRefreshFailed({
          providerId,
          error: sanitizeShiprocketAuthRefreshError(
            error instanceof Error ? error.message : "Refresh failed",
          ),
          leaseToken,
        });
      }

      throw error;
    }
  }
}

export const shiprocketAuthService = new ShiprocketAuthService();
