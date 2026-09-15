import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { logger } from "../src/config/logger.js";
import { MockProviderAdapter } from "../src/modules/provider/adapters/mock/mock-provider.adapter.js";
import { MOCK_BOOKING_ID } from "../src/modules/provider/adapters/mock/mock-provider.constants.js";
import { ProviderAdapterExecutor } from "../src/modules/provider/adapters/provider-adapter-executor.js";
import { ProviderAdapterRegistry } from "../src/modules/provider/adapters/provider-adapter-registry.js";
import { ProviderAdapterResolver } from "../src/modules/provider/adapters/provider-adapter-resolver.js";
import { ProviderConfigResolver } from "../src/modules/provider/adapters/provider-config-resolver.js";
import { toServiceabilityRequest } from "../src/modules/provider/adapters/delivery-provider.mapper.js";
import type { DeliveryDetailDto } from "../src/modules/delivery/delivery.types.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";
import { seedMockProvider } from "./helpers/provider-adapter-test-helpers.js";

const sampleDelivery: DeliveryDetailDto = {
  id: "22222222-2222-2222-2222-222222222222",
  reference: "DUTT-3000",
  status: "CREATED",
  pickup: {
    addressText: "A",
    contactName: "A",
    contactPhone: "+911111111111",
    instructions: null,
  },
  drop: {
    addressText: "B",
    contactName: "B",
    contactPhone: "+912222222222",
    instructions: null,
  },
  package: {
    packageType: "FOOD",
    description: null,
    weightKg: 2,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    sizeTier: "SMALL",
    quantity: 1,
    photos: [],
  },
  requirements: [],
  specialInstructions: null,
  schedule: {
    mode: "ASAP",
    timezone: "Asia/Kolkata",
    scheduledAt: null,
    windowStart: null,
    windowEnd: null,
  },
  compliance: {
    accepted: true,
    acceptedAt: "2026-09-14T10:00:00.000Z",
  },
  createdAt: "2026-09-14T10:00:00.000Z",
  updatedAt: "2026-09-14T10:00:00.000Z",
};

describe("Provider adapter executor", () => {
  let executor: ProviderAdapterExecutor;

  beforeEach(async () => {
    const repo = new InMemoryProviderRepository();
    await seedMockProvider(repo, { integrationStatus: "READY" });
    const registry = new ProviderAdapterRegistry();
    registry.register(new MockProviderAdapter());
    const resolver = new ProviderAdapterResolver(
      registry,
      new ProviderConfigResolver(repo),
    );
    executor = new ProviderAdapterExecutor(resolver);
  });

  it("executes serviceability through mock adapter", async () => {
    const result = await executor.execute({
      providerCode: "MOCK",
      operation: "checkServiceability",
      payload: toServiceabilityRequest(sampleDelivery),
      requestId: "exec-1",
    });
    expect(result.serviceable).toBe(true);
    expect(result.availableServices[0]?.serviceCode).toBe("MOCK_BIKE");
  });

  it("executes quote, booking, tracking, and cancellation", async () => {
    const quote = await executor.execute({
      providerCode: "MOCK",
      operation: "getQuote",
      payload: { ...toServiceabilityRequest(sampleDelivery), serviceCode: "MOCK_BIKE" },
      requestId: "exec-2",
    });
    expect(quote.amount?.amount).toBe(150);
    expect(quote.breakdown?.totalAmount).toBe(150);

    const booking = await executor.execute({
      providerCode: "MOCK",
      operation: "createBooking",
      payload: {
        ...toServiceabilityRequest(sampleDelivery),
        serviceCode: "MOCK_BIKE",
        providerQuoteId: quote.providerQuoteId,
      },
      requestId: "exec-3",
    });
    expect(booking.success).toBe(true);
    expect(booking.driver).toBeNull();

    const tracking = await executor.execute({
      providerCode: "MOCK",
      operation: "getTracking",
      payload: { providerBookingId: MOCK_BOOKING_ID },
      requestId: "exec-4",
      testHints: { includeTrackingCoordinates: true },
    });
    expect(tracking.latitude).toBe(12.9716);
    expect(tracking.longitude).toBe(77.5946);

    const trackingNoCoords = await executor.execute({
      providerCode: "MOCK",
      operation: "getTracking",
      payload: { providerBookingId: MOCK_BOOKING_ID },
      requestId: "exec-4b",
    });
    expect(trackingNoCoords.latitude).toBeNull();
    expect(trackingNoCoords.longitude).toBeNull();

    const cancellation = await executor.execute({
      providerCode: "MOCK",
      operation: "cancelBooking",
      payload: { providerBookingId: MOCK_BOOKING_ID, reason: "test" },
      requestId: "exec-5",
    });
    expect(cancellation.success).toBe(true);
  });

  it("executes availability with driver count and no fabricated drivers", async () => {
    const result = await executor.execute({
      providerCode: "MOCK",
      operation: "getAvailability",
      payload: toServiceabilityRequest(sampleDelivery),
      requestId: "exec-6",
    });
    expect(result.availableDriverCount).toBe(2);
    expect(result.drivers).toBeNull();
  });

  it("normalizes booking failure to AppError", async () => {
    await expect(
      executor.execute({
        providerCode: "MOCK",
        operation: "createBooking",
        payload: {
          ...toServiceabilityRequest(sampleDelivery),
          package: { ...sampleDelivery.package, weightKg: 5000 },
        },
        requestId: "exec-7",
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.PROVIDER_ADAPTER_ERROR,
    });
  });

  it("does not log credential secrets", async () => {
    const infoSpy = vi.spyOn(logger, "info");
    const warnSpy = vi.spyOn(logger, "warn");
    await executor.execute({
      providerCode: "MOCK",
      operation: "checkServiceability",
      payload: toServiceabilityRequest(sampleDelivery),
      requestId: "exec-8",
    });
    const logged = JSON.stringify([...infoSpy.mock.calls, ...warnSpy.mock.calls]);
    expect(logged).not.toContain("mock-api-key");
    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
