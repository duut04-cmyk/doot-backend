import { randomUUID } from "node:crypto";
import type { ProviderAuthTokenRefreshStatus } from "@prisma/client";
import {
  formatProviderAuthRefreshLease,
  type CreateTokenIfAbsentResult,
  type IProviderAuthTokenRepository,
  type ProviderAuthTokenRow,
  type SaveTokenWithLeaseResult,
} from "../../src/modules/provider/provider-auth-token.repository.js";
import { SHIPROCKET_AUTH_REFRESH_LEASE_MS } from "../../src/modules/provider/adapters/shiprocket/shiprocket.constants.js";
import type { EncryptedCredential } from "../../src/modules/provider/provider.crypto.js";

type StoredRow = ProviderAuthTokenRow & { id: string; updatedAt: Date };

export class InMemoryProviderAuthTokenRepository implements IProviderAuthTokenRepository {
  readonly rows = new Map<string, StoredRow>();

  async findByProviderId(providerId: string): Promise<ProviderAuthTokenRow | null> {
    const row = this.rows.get(providerId);
    return row ? { ...row } : null;
  }

  /** Test fixture seeding only — bypasses lease checks. */
  seedStoredToken(input: {
    providerId: string;
    encrypted: EncryptedCredential;
    expiresAt: Date;
    issuedAt: Date;
    refreshedAt: Date;
  }): void {
    const existing = this.rows.get(input.providerId);
    this.rows.set(input.providerId, {
      id: existing?.id ?? randomUUID(),
      providerId: input.providerId,
      tokenCiphertext: input.encrypted.ciphertext,
      tokenIv: input.encrypted.iv,
      tokenAuthTag: input.encrypted.authTag,
      expiresAt: input.expiresAt,
      issuedAt: input.issuedAt,
      refreshedAt: input.refreshedAt,
      refreshLeaseToken: null,
      refreshLeaseUntil: null,
      lastRefreshStatus: "SUCCESS" as ProviderAuthTokenRefreshStatus,
      lastRefreshError: null,
      updatedAt: new Date(),
    });
  }

  async saveSuccessfulTokenWithLease(input: {
    providerId: string;
    leaseToken: string;
    encrypted: EncryptedCredential;
    expiresAt: Date;
    issuedAt: Date;
    refreshedAt: Date;
  }): Promise<SaveTokenWithLeaseResult> {
    const row = this.rows.get(input.providerId);
    if (!row) {
      return "lease_lost";
    }
    const expected = formatProviderAuthRefreshLease(input.leaseToken);
    if (row.refreshLeaseToken !== expected) {
      return "lease_lost";
    }
    row.tokenCiphertext = input.encrypted.ciphertext;
    row.tokenIv = input.encrypted.iv;
    row.tokenAuthTag = input.encrypted.authTag;
    row.expiresAt = input.expiresAt;
    row.issuedAt = input.issuedAt;
    row.refreshedAt = input.refreshedAt;
    row.refreshLeaseToken = null;
    row.refreshLeaseUntil = null;
    row.lastRefreshStatus = "SUCCESS";
    row.lastRefreshError = null;
    row.updatedAt = new Date();
    return "saved";
  }

  async createSuccessfulTokenIfAbsent(input: {
    providerId: string;
    encrypted: EncryptedCredential;
    expiresAt: Date;
    issuedAt: Date;
    refreshedAt: Date;
  }): Promise<CreateTokenIfAbsentResult> {
    if (this.rows.has(input.providerId)) {
      return "already_exists";
    }
    this.seedStoredToken(input);
    return "created";
  }

  async markRefreshFailed(input: {
    providerId: string;
    error: string;
    leaseToken?: string;
  }): Promise<void> {
    const row = this.rows.get(input.providerId);
    if (!row) {
      return;
    }
    if (input.leaseToken) {
      const expected = formatProviderAuthRefreshLease(input.leaseToken);
      if (row.refreshLeaseToken !== expected) {
        return;
      }
    }
    row.lastRefreshStatus = "FAILED";
    row.lastRefreshError = input.error;
    row.refreshLeaseToken = null;
    row.refreshLeaseUntil = null;
    row.updatedAt = new Date();
  }

  async tryAcquireRefreshLease(input: {
    providerId: string;
    leaseToken: string;
  }): Promise<boolean> {
    const row = this.rows.get(input.providerId);
    if (!row) {
      return false;
    }
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + SHIPROCKET_AUTH_REFRESH_LEASE_MS);
    const leaseActive = row.refreshLeaseUntil != null && row.refreshLeaseUntil > now;
    if (leaseActive) {
      return false;
    }
    row.refreshLeaseToken = formatProviderAuthRefreshLease(input.leaseToken);
    row.refreshLeaseUntil = leaseUntil;
    row.updatedAt = now;
    return true;
  }

  async renewRefreshLease(input: {
    providerId: string;
    leaseToken: string;
  }): Promise<boolean> {
    const row = this.rows.get(input.providerId);
    if (!row) {
      return false;
    }
    const now = new Date();
    const expected = formatProviderAuthRefreshLease(input.leaseToken);
    if (row.refreshLeaseToken !== expected || row.refreshLeaseUntil == null) {
      return false;
    }
    if (row.refreshLeaseUntil <= now) {
      return false;
    }
    row.refreshLeaseUntil = new Date(now.getTime() + SHIPROCKET_AUTH_REFRESH_LEASE_MS);
    row.updatedAt = now;
    return true;
  }

  async releaseRefreshLease(input: {
    providerId: string;
    leaseToken: string;
  }): Promise<void> {
    const row = this.rows.get(input.providerId);
    if (!row) {
      return;
    }
    const expected = formatProviderAuthRefreshLease(input.leaseToken);
    if (row.refreshLeaseToken !== expected) {
      return;
    }
    row.refreshLeaseToken = null;
    row.refreshLeaseUntil = null;
    row.updatedAt = new Date();
  }
}
