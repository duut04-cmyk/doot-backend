import { z } from "zod";
import { MAX_RATING, MIN_RATING } from "./rating.constants.js";

const ratingValue = z
  .number()
  .int("Rating must be an integer")
  .min(MIN_RATING, `Rating must be at least ${MIN_RATING}`)
  .max(MAX_RATING, `Rating must be at most ${MAX_RATING}`);

export const submitRatingBodySchema = z.object({
  driverRating: ratingValue,
  deliveryRating: ratingValue,
});

export type SubmitRatingBody = z.infer<typeof submitRatingBodySchema>;
