const deliveryIdParam = {
  name: "id",
  in: "path" as const,
  required: true,
  schema: { type: "string", format: "uuid" },
};

const bearerSecurity = [{ bearerAuth: [] }];

const operationalErrorSchema = {
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

export const operationalSwaggerPaths = {
  "/api/v1/deliveries/{id}/driver": {
    get: {
      tags: ["Deliveries"],
      summary: "Get driver assignment for delivery",
      security: bearerSecurity,
      parameters: [deliveryIdParam],
      responses: {
        200: { description: "Driver assignment snapshot" },
        401: { description: "Unauthorized", content: { "application/json": { schema: operationalErrorSchema } } },
        404: { description: "Delivery not found", content: { "application/json": { schema: operationalErrorSchema } } },
      },
    },
  },
  "/api/v1/deliveries/{id}/tracking": {
    get: {
      tags: ["Deliveries"],
      summary: "Get latest tracking snapshot",
      security: bearerSecurity,
      parameters: [deliveryIdParam],
      responses: {
        200: { description: "Latest tracking point" },
      },
    },
  },
  "/api/v1/deliveries/{id}/tracking/history": {
    get: {
      tags: ["Deliveries"],
      summary: "List tracking history",
      security: bearerSecurity,
      parameters: [
        deliveryIdParam,
        { name: "page", in: "query", schema: { type: "integer", default: 1 } },
        { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
      ],
      responses: {
        200: { description: "Paginated tracking history" },
      },
    },
  },
  "/api/v1/deliveries/{id}/pickup-otp": {
    post: {
      tags: ["Deliveries"],
      summary: "Generate pickup OTP",
      security: bearerSecurity,
      parameters: [deliveryIdParam],
      responses: {
        200: { description: "Pickup OTP generated" },
        422: { description: "OTP not allowed for current status" },
        429: { description: "OTP generation cooldown" },
      },
    },
  },
  "/api/v1/deliveries/{id}/pickup/verify-otp": {
    post: {
      tags: ["Deliveries"],
      summary: "Verify pickup OTP",
      security: bearerSecurity,
      parameters: [deliveryIdParam],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { otp: { type: "string", minLength: 6, maxLength: 6 } },
              required: ["otp"],
            },
          },
        },
      },
      responses: {
        200: { description: "Pickup verified; delivery moves to PICKED_UP" },
        422: { description: "Invalid or expired OTP" },
      },
    },
  },
  "/api/v1/deliveries/{id}/delivery-otp": {
    post: {
      tags: ["Deliveries"],
      summary: "Generate delivery OTP",
      security: bearerSecurity,
      parameters: [deliveryIdParam],
      responses: {
        200: { description: "Delivery OTP generated" },
      },
    },
  },
  "/api/v1/deliveries/{id}/delivery/verify-otp": {
    post: {
      tags: ["Deliveries"],
      summary: "Verify delivery OTP",
      security: bearerSecurity,
      parameters: [deliveryIdParam],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { otp: { type: "string", minLength: 6, maxLength: 6 } },
              required: ["otp"],
            },
          },
        },
      },
      responses: {
        200: { description: "Delivery verified; delivery moves to DELIVERED" },
      },
    },
  },
  "/api/v1/deliveries/{id}/cancel": {
    post: {
      tags: ["Deliveries"],
      summary: "Cancel delivery",
      description:
        "Local cancellation before booking; provider cancellation after BOOKED. Supports optional Idempotency-Key.",
      security: bearerSecurity,
      parameters: [
        deliveryIdParam,
        {
          name: "Idempotency-Key",
          in: "header",
          required: false,
          schema: { type: "string", maxLength: 128 },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                reasonCode: {
                  type: "string",
                  enum: [
                    "CUSTOMER_CHANGED_MIND",
                    "WRONG_ADDRESS",
                    "WRONG_PACKAGE_DETAILS",
                    "DELIVERY_NO_LONGER_REQUIRED",
                    "PROVIDER_DELAY",
                    "OTHER",
                  ],
                },
                reasonMessage: { type: "string", maxLength: 500, nullable: true },
              },
              required: ["reasonCode"],
            },
          },
        },
      },
      responses: {
        200: { description: "Cancellation accepted" },
        409: { description: "Reconciliation required or idempotency conflict" },
        422: { description: "Cancellation not allowed" },
      },
    },
  },
  "/api/v1/deliveries/{id}/cancellation": {
    get: {
      tags: ["Deliveries"],
      summary: "Get latest cancellation attempt",
      security: bearerSecurity,
      parameters: [deliveryIdParam],
      responses: {
        200: { description: "Cancellation details" },
        404: { description: "Cancellation not found" },
      },
    },
  },
  "/api/v1/admin/deliveries/{id}/driver/refresh": {
    post: {
      tags: ["Admin Deliveries"],
      summary: "Refresh driver assignment from provider",
      security: bearerSecurity,
      parameters: [deliveryIdParam],
      responses: {
        200: { description: "Driver refreshed from provider poll" },
      },
    },
  },
  "/api/v1/admin/deliveries/{id}/tracking/refresh": {
    post: {
      tags: ["Admin Deliveries"],
      summary: "Refresh tracking from provider",
      security: bearerSecurity,
      parameters: [deliveryIdParam],
      responses: {
        200: { description: "Tracking refreshed from provider poll" },
      },
    },
  },
} as const;
