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
        "Requires ADMIN role. Read-only view of runtime platform configuration, operational policies, and feature flags. Values reflect environment variables and code constants — not editable via API.",
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
                          borzoWebhooksEnabled: { type: "boolean" },
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
} as const;
