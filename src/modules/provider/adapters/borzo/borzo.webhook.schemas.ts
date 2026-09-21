import { z } from "zod";
import { borzoCourierSchema } from "./borzo.schemas.js";

const borzoContactPersonSchema = z
  .object({
    phone: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
  })
  .passthrough()
  .nullable()
  .optional();

const borzoOrderPointSchema = z
  .object({
    point_id: z.number().nullable().optional(),
    delivery_id: z.number().nullable().optional(),
    address: z.string().nullable().optional(),
    latitude: z.union([z.string(), z.number()]).nullable().optional(),
    longitude: z.union([z.string(), z.number()]).nullable().optional(),
    contact_person: borzoContactPersonSchema,
    tracking_url: z.string().nullable().optional(),
    estimated_arrival_datetime: z.string().nullable().optional(),
  })
  .passthrough();

export const borzoOrderCallbackSchema = z
  .object({
    event_datetime: z.string(),
    event_type: z.enum(["order_created", "order_changed"]),
    order: z
      .object({
        order_id: z.number(),
        type: z.string().nullable().optional(),
        order_name: z.string().nullable().optional(),
        vehicle_type_id: z.number().nullable().optional(),
        created_datetime: z.string().nullable().optional(),
        finish_datetime: z.string().nullable().optional(),
        status: z.string().nullable().optional(),
        status_description: z.string().nullable().optional(),
        matter: z.string().nullable().optional(),
        total_weight_kg: z.number().nullable().optional(),
        points: z.array(borzoOrderPointSchema).nullable().optional(),
        courier: borzoCourierSchema,
      })
      .passthrough(),
  })
  .passthrough();

export const borzoDeliveryCallbackSchema = z
  .object({
    event_datetime: z.string(),
    event_type: z.enum(["delivery_created", "delivery_changed"]),
    delivery: z
      .object({
        delivery_id: z.number(),
        delivery_type: z.string().nullable().optional(),
        order_id: z.number().nullable().optional(),
        client_id: z.number().nullable().optional(),
        client_order_id: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
        latitude: z.union([z.string(), z.number()]).nullable().optional(),
        longitude: z.union([z.string(), z.number()]).nullable().optional(),
        status: z.string().nullable().optional(),
        status_description: z.string().nullable().optional(),
        status_datetime: z.string().nullable().optional(),
        created_datetime: z.string().nullable().optional(),
        order_name: z.string().nullable().optional(),
        order_payment_amount: z.string().nullable().optional(),
        delivery_price_amount: z.string().nullable().optional(),
        point_id: z.number().nullable().optional(),
        contact_person: borzoContactPersonSchema,
        tracking_url: z.string().nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type BorzoOrderCallback = z.infer<typeof borzoOrderCallbackSchema>;
export type BorzoDeliveryCallback = z.infer<typeof borzoDeliveryCallbackSchema>;

export type BorzoWebhookCallback = BorzoOrderCallback | BorzoDeliveryCallback;

export function parseBorzoWebhookCallback(
  body: unknown,
): BorzoWebhookCallback {
  if (typeof body !== "object" || body === null) {
    throw new Error("Webhook body must be an object.");
  }

  const record = body as Record<string, unknown>;
  const eventType = record.event_type;

  if (
    eventType === "order_created" ||
    eventType === "order_changed"
  ) {
    return borzoOrderCallbackSchema.parse(body);
  }

  if (
    eventType === "delivery_created" ||
    eventType === "delivery_changed"
  ) {
    return borzoDeliveryCallbackSchema.parse(body);
  }

  throw new Error(`Unsupported Borzo webhook event type: ${String(eventType)}`);
}

export function isBorzoOrderCallback(
  callback: BorzoWebhookCallback,
): callback is BorzoOrderCallback {
  return (
    callback.event_type === "order_created" ||
    callback.event_type === "order_changed"
  );
}
