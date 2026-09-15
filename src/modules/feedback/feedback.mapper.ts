import type { DeliveryFeedbackDto } from "./feedback.types.js";

export function toFeedbackResponse(feedback: DeliveryFeedbackDto) {
  return {
    id: feedback.id,
    deliveryId: feedback.deliveryId,
    positiveTags: feedback.positiveTags,
    issueTags: feedback.issueTags,
    comment: feedback.comment,
    submittedAt: feedback.createdAt.toISOString(),
    createdAt: feedback.createdAt.toISOString(),
    updatedAt: feedback.updatedAt.toISOString(),
  };
}
