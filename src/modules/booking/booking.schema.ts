import { createHash } from "node:crypto";
import { z } from "zod";
import { CONFIRM_REQUEST_HASH } from "./booking.constants.js";

export const confirmDeliveryParamsSchema = z.object({
  id: z.string().uuid(),
});

export const confirmDeliveryBodySchema = z.object({}).strict();

export type ConfirmDeliveryParams = z.infer<typeof confirmDeliveryParamsSchema>;
export type ConfirmDeliveryBody = z.infer<typeof confirmDeliveryBodySchema>;

export function hashConfirmRequest(): string {
  return createHash("sha256").update(CONFIRM_REQUEST_HASH).digest("hex");
}
