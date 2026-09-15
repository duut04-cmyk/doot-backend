const ratingPayloadSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    deliveryId: { type: "string", format: "uuid" },
    driverRating: { type: "integer", minimum: 1, maximum: 5, example: 5 },
    deliveryRating: { type: "integer", minimum: 1, maximum: 5, example: 4 },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: [
    "id",
    "deliveryId",
    "driverRating",
    "deliveryRating",
    "createdAt",
    "updatedAt",
  ],
} as const;

const ratingErrorSchema = {
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

export const ratingSwaggerPaths = {
  "/api/v1/deliveries/{id}/rating": {
    post: {
      tags: ["Deliveries"],
      summary: "Submit customer rating for a delivered delivery",
      description:
        "Customer-only. One immutable rating per delivery. Both driver and delivery ratings (1–5) are required.",
      security: [{ bearerAuth: [] }],
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
                driverRating: { type: "integer", minimum: 1, maximum: 5 },
                deliveryRating: { type: "integer", minimum: 1, maximum: 5 },
              },
              required: ["driverRating", "deliveryRating"],
            },
          },
        },
      },
      responses: {
        201: {
          description: "Rating submitted",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  data: ratingPayloadSchema,
                },
                required: ["success", "data"],
              },
            },
          },
        },
        400: { description: "Validation error", content: { "application/json": { schema: ratingErrorSchema } } },
        401: { description: "Unauthorized", content: { "application/json": { schema: ratingErrorSchema } } },
        403: { description: "Forbidden", content: { "application/json": { schema: ratingErrorSchema } } },
        404: { description: "Delivery not found", content: { "application/json": { schema: ratingErrorSchema } } },
        409: { description: "Not allowed or already submitted", content: { "application/json": { schema: ratingErrorSchema } } },
      },
    },
    get: {
      tags: ["Deliveries"],
      summary: "Get customer rating for a delivery",
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
          description: "Rating found",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  data: ratingPayloadSchema,
                },
                required: ["success", "data"],
              },
            },
          },
        },
        401: { description: "Unauthorized", content: { "application/json": { schema: ratingErrorSchema } } },
        404: { description: "Delivery or rating not found", content: { "application/json": { schema: ratingErrorSchema } } },
      },
    },
  },
} as const;
