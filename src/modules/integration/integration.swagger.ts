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

const integrationItemSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    category: {
      type: "string",
      enum: ["identity", "communications", "infrastructure", "webhooks", "security"],
    },
    status: {
      type: "string",
      enum: ["connected", "not_configured", "degraded", "coming_soon"],
    },
    statusLabel: { type: "string" },
    usedBy: { type: "string" },
    impact: { type: "string" },
    metadata: { type: "object", additionalProperties: { type: "string" } },
    manageHref: { type: "string", nullable: true },
  },
} as const;

export const integrationSwaggerPaths = {
  "/api/v1/admin/integrations/status": {
    get: {
      tags: ["Admin Integrations"],
      summary: "Get platform integration status",
      description:
        "Requires ADMIN role. Read-only snapshot of third-party connectivity (email, auth, database, webhooks, encryption). No secrets are returned.",
      security: adminSecurity,
      responses: {
        200: {
          description: "Integration status by category",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  data: {
                    type: "object",
                    properties: {
                      summary: {
                        type: "object",
                        properties: {
                          connected: { type: "integer" },
                          total: { type: "integer" },
                          needsAttention: { type: "integer" },
                        },
                      },
                      categories: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            id: { type: "string" },
                            title: { type: "string" },
                            description: { type: "string" },
                            items: {
                              type: "array",
                              items: integrationItemSchema,
                            },
                          },
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
