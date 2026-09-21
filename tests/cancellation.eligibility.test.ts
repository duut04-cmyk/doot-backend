import { describe, expect, it } from "vitest";
import {
  canCancelWithBooking,
  isDeliveryCancellable,
  isProviderCancellationEligible,
} from "../src/modules/cancellation/cancellation.eligibility.js";
import type { ProviderWithRelations } from "../src/modules/provider/provider.repository.js";
import { initializeProviderAdapters } from "../src/modules/provider/adapters/bootstrap.js";

describe("cancellation eligibility", () => {
  initializeProviderAdapters();

  describe("isDeliveryCancellable", () => {
    it.each([
      "CREATED",
      "ORCHESTRATING",
      "OPTION_READY",
      "BOOKED",
      "DRIVER_ASSIGNED",
      "PICKUP_OTP_PENDING",
    ] as const)("allows %s", (status) => {
      expect(isDeliveryCancellable(status)).toBe(true);
    });

    it.each([
      "BOOKING",
      "PICKED_UP",
      "IN_TRANSIT",
      "DELIVERY_OTP_PENDING",
      "DELIVERED",
      "CANCELLED",
      "FAILED",
    ] as const)("rejects %s", (status) => {
      expect(isDeliveryCancellable(status)).toBe(false);
    });
  });

  describe("canCancelWithBooking", () => {
    it("allows local-only cancel before booking", () => {
      expect(
        canCancelWithBooking({
          deliveryStatus: "OPTION_READY",
          bookingStatus: null,
        }),
      ).toEqual({ allowed: true, localOnly: true });
    });

    it("allows provider cancel when booked", () => {
      expect(
        canCancelWithBooking({
          deliveryStatus: "BOOKED",
          bookingStatus: "BOOKED",
        }),
      ).toEqual({ allowed: true, localOnly: false });
    });

    it("allows provider cancel after driver assignment", () => {
      expect(
        canCancelWithBooking({
          deliveryStatus: "DRIVER_ASSIGNED",
          bookingStatus: "BOOKED",
        }),
      ).toEqual({ allowed: true, localOnly: false });
    });

    it("blocks cancel when booking outcome is unknown", () => {
      expect(
        canCancelWithBooking({
          deliveryStatus: "BOOKED",
          bookingStatus: "UNKNOWN",
        }),
      ).toEqual({ allowed: false, localOnly: false });
    });

    it("blocks cancel after pickup even with booked booking", () => {
      expect(
        canCancelWithBooking({
          deliveryStatus: "IN_TRANSIT",
          bookingStatus: "BOOKED",
        }),
      ).toEqual({ allowed: false, localOnly: false });
    });

    it("blocks cancel during active booking attempt", () => {
      expect(
        canCancelWithBooking({
          deliveryStatus: "BOOKING",
          bookingStatus: "PROCESSING",
        }),
      ).toEqual({ allowed: false, localOnly: false });
    });
  });

  describe("isProviderCancellationEligible", () => {
    function mockProvider(
      overrides: Partial<ProviderWithRelations> = {},
    ): ProviderWithRelations {
      return {
        id: "provider-1",
        code: "MOCK",
        name: "Mock",
        displayName: "Mock",
        description: null,
        environment: "SANDBOX",
        enabled: true,
        status: "ACTIVE",
        orchestrationEnabled: true,
        priority: 1,
        integrationStatus: "READY",
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        capabilities: [{ capability: "CANCELLATION" }],
        services: [],
        credentials: [],
        ...overrides,
      } as ProviderWithRelations;
    }

    it("accepts active MOCK provider with cancellation capability", () => {
      expect(isProviderCancellationEligible(mockProvider())).toBe(true);
    });

    it("rejects disabled provider", () => {
      expect(isProviderCancellationEligible(mockProvider({ enabled: false }))).toBe(
        false,
      );
    });

    it("rejects provider without cancellation capability", () => {
      expect(
        isProviderCancellationEligible(
          mockProvider({ capabilities: [{ capability: "BOOKING" }] }),
        ),
      ).toBe(false);
    });
  });
});
