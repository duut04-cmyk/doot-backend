import { beforeEach, describe, expect, it } from "vitest";
import { MockProviderAdapter } from "../src/modules/provider/adapters/mock/mock-provider.adapter.js";
import { ProviderAdapterRegistry } from "../src/modules/provider/adapters/provider-adapter-registry.js";

describe("Provider adapter registry", () => {
  let registry: ProviderAdapterRegistry;

  beforeEach(() => {
    registry = new ProviderAdapterRegistry();
  });

  it("registers and resolves an adapter", () => {
    const adapter = new MockProviderAdapter();
    registry.register(adapter);
    expect(registry.has("MOCK")).toBe(true);
    expect(registry.resolve("mock")?.metadata.providerCode).toBe("MOCK");
  });

  it("lists registered adapter metadata", () => {
    registry.register(new MockProviderAdapter());
    const list = registry.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.supportedOperations).toContain("checkServiceability");
  });

  it("returns null for unknown provider", () => {
    expect(registry.resolve("UNKNOWN")).toBeNull();
  });

  it("rejects duplicate adapter registration", () => {
    registry.register(new MockProviderAdapter());
    expect(() => registry.register(new MockProviderAdapter())).toThrow(
      /already registered/i,
    );
  });
});
