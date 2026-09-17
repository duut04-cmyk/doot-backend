import swaggerJsdoc from "swagger-jsdoc";
import {
  phoneInputSchema as phoneInputSwaggerSchema,
  phoneResponseSchema,
} from "../core/phone/phone.swagger.js";
import { authSwaggerPaths, authSwaggerComponents } from "../modules/auth/auth.swagger.js";
import {
  deliverySwaggerComponents,
  deliverySwaggerPaths,
} from "../modules/delivery/delivery.swagger.js";
import { bookingSwaggerPaths } from "../modules/booking/booking.swagger.js";
import { feedbackSwaggerPaths } from "../modules/feedback/feedback.swagger.js";
import {
  driverSimulationSwaggerPaths,
  operationalSwaggerPaths,
} from "../modules/operations/operational.swagger.js";
import { env } from "./env.js";
import { ratingSwaggerPaths } from "../modules/rating/rating.swagger.js";
import {
  orchestrationSwaggerPaths,
} from "../modules/orchestration/orchestration.swagger.js";
import {
  providerSwaggerComponents,
  providerSwaggerPaths,
} from "../modules/provider/provider.swagger.js";

const healthPaths = {
  "/api/v1/health": {
    get: {
      tags: ["Health"],
      summary: "Health check",
      description: "Returns service health status.",
      responses: {
        200: {
          description: "Service is healthy",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  data: {
                    type: "object",
                    properties: {
                      status: { type: "string", example: "ok" },
                    },
                    required: ["status"],
                  },
                },
                required: ["success", "data"],
              },
            },
          },
        },
      },
    },
  },
} as const;

export function buildOpenApiDocument() {
  const definition = {
    openapi: "3.0.3",
    info: {
      title: "Dutt Backend API",
      version: "1.0.0",
      description: "Logistics and orchestration platform API.",
    },
    servers: [
      {
        url: "/",
        description: "Current server",
      },
    ],
    tags: [
      { name: "Health", description: "Service health" },
      { name: "Auth", description: "Authentication" },
      { name: "Deliveries", description: "Customer delivery foundation" },
      { name: "Admin Providers", description: "Provider registry and admin configuration" },
      { name: "Admin Deliveries", description: "Admin delivery operational tools" },
      {
        name: "Admin Driver Simulation",
        description:
          "Development/test-only endpoints for simulating provider driver assignment",
      },
    ],
    paths: {
      ...healthPaths,
      ...authSwaggerPaths,
      ...deliverySwaggerPaths,
      ...orchestrationSwaggerPaths,
      ...bookingSwaggerPaths,
      ...operationalSwaggerPaths,
      ...(env.NODE_ENV !== "production" ? driverSimulationSwaggerPaths : {}),
      ...ratingSwaggerPaths,
      ...feedbackSwaggerPaths,
      ...providerSwaggerPaths,
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas: {
        PhoneInput: phoneInputSwaggerSchema,
        PhoneResponse: phoneResponseSchema,
        ...authSwaggerComponents,
        ...deliverySwaggerComponents,
        ...providerSwaggerComponents,
      },
    },
  };

  return swaggerJsdoc({
    definition,
    apis: ["./src/modules/**/*.swagger.ts", "./src/routes/**/*.ts"],
  });
}
