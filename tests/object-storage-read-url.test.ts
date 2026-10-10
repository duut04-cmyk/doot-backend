import { afterEach, describe, expect, it, vi } from "vitest";

describe("objectStorageService.resolveObjectReadUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses R2_PUBLIC_BASE_URL without R2 credentials", async () => {
    vi.stubEnv("R2_PUBLIC_BASE_URL", "https://cdn.example.com");
    vi.stubEnv("R2_ACCOUNT_ID", "");
    vi.stubEnv("R2_ACCESS_KEY_ID", "");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "");

    const { objectStorageService } =
      await import("../src/infrastructure/object-storage/object-storage.service.js");

    const url = await objectStorageService.resolveObjectReadUrl(
      "staging/user-1/batch/photos/abc.jpg",
    );
    expect(url).toBe("https://cdn.example.com/staging/user-1/batch/photos/abc.jpg");
  });

  it("returns null when neither public base nor credentials are configured", async () => {
    vi.stubEnv("R2_PUBLIC_BASE_URL", "");
    vi.stubEnv("R2_ACCOUNT_ID", "");
    vi.stubEnv("R2_ACCESS_KEY_ID", "");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "");

    const { objectStorageService } =
      await import("../src/infrastructure/object-storage/object-storage.service.js");

    const url = await objectStorageService.resolveObjectReadUrl("staging/x/y.jpg");
    expect(url).toBeNull();
  });
});
