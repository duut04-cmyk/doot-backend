import { z } from "zod";
import { MAX_FEEDBACK_COMMENT_LENGTH } from "../feedback/feedback.constants.js";
import { MAX_RATING, MIN_RATING } from "../rating/rating.constants.js";

const ratingValue = z
  .number()
  .int("Rating must be an integer")
  .min(MIN_RATING, `Rating must be at least ${MIN_RATING}`)
  .max(MAX_RATING, `Rating must be at most ${MAX_RATING}`);

export const submitDeliveryExperienceBodySchema = z.object({
  driverRating: ratingValue,
  platformRating: ratingValue,
  deliveryRating: ratingValue,
  timelinessRating: ratingValue,
  packageHandlingRating: ratingValue,
  servicePresentationRating: ratingValue,
  comment: z
    .preprocess((value) => {
      if (value === null || value === undefined) {
        return null;
      }
      if (typeof value !== "string") {
        return value;
      }
      const trimmed = value.trim();
      return trimmed === "" ? null : trimmed;
    }, z.string().max(MAX_FEEDBACK_COMMENT_LENGTH).nullable())
    .optional()
    .transform((value) => value ?? null),
});

export type SubmitDeliveryExperienceBody = z.infer<
  typeof submitDeliveryExperienceBodySchema
>;
