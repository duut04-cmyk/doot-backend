import { Prisma } from "@prisma/client";
import type { ProviderAuthToken, ProviderAuthTokenRefreshStatus } from "@prisma/client";
import { getPrismaClient } from "../../config/database.js";
import {
  SHIPROCKET_AUTH_REFRESH_LEASE_MS,
  SHIPROCKET_AUTH_REFRESH_LEASE_PREFIX,
} from "./adapters/shiprocket/shiprocket.constants.js";
import type { EncryptedCredential } from "./provider.crypto.js";

export type ProviderAuthTokenRow = {
  providerId: string;
  tokenCiphertext: string;
  tokenIv: string;
  tokenAuthTag: string;
  expiresAt: Date;
  issuedAt: Date;
  refreshedAt: Date | null;
  refreshLeaseToken: string | null;
  refreshLeaseUntil: Date | null;
  lastRefreshStatus: ProviderAuthTokenRefreshStatus | null;
  lastRefreshError: string | null;
};

export type SaveTokenWithLeaseResult = "saved" | "lease_lost";
export type CreateTokenIfAbsentResult = "created" | "already_exists";

export function formatProviderAuthRefreshLease(leaseToken: string): string {
  return `${SHIPROCKET_AUTH_REFRESH_LEASE_PREFIX}${leaseToken}`;
}

function mapRow(row: ProviderAuthToken): ProviderAuthTokenRow {
  return {
    providerId: row.providerId,
    tokenCiphertext: row.tokenCiphertext,
    tokenIv: row.tokenIv,
    tokenAuthTag: row.tokenAuthTag,
    expiresAt: row.expiresAt,
    issuedAt: row.issuedAt,
    refreshedAt: row.refreshedAt,
    refreshLeaseToken: row.refreshLeaseToken,
    refreshLeaseUntil: row.refreshLeaseUntil,
    lastRefreshStatus: row.lastRefreshStatus,
    lastRefreshError: row.lastRefreshError,
  };
}

export interface IProviderAuthTokenRepository {
  findByProviderId(providerId: string): Promise<ProviderAuthTokenRow | null>;
  saveSuccessfulTokenWithLease(input: {
    providerId: string;
    leaseToken: string;
    encrypted: EncryptedCredential;
    expiresAt: Date;
    issuedAt: Date;
    refreshedAt: Date;
  }): Promise<SaveTokenWithLeaseResult>;
  createSuccessfulTokenIfAbsent(input: {
    providerId: string;
    encrypted: EncryptedCredential;
    expiresAt: Date;
    issuedAt: Date;
    refreshedAt: Date;
  }): Promise<CreateTokenIfAbsentResult>;
  markRefreshFailed(input: {
    providerId: string;
    error: string;
    leaseToken?: string;
  }): Promise<void>;
  tryAcquireRefreshLease(input: {
    providerId: string;
    leaseToken: string;
  }): Promise<boolean>;
  renewRefreshLease(input: {
    providerId: string;
    leaseToken: string;
  }): Promise<boolean>;
  releaseRefreshLease(input: { providerId: string; leaseToken: string }): Promise<void>;
}

export class PrismaProviderAuthTokenRepository implements IProviderAuthTokenRepository {
  async findByProviderId(providerId: string): Promise<ProviderAuthTokenRow | null> {
    const prisma = getPrismaClient();
    const row = await prisma.providerAuthToken.findUnique({ where: { providerId } });
    return row ? mapRow(row) : null;
  }

  async saveSuccessfulTokenWithLease(input: {
    providerId: string;
    leaseToken: string;
    encrypted: EncryptedCredential;
    expiresAt: Date;
    issuedAt: Date;
    refreshedAt: Date;
  }): Promise<SaveTokenWithLeaseResult> {
    const prisma = getPrismaClient();
    const leaseValue = formatProviderAuthRefreshLease(input.leaseToken);
    const result = await prisma.providerAuthToken.updateMany({
      where: {
        providerId: input.providerId,
        refreshLeaseToken: leaseValue,
      },
      data: {
        tokenCiphertext: input.encrypted.ciphertext,
        tokenIv: input.encrypted.iv,
        tokenAuthTag: input.encrypted.authTag,
        expiresAt: input.expiresAt,
        issuedAt: input.issuedAt,
        refreshedAt: input.refreshedAt,
        refreshLeaseToken: null,
        refreshLeaseUntil: null,
        lastRefreshStatus: "SUCCESS",
        lastRefreshError: null,
      },
    });
    return result.count === 1 ? "saved" : "lease_lost";
  }

  async createSuccessfulTokenIfAbsent(input: {
    providerId: string;
    encrypted: EncryptedCredential;
    expiresAt: Date;
    issuedAt: Date;
    refreshedAt: Date;
  }): Promise<CreateTokenIfAbsentResult> {
    const prisma = getPrismaClient();
    try {
      await prisma.providerAuthToken.create({
        data: {
          providerId: input.providerId,
          tokenCiphertext: input.encrypted.ciphertext,
          tokenIv: input.encrypted.iv,
          tokenAuthTag: input.encrypted.authTag,
          expiresAt: input.expiresAt,
          issuedAt: input.issuedAt,
          refreshedAt: input.refreshedAt,
          refreshLeaseToken: null,
          refreshLeaseUntil: null,
          lastRefreshStatus: "SUCCESS",
          lastRefreshError: null,
        },
      });
      return "created";
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return "already_exists";
      }
      throw error;
    }
  }

  async markRefreshFailed(input: {
    providerId: string;
    error: string;
    leaseToken?: string;
  }): Promise<void> {
    const prisma = getPrismaClient();
    const where: Prisma.ProviderAuthTokenWhereInput = {
      providerId: input.providerId,
    };
    if (input.leaseToken) {
      where.refreshLeaseToken = formatProviderAuthRefreshLease(input.leaseToken);
    }
    await prisma.providerAuthToken.updateMany({
      where,
      data: {
        lastRefreshStatus: "FAILED",
        lastRefreshError: input.error,
        refreshLeaseToken: null,
        refreshLeaseUntil: null,
      },
    });
  }

  async tryAcquireRefreshLease(input: {
    providerId: string;
    leaseToken: string;
  }): Promise<boolean> {
    const prisma = getPrismaClient();
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + SHIPROCKET_AUTH_REFRESH_LEASE_MS);
    const leaseValue = formatProviderAuthRefreshLease(input.leaseToken);

    const acquired = await prisma.providerAuthToken.updateMany({
      where: {
        providerId: input.providerId,
        OR: [{ refreshLeaseUntil: null }, { refreshLeaseUntil: { lte: now } }],
      },
      data: {
        refreshLeaseToken: leaseValue,
        refreshLeaseUntil: leaseUntil,
      },
    });
    return acquired.count === 1;
  }

  async renewRefreshLease(input: {
    providerId: string;
    leaseToken: string;
  }): Promise<boolean> {
    const prisma = getPrismaClient();
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + SHIPROCKET_AUTH_REFRESH_LEASE_MS);
    const leaseValue = formatProviderAuthRefreshLease(input.leaseToken);
    const renewed = await prisma.providerAuthToken.updateMany({
      where: {
        providerId: input.providerId,
        refreshLeaseToken: leaseValue,
        refreshLeaseUntil: { gt: now },
      },
      data: {
        refreshLeaseUntil: leaseUntil,
      },
    });
    return renewed.count === 1;
  }

  async releaseRefreshLease(input: {
    providerId: string;
    leaseToken: string;
  }): Promise<void> {
    const prisma = getPrismaClient();
    const leaseValue = formatProviderAuthRefreshLease(input.leaseToken);
    await prisma.providerAuthToken.updateMany({
      where: {
        providerId: input.providerId,
        refreshLeaseToken: leaseValue,
      },
      data: {
        refreshLeaseToken: null,
        refreshLeaseUntil: null,
      },
    });
  }
}

export const providerAuthTokenRepository = new PrismaProviderAuthTokenRepository();
