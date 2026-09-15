export const phoneResponseSchema = {
  type: "object",
  nullable: true,
  properties: {
    countryCode: {
      type: "string",
      example: "+91",
      description: "International dialing code including + prefix",
    },
    number: {
      type: "string",
      example: "9876543210",
      description: "National significant number (digits only)",
    },
    e164: {
      type: "string",
      example: "+919876543210",
      description: "Derived E.164 format",
    },
  },
  required: ["countryCode", "number", "e164"],
} as const;

export const phoneInputSchema = {
  type: "object",
  properties: {
    countryCode: {
      type: "string",
      example: "+91",
    },
    number: {
      type: "string",
      example: "9876543210",
    },
  },
  required: ["countryCode", "number"],
} as const;
