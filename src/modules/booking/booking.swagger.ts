const bookingErrorSchema = {
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

const bookingPayloadSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    providerCode: { type: "string" },
    serviceCode: { type: "string", nullable: true },
    status: {
      type: "string",
      enum: ["PENDING", "BOOKING", "BOOKED", "FAILED", "UNKNOWN"],
    },
    providerReference: { type: "string", nullable: true },
    quote: {
      type: "object",
      properties: {
        amount: { type: "number" },
        currency: { type: "string" },
      },
    },
    bookedAt: { type: "string", format: "date-time", nullable: true },
  },
} as const;

export const bookingSwaggerPaths = {
  "/api/v1/deliveries/{id}/confirm": {
    post: {
      tags: ["Deliveries"],
      summary: "Confirm delivery and book with selected provider",
      description:
        "Uses the persisted Phase 5 orchestration selected option. Supports optional Idempotency-Key. Does not accept client provider or price selection. Revalidates stale quotes and cancellation policy before booking; returns 409 BOOKING_OPTION_CHANGED when price or cancellation terms have materially changed.",
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
        {
          name: "Idempotency-Key",
          in: "header",
          required: false,
          schema: { type: "string", maxLength: 128 },
        },
      ],
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: { type: "object", additionalProperties: false },
          },
        },
      },
      responses: {
        200: {
          description: "Booking confirmed or existing booking returned",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  data: {
                    type: "object",
                    properties: {
                      delivery: {
                        type: "object",
                        properties: {
                          id: { type: "string", format: "uuid" },
                          reference: { type: "string" },
                          status: { type: "string" },
                        },
                      },
                      booking: bookingPayloadSchema,
                    },
                  },
                },
              },
            },
          },
        },
        401: { description: "Unauthorized", content: { "application/json": { schema: bookingErrorSchema } } },
        404: { description: "Delivery not found", content: { "application/json": { schema: bookingErrorSchema } } },
        409: {
          description: "Conflict — booking in progress, idempotency conflict, or option changed",
          content: { "application/json": { schema: bookingErrorSchema } },
        },
        422: { description: "Validation or booking failure", content: { "application/json": { schema: bookingErrorSchema } } },
        503: {
          description: "Provider booking outcome unknown",
          content: { "application/json": { schema: bookingErrorSchema } },
        },
      },
    },
  },
  "/api/v1/deliveries/{id}/booking": {
    get: {
      tags: ["Deliveries"],
      summary: "Get latest booking for a delivery",
      security: [{ bearerAuth: [] }],
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
          description: "Latest booking attempt",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  data: {
                    type: "object",
                    properties: {
                      delivery: {
                        type: "object",
                        properties: {
                          id: { type: "string", format: "uuid" },
                          reference: { type: "string" },
                          status: { type: "string" },
                        },
                      },
                      booking: bookingPayloadSchema,
                    },
                  },
                },
              },
            },
          },
        },
        401: { description: "Unauthorized", content: { "application/json": { schema: bookingErrorSchema } } },
        404: { description: "Delivery or booking not found", content: { "application/json": { schema: bookingErrorSchema } } },
      },
    },
  },
} as const;
