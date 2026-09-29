import { createHash } from "node:crypto";
import { z } from "zod";
import { deliveryIdParamsSchema } from "../delivery/delivery.schema.js";

export const paymentDeliveryParamsSchema = deliveryIdParamsSchema;

export type PaymentDeliveryParams = z.infer<typeof paymentDeliveryParamsSchema>;

export function hashPaymentCreateRequest(): string {
  return createHash("sha256").update("payment-create").digest("hex");
}
