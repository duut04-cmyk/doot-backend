import type { DeliveryRatingResponse } from "../rating/rating.types.js";
import type { DeliveryFeedbackDto } from "../feedback/feedback.types.js";

export type SubmitDeliveryExperienceResult = {
  success: true;
  data: {
    rating: DeliveryRatingResponse;
    feedback: {
      positiveTags: DeliveryFeedbackDto["positiveTags"];
      issueTags: DeliveryFeedbackDto["issueTags"];
      comment: string | null;
      submittedAt: string;
    };
  };
};
