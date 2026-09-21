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

const customerSummarySchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    name: { type: "string" },
    email: { type: "string", format: "email" },
    phone: { type: "object", nullable: true },
    emailVerified: { type: "boolean" },
    status: { type: "string", enum: ["ACTIVE", "SUSPENDED", "DELETED"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    oauthProviders: {
      type: "array",
      items: { type: "string", enum: ["GOOGLE"] },
    },
    stats: {
      type: "object",
      properties: {
        totalDeliveries: { type: "integer" },
        lastDeliveryAt: { type: "string", format: "date-time", nullable: true },
      },
    },
  },
} as const;

export const customerSwaggerComponents = {
  CustomerSummary: customerSummarySchema,
} as const;

export const customerSwaggerPaths = {
  "/api/v1/admin/customers": {
    get: {
      tags: ["Admin Customers"],
      summary: "List customers",
      description:
        "Requires ADMIN role. Returns paginated customer accounts with delivery stats.",
      security: adminSecurity,
      parameters: [
        { name: "page", in: "query", schema: { type: "integer", default: 1 } },
        { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
        { name: "search", in: "query", schema: { type: "string" } },
        {
          name: "status",
          in: "query",
          schema: { type: "string", enum: ["ACTIVE", "SUSPENDED", "DELETED"] },
        },
        {
          name: "emailVerified",
          in: "query",
          schema: { type: "string", enum: ["true", "false"] },
        },
      ],
      responses: {
        200: {
          description: "Paginated customer list",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  data: {
                    type: "object",
                    properties: {
                      items: {
                        type: "array",
                        items: customerSummarySchema,
                      },
                      page: { type: "integer" },
                      limit: { type: "integer" },
                      total: { type: "integer" },
                      totalPages: { type: "integer" },
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
  "/api/v1/admin/customers/{id}": {
    get: {
      tags: ["Admin Customers"],
      summary: "Get customer details",
      description:
        "Requires ADMIN role. Includes delivery stats and recent deliveries.",
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
          description: "Customer detail",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  data: { type: "object" },
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
        404: {
          description: "Customer not found",
          content: { "application/json": { schema: adminErrorSchema } },
        },
      },
    },
    patch: {
      tags: ["Admin Customers"],
      summary: "Update customer account status",
      description: "Requires ADMIN role. Supports suspend and reactivate.",
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
                status: { type: "string", enum: ["ACTIVE", "SUSPENDED"] },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: "Customer updated",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  data: { type: "object" },
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
        404: {
          description: "Customer not found",
          content: { "application/json": { schema: adminErrorSchema } },
        },
      },
    },
  },
} as const;
