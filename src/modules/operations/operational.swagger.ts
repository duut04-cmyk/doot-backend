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
      description:
        "Generates a pickup verification code, emails it to the delivery owner, and moves eligible deliveries to PICKUP_OTP_PENDING. The OTP is never returned in the API response.",
      security: bearerSecurity,
      parameters: [deliveryIdParam],
      responses: {
        200: { description: "Pickup OTP generated and emailed to the customer" },
        503: { description: "Pickup OTP email delivery failed" },
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
      description:
        "Generates a delivery verification code, emails it to the delivery owner, and moves eligible deliveries to DELIVERY_OTP_PENDING. The OTP is never returned in the API response.",
      security: bearerSecurity,
      parameters: [deliveryIdParam],
      responses: {
        200: { description: "Delivery OTP generated and emailed to the customer" },
        503: { description: "Delivery OTP email delivery failed" },
        422: { description: "OTP not allowed for current status" },
        429: { description: "OTP generation cooldown" },
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

const simulateDriverRequestExample = {
  status: "ASSIGNED",
  providerDriverId: "MOCK-DRIVER-001",
  driverName: "Aman Singh",
  driverPhoneCountryCode: "+91",
  driverPhoneNumber: "9876543210",
  driverPhotoUrl: null,
  providerRating: 4.8,
  vehicleType: "BIKE",
  vehicleNumber: "PB10AB1234",
} as const;

export const driverSimulationSwaggerPaths = {
  "/api/v1/admin/deliveries/{id}/driver/simulate": {
    post: {
      tags: ["Admin Driver Simulation"],
      summary: "Simulate provider driver assignment (development/test only)",
      description:
        "Simulates a provider assigning a driver after booking. Reuses the same DriverService persistence and delivery transition path as real provider polling/webhooks. **Not available in production.** Requires ADMIN role.",
      security: bearerSecurity,
      parameters: [deliveryIdParam],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                status: { type: "string", enum: ["ASSIGNED"] },
                providerDriverId: { type: "string", example: "MOCK-DRIVER-001" },
                driverName: { type: "string", nullable: true, example: "Aman Singh" },
                driverPhoneCountryCode: { type: "string", example: "+91" },
                driverPhoneNumber: { type: "string", example: "9876543210" },
                driverPhotoUrl: { type: "string", nullable: true },
                providerRating: {
                  type: "number",
                  nullable: true,
                  minimum: 0,
                  maximum: 5,
                  example: 4.8,
                },
                vehicleType: {
                  type: "string",
                  nullable: true,
                  enum: ["BIKE", "SCOOTER", "CAR", "VAN", "TRUCK"],
                  example: "BIKE",
                },
                vehicleNumber: { type: "string", nullable: true, example: "PB10AB1234" },
              },
              required: ["status", "providerDriverId"],
            },
            example: simulateDriverRequestExample,
          },
        },
      },
      responses: {
        200: {
          description: "Simulated driver assignment persisted; delivery may transition to DRIVER_ASSIGNED",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  data: {
                    type: "object",
                    properties: {
                      known: { type: "boolean", example: true },
                      assigned: { type: "boolean", example: true },
                      status: { type: "string", example: "ASSIGNED" },
                      driver: { type: "object" },
                    },
                  },
                },
              },
            },
          },
        },
        401: {
          description: "Unauthorized",
          content: { "application/json": { schema: operationalErrorSchema } },
        },
        403: { description: "Forbidden — ADMIN role required" },
        404: {
          description: "Delivery not found, or endpoint disabled in production",
          content: { "application/json": { schema: operationalErrorSchema } },
        },
        409: {
          description: "Invalid delivery state for driver assignment simulation",
          content: { "application/json": { schema: operationalErrorSchema } },
        },
        422: {
          description: "Invalid request body or no active provider booking",
          content: { "application/json": { schema: operationalErrorSchema } },
        },
      },
    },
  },
} as const;
