import { describe, expect, it } from "vitest";
import { InMemoryProviderAuthTokenRepository } from "./helpers/in-memory-provider-auth-token.repository.js";
import { encryptCredential } from "../src/modules/provider/provider.crypto.js";
import { SHIPROCKET_AUTH_REFRESH_LEASE_MS } from "../src/modules/provider/adapters/shiprocket/shiprocket.constants.js";

describe("Provider auth token lease (in-memory)", () => {
  it("allows only one active refresh lease holder", async () => {
    const repo = new InMemoryProviderAuthTokenRepository();
    const providerId = "provider-lease";
    repo.seedStoredToken({
      providerId,
      encrypted: encryptCredential("token"),
      expiresAt: new Date(Date.now() + 60_000),
      issuedAt: new Date(),
      refreshedAt: new Date(),
    });

    const first = await repo.tryAcquireRefreshLease({
      providerId,
      leaseToken: "worker-a",
    });
    const second = await repo.tryAcquireRefreshLease({
      providerId,
      leaseToken: "worker-b",
    });
    expect(first).toBe(true);
    expect(second).toBe(false);

    await repo.releaseRefreshLease({ providerId, leaseToken: "worker-a" });
    const third = await repo.tryAcquireRefreshLease({
      providerId,
      leaseToken: "worker-c",
    });
    expect(third).toBe(true);
  });

  it("reclaims only after refreshLeaseUntil expires", async () => {
    const repo = new InMemoryProviderAuthTokenRepository();
    const providerId = "provider-expired-lease";
    repo.seedStoredToken({
      providerId,
      encrypted: encryptCredential("token"),
      expiresAt: new Date(Date.now() + 60_000),
      issuedAt: new Date(),
      refreshedAt: new Date(),
    });

    expect(
      await repo.tryAcquireRefreshLease({ providerId, leaseToken: "worker-a" }),
    ).toBe(true);

    const row = repo.rows.get(providerId)!;
    row.refreshLeaseUntil = new Date(Date.now() - 1000);

    expect(
      await repo.tryAcquireRefreshLease({ providerId, leaseToken: "worker-b" }),
    ).toBe(true);
  });

  it("does not reclaim an active lease based on updatedAt alone", async () => {
    const repo = new InMemoryProviderAuthTokenRepository();
    const providerId = "provider-active-lease";
    repo.seedStoredToken({
      providerId,
      encrypted: encryptCredential("token"),
      expiresAt: new Date(Date.now() + 60_000),
      issuedAt: new Date(),
      refreshedAt: new Date(),
    });

    expect(
      await repo.tryAcquireRefreshLease({ providerId, leaseToken: "worker-a" }),
    ).toBe(true);

    const row = repo.rows.get(providerId)!;
    row.updatedAt = new Date(Date.now() - SHIPROCKET_AUTH_REFRESH_LEASE_MS * 2);
    row.refreshLeaseUntil = new Date(Date.now() + SHIPROCKET_AUTH_REFRESH_LEASE_MS);

    expect(
      await repo.tryAcquireRefreshLease({ providerId, leaseToken: "worker-b" }),
    ).toBe(false);
  });

  it("saveSuccessfulTokenWithLease requires matching lease token", async () => {
    const repo = new InMemoryProviderAuthTokenRepository();
    const providerId = "provider-conditional-save";
    repo.seedStoredToken({
      providerId,
      encrypted: encryptCredential("original-token"),
      expiresAt: new Date(Date.now() + 60_000),
      issuedAt: new Date(),
      refreshedAt: new Date(),
    });
    await repo.tryAcquireRefreshLease({ providerId, leaseToken: "holder-a" });
    const ciphertextBefore = (await repo.findByProviderId(providerId))!.tokenCiphertext;

    const lost = await repo.saveSuccessfulTokenWithLease({
      providerId,
      leaseToken: "wrong-lease",
      encrypted: encryptCredential("attacker-token"),
      expiresAt: new Date(Date.now() + 60_000),
      issuedAt: new Date(),
      refreshedAt: new Date(),
    });
    expect(lost).toBe("lease_lost");

    const row = await repo.findByProviderId(providerId);
    expect(row?.tokenCiphertext).toBe(ciphertextBefore);
  });
});
