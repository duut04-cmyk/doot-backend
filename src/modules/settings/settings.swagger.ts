const adminErrorSchema = {
  type: "object",
  properties: {
    success: { type: "boolean", example: false },
    error: {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" },
      },
      required: ["code", "message"],
    },
    requestId: { type: "string" },
  },
  required: ["success", "error", "requestId"],
} as const;

const adminSecurity = [{ bearerAuth: [] }] as const;

export const settingsSwaggerPaths = {
  "/api/v1/admin/settings": {
    get: {
      tags: ["Admin Settings"],
      summary: "Get platform settings snapshot",
      description:
        "Requires ADMIN role. View of runtime platform configuration, operational policies, and feature flags. Booking quote policies may be overridden in the database via PATCH /api/v1/admin/settings/policies.",
      security: adminSecurity,
      responses: {
        200: {
          description: "Platform settings snapshot",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  data: {
                    type: "object",
                    properties: {
                      platform: {
                        type: "object",
                        properties: {
                          appName: { type: "string" },
                          nodeEnv: {
                            type: "string",
                            enum: ["development", "test", "production"],
                          },
                          port: { type: "integer" },
                          frontendUrl: { type: "string", nullable: true },
                          adminFrontendUrl: { type: "string", nullable: true },
                        },
                      },
                      policies: { type: "object" },
                      flags: {
                        type: "object",
                        properties: {
                          mockProviderAdapter: { type: "boolean" },
                          developmentMode: { type: "boolean" },
                        },
                      },
                      checkedAt: { type: "string", format: "date-time" },
                    },
                  },
                },
              },
            },
          },
        },
        401: {
          description: "Unauthorized",
          content: { "application/json": { schema: adminErrorSchema } },
        },
        403: {
          description: "Forbidden — ADMIN role required",
          content: { "application/json": { schema: adminErrorSchema } },
        },
      },
    },
  },
  "/api/v1/admin/settings/policies": {
    patch: {
      tags: ["Admin Settings"],
      summary: "Update allowlisted booking runtime policies",
      description:
        "Requires ADMIN role. Updates persisted booking quote max age and price tolerance with optimistic concurrency (expectedVersions).",
      security: adminSecurity,
      responses: {
        200: { description: "Updated booking runtime policies" },
        400: {
          description: "Validation error",
          content: { "application/json": { schema: adminErrorSchema } },
        },
        401: {
          description: "Unauthorized",
          content: { "application/json": { schema: adminErrorSchema } },
        },
        403: {
          description: "Forbidden — ADMIN role required",
          content: { "application/json": { schema: adminErrorSchema } },
        },
        409: {
          description: "Version conflict",
          content: { "application/json": { schema: adminErrorSchema } },
        },
      },
    },
  },
} as const;
