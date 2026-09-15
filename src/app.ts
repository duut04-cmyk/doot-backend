import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Request } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { buildOpenApiDocument } from "./config/swagger.js";
import { devRequestLoggerMiddleware } from "./core/middleware/dev-request-logger.js";
import { errorHandlerMiddleware } from "./core/middleware/error-handler.js";
import { notFoundMiddleware } from "./core/middleware/not-found.js";
import { requestIdMiddleware } from "./core/middleware/request-id.js";
import type { AuthController } from "./modules/auth/auth.controller.js";
import type { DeliveryController } from "./modules/delivery/delivery.controller.js";
import { createBorzoWebhookRouter } from "./modules/provider/provider.webhook.routes.js";
import { createApiV1Router } from "./routes/index.js";

export function createApp(options?: {
  authController?: AuthController;
  deliveryController?: DeliveryController;
  borzoWebhookRouter?: ReturnType<typeof createBorzoWebhookRouter>;
}) {
  const app = express();

  app.disable("x-powered-by");

  app.use(helmet());
  const corsOrigins = [env.FRONTEND_URL, env.ADMIN_FRONTEND_URL].filter(
    (value): value is string => Boolean(value),
  );
  app.use(
    cors({
      origin: corsOrigins.length > 0 ? corsOrigins : true,
      credentials: true,
    }),
  );
  app.use(cookieParser());
  app.use(requestIdMiddleware);

  if (env.NODE_ENV === "development") {
    app.use(devRequestLoggerMiddleware);
  } else if (env.NODE_ENV !== "test") {
    app.use(
      pinoHttp({
        logger,
        customProps: (req) => ({
          requestId: (req as Request).requestId,
        }),
        autoLogging: true,
      }),
    );
  }

  const openApiDocument = buildOpenApiDocument();
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));

  app.use(
    "/api/v1/providers/borzo",
    options?.borzoWebhookRouter ?? createBorzoWebhookRouter(),
  );

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.use("/api/v1", createApiV1Router(options));

  app.use(notFoundMiddleware);
  app.use(errorHandlerMiddleware);

  return app;
}
