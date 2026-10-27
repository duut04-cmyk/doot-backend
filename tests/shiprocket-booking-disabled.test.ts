import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config/env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config/env.js")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      NODE_ENV: "production",
      SHIPROCKET_ENABLED: true,
      SHIPROCKET_BOOKING_ENABLED: false,
      SHIPROCKET_AUTH_EMAIL: "sandbox@example.com",
      SHIPROCKET_AUTH_PASSWORD: "secret",
    },
  };
});

import { initializeProviderAdapters } from "../src/modules/provider/adapters/bootstrap.js";
import { providerAdapterRegistry } from "../src/modules/provider/adapters/provider-adapter-registry.js";

describe("Shiprocket booking gate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not expose createBooking when SHIPROCKET_BOOKING_ENABLED is false", () => {
    initializeProviderAdapters();
    const adapter = providerAdapterRegistry.resolve("SHIPROCKET");
    expect(adapter).toBeDefined();
    expect(adapter?.supportsOperation("createBooking")).toBe(false);
    expect(adapter?.supportsOperation("getQuote")).toBe(true);
  });
});
