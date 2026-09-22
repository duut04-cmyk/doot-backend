const providerErrorSchema = {
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

const credentialMetadataSchema = {
  type: "object",
  properties: {
    configured: { type: "boolean" },
    fields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          configured: { type: "boolean" },
        },
      },
    },
  },
} as const;

const providerSummarySchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    code: { type: "string", example: "MOCK" },
    name: { type: "string" },
    displayName: { type: "string", nullable: true },
    environment: { type: "string", enum: ["SANDBOX", "LIVE"] },
    status: { type: "string", enum: ["ACTIVE", "INACTIVE", "SUSPENDED"] },
    enabled: { type: "boolean" },
    orchestrationEnabled: { type: "boolean" },
    priority: { type: "integer" },
    integrationStatus: {
      type: "string",
      enum: ["NOT_CONFIGURED", "CONFIGURED", "READY", "ERROR"],
    },
    orchestrationEligible: { type: "boolean" },
    health: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["UNKNOWN", "HEALTHY", "UNHEALTHY"] },
        lastCheckedAt: { type: "string", format: "date-time", nullable: true },
        lastError: { type: "string", nullable: true },
      },
    },
    credentials: credentialMetadataSchema,
    capabilities: {
      type: "array",
      items: { type: "string" },
    },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

const adminSecurity = [{ bearerAuth: [] }] as const;

const admin403 = {
  description: "Forbidden — ADMIN role required",
  content: { "application/json": { schema: providerErrorSchema } },
} as const;

const admin401 = {
  description: "Unauthorized",
  content: { "application/json": { schema: providerErrorSchema } },
} as const;

export const providerSwaggerComponents = {
  ProviderSummary: providerSummarySchema,
  ProviderCredentialMetadata: credentialMetadataSchema,
} as const;

export const providerSwaggerPaths = {
  "/api/v1/admin/providers": {
    post: {
      tags: ["Admin Providers"],
      summary: "Register a provider configuration",
      description: "Requires ADMIN role. Does not connect to external provider APIs.",
      security: adminSecurity,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["code", "name"],
              properties: {
                code: { type: "string", example: "MOCK" },
                name: { type: "string", example: "Mock Provider" },
                displayName: { type: "string", nullable: true },
                description: { type: "string", nullable: true },
                environment: { type: "string", enum: ["SANDBOX", "LIVE"] },
                enabled: { type: "boolean" },
                orchestrationEnabled: { type: "boolean" },
                priority: { type: "integer" },
                capabilities: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: "Provider created",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: providerSummarySchema,
                },
              },
            },
          },
        },
        401: admin401,
        403: admin403,
        409: {
          description: "Provider code already exists",
          content: { "application/json": { schema: providerErrorSchema } },
        },
      },
    },
    get: {
      tags: ["Admin Providers"],
      summary: "List provider configurations",
      security: adminSecurity,
      responses: {
        200: {
          description: "Provider list (no secrets)",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: { type: "array", items: providerSummarySchema },
                },
              },
            },
          },
        },
        401: admin401,
        403: admin403,
      },
    },
  },
  "/api/v1/admin/providers/{id}": {
    get: {
      tags: ["Admin Providers"],
      summary: "Get provider configuration",
      security: adminSecurity,
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        200: {
          description:
            "Provider detail (credential metadata only, never secret values)",
        },
        401: admin401,
        403: admin403,
        404: { description: "Not found" },
      },
    },
    patch: {
      tags: ["Admin Providers"],
      summary: "Update provider configuration",
      security: adminSecurity,
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object" } } },
      },
      responses: {
        200: { description: "Updated provider" },
        401: admin401,
        403: admin403,
        404: { description: "Not found" },
      },
    },
  },
  "/api/v1/admin/providers/{id}/status": {
    patch: {
      tags: ["Admin Providers"],
      summary: "Update provider lifecycle status",
      security: adminSecurity,
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["status"],
              properties: {
                status: { type: "string", enum: ["ACTIVE", "INACTIVE", "SUSPENDED"] },
                enabled: { type: "boolean" },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Status updated" },
        401: admin401,
        403: admin403,
      },
    },
  },
  "/api/v1/admin/providers/{id}/credentials": {
    put: {
      tags: ["Admin Providers"],
      summary: "Upsert encrypted provider credentials",
      description:
        "Secrets are encrypted at rest (AES-256-GCM). Response never echoes credential values.",
      security: adminSecurity,
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                API_KEY: { type: "string", writeOnly: true },
                API_SECRET: { type: "string", writeOnly: true },
              },
              description:
                "At least one credential field required. Values are write-only.",
            },
          },
        },
      },
      responses: {
        200: {
          description: "Configuration status only",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: {
                    type: "object",
                    properties: { configured: { type: "boolean" } },
                  },
                },
              },
            },
          },
        },
        401: admin401,
        403: admin403,
      },
    },
  },
  "/api/v1/admin/providers/{id}/capabilities": {
    put: {
      tags: ["Admin Providers"],
      summary: "Replace provider capabilities",
      security: adminSecurity,
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["capabilities"],
              properties: {
                capabilities: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      },
      responses: {
        200: { description: "Capabilities updated" },
        401: admin401,
        403: admin403,
      },
    },
  },
  "/api/v1/admin/providers/{id}/services": {
    post: {
      tags: ["Admin Providers"],
      summary: "Add provider service configuration",
      security: adminSecurity,
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        201: { description: "Service created" },
        401: admin401,
        403: admin403,
      },
    },
    get: {
      tags: ["Admin Providers"],
      summary: "List provider services",
      security: adminSecurity,
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: { 200: { description: "Service list" }, 401: admin401, 403: admin403 },
    },
  },
  "/api/v1/admin/providers/{id}/services/{serviceId}": {
    patch: {
      tags: ["Admin Providers"],
      summary: "Update or disable a provider service",
      security: adminSecurity,
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
        {
          name: "serviceId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        200: { description: "Service updated" },
        401: admin401,
        403: admin403,
      },
    },
  },
  "/api/v1/admin/providers/{id}/vehicles": {
    post: {
      tags: ["Admin Providers"],
      summary: "Add provider vehicle configuration",
      security: adminSecurity,
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        201: { description: "Vehicle created" },
        401: admin401,
        403: admin403,
      },
    },
    get: {
      tags: ["Admin Providers"],
      summary: "List provider vehicles",
      security: adminSecurity,
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: { 200: { description: "Vehicle list" }, 401: admin401, 403: admin403 },
    },
  },
  "/api/v1/admin/providers/{id}/vehicles/{vehicleId}": {
    patch: {
      tags: ["Admin Providers"],
      summary: "Update provider vehicle configuration",
      security: adminSecurity,
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
        {
          name: "vehicleId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        200: { description: "Vehicle updated" },
        401: admin401,
        403: admin403,
      },
    },
  },
  "/api/v1/admin/providers/{id}/test-connection": {
    post: {
      tags: ["Admin Providers"],
      summary: "Test provider connectivity (admin diagnostic)",
      description:
        "Executes a safe provider health check using configured credentials. Does not create orders.",
      security: adminSecurity,
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        200: {
          description: "Sanitized connectivity result",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  data: {
                    type: "object",
                    properties: {
                      providerCode: { type: "string", example: "MOCK" },
                      environment: { type: "string", enum: ["SANDBOX", "LIVE"] },
                      connected: { type: "boolean" },
                      latencyMs: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
        401: admin401,
        403: admin403,
      },
    },
  },
  "/api/v1/admin/providers/{id}/test-quote": {
    post: {
      tags: ["Admin Providers"],
      summary: "Test provider quote normalization (admin diagnostic)",
      description:
        "Calculates a provider quote without booking. Returns Dutt normalized quote, serviceability, and availability.",
      security: adminSecurity,
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["pickup", "drop", "package", "schedule", "requirements"],
              properties: {
                pickup: {
                  type: "object",
                  properties: {
                    addressText: { type: "string" },
                    contactName: { type: "string" },
                    contactPhoneCountryCode: { type: "string", example: "+91" },
                    contactPhoneNumber: { type: "string", example: "9876543210" },
                  },
                },
                drop: {
                  type: "object",
                  properties: {
                    addressText: { type: "string" },
                    contactName: { type: "string" },
                    contactPhoneCountryCode: { type: "string", example: "+91" },
                    contactPhoneNumber: { type: "string", example: "9876543210" },
                  },
                },
                package: {
                  type: "object",
                  properties: {
                    packageType: {
                      type: "string",
                      enum: ["DOCUMENT", "FOOD", "MEDICINE", "OTHER"],
                    },
                    weightKg: { type: "number" },
                    quantity: { type: "integer" },
                  },
                },
                schedule: {
                  type: "object",
                  properties: {
                    mode: { type: "string", enum: ["ASAP", "SCHEDULED"] },
                    timezone: { type: "string" },
                  },
                },
                requirements: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: "Normalized provider quote probe result",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  data: {
                    type: "object",
                    properties: {
                      providerCode: { type: "string", example: "MOCK" },
                      availability: {
                        type: "object",
                        properties: {
                          known: {
                            type: "boolean",
                            description:
                              "False when driver availability was not established by the provider operation.",
                          },
                          available: { type: "boolean" },
                          availableDriverCount: {
                            type: "integer",
                            nullable: true,
                          },
                          drivers: { type: "array", nullable: true, items: {} },
                          reason: { type: "string", nullable: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        401: admin401,
        403: admin403,
      },
    },
  },
} as const;
