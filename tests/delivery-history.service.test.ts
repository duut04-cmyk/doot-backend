import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { DeliveryHistoryService } from "../src/modules/delivery/delivery-history.service.js";
import { DeliveryService } from "../src/modules/delivery/delivery.service.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryCancellationRepository } from "./helpers/in-memory-cancellation-repository.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryDriverRepository } from "./helpers/in-memory-driver-repository.js";
import { InMemoryFeedbackRepository } from "./helpers/in-memory-feedback-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryOtpRepository } from "./helpers/in-memory-otp-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { InMemoryRatingRepository } from "./helpers/in-memory-rating-repository.js";
import { InMemoryTrackingRepository } from "./helpers/in-memory-tracking-repository.js";
import {
  seedDeliveredDelivery,
} from "./helpers/operational-test-helpers.js";

describe("DeliveryHistoryService", () => {
  let deliveryRepo: InMemoryDeliveryRepository;
  let orchestrationRepo: InMemoryOrchestrationRepository;
  let bookingRepo: InMemoryBookingRepository;
  let driverRepo: InMemoryDriverRepository;
  let trackingRepo: InMemoryTrackingRepository;
  let cancellationRepo: InMemoryCancellationRepository;
  let otpRepo: InMemoryOtpRepository;
  let ratingRepo: InMemoryRatingRepository;
  let feedbackRepo: InMemoryFeedbackRepository;
  let historyService: DeliveryHistoryService;
  let deliveryService: DeliveryService;
  const customerId = "44444444-4444-4444-8444-444444444444";
  const otherCustomerId = "55555555-5555-5555-8555-555555555555";

  beforeEach(() => {
    deliveryRepo = new InMemoryDeliveryRepository();
    orchestrationRepo = new InMemoryOrchestrationRepository();
    bookingRepo = new InMemoryBookingRepository();
    driverRepo = new InMemoryDriverRepository();
    trackingRepo = new InMemoryTrackingRepository();
    cancellationRepo = new InMemoryCancellationRepository();
    otpRepo = new InMemoryOtpRepository();
    ratingRepo = new InMemoryRatingRepository(deliveryRepo);
    feedbackRepo = new InMemoryFeedbackRepository(deliveryRepo);
    historyService = new DeliveryHistoryService(
      deliveryRepo,
      orchestrationRepo,
      bookingRepo,
      driverRepo,
      trackingRepo,
      cancellationRepo,
      otpRepo,
      ratingRepo,
      feedbackRepo,
    );
    deliveryService = new DeliveryService(deliveryRepo);
  });

  async function seedFullDelivered() {
    const providerRepo = new InMemoryProviderRepository();
    const seeded = await seedDeliveredDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });

    await driverRepo.upsertAssignment({
      deliveryId: seeded.deliveryId,
      providerBookingId: seeded.bookingId,
      providerId: seeded.providerId,
      providerDriverId: "DRV-1",
      driverName: "Alex Driver",
      driverPhone: "+919999999999",
      driverPhotoUrl: null,
      providerRating: 4.8,
      vehicleType: "BIKE",
      vehicleNumber: "KA01AB1234",
      assignedAt: new Date(),
      status: "ASSIGNED",
      source: "PROVIDER_POLL",
      providerStatus: "assigned",
    });

    await trackingRepo.createPoint({
      deliveryId: seeded.deliveryId,
      providerBookingId: seeded.bookingId,
      providerId: seeded.providerId,
      latitude: 12.9716,
      longitude: 77.5946,
      receivedAt: new Date(),
      normalizedStatus: "IN_TRANSIT",
      trackingUrl: "https://track.example/d/1",
      source: "PROVIDER_POLL",
    });

    await otpRepo.create({
      deliveryId: seeded.deliveryId,
      type: "PICKUP",
      codeHash: "secret-hash-pickup",
      expiresAt: new Date(Date.now() + 60_000),
      maxAttempts: 5,
    });
    const deliveryOtp = await otpRepo.create({
      deliveryId: seeded.deliveryId,
      type: "DELIVERY",
      codeHash: "secret-hash-delivery",
      expiresAt: new Date(Date.now() + 60_000),
      maxAttempts: 5,
    });
    await otpRepo.consume(deliveryOtp.id);

    await ratingRepo.createForDeliveredDelivery({
      deliveryId: seeded.deliveryId,
      customerId,
      driverRating: 5,
      deliveryRating: 4,
    });
    await feedbackRepo.createForDeliveredDelivery({
      deliveryId: seeded.deliveryId,
      customerId,
      positiveTags: ["FAST_DELIVERY"],
      issueTags: [],
      comment: "On time",
    });

    return seeded;
  }

  it("returns historical detail with rating and feedback", async () => {
    const seeded = await seedFullDelivered();
    const result = await historyService.getHistoryDetail({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
    });
    expect(result.data.rating?.driverRating).toBe(5);
    expect(result.data.feedback?.comment).toBe("On time");
  });

  it("includes driver snapshot and booking", async () => {
    const seeded = await seedFullDelivered();
    const result = await historyService.getHistoryDetail({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
    });
    expect(result.data.booking?.providerCode).toBe("MOCK");
    expect(result.data.driver).toMatchObject({
      known: true,
      assigned: true,
    });
  });

  it("includes tracking and timeline", async () => {
    const seeded = await seedFullDelivered();
    const result = await historyService.getHistoryDetail({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
    });
    expect(result.data.tracking.latest?.latitude).toBe(12.9716);
    expect(result.data.timeline.length).toBeGreaterThan(0);
  });

  it("never exposes OTP secrets", async () => {
    const seeded = await seedFullDelivered();
    const result = await historyService.getHistoryDetail({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret-hash");
    expect(serialized).not.toContain("codeHash");
  });

  it("rejects cross-customer history access", async () => {
    const seeded = await seedFullDelivered();
    await expect(
      historyService.getHistoryDetail({
        deliveryId: seeded.deliveryId,
        userId: otherCustomerId,
        role: "CUSTOMER",
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.DELIVERY_NOT_FOUND });
  });

  it("allows admin historical access", async () => {
    const seeded = await seedFullDelivered();
    const result = await historyService.getHistoryDetail({
      deliveryId: seeded.deliveryId,
      userId: randomUUID(),
      role: "ADMIN",
    });
    expect(result.data.delivery.id).toBe(seeded.deliveryId);
  });

  it("lists deliveries newest first with pagination", async () => {
    const providerRepo = new InMemoryProviderRepository();
    const first = await seedDeliveredDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await seedDeliveredDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });

    const page1 = await deliveryService.listDeliveries({
      customerId,
      role: "CUSTOMER",
      query: { page: 1, limit: 1 },
    });
    expect(page1.data.items).toHaveLength(1);
    expect(page1.data.total).toBe(2);
    expect(page1.data.items[0]?.id).toBe(second.deliveryId);

    const page2 = await deliveryService.listDeliveries({
      customerId,
      role: "CUSTOMER",
      query: { page: 2, limit: 1 },
    });
    expect(page2.data.items[0]?.id).toBe(first.deliveryId);
  });

  it("filters deliveries by status", async () => {
    const providerRepo = new InMemoryProviderRepository();
    const delivered = await seedDeliveredDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });
    await deliveryRepo.transitionStatus({
      deliveryId: delivered.deliveryId,
      expectedFromStatuses: ["DELIVERED"],
      toStatus: "CANCELLED",
      source: "SYSTEM",
      reason: "test",
    });
    await seedDeliveredDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });

    const result = await deliveryService.listDeliveries({
      customerId,
      role: "CUSTOMER",
      query: { page: 1, limit: 20, status: "DELIVERED" },
    });
    expect(result.data.items.every((item) => item.status === "DELIVERED")).toBe(true);
  });

  it("keeps cancelled delivery readable in history", async () => {
    const seeded = await seedFullDelivered();
    await deliveryRepo.transitionStatus({
      deliveryId: seeded.deliveryId,
      expectedFromStatuses: ["DELIVERED"],
      toStatus: "CANCELLED",
      source: "SYSTEM",
      reason: "post-delivery test",
    });
    const result = await historyService.getHistoryDetail({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
    });
    expect(result.data.delivery.status).toBe("CANCELLED");
    expect(result.data.rating).not.toBeNull();
  });
});
