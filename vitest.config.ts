import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      NODE_ENV: "test",
      MSG91_ENABLED: "false",
      // Must be set before env.ts is first imported; local .env must not win in tests.
      BORZO_CALLBACK_SECRET: "test-borzo-callback-secret-min-16-chars",
    },
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
  },
});
