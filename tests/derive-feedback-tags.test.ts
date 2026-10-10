import { describe, expect, it } from "vitest";
import { deriveFeedbackTagsFromExperienceScores } from "../src/modules/experience/derive-feedback-tags.js";

describe("deriveFeedbackTagsFromExperienceScores", () => {
  it("maps low driver and platform scores to issue tags", () => {
    const { positiveTags, issueTags } = deriveFeedbackTagsFromExperienceScores({
      driverRating: 1,
      platformRating: 2,
      deliveryRating: 3,
    });
    expect(issueTags).toContain("DRIVER_UNPROFESSIONAL");
    expect(issueTags).toContain("TRACKING_ISSUE");
    expect(positiveTags).toHaveLength(0);
  });

  it("maps high optional dimensions to positive tags", () => {
    const { positiveTags, issueTags } = deriveFeedbackTagsFromExperienceScores({
      driverRating: 5,
      platformRating: 5,
      deliveryRating: 5,
      timelinessRating: 5,
      packageHandlingRating: 4,
    });
    expect(positiveTags).toEqual(
      expect.arrayContaining([
        "DRIVER_POLITE",
        "DRIVER_PROFESSIONAL",
        "EASY_BOOKING",
        "GOOD_COMMUNICATION",
        "FAST_DELIVERY",
        "PACKAGE_HANDLED_WELL",
      ]),
    );
    expect(issueTags).toHaveLength(0);
  });

  it("ignores omitted optional dimensions", () => {
    const { positiveTags, issueTags } = deriveFeedbackTagsFromExperienceScores({
      driverRating: 3,
      platformRating: 3,
      deliveryRating: 3,
    });
    expect(positiveTags).toHaveLength(0);
    expect(issueTags).toHaveLength(0);
  });

  it("dedupes tags when rules overlap", () => {
    const { issueTags } = deriveFeedbackTagsFromExperienceScores({
      driverRating: 1,
      platformRating: 1,
      deliveryRating: 1,
      timelinessRating: 1,
    });
    expect(new Set(issueTags).size).toBe(issueTags.length);
  });
});
