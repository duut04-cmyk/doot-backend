import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertCleanupAllowed,
  CleanupRefusedError,
  deleteApplicationData,
  parseSafeDatabaseIdentification,
  resetDeliveryReferenceSequence,
} from "../scripts/reset-database-data.lib.js";

describe("assertCleanupAllowed", () => {
  it("refuses when ALLOW_DATABASE_DATA_RESET is missing", () => {
    expect(() =>
      assertCleanupAllowed({
        NODE_ENV: "development",
      }),
    ).toThrow(CleanupRefusedError);
  });

  it("refuses when ALLOW_DATABASE_DATA_RESET is not exactly true", () => {
    expect(() =>
      assertCleanupAllowed({
        NODE_ENV: "development",
        ALLOW_DATABASE_DATA_RESET: "yes",
      }),
    ).toThrow(CleanupRefusedError);
  });

  it("refuses in production", () => {
    expect(() =>
      assertCleanupAllowed({
        NODE_ENV: "production",
        ALLOW_DATABASE_DATA_RESET: "true",
      }),
    ).toThrow(CleanupRefusedError);
  });

  it("allows development with explicit flag", () => {
    expect(() =>
      assertCleanupAllowed({
        NODE_ENV: "development",
        ALLOW_DATABASE_DATA_RESET: "true",
      }),
    ).not.toThrow();
  });
});

describe("parseSafeDatabaseIdentification", () => {
  it("extracts host and database without exposing credentials", () => {
    const info = parseSafeDatabaseIdentification(
      "postgresql://user:secret@db.example.com:5432/dutt_dev?schema=public",
    );

    expect(info).toEqual({
      provider: "postgresql",
      host: "db.example.com",
      port: "5432",
      database: "dutt_dev",
    });
    expect(JSON.stringify(info)).not.toContain("secret");
  });
});

describe("deleteApplicationData", () => {
  it("deletes models in dependency-safe order", async () => {
    const order: string[] = [];

    const makeDelegate = (name: string) => ({
      deleteMany: vi.fn(async () => {
        order.push(name);
        return { count: 1 };
      }),
      count: vi.fn(async () => 1),
    });

    const tx = {
      cancellationIdempotencyKey: makeDelegate("CancellationIdempotencyKey"),
      deliveryCancellation: makeDelegate("DeliveryCancellation"),
      deliveryTrackingPoint: makeDelegate("DeliveryTrackingPoint"),
      deliveryOtp: makeDelegate("DeliveryOtp"),
      driverAssignment: makeDelegate("DriverAssignment"),
      bookingConfirmIdempotencyKey: makeDelegate("BookingConfirmIdempotencyKey"),
      providerBooking: makeDelegate("ProviderBooking"),
      orchestrationOption: makeDelegate("OrchestrationOption"),
      orchestrationEvaluation: makeDelegate("OrchestrationEvaluation"),
      orchestrationRequest: makeDelegate("OrchestrationRequest"),
      deliveryIdempotencyKey: makeDelegate("DeliveryIdempotencyKey"),
      deliveryStatusEvent: makeDelegate("DeliveryStatusEvent"),
      deliveryHandlingRequirement: makeDelegate("DeliveryHandlingRequirement"),
      deliveryPackagePhoto: makeDelegate("DeliveryPackagePhoto"),
      deliveryPackage: makeDelegate("DeliveryPackage"),
      deliveryCompliance: makeDelegate("DeliveryCompliance"),
      deliverySchedule: makeDelegate("DeliverySchedule"),
      deliveryPickup: makeDelegate("DeliveryPickup"),
      deliveryDrop: makeDelegate("DeliveryDrop"),
      deliveryRating: makeDelegate("DeliveryRating"),
      deliveryFeedback: makeDelegate("DeliveryFeedback"),
      delivery: makeDelegate("Delivery"),
      providerWebhookEvent: makeDelegate("ProviderWebhookEvent"),
      providerCredential: makeDelegate("ProviderCredential"),
      providerCapabilityRecord: makeDelegate("ProviderCapabilityRecord"),
      providerService: makeDelegate("ProviderService"),
      providerVehicle: makeDelegate("ProviderVehicle"),
      providerSettings: makeDelegate("ProviderSettings"),
      providerPackageLimits: makeDelegate("ProviderPackageLimits"),
      provider: makeDelegate("Provider"),
      adminAuditLog: makeDelegate("AdminAuditLog"),
      oAuthAccount: makeDelegate("OAuthAccount"),
      emailVerificationOtp: makeDelegate("EmailVerificationOtp"),
      passwordResetOtp: makeDelegate("PasswordResetOtp"),
      passwordResetVerificationToken: makeDelegate(
        "PasswordResetVerificationToken",
      ),
      refreshToken: makeDelegate("RefreshToken"),
      user: makeDelegate("User"),
    };

    await deleteApplicationData(tx as never);

    expect(order[0]).toBe("CancellationIdempotencyKey");
    expect(order.at(-1)).toBe("User");
    expect(order.indexOf("OrchestrationOption")).toBeLessThan(
      order.indexOf("OrchestrationEvaluation"),
    );
    expect(order.indexOf("Delivery")).toBeLessThan(order.indexOf("Provider"));
    expect(order.indexOf("Provider")).toBeLessThan(order.indexOf("User"));
  });
});

describe("resetDeliveryReferenceSequence", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("restarts sequence and reports next DUTT reference", async () => {
    const prisma = {
      $executeRawUnsafe: vi.fn(async () => undefined),
      $queryRaw: vi.fn(async () => [{ last_value: 1000, is_called: false }]),
    };

    const state = await resetDeliveryReferenceSequence(prisma as never, 1000);

    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      "ALTER SEQUENCE delivery_reference_seq RESTART WITH 1000",
    );
    expect(state.nextReference).toBe("DUTT-1000");
  });
});
