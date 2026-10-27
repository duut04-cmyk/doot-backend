import { z } from "zod";
import {
  DEFAULT_LIST_LIMIT,
  DEFAULT_LIST_PAGE,
  MAX_LIST_LIMIT,
} from "../delivery/delivery.constants.js";
import { deliveryIdParamsSchema } from "../delivery/delivery.schema.js";

export const orchestrateBodySchema = z.object({}).strict().optional().default({});

export const orchestrationDeliveryParamsSchema = deliveryIdParamsSchema;

export type OrchestrationDeliveryParams = z.infer<
  typeof orchestrationDeliveryParamsSchema
>;

const orchestrationRequestStatuses = ["RUNNING", "COMPLETED", "FAILED"] as const;

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

const providerBookingStatuses = [
  "PENDING",
  "BOOKING",
  "BOOKED",
  "FAILED",
  "UNKNOWN",
] as const;

export const listOrchestrationsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(DEFAULT_LIST_PAGE),
    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(MAX_LIST_LIMIT)
      .default(DEFAULT_LIST_LIMIT),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    reference: z.string().trim().min(1).max(64).optional(),
    deliveryId: z.string().uuid("Invalid delivery id").optional(),
    orchestrationStatus: z.enum(orchestrationRequestStatuses).optional(),
    deliveryStatus: z.enum(deliveryStatuses).optional(),
    bookingStatus: z.enum(providerBookingStatuses).optional(),
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

export type ListOrchestrationsQuery = z.infer<typeof listOrchestrationsQuerySchema>;

export const orchestrationRequestIdParamsSchema = z.object({
  orchestrationRequestId: z.string().uuid("Invalid orchestration id"),
});

export type OrchestrationRequestIdParams = z.infer<
  typeof orchestrationRequestIdParamsSchema
>;
