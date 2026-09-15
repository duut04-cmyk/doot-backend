const deliveryErrorSchema = {
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

const selectedOptionSchema = {
  type: "object",
  properties: {
    providerCode: { type: "string", example: "MOCK" },
    serviceCode: { type: "string", nullable: true },
    quote: {
      type: "object",
      properties: {
        amount: { type: "number", example: 150 },
        currency: { type: "string", example: "INR" },
      },
    },
    estimatedDeliveryAt: { type: "string", format: "date-time", nullable: true },
    availability: {
      type: "object",
      properties: {
        known: {
          type: "boolean",
          description:
            "False when driver availability was not established by the provider.",
        },
        available: { type: "boolean" },
        availableDriverCount: { type: "integer", nullable: true },
        reason: { type: "string", nullable: true },
      },
    },
    selectionReason: { type: "string" },
  },
} as const;

export const orchestrationSwaggerPaths = {
  "/api/v1/deliveries/{id}/orchestrate": {
    post: {
      tags: ["Deliveries"],
      summary: "Orchestrate provider evaluation for a delivery",
      description:
        "Evaluates orchestration-eligible providers, scores eligible options, persists history, and transitions the delivery to OPTION_READY. Does not book with any provider.",
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
        required: false,
        content: {
          "application/json": {
            schema: { type: "object", additionalProperties: false },
          },
        },
      },
      responses: {
        200: {
          description: "Orchestration completed or returned existing OPTION_READY result",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  data: {
                    type: "object",
                    properties: {
                      deliveryId: { type: "string", format: "uuid" },
                      status: { type: "string", example: "OPTION_READY" },
                      orchestration: {
                        type: "object",
                        properties: {
                          id: { type: "string", format: "uuid" },
                          attemptNumber: { type: "integer" },
                          completedAt: {
                            type: "string",
                            format: "date-time",
                            nullable: true,
                          },
                          selectedOption: selectedOptionSchema,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        401: {
          description: "Unauthorized",
          content: { "application/json": { schema: deliveryErrorSchema } },
        },
        404: {
          description: "Delivery not found",
          content: { "application/json": { schema: deliveryErrorSchema } },
        },
        409: {
          description: "Orchestration already in progress",
          content: { "application/json": { schema: deliveryErrorSchema } },
        },
        422: {
          description: "Delivery not ready for orchestration",
          content: { "application/json": { schema: deliveryErrorSchema } },
        },
      },
    },
  },
  "/api/v1/deliveries/{id}/orchestration": {
    get: {
      tags: ["Deliveries"],
      summary: "Get latest orchestration result for a delivery",
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
          description: "Latest orchestration request (admin receives full evaluation detail)",
        },
        401: {
          description: "Unauthorized",
          content: { "application/json": { schema: deliveryErrorSchema } },
        },
        404: {
          description: "Delivery or orchestration not found",
          content: { "application/json": { schema: deliveryErrorSchema } },
        },
      },
    },
  },
} as const;
