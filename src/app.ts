import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Request } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import swaggerUi from "swagger-ui-express";
import {
  createCorsOriginCallback,
  resolveCorsAllowedOrigins,
} from "./config/cors.config.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { buildOpenApiDocument } from "./config/swagger.js";
import { devRequestLoggerMiddleware } from "./core/middleware/dev-request-logger.js";
import { errorHandlerMiddleware } from "./core/middleware/error-handler.js";
import { notFoundMiddleware } from "./core/middleware/not-found.js";
import { requestIdMiddleware } from "./core/middleware/request-id.js";
import type { AuthController } from "./modules/auth/auth.controller.js";
import type { DeliveryController } from "./modules/delivery/delivery.controller.js";
import { createApiV1Router } from "./routes/index.js";

export function createApp(options?: {
  authController?: AuthController;
  deliveryController?: DeliveryController;
  /** When false, Swagger UI is not mounted. Enabled by default; pass `exposeSwagger: false` to disable. */
  exposeSwagger?: boolean;
}) {
  const app = express();

  app.disable("x-powered-by");

  app.use(helmet());
  app.use(
    cors({
      origin: createCorsOriginCallback({
        allowedOrigins: resolveCorsAllowedOrigins(
          env.FRONTEND_URL,
          env.ADMIN_FRONTEND_URL,
        ),
        nodeEnv: env.NODE_ENV,
      }),
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

  const exposeSwagger = options?.exposeSwagger ?? true;
  if (exposeSwagger) {
    const openApiDocument = buildOpenApiDocument();
    app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));
  }

  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        (req as Request).rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: true }));

  app.use("/api/v1", createApiV1Router(options));

  app.get("/", (_req, res) => {
    res.status(200).json({
      success: true,
      message: "Dutt backend is running",
    });
  });

  app.get("/health", (_req, res) => {
    res.status(200).json({
      success: true,
      message: "Dutt backend is healthy",
    });
  });

  app.use(notFoundMiddleware);
  app.use(errorHandlerMiddleware);

  return app;
}
