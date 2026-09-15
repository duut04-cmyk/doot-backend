import { describe, expect, it } from "vitest";
import { submitRatingBodySchema } from "../src/modules/rating/rating.schema.js";

describe("submitRatingBodySchema", () => {
  it("rejects driver rating below 1", () => {
    const result = submitRatingBodySchema.safeParse({
      driverRating: 0,
      deliveryRating: 5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects driver rating above 5", () => {
    const result = submitRatingBodySchema.safeParse({
      driverRating: 6,
      deliveryRating: 5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects delivery rating below 1", () => {
    const result = submitRatingBodySchema.safeParse({
      driverRating: 5,
      deliveryRating: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects delivery rating above 5", () => {
    const result = submitRatingBodySchema.safeParse({
      driverRating: 5,
      deliveryRating: 6,
    });
    expect(result.success).toBe(false);
  });
});
