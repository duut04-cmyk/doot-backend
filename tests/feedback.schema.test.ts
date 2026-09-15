import { describe, expect, it } from "vitest";
import { submitFeedbackBodySchema } from "../src/modules/feedback/feedback.schema.js";

describe("submitFeedbackBodySchema", () => {
  it("rejects empty feedback", () => {
    const result = submitFeedbackBodySchema.safeParse({
      positiveTags: [],
      issueTags: [],
      comment: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid tag", () => {
    const result = submitFeedbackBodySchema.safeParse({
      positiveTags: ["NOT_A_TAG"],
      issueTags: [],
    });
    expect(result.success).toBe(false);
  });

  it("dedupes duplicate tags", () => {
    const result = submitFeedbackBodySchema.parse({
      positiveTags: ["FAST_DELIVERY", "FAST_DELIVERY"],
      issueTags: [],
    });
    expect(result.positiveTags).toEqual(["FAST_DELIVERY"]);
  });

  it("rejects comment over 1000 chars", () => {
    const result = submitFeedbackBodySchema.safeParse({
      positiveTags: [],
      issueTags: [],
      comment: "x".repeat(1001),
    });
    expect(result.success).toBe(false);
  });

  it("rejects whitespace-only comment", () => {
    const result = submitFeedbackBodySchema.safeParse({
      positiveTags: [],
      issueTags: [],
      comment: "   ",
    });
    expect(result.success).toBe(false);
  });
});
