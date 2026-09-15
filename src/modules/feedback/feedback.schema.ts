import { z } from "zod";
import {
  FEEDBACK_ISSUE_TAGS,
  FEEDBACK_POSITIVE_TAGS,
  MAX_FEEDBACK_COMMENT_LENGTH,
  MAX_TAGS_PER_CATEGORY,
} from "./feedback.constants.js";

const positiveTagSchema = z.enum(FEEDBACK_POSITIVE_TAGS);
const issueTagSchema = z.enum(FEEDBACK_ISSUE_TAGS);

const dedupeTags = <T extends string>(values: T[]) => [...new Set(values)];

export const submitFeedbackBodySchema = z
  .object({
    positiveTags: z
      .array(positiveTagSchema)
      .max(MAX_TAGS_PER_CATEGORY)
      .optional()
      .default([])
      .transform(dedupeTags),
    issueTags: z
      .array(issueTagSchema)
      .max(MAX_TAGS_PER_CATEGORY)
      .optional()
      .default([])
      .transform(dedupeTags),
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
  })
  .superRefine((data, ctx) => {
    const overlap = data.positiveTags.filter((tag) =>
      data.issueTags.includes(tag as (typeof FEEDBACK_ISSUE_TAGS)[number]),
    );
    if (overlap.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["positiveTags"],
        message: "A tag cannot appear in both positiveTags and issueTags",
      });
    }

    const hasContent =
      data.positiveTags.length > 0 ||
      data.issueTags.length > 0 ||
      data.comment != null;
    if (!hasContent) {
      ctx.addIssue({
        code: "custom",
        path: ["comment"],
        message:
          "At least one of positiveTags, issueTags, or comment is required",
      });
    }
  });

export type SubmitFeedbackBody = z.infer<typeof submitFeedbackBodySchema>;
