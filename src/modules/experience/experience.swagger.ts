const experienceRatingSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    deliveryId: { type: "string", format: "uuid" },
    driverRating: { type: "integer", minimum: 1, maximum: 5 },
    platformRating: { type: "integer", minimum: 1, maximum: 5, nullable: true },
    deliveryRating: { type: "integer", minimum: 1, maximum: 5 },
    timelinessRating: { type: "integer", minimum: 1, maximum: 5, nullable: true },
    packageHandlingRating: { type: "integer", minimum: 1, maximum: 5, nullable: true },
    servicePresentationRating: {
      type: "integer",
      minimum: 1,
      maximum: 5,
      nullable: true,
    },
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

export const experienceSwaggerPaths = {
  "/api/v1/deliveries/{id}/experience": {
    post: {
      tags: ["Deliveries"],
      summary: "Submit delivery experience survey (ratings + feedback)",
      description:
        "Customer-only. Atomic submit after DELIVERED: multi-dimensional ratings stored on DeliveryRating; derived tags and optional comment on DeliveryFeedback.",
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
              required: [
                "driverRating",
                "platformRating",
                "deliveryRating",
                "timelinessRating",
                "packageHandlingRating",
                "servicePresentationRating",
              ],
              properties: {
                driverRating: { type: "integer", minimum: 1, maximum: 5 },
                platformRating: { type: "integer", minimum: 1, maximum: 5 },
                deliveryRating: { type: "integer", minimum: 1, maximum: 5 },
                timelinessRating: { type: "integer", minimum: 1, maximum: 5 },
                packageHandlingRating: { type: "integer", minimum: 1, maximum: 5 },
                servicePresentationRating: {
                  type: "integer",
                  minimum: 1,
                  maximum: 5,
                },
                comment: { type: "string", maxLength: 1000, nullable: true },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: "Experience submitted",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  data: {
                    type: "object",
                    properties: {
                      rating: experienceRatingSchema,
                      feedback: {
                        type: "object",
                        properties: {
                          positiveTags: { type: "array", items: { type: "string" } },
                          issueTags: { type: "array", items: { type: "string" } },
                          comment: { type: "string", nullable: true },
                          submittedAt: { type: "string", format: "date-time" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
