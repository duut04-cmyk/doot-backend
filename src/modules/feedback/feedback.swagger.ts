const feedbackPayloadSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    deliveryId: { type: "string", format: "uuid" },
    positiveTags: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "DRIVER_POLITE",
          "DRIVER_PROFESSIONAL",
          "FAST_DELIVERY",
          "EASY_BOOKING",
          "GOOD_COMMUNICATION",
          "PACKAGE_HANDLED_WELL",
        ],
      },
    },
    issueTags: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "DRIVER_LATE",
          "DRIVER_UNPROFESSIONAL",
          "DELIVERY_DELAYED",
          "COMMUNICATION_ISSUE",
          "PACKAGE_HANDLING_ISSUE",
          "TRACKING_ISSUE",
          "OTHER",
        ],
      },
    },
    comment: { type: "string", nullable: true, maxLength: 1000 },
    submittedAt: { type: "string", format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: [
    "id",
    "deliveryId",
    "positiveTags",
    "issueTags",
    "comment",
    "submittedAt",
    "createdAt",
    "updatedAt",
  ],
} as const;

const feedbackErrorSchema = {
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

export const feedbackSwaggerPaths = {
  "/api/v1/deliveries/{id}/feedback": {
    post: {
      tags: ["Deliveries"],
      summary: "Submit customer feedback for a delivered delivery",
      description:
        "Customer-only. One immutable feedback record per delivery. At least one tag or comment is required.",
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
                positiveTags: {
                  type: "array",
                  items: { type: "string" },
                },
                issueTags: {
                  type: "array",
                  items: { type: "string" },
                },
                comment: { type: "string", maxLength: 1000, nullable: true },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: "Feedback submitted",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  data: feedbackPayloadSchema,
                },
                required: ["success", "data"],
              },
            },
          },
        },
        400: { description: "Validation error", content: { "application/json": { schema: feedbackErrorSchema } } },
        401: { description: "Unauthorized", content: { "application/json": { schema: feedbackErrorSchema } } },
        403: { description: "Forbidden", content: { "application/json": { schema: feedbackErrorSchema } } },
        404: { description: "Delivery not found", content: { "application/json": { schema: feedbackErrorSchema } } },
        409: { description: "Not allowed or already submitted", content: { "application/json": { schema: feedbackErrorSchema } } },
      },
    },
    get: {
      tags: ["Deliveries"],
      summary: "Get customer feedback for a delivery",
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
          description: "Feedback found",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  data: feedbackPayloadSchema,
                },
                required: ["success", "data"],
              },
            },
          },
        },
        401: { description: "Unauthorized", content: { "application/json": { schema: feedbackErrorSchema } } },
        404: { description: "Delivery or feedback not found", content: { "application/json": { schema: feedbackErrorSchema } } },
      },
    },
  },
} as const;
