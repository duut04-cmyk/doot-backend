import { createHash } from "node:crypto";
import { z } from "zod";
import {
  DEFAULT_LIST_LIMIT,
  DEFAULT_LIST_PAGE,
  DEFAULT_PACKAGE_QUANTITY,
  DIMENSIONS_REQUIRED_ABOVE_KG,
  MAX_ADDRESS_LENGTH,
  MAX_CONTACT_NAME_LENGTH,
  MAX_INSTRUCTIONS_LENGTH,
  MAX_LIST_LIMIT,
  MAX_OBJECT_KEY_LENGTH,
  MAX_PACKAGE_DESCRIPTION_LENGTH,
  MAX_PACKAGE_PHOTOS,
  MAX_SPECIAL_INSTRUCTIONS_LENGTH,
  MAX_LATITUDE,
  MAX_LONGITUDE,
  MAX_WEIGHT_KG,
  MIN_LATITUDE,
  MIN_LONGITUDE,
  OBJECT_KEY_REGEX,
} from "./delivery.constants.js";
import { phoneInputSchema } from "../../core/phone/phone.schema.js";
import { deriveSizeTier } from "./delivery.types.js";

const packageTypes = ["MEDICINE", "FOOD", "DOCUMENT", "OTHER"] as const;
const sizeTiers = ["SMALL", "MEDIUM", "LARGE"] as const;
const handlingRequirements = [
  "HANDLE_WITH_CARE",
  "FRAGILE",
  "KEEP_UPRIGHT",
  "NONE",
] as const;
const scheduleModes = ["ASAP", "SCHEDULED"] as const;

function isValidIanaTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

const trimmedNonEmpty = (max: number, field: string) =>
  z
    .string()
    .trim()
    .min(1, `${field} is required`)
    .max(max, `${field} is too long`);

const optionalTrimmed = (max: number) =>
  z.preprocess((value) => {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value !== "string") {
      return value;
    }
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }, z.string().max(max).nullable());

const locationSchema = z
  .object({
    addressText: trimmedNonEmpty(MAX_ADDRESS_LENGTH, "Address"),
    contactName: trimmedNonEmpty(MAX_CONTACT_NAME_LENGTH, "Contact name"),
    contactPhone: phoneInputSchema,
    instructions: optionalTrimmed(MAX_INSTRUCTIONS_LENGTH),
    latitude: z
      .number()
      .min(MIN_LATITUDE, "Latitude must be between -90 and 90")
      .max(MAX_LATITUDE, "Latitude must be between -90 and 90")
      .nullable()
      .optional(),
    longitude: z
      .number()
      .min(MIN_LONGITUDE, "Longitude must be between -180 and 180")
      .max(MAX_LONGITUDE, "Longitude must be between -180 and 180")
      .nullable()
      .optional(),
  })
  .superRefine((data, ctx) => {
    const hasLatitude = data.latitude != null;
    const hasLongitude = data.longitude != null;
    if (hasLatitude !== hasLongitude) {
      ctx.addIssue({
        code: "custom",
        path: ["latitude"],
        message: "latitude and longitude must be provided together",
      });
    }
  });

const photoSchema = z.object({
  objectKey: z
    .string()
    .trim()
    .min(1, "Photo object key is required")
    .max(MAX_OBJECT_KEY_LENGTH)
    .refine((value) => !value.toLowerCase().startsWith("blob:"), {
      message: "Browser blob URLs are not durable storage references",
    })
    .refine((value) => !/^https?:\/\//i.test(value), {
      message: "External HTTP URLs are not accepted as photo object keys",
    })
    .regex(OBJECT_KEY_REGEX, "Invalid photo object key format"),
  storageProvider: z.string().trim().min(1).max(64).optional().default("PENDING"),
  mimeType: z
    .union([z.string().trim().min(1).max(128), z.null()])
    .optional()
    .transform((v) => v ?? null),
  fileSizeBytes: z
    .union([z.number().int().positive().max(20_000_000), z.null()])
    .optional()
    .transform((v) => v ?? null),
});

const packageSchema = z
  .object({
    packageType: z.enum(packageTypes),
    description: optionalTrimmed(MAX_PACKAGE_DESCRIPTION_LENGTH),
    weightKg: z.number().positive("Weight must be greater than 0").max(MAX_WEIGHT_KG, {
      message: `Weight must be at most ${MAX_WEIGHT_KG} kg`,
    }),
    lengthCm: z.number().positive("Length must be greater than 0").nullable().optional(),
    widthCm: z.number().positive("Width must be greater than 0").nullable().optional(),
    heightCm: z.number().positive("Height must be greater than 0").nullable().optional(),
    sizeTier: z.enum(sizeTiers).nullable().optional(),
    quantity: z
      .number()
      .int()
      .positive()
      .max(1, "Multi-package line items are not supported yet")
      .optional()
      .default(DEFAULT_PACKAGE_QUANTITY),
    photos: z.array(photoSchema).max(MAX_PACKAGE_PHOTOS).optional().default([]),
  })
  .superRefine((data, ctx) => {
    if (data.packageType === "OTHER") {
      if (!data.description) {
        ctx.addIssue({
          code: "custom",
          path: ["description"],
          message: "Description is required for OTHER packages",
        });
      }
    }

    const dims = [data.lengthCm, data.widthCm, data.heightCm];
    const provided = dims.filter((d) => d !== null && d !== undefined);
    if (provided.length > 0 && provided.length < 3) {
      ctx.addIssue({
        code: "custom",
        path: ["lengthCm"],
        message: "If one dimension is supplied, length, width, and height are all required",
      });
    }

    if (data.weightKg > DIMENSIONS_REQUIRED_ABOVE_KG) {
      if (
        data.lengthCm == null ||
        data.widthCm == null ||
        data.heightCm == null
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["lengthCm"],
          message: `Dimensions are required when weight is above ${DIMENSIONS_REQUIRED_ABOVE_KG} kg`,
        });
      }
    }

    const derived = deriveSizeTier(data.weightKg);
    if (data.sizeTier && data.sizeTier !== derived) {
      ctx.addIssue({
        code: "custom",
        path: ["sizeTier"],
        message: `sizeTier must be ${derived} for weight ${data.weightKg} kg`,
      });
    }
  });

const scheduleSchema = z
  .object({
    mode: z.enum(scheduleModes),
    timezone: z
      .string()
      .trim()
      .min(1, "Timezone is required")
      .refine(isValidIanaTimezone, { message: "Invalid IANA timezone" }),
    windowStart: z.string().datetime({ offset: true }).nullable().optional(),
    windowEnd: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.mode === "ASAP") {
      if (data.windowStart || data.windowEnd) {
        ctx.addIssue({
          code: "custom",
          path: ["windowStart"],
          message: "ASAP schedule must not include a pickup window",
        });
      }
      return;
    }

    if (!data.windowStart || !data.windowEnd) {
      ctx.addIssue({
        code: "custom",
        path: ["windowStart"],
        message: "Scheduled deliveries require windowStart and windowEnd",
      });
      return;
    }

    const start = new Date(data.windowStart);
    const end = new Date(data.windowEnd);
    if (!(start.getTime() < end.getTime())) {
      ctx.addIssue({
        code: "custom",
        path: ["windowEnd"],
        message: "windowEnd must be after windowStart",
      });
    }
    if (start.getTime() <= Date.now()) {
      ctx.addIssue({
        code: "custom",
        path: ["windowStart"],
        message: "Pickup window must be in the future",
      });
    }
  });

export const createDeliverySchema = z.object({
  pickup: locationSchema,
  drop: locationSchema,
  package: packageSchema,
  requirements: z
    .array(z.enum(handlingRequirements))
    .optional()
    .default([])
    .transform((values) => {
      const withoutNone = values.filter((value) => value !== "NONE");
      return [...new Set(withoutNone)];
    }),
  specialInstructions: optionalTrimmed(MAX_SPECIAL_INSTRUCTIONS_LENGTH),
  schedule: scheduleSchema,
  compliance: z.object({
    accepted: z.literal(true, {
      message: "Compliance acceptance is required",
    }),
  }),
});

const deliveryStatuses = [
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
] as const;

export const listDeliveriesQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(DEFAULT_LIST_PAGE),
    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(MAX_LIST_LIMIT)
      .default(DEFAULT_LIST_LIMIT),
    status: z.enum(deliveryStatuses).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    reference: z.string().trim().min(1).max(64).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.from && data.to) {
      const from = new Date(data.from);
      const to = new Date(data.to);
      if (from.getTime() > to.getTime()) {
        ctx.addIssue({
          code: "custom",
          path: ["to"],
          message: "to must be on or after from",
        });
      }
    }
  });

export const deliveryIdParamsSchema = z.object({
  id: z.string().uuid("Invalid delivery id"),
});

export type CreateDeliveryBody = z.infer<typeof createDeliverySchema>;
export type ListDeliveriesQuery = z.infer<typeof listDeliveriesQuerySchema>;
export type DeliveryIdParams = z.infer<typeof deliveryIdParamsSchema>;

export function hashDeliveryCreateRequest(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}
