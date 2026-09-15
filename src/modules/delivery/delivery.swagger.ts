import {
  phoneInputSchema as phoneInputSwaggerSchema,
  phoneResponseSchema,
} from "../../core/phone/phone.swagger.js";

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

const locationInputSchema = {
  type: "object",
  required: ["addressText", "contactName", "contactPhone"],
  properties: {
    addressText: { type: "string", example: "12 MG Road, Bengaluru" },
    contactName: { type: "string", example: "Riya Sharma" },
    contactPhone: phoneInputSwaggerSchema,
    instructions: { type: "string", nullable: true, example: "Gate 2" },
  },
} as const;

const locationResponseSchema = {
  type: "object",
  required: ["addressText", "contactName", "contactPhone"],
  properties: {
    addressText: { type: "string", example: "12 MG Road, Bengaluru" },
    contactName: { type: "string", example: "Riya Sharma" },
    contactPhone: phoneResponseSchema,
    instructions: { type: "string", nullable: true, example: "Gate 2" },
  },
} as const;

const packageSchema = {
  type: "object",
  required: ["packageType", "weightKg"],
  properties: {
    packageType: {
      type: "string",
      enum: ["MEDICINE", "FOOD", "DOCUMENT", "OTHER"],
    },
    description: { type: "string", nullable: true, maxLength: 200 },
    weightKg: { type: "number", exclusiveMinimum: 0, maximum: 50, example: 1.8 },
    lengthCm: { type: "number", nullable: true, exclusiveMinimum: 0 },
    widthCm: { type: "number", nullable: true, exclusiveMinimum: 0 },
    heightCm: { type: "number", nullable: true, exclusiveMinimum: 0 },
    sizeTier: {
      type: "string",
      enum: ["SMALL", "MEDIUM", "LARGE"],
      nullable: true,
      description: "Optional; validated against weight. Server derives authoritative tier.",
    },
    quantity: { type: "integer", minimum: 1, maximum: 1, default: 1 },
    photos: {
      type: "array",
      items: {
        type: "object",
        required: ["objectKey"],
        properties: {
          objectKey: {
            type: "string",
            example: "deliveries/tmp/photos/front.jpg",
            description: "Durable object storage key (not a blob: URL)",
          },
          storageProvider: { type: "string", example: "PENDING" },
          mimeType: { type: "string", nullable: true },
          fileSizeBytes: { type: "integer", nullable: true },
        },
      },
    },
  },
} as const;

const deliveryDetailSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    reference: { type: "string", example: "DUTT-1000" },
    status: { type: "string", example: "CREATED" },
    pickup: locationResponseSchema,
    drop: locationResponseSchema,
    package: {
      type: "object",
      properties: {
        packageType: { type: "string" },
        description: { type: "string", nullable: true },
        weightKg: { type: "number" },
        lengthCm: { type: "number", nullable: true },
        widthCm: { type: "number", nullable: true },
        heightCm: { type: "number", nullable: true },
        sizeTier: { type: "string" },
        quantity: { type: "integer" },
        photos: { type: "array", items: { type: "object" } },
      },
    },
    requirements: {
      type: "array",
      items: {
        type: "string",
        enum: ["HANDLE_WITH_CARE", "FRAGILE", "KEEP_UPRIGHT"],
      },
    },
    specialInstructions: { type: "string", nullable: true },
    schedule: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["ASAP", "SCHEDULED"] },
        timezone: { type: "string", example: "Asia/Kolkata" },
        scheduledAt: { type: "string", format: "date-time", nullable: true },
        windowStart: { type: "string", format: "date-time", nullable: true },
        windowEnd: { type: "string", format: "date-time", nullable: true },
      },
    },
    compliance: {
      type: "object",
      properties: {
        accepted: { type: "boolean" },
        acceptedAt: { type: "string", format: "date-time" },
      },
    },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

export const deliverySwaggerComponents = {
  DeliveryError: deliveryErrorSchema,
  CreateDeliveryRequest: {
    type: "object",
    required: ["pickup", "drop", "package", "schedule", "compliance"],
    properties: {
      pickup: locationInputSchema,
      drop: locationInputSchema,
      package: packageSchema,
      requirements: {
        type: "array",
        items: {
          type: "string",
          enum: ["HANDLE_WITH_CARE", "FRAGILE", "KEEP_UPRIGHT", "NONE"],
        },
      },
      specialInstructions: { type: "string", nullable: true },
      schedule: {
        type: "object",
        required: ["mode", "timezone"],
        properties: {
          mode: { type: "string", enum: ["ASAP", "SCHEDULED"] },
          timezone: { type: "string", example: "Asia/Kolkata" },
          windowStart: { type: "string", format: "date-time", nullable: true },
          windowEnd: { type: "string", format: "date-time", nullable: true },
        },
      },
      compliance: {
        type: "object",
        required: ["accepted"],
        properties: {
          accepted: { type: "boolean", enum: [true] },
        },
      },
    },
  },
  DeliveryDetailResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      data: deliveryDetailSchema,
    },
    required: ["success", "data"],
  },
  DeliveryListResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      data: {
        type: "object",
        properties: {
          items: { type: "array", items: { type: "object" } },
          page: { type: "integer" },
          limit: { type: "integer" },
          total: { type: "integer" },
          totalPages: { type: "integer" },
        },
      },
    },
  },
} as const;

export const deliverySwaggerPaths = {
  "/api/v1/deliveries": {
    post: {
      tags: ["Deliveries"],
      summary: "Create a delivery",
      description:
        "Creates a customer-owned delivery in CREATED status. Requires Idempotency-Key. Status, reference, and customerId are server-owned.",
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: "Idempotency-Key",
          in: "header",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/CreateDeliveryRequest" },
          },
        },
      },
      responses: {
        201: {
          description: "Delivery created",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DeliveryDetailResponse" },
            },
          },
        },
        400: {
          description: "Validation error",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DeliveryError" },
            },
          },
        },
        401: {
          description: "Unauthorized",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DeliveryError" },
            },
          },
        },
        409: {
          description: "Idempotency conflict",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DeliveryError" },
            },
          },
        },
      },
    },
    get: {
      tags: ["Deliveries"],
      summary: "List deliveries",
      description:
        "CUSTOMER sees own deliveries only. ADMIN may list all. Sorted by createdAt DESC.",
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: "page",
          in: "query",
          schema: { type: "integer", minimum: 1, default: 1 },
        },
        {
          name: "limit",
          in: "query",
          schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        },
        {
          name: "status",
          in: "query",
          schema: {
            type: "string",
            enum: [
              "CREATED",
              "ORCHESTRATING",
              "OPTION_READY",
              "BOOKING",
              "BOOKED",
              "DRIVER_ASSIGNED",
              "PICKUP_OTP_PENDING",
              "PICKED_UP",
              "IN_TRANSIT",
              "DELIVERY_OTP_PENDING",
              "DELIVERED",
              "CANCELLED",
              "FAILED",
            ],
          },
        },
        {
          name: "from",
          in: "query",
          schema: { type: "string", format: "date-time" },
        },
        {
          name: "to",
          in: "query",
          schema: { type: "string", format: "date-time" },
        },
        {
          name: "reference",
          in: "query",
          schema: { type: "string", maxLength: 64 },
        },
      ],
      responses: {
        200: {
          description: "Paginated deliveries",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DeliveryListResponse" },
            },
          },
        },
        401: {
          description: "Unauthorized",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DeliveryError" },
            },
          },
        },
      },
    },
  },
  "/api/v1/deliveries/{id}/history": {
    get: {
      tags: ["Deliveries"],
      summary: "Get historical delivery detail",
      description:
        "Composed read model including timeline, booking, driver, tracking, cancellation, OTP metadata (no secrets), rating, and feedback.",
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
          description: "Historical delivery detail",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  data: { type: "object" },
                },
                required: ["success", "data"],
              },
            },
          },
        },
        401: {
          description: "Unauthorized",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DeliveryError" },
            },
          },
        },
        404: {
          description: "Not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DeliveryError" },
            },
          },
        },
      },
    },
  },
  "/api/v1/admin/deliveries/{id}/history": {
    get: {
      tags: ["Admin Deliveries"],
      summary: "Admin historical delivery detail",
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
          description: "Historical delivery detail",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  data: { type: "object" },
                },
                required: ["success", "data"],
              },
            },
          },
        },
        401: {
          description: "Unauthorized",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DeliveryError" },
            },
          },
        },
        403: {
          description: "Forbidden",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DeliveryError" },
            },
          },
        },
        404: {
          description: "Not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DeliveryError" },
            },
          },
        },
      },
    },
  },
  "/api/v1/deliveries/{id}": {
    get: {
      tags: ["Deliveries"],
      summary: "Get delivery by id",
      description:
        "CUSTOMER may only access own deliveries. Cross-customer access returns 404.",
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
          description: "Delivery detail",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DeliveryDetailResponse" },
            },
          },
        },
        401: {
          description: "Unauthorized",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DeliveryError" },
            },
          },
        },
        404: {
          description: "Not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DeliveryError" },
            },
          },
        },
      },
    },
  },
} as const;
