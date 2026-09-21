import { createApp } from "./app.js";
import { disconnectDatabase } from "./config/database.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { initializeProviderAdapters } from "./modules/provider/adapters/bootstrap.js";

async function bootstrap(): Promise<void> {
  // Database connections are established lazily when features need Prisma.
  // This keeps health/Swagger available without a live Postgres instance.

  initializeProviderAdapters();
  const app = createApp();
  const server = app.listen(env.PORT, "0.0.0.0", () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, "Dutt backend listening");
    if (env.NODE_ENV === "development") {
      console.log(`✓ Backend ready on http://localhost:${env.PORT}`);
    }
  });

  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    logger.info({ signal }, "Shutting down gracefully");

    server.close(async (closeError) => {
      if (closeError) {
        logger.error({ err: closeError }, "Error while closing HTTP server");
      }

      try {
        await disconnectDatabase();
        logger.info("Shutdown complete");
        process.exit(0);
      } catch (error) {
        logger.error({ err: error }, "Error while disconnecting database");
        process.exit(1);
      }
    });

    setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

bootstrap().catch((error: unknown) => {
  logger.error({ err: error }, "Failed to start server");
  process.exit(1);
});
