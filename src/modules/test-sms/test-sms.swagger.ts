export const testSmsSwaggerPaths = {
  "/api/v1/test/sms": {
    post: {
      tags: ["Development / Test"],
      summary: "Send a test SMS via MSG91 (development only)",
      description:
        "Generates a random 6-digit OTP server-side and sends it through MSG91 using the configured template for the requested type. **Not available in production.** The OTP is never returned in the response.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["phone", "type"],
              properties: {
                phone: {
                  type: "string",
                  example: "9876543210",
                  description:
                    "Indian mobile number (10 digits, or with +91 / 91 prefix)",
                },
                type: {
                  type: "string",
                  enum: ["ACCOUNT_OTP", "PICKUP_OTP", "DELIVERY_OTP"],
                  example: "ACCOUNT_OTP",
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: "Test SMS accepted by MSG91",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  message: {
                    type: "string",
                    example: "Test SMS sent successfully",
                  },
                },
                required: ["success", "message"],
              },
            },
          },
        },
        400: { description: "Invalid phone number or SMS type" },
        503: {
          description: "MSG91 disabled, misconfigured, or SMS delivery failed",
        },
      },
    },
  },
} as const;
