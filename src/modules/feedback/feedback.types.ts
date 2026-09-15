import type { FeedbackIssueTag, FeedbackPositiveTag } from "@prisma/client";

export type DeliveryFeedbackDto = {
  id: string;
  deliveryId: string;
  positiveTags: FeedbackPositiveTag[];
  issueTags: FeedbackIssueTag[];
  comment: string | null;
  createdAt: Date;
  updatedAt: Date;
};
