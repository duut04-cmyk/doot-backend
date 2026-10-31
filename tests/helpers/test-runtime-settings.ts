import { RuntimeSettingsService } from "../../src/modules/runtime-settings/runtime-settings.service.js";
import { InMemoryRuntimeSettingsRepository } from "./in-memory-runtime-settings-repository.js";

/** Avoid Prisma runtime-settings reads in unit tests (uses env defaults). */
export function createTestRuntimeSettingsService(): RuntimeSettingsService {
  return new RuntimeSettingsService(new InMemoryRuntimeSettingsRepository());
}
