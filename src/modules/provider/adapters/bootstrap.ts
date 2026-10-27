import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import {
  ProviderAdapterRegistry,
  providerAdapterRegistry,
} from "./provider-adapter-registry.js";
import { MockProviderAdapter } from "./mock/mock-provider.adapter.js";
import { MOCK_PROVIDER_CODE } from "./mock/mock-provider.constants.js";
import { ShiprocketProviderAdapter } from "./shiprocket/shiprocket-provider.adapter.js";
import { SHIPROCKET_PROVIDER_CODE } from "./shiprocket/shiprocket.constants.js";

const initializedRegistries = new WeakSet<ProviderAdapterRegistry>();

export function initializeProviderAdapters(
  registry: ProviderAdapterRegistry = providerAdapterRegistry,
): void {
  if (initializedRegistries.has(registry)) {
    return;
  }

  if (env.NODE_ENV === "test" || env.ENABLE_MOCK_PROVIDER_ADAPTER) {
    if (!registry.has(MOCK_PROVIDER_CODE)) {
      registry.register(new MockProviderAdapter());
      logger.info(
        { providerCode: MOCK_PROVIDER_CODE },
        "mock_provider_adapter_registered",
      );
    }
  }

  if (env.SHIPROCKET_ENABLED || env.NODE_ENV === "test") {
    if (!registry.has(SHIPROCKET_PROVIDER_CODE)) {
      registry.register(new ShiprocketProviderAdapter());
      logger.info(
        { providerCode: SHIPROCKET_PROVIDER_CODE },
        "shiprocket_provider_adapter_registered",
      );
    }
  }

  initializedRegistries.add(registry);
}
