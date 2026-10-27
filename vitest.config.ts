import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const adminPanelSrc = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../admin-panel/src",
);

export default defineConfig({
  resolve: {
    alias: {
      "@": adminPanelSrc,
    },
  },
  test: {
    environment: "node",
    env: {
      NODE_ENV: "test",
      MSG91_ENABLED: "false",
      SMS_PROVIDER: "mock",
    },
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
  },
});
