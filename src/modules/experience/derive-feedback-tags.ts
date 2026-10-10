import type { FeedbackIssueTag, FeedbackPositiveTag } from "@prisma/client";

export type ExperienceScores = {
  driverRating: number;
  platformRating: number;
  deliveryRating: number;
  timelinessRating?: number | null;
  packageHandlingRating?: number | null;
  servicePresentationRating?: number | null;
};

function dedupeTags<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

/** Map 1–5 experience scores to existing feedback tag enums for analytics. */
export function deriveFeedbackTagsFromExperienceScores(scores: ExperienceScores): {
  positiveTags: FeedbackPositiveTag[];
  issueTags: FeedbackIssueTag[];
} {
  const positiveTags: FeedbackPositiveTag[] = [];
  const issueTags: FeedbackIssueTag[] = [];

  if (scores.driverRating <= 2) {
    issueTags.push("DRIVER_UNPROFESSIONAL");
  } else if (scores.driverRating >= 4) {
    positiveTags.push("DRIVER_POLITE", "DRIVER_PROFESSIONAL");
  }

  if (scores.platformRating <= 2) {
    issueTags.push("TRACKING_ISSUE", "COMMUNICATION_ISSUE");
  } else if (scores.platformRating >= 4) {
    positiveTags.push("EASY_BOOKING", "GOOD_COMMUNICATION");
  }

  if (scores.timelinessRating != null) {
    if (scores.timelinessRating <= 2) {
      issueTags.push("DELIVERY_DELAYED", "DRIVER_LATE");
    } else if (scores.timelinessRating >= 4) {
      positiveTags.push("FAST_DELIVERY");
    }
  }

  if (scores.packageHandlingRating != null) {
    if (scores.packageHandlingRating <= 2) {
      issueTags.push("PACKAGE_HANDLING_ISSUE");
    } else if (scores.packageHandlingRating >= 4) {
      positiveTags.push("PACKAGE_HANDLED_WELL");
    }
  }

  return {
    positiveTags: dedupeTags(positiveTags),
    issueTags: dedupeTags(issueTags),
  };
}
