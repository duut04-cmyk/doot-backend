import type { DeliveryOtpType, User, UserRole, UserStatus } from "@prisma/client";
import type { OtpService } from "../../src/modules/otp/otp.service.js";
import type { InMemoryAuthRepository } from "./in-memory-auth-repository.js";
import type { InMemoryBookingRepository } from "./in-memory-booking-repository.js";
import type { InMemoryDeliveryRepository } from "./in-memory-delivery-repository.js";
import type { InMemoryOrchestrationRepository } from "./in-memory-orchestration-repository.js";
import type { InMemoryOtpRepository } from "./in-memory-otp-repository.js";
import type { InMemoryProviderRepository } from "./in-memory-provider-repository.js";
import { seedBookedDelivery } from "./operational-test-helpers.js";

export function seedCustomerUser(
  authRepo: InMemoryAuthRepository,
  input: {
    id: string;
    email?: string;
    name?: string;
    status?: UserStatus;
  },
): User {
  const now = new Date();
  const user: User = {
    id: input.id,
    name: input.name ?? "Test Customer",
    email: input.email ?? "customer@example.com",
    phoneCountryCode: "+91",
    phoneNumber: "9876543210",
    passwordHash: "hash",
    emailVerified: true,
    status: input.status ?? ("ACTIVE" as UserStatus),
    role: "CUSTOMER" as UserRole,
    createdAt: now,
    updatedAt: now,
  };
  authRepo.users.push(user);
  return user;
}

export async function seedDriverAssignedDelivery(input: {
  deliveryRepo: InMemoryDeliveryRepository;
  orchestrationRepo: InMemoryOrchestrationRepository;
  providerRepo: InMemoryProviderRepository;
  bookingRepo: InMemoryBookingRepository;
  customerId: string;
}) {
  const seeded = await seedBookedDelivery(input);
  await input.deliveryRepo.transitionStatus({
    deliveryId: seeded.deliveryId,
    expectedFromStatuses: ["BOOKED"],
    toStatus: "DRIVER_ASSIGNED",
    source: "TRACKING",
    reason: "test",
  });
  return seeded;
}

export async function seedPickupOtpPending(input: {
  service: OtpService;
  deliveryRepo: InMemoryDeliveryRepository;
  orchestrationRepo: InMemoryOrchestrationRepository;
  providerRepo: InMemoryProviderRepository;
  bookingRepo: InMemoryBookingRepository;
  customerId: string;
  requestId?: string;
}) {
  const seeded = await seedDriverAssignedDelivery(input);
  const generated = await input.service.generatePickupOtp({
    deliveryId: seeded.deliveryId,
    userId: input.customerId,
    role: "CUSTOMER",
    requestId: input.requestId ?? "req-seed-pickup-otp",
  });
  return { seeded, generated };
}

export async function seedInTransitDelivery(input: {
  service: OtpService;
  deliveryRepo: InMemoryDeliveryRepository;
  orchestrationRepo: InMemoryOrchestrationRepository;
  providerRepo: InMemoryProviderRepository;
  bookingRepo: InMemoryBookingRepository;
  customerId: string;
}) {
  const { seeded, generated } = await seedPickupOtpPending(input);
  await input.service.verifyPickupOtp({
    deliveryId: seeded.deliveryId,
    userId: input.customerId,
    role: "CUSTOMER",
    otp: generated.data._testOtp!,
    requestId: "req-seed-pickup-verify",
  });
  await input.deliveryRepo.transitionStatus({
    deliveryId: seeded.deliveryId,
    expectedFromStatuses: ["PICKED_UP"],
    toStatus: "IN_TRANSIT",
    source: "TRACKING",
    reason: "test",
  });
  return seeded;
}

export async function seedDeliveryOtpPending(input: {
  service: OtpService;
  deliveryRepo: InMemoryDeliveryRepository;
  orchestrationRepo: InMemoryOrchestrationRepository;
  providerRepo: InMemoryProviderRepository;
  bookingRepo: InMemoryBookingRepository;
  customerId: string;
}) {
  const seeded = await seedInTransitDelivery(input);
  const generated = await input.service.generateDeliveryOtp({
    deliveryId: seeded.deliveryId,
    userId: input.customerId,
    role: "CUSTOMER",
    requestId: "req-seed-delivery-otp",
  });
  return { seeded, generated };
}

export function expireActiveOtp(
  otpRepo: InMemoryOtpRepository,
  deliveryId: string,
  type: DeliveryOtpType,
) {
  const row = otpRepo.otps.find(
    (item) =>
      item.deliveryId === deliveryId && item.type === type && item.consumedAt == null,
  );
  if (row) {
    row.expiresAt = new Date(Date.now() - 1000);
  }
}

export function backdateActiveOtpCreatedAt(
  otpRepo: InMemoryOtpRepository,
  deliveryId: string,
  type: DeliveryOtpType,
  msAgo: number,
) {
  const row = otpRepo.otps.find(
    (item) =>
      item.deliveryId === deliveryId && item.type === type && item.consumedAt == null,
  );
  if (row) {
    row.createdAt = new Date(Date.now() - msAgo);
  }
}

export function getActiveOtp(
  otpRepo: InMemoryOtpRepository,
  deliveryId: string,
  type: DeliveryOtpType,
) {
  return otpRepo.otps.find(
    (item) =>
      item.deliveryId === deliveryId && item.type === type && item.consumedAt == null,
  );
}
