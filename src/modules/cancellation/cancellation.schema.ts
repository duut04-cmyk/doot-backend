import { createHash } from "node:crypto";
import { z } from "zod";
import { CANCELLATION_REASON_CODES } from "./cancellation.constants.js";

export const cancelDeliveryBodySchema = z.object({
  reasonCode: z.enum(CANCELLATION_REASON_CODES),
  reasonMessage: z.string().max(500).nullable().optional(),
});

export type CancelDeliveryBody = z.infer<typeof cancelDeliveryBodySchema>;

export function hashCancelRequest(body: CancelDeliveryBody): string {
  return createHash("sha256")
    .update(JSON.stringify(body))
    .digest("hex");
}
