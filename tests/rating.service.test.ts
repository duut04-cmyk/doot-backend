import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../src/core/errors/app-error.js";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { RatingService } from "../src/modules/rating/rating.service.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { InMemoryRatingRepository } from "./helpers/in-memory-rating-repository.js";
import {
  seedBookedDelivery,
  seedDeliveredDelivery,
} from "./helpers/operational-test-helpers.js";
import { seedOptionReadyDelivery } from "./helpers/booking-test-helpers.js";

describe("RatingService", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let ratingRepo: InMemoryRatingRepository;
  let service: RatingService;
  const customerId = "44444444-4444-4444-8444-444444444444";
  const otherCustomerId = "55555555-5555-5555-8555-555555555555";

  beforeEach(() => {
    deliveryRepo = new InMemoryDeliveryRepository();
    ratingRepo = new InMemoryRatingRepository(deliveryRepo);
    service = new RatingService(deliveryRepo, ratingRepo);
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

  it("allows customer to rate DELIVERED delivery", async () => {
    const seeded = await seedDelivered();
    const result = await service.submitRating({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      body: { driverRating: 5, deliveryRating: 4 },
    });
    expect(result.data.driverRating).toBe(5);
    expect(result.data.deliveryRating).toBe(4);
  });

  it("rejects rating for CREATED delivery", async () => {
    const seeded = await seedOptionReadyDelivery({
      deliveryRepo,
      orchestrationRepo: new InMemoryOrchestrationRepository(),
      providerRepo: new InMemoryProviderRepository(),
      customerId,
    });
    await expect(
      service.submitRating({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        body: { driverRating: 5, deliveryRating: 5 },
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.RATING_NOT_ALLOWED });
  });

  it("rejects rating for IN_TRANSIT delivery", async () => {
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
      toStatus: "IN_TRANSIT",
      source: "TRACKING",
      reason: "test",
    });
    await expect(
      service.submitRating({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        body: { driverRating: 5, deliveryRating: 5 },
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.RATING_NOT_ALLOWED });
  });

  it("rejects rating for CANCELLED delivery", async () => {
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
      service.submitRating({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        body: { driverRating: 5, deliveryRating: 5 },
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.RATING_NOT_ALLOWED });
  });

  it("rejects rating for FAILED delivery", async () => {
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
      toStatus: "FAILED",
      source: "SYSTEM",
      reason: "test",
    });
    await expect(
      service.submitRating({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        body: { driverRating: 5, deliveryRating: 5 },
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.RATING_NOT_ALLOWED });
  });

  it("rejects cross-customer rating", async () => {
    const seeded = await seedDelivered();
    await expect(
      service.submitRating({
        deliveryId: seeded.deliveryId,
        userId: otherCustomerId,
        role: "CUSTOMER",
        body: { driverRating: 5, deliveryRating: 5 },
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.DELIVERY_NOT_FOUND });
  });

  it("rejects duplicate rating", async () => {
    const seeded = await seedDelivered();
    await service.submitRating({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      body: { driverRating: 5, deliveryRating: 5 },
    });
    await expect(
      service.submitRating({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        body: { driverRating: 4, deliveryRating: 4 },
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.RATING_ALREADY_SUBMITTED });
  });

  it("allows exactly one concurrent rating submission", async () => {
    const seeded = await seedDelivered();
    const results = await Promise.allSettled([
      service.submitRating({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        body: { driverRating: 5, deliveryRating: 5 },
      }),
      service.submitRating({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
        body: { driverRating: 4, deliveryRating: 4 },
      }),
    ]);
    const fulfilled = results.filter((item) => item.status === "fulfilled");
    const rejected = results.filter((item) => item.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(AppError);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: ErrorCodes.RATING_ALREADY_SUBMITTED,
    });
  });

  it("rejects admin submitting customer rating", async () => {
    const seeded = await seedDelivered();
    await expect(
      service.submitRating({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "ADMIN",
        body: { driverRating: 5, deliveryRating: 5 },
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.FORBIDDEN });
  });

  it("returns rating without secrets", async () => {
    const seeded = await seedDelivered();
    const result = await service.submitRating({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      body: { driverRating: 5, deliveryRating: 4 },
    });
    expect(JSON.stringify(result)).not.toContain("codeHash");
    expect(JSON.stringify(result)).not.toContain("password");
  });

  it("returns 404 when rating missing on get", async () => {
    const seeded = await seedDelivered();
    await expect(
      service.getRating({
        deliveryId: seeded.deliveryId,
        userId: customerId,
        role: "CUSTOMER",
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.RATING_NOT_FOUND });
  });
});
