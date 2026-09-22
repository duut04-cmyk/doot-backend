import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeliveryStatus } from "@prisma/client";
import { OperationalPollingService } from "../src/modules/operations/operational-polling.service.js";
import type { OperationalRefreshResult } from "../src/modules/operations/operational-refresh.types.js";
import type {
  IOperationalPollingRepository,
  OperationalPollingCandidate,
} from "../src/modules/operations/operational-polling.repository.js";
import { InMemoryOperationalPollingLock } from "../src/modules/operations/operational-polling.lock.js";
import { AppError } from "../src/core/errors/app-error.js";
import { ErrorCodes } from "../src/core/errors/error-codes.js";
import { ProviderAdapterResolver } from "../src/modules/provider/adapters/provider-adapter-resolver.js";

class InMemoryOperationalPollingRepository implements IOperationalPollingRepository {
  candidates: OperationalPollingCandidate[] = [];

  async findEligibleDeliveries(limit: number): Promise<OperationalPollingCandidate[]> {
    return this.candidates.slice(0, limit);
  }
}

describe("OperationalPollingService", () => {
  let pollingRepo: InMemoryOperationalPollingRepository;
  let refreshMock: ReturnType<typeof vi.fn>;
  let lock: InMemoryOperationalPollingLock;
  let resolverMock: { resolveForExecution: ReturnType<typeof vi.fn> };
  let service: OperationalPollingService;

  beforeEach(() => {
    pollingRepo = new InMemoryOperationalPollingRepository();
    refreshMock = vi.fn();
    lock = new InMemoryOperationalPollingLock();
    resolverMock = {
      resolveForExecution: vi.fn().mockResolvedValue({
        adapter: {},
        config: { providerCode: "MOCK", capabilities: ["LIVE_TRACKING"] },
      }),
    };

    service = new OperationalPollingService(
      pollingRepo,
      { refreshFromProvider: refreshMock } as never,
      lock,
      resolverMock as unknown as ProviderAdapterResolver,
    );
  });

  function candidate(
    deliveryId: string,
    status: DeliveryStatus = "BOOKED",
  ): OperationalPollingCandidate {
    return {
      deliveryId,
      deliveryStatus: status,
      deliveryReference: `DOTT-${deliveryId.slice(0, 8)}`,
      providerBookingId: "booking-1",
      providerId: "provider-1",
      providerCode: "MOCK",
      providerOrderId: "order-1",
    };
  }

  it("refreshes active provider-backed deliveries", async () => {
    pollingRepo.candidates = [candidate("delivery-1"), candidate("delivery-2")];
    refreshMock.mockResolvedValue({
      pollSucceeded: true,
    } satisfies Partial<OperationalRefreshResult>);

    await service.runCycle("cycle-1");

    expect(refreshMock).toHaveBeenCalledTimes(2);
    expect(refreshMock.mock.calls[0]?.[0]).toMatchObject({
      deliveryId: "delivery-1",
      source: "PROVIDER_POLL",
      failureMode: "preserve",
    });
  });

  it("skips deliveries when provider is not eligible", async () => {
    pollingRepo.candidates = [candidate("delivery-1")];
    resolverMock.resolveForExecution.mockRejectedValue(
      new AppError("Provider does not support required capabilities.", {
        statusCode: 422,
        code: ErrorCodes.PROVIDER_UNSUPPORTED_OPERATION,
      }),
    );

    await service.runCycle("cycle-2");

    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("does not process the same delivery concurrently", async () => {
    pollingRepo.candidates = [candidate("delivery-1")];

    let unblockRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      unblockRefresh = resolve;
    });

    refreshMock.mockImplementation(async () => {
      await refreshGate;
      return { pollSucceeded: true };
    });

    const first = service.runCycle("cycle-a");
    await new Promise((resolve) => setTimeout(resolve, 10));

    pollingRepo.candidates = [candidate("delivery-1")];
    await service.runCycle("cycle-b");

    unblockRefresh();
    await first;

    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
