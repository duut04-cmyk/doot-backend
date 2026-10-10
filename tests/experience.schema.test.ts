import { describe, expect, it } from "vitest";
import { submitDeliveryExperienceBodySchema } from "../src/modules/experience/experience.schema.js";

describe("submitDeliveryExperienceBodySchema", () => {
  it("accepts all rating dimensions and comment", () => {
    const result = submitDeliveryExperienceBodySchema.safeParse({
      driverRating: 3,
      platformRating: 3,
      deliveryRating: 3,
      timelinessRating: 2,
      packageHandlingRating: 5,
      servicePresentationRating: 4,
      comment: "Great service",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.comment).toBe("Great service");
    }
  });

  it("rejects missing timelinessRating", () => {
    const result = submitDeliveryExperienceBodySchema.safeParse({
      driverRating: 5,
      platformRating: 5,
      deliveryRating: 5,
      packageHandlingRating: 5,
      servicePresentationRating: 5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects out-of-range driverRating", () => {
    const result = submitDeliveryExperienceBodySchema.safeParse({
      driverRating: 0,
      platformRating: 5,
      deliveryRating: 5,
    });
    expect(result.success).toBe(false);
  });

  it("normalizes blank comment to null", () => {
    const result = submitDeliveryExperienceBodySchema.safeParse({
      driverRating: 5,
      platformRating: 5,
      deliveryRating: 5,
      timelinessRating: 5,
      packageHandlingRating: 5,
      servicePresentationRating: 5,
      comment: "   ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.comment).toBeNull();
    }
  });
});
