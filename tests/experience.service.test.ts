import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../src/core/errors/app-error.js";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { ExperienceService } from "../src/modules/experience/experience.service.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryFeedbackRepository } from "./helpers/in-memory-feedback-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { InMemoryRatingRepository } from "./helpers/in-memory-rating-repository.js";
import { seedDeliveredDelivery } from "./helpers/operational-test-helpers.js";

describe("ExperienceService", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let ratingRepo: InMemoryRatingRepository;
  let feedbackRepo: InMemoryFeedbackRepository;
  let service: ExperienceService;
  const customerId = "44444444-4444-4444-8444-444444444444";

  beforeEach(() => {
    deliveryRepo = new InMemoryDeliveryRepository();
    ratingRepo = new InMemoryRatingRepository(deliveryRepo);
    feedbackRepo = new InMemoryFeedbackRepository(deliveryRepo);
    service = new ExperienceService(deliveryRepo, ratingRepo, feedbackRepo);
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

  it("submits rating and feedback atomically", async () => {
    const seeded = await seedDelivered();
    const result = await service.submitExperience({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      body: {
        driverRating: 5,
        platformRating: 4,
        deliveryRating: 5,
        timelinessRating: 5,
        packageHandlingRating: 4,
        servicePresentationRating: 4,
        comment: "Smooth delivery",
      },
    });

    expect(result.data.rating.platformRating).toBe(4);
    expect(result.data.rating.timelinessRating).toBe(5);
    expect(result.data.feedback.comment).toBe("Smooth delivery");
    expect(result.data.feedback.positiveTags.length).toBeGreaterThan(0);
    expect(feedbackRepo.feedback).toHaveLength(1);
    expect(ratingRepo.ratings).toHaveLength(1);
  });

  it("rejects duplicate submit", async () => {
    const seeded = await seedDelivered();
    const body = {
      driverRating: 5,
      platformRating: 5,
      deliveryRating: 5,
      timelinessRating: 5,
      packageHandlingRating: 5,
      servicePresentationRating: 5,
      comment: null as string | null,
    };
    await service.submitExperience({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      body,
    });
    await expect(
      service.submitExperience({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        body,
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.RATING_ALREADY_SUBMITTED });
  });

  it("rejects non-customer role", async () => {
    const seeded = await seedDelivered();
    await expect(
      service.submitExperience({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "ADMIN",
        body: {
          driverRating: 5,
          platformRating: 5,
          deliveryRating: 5,
          timelinessRating: 5,
          packageHandlingRating: 5,
          servicePresentationRating: 5,
          comment: null,
        },
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("stores all rating dimensions", async () => {
    const seeded = await seedDelivered();
    const result = await service.submitExperience({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      body: {
        driverRating: 4,
        platformRating: 4,
        deliveryRating: 4,
        timelinessRating: 3,
        packageHandlingRating: 5,
        servicePresentationRating: 4,
        comment: null,
      },
    });
    expect(result.data.rating.timelinessRating).toBe(3);
    expect(result.data.rating.packageHandlingRating).toBe(5);
    expect(result.data.rating.servicePresentationRating).toBe(4);
  });
});
