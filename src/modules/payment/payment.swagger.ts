export const paymentSwaggerPaths = {
  "/api/v1/payments/webhooks/cashfree": {
    post: {
      tags: ["Payment"],
      summary: "Cashfree payment webhook",
      description:
        "Receives Cashfree PG webhooks. Signature is verified using x-webhook-signature and the raw request body.",
      parameters: [
        {
          in: "header",
          name: "x-webhook-signature",
          required: true,
          schema: { type: "string" },
        },
        {
          in: "header",
          name: "x-webhook-timestamp",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: { description: "Webhook processed" },
        401: { description: "Invalid signature" },
      },
    },
  },
  "/api/v1/deliveries/{id}/payment": {
    post: {
      tags: ["Payment"],
      summary: "Create or retrieve payment for delivery",
      description:
        "Creates a provider-neutral payment intent using server-side orchestration pricing. Does not accept client-supplied amounts.",
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        200: { description: "Payment created or returned" },
        422: { description: "Delivery not ready for payment" },
      },
    },
    get: {
      tags: ["Payment"],
      summary: "Get payment for delivery",
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        200: { description: "Payment details" },
        404: { description: "Payment not found" },
      },
    },
  },
};
