import { beforeEach, describe, expect, it } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { FeedbackService } from "../src/modules/feedback/feedback.service.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryFeedbackRepository } from "./helpers/in-memory-feedback-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import {
  seedBookedDelivery,
  seedDeliveredDelivery,
} from "./helpers/operational-test-helpers.js";

describe("FeedbackService", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let feedbackRepo: InMemoryFeedbackRepository;
  let service: FeedbackService;
  const customerId = "44444444-4444-4444-8444-444444444444";
  const otherCustomerId = "55555555-5555-5555-8555-555555555555";

  beforeEach(() => {
    deliveryRepo = new InMemoryDeliveryRepository();
    feedbackRepo = new InMemoryFeedbackRepository(deliveryRepo);
    service = new FeedbackService(deliveryRepo, feedbackRepo);
  });

  async function seedDelivered() {
    return seedDeliveredDelivery({
      deliveryRepo,
      orchestrationRepo: new InMemoryOrchestrationRepository(),
      providerRepo: new InMemoryProviderRepository(),
      bookingRepo: new InMemoryBookingRepository(),
      customerId,
    });
  }

  it("allows positive feedback", async () => {
    const seeded = await seedDelivered();
    const result = await service.submitFeedback({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      body: { positiveTags: ["DRIVER_POLITE", "FAST_DELIVERY"], issueTags: [] },
    });
    expect(result.data.positiveTags).toEqual(["DRIVER_POLITE", "FAST_DELIVERY"]);
  });

  it("allows issue feedback", async () => {
    const seeded = await seedDelivered();
    const result = await service.submitFeedback({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      body: { positiveTags: [], issueTags: ["DRIVER_LATE"] },
    });
    expect(result.data.issueTags).toEqual(["DRIVER_LATE"]);
  });

  it("allows comment-only feedback", async () => {
    const seeded = await seedDelivered();
    const result = await service.submitFeedback({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      body: { positiveTags: [], issueTags: [], comment: "Great experience" },
    });
    expect(result.data.comment).toBe("Great experience");
  });

  it("rejects cross-customer feedback", async () => {
    const seeded = await seedDelivered();
    await expect(
      service.submitFeedback({
        deliveryId: seeded.deliveryId,
        userId: otherCustomerId,
        role: "CUSTOMER",
        body: { positiveTags: ["FAST_DELIVERY"], issueTags: [] },
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.DELIVERY_NOT_FOUND });
  });

  it("rejects cancelled delivery feedback", async () => {
    const seeded = await seedBookedDelivery({
      deliveryRepo,
      orchestrationRepo: new InMemoryOrchestrationRepository(),
      providerRepo: new InMemoryProviderRepository(),
      bookingRepo: new InMemoryBookingRepository(),
      customerId,
    });
    await deliveryRepo.transitionStatus({
      deliveryId: seeded.deliveryId,
      expectedFromStatuses: ["BOOKED"],
      toStatus: "CANCELLED",
      source: "SYSTEM",
      reason: "test",
    });
    await expect(
      service.submitFeedback({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        body: { positiveTags: ["FAST_DELIVERY"], issueTags: [] },
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.FEEDBACK_NOT_ALLOWED });
  });

  it("rejects duplicate feedback", async () => {
    const seeded = await seedDelivered();
    await service.submitFeedback({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      body: { positiveTags: ["FAST_DELIVERY"], issueTags: [] },
    });
    await expect(
      service.submitFeedback({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        body: { positiveTags: ["EASY_BOOKING"], issueTags: [] },
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.FEEDBACK_ALREADY_SUBMITTED });
  });

  it("allows exactly one concurrent feedback submission", async () => {
    const seeded = await seedDelivered();
    const results = await Promise.allSettled([
      service.submitFeedback({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        body: { positiveTags: ["FAST_DELIVERY"], issueTags: [] },
      }),
      service.submitFeedback({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        body: { issueTags: ["OTHER"], positiveTags: [] },
      }),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect((results[0].status === "rejected" ? results[0] : results[1]) as PromiseRejectedResult).toBeDefined();
  });

  it("returns feedback without secrets", async () => {
    const seeded = await seedDelivered();
    const result = await service.submitFeedback({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      body: { positiveTags: ["FAST_DELIVERY"], issueTags: [] },
    });
    expect(JSON.stringify(result)).not.toContain("codeHash");
  });

  it("rejects rating+status race when delivery no longer DELIVERED", async () => {
    const seeded = await seedDelivered();
    await deliveryRepo.transitionStatus({
      deliveryId: seeded.deliveryId,
      expectedFromStatuses: ["DELIVERED"],
      toStatus: "CANCELLED",
      source: "SYSTEM",
      reason: "test race",
    });
    await expect(
      service.submitFeedback({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        body: { positiveTags: ["FAST_DELIVERY"], issueTags: [] },
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.FEEDBACK_NOT_ALLOWED });
  });
});
