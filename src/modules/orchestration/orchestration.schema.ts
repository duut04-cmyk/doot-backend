import { z } from "zod";
import { deliveryIdParamsSchema } from "../delivery/delivery.schema.js";

export const orchestrateBodySchema = z.object({}).strict().optional().default({});

export const orchestrationDeliveryParamsSchema = deliveryIdParamsSchema;

export type OrchestrationDeliveryParams = z.infer<
  typeof orchestrationDeliveryParamsSchema
>;
