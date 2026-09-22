import type { Mock } from "vitest";
import { DeliveryLifecycleService } from "../../src/modules/delivery/delivery-lifecycle.service.js";
import { DriverService } from "../../src/modules/driver/driver.service.js";
import { OperationalRefreshService } from "../../src/modules/operations/operational-refresh.service.js";
import { ProviderAdapterExecutor } from "../../src/modules/provider/adapters/provider-adapter-executor.js";
import { TrackingService } from "../../src/modules/tracking/tracking.service.js";
import type { InMemoryBookingRepository } from "./in-memory-booking-repository.js";
import type { InMemoryDeliveryRepository } from "./in-memory-delivery-repository.js";
import { InMemoryDriverRepository } from "./in-memory-driver-repository.js";
import { InMemoryTrackingRepository } from "./in-memory-tracking-repository.js";

export function createOperationalServices(input: {
  deliveryRepo: InMemoryDeliveryRepository;
  bookingRepo: InMemoryBookingRepository;
  executeMock?: Mock;
  adapterExecutor?: ProviderAdapterExecutor;
  driverRepo?: InMemoryDriverRepository;
  trackingRepo?: InMemoryTrackingRepository;
}) {
  const adapterExecutor =
    input.adapterExecutor ??
    ({ execute: input.executeMock! } as unknown as ProviderAdapterExecutor);
  const lifecycle = new DeliveryLifecycleService(input.deliveryRepo);
  const driverRepo = input.driverRepo ?? new InMemoryDriverRepository();
  const trackingRepo = input.trackingRepo ?? new InMemoryTrackingRepository();

  const stubOperationalRefresh = {
    refreshFromProvider: async () => ({
      pollSucceeded: false,
      deliveryId: "",
      deliveryStatus: "BOOKED" as const,
      driverAssignment: null,
      trackingPoint: null,
    }),
  };

  const driverService = new DriverService(
    input.deliveryRepo,
    input.bookingRepo,
    driverRepo,
    lifecycle,
    stubOperationalRefresh as unknown as OperationalRefreshService,
  );
  const trackingService = new TrackingService(
    input.deliveryRepo,
    trackingRepo,
    lifecycle,
    stubOperationalRefresh as unknown as OperationalRefreshService,
  );

  const operationalRefresh = new OperationalRefreshService(
    input.deliveryRepo,
    input.bookingRepo,
    adapterExecutor,
    { driver: driverService, tracking: trackingService },
  );

  const wiredDriverService = new DriverService(
    input.deliveryRepo,
    input.bookingRepo,
    driverRepo,
    lifecycle,
    operationalRefresh,
  );
  const wiredTrackingService = new TrackingService(
    input.deliveryRepo,
    trackingRepo,
    lifecycle,
    operationalRefresh,
  );

  return {
    lifecycle,
    operationalRefresh,
    driverService: wiredDriverService,
    trackingService: wiredTrackingService,
    ingestDriverService: driverService,
    ingestTrackingService: trackingService,
  };
}
