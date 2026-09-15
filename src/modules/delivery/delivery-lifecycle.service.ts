import type { DeliveryStatus, StatusEventSource } from "@prisma/client";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import {
  canTransitionDelivery,
  isStaleOperationalTransition,
  isTerminalDeliveryStatus,
} from "./delivery.transitions.js";
import {
  deliveryRepository,
  type IDeliveryRepository,
} from "./delivery.repository.js";

export class DeliveryLifecycleService {
  constructor(
    private readonly deliveryRepo: IDeliveryRepository = deliveryRepository,
  ) {}

  async transition(input: {
    deliveryId: string;
    currentStatus: DeliveryStatus;
    toStatus: DeliveryStatus;
    expectedFromStatuses: DeliveryStatus[];
    source: StatusEventSource;
    reason: string;
    metadata?: Record<string, unknown>;
    allowStaleGuard?: boolean;
  }) {
    if (
      input.allowStaleGuard !== false &&
      isStaleOperationalTransition(input.currentStatus, input.toStatus)
    ) {
      return null;
    }

    if (
      input.currentStatus !== input.toStatus &&
      !canTransitionDelivery(input.currentStatus, input.toStatus)
    ) {
      throw new AppError("Invalid delivery state transition.", {
        statusCode: 409,
        code: ErrorCodes.DELIVERY_INVALID_TRANSITION,
      });
    }

    if (isTerminalDeliveryStatus(input.currentStatus) && input.currentStatus !== input.toStatus) {
      return null;
    }

    return this.deliveryRepo.transitionStatus({
      deliveryId: input.deliveryId,
      expectedFromStatuses: input.expectedFromStatuses,
      toStatus: input.toStatus,
      source: input.source,
      reason: input.reason,
      metadata: input.metadata,
    });
  }
}

export const deliveryLifecycleService = new DeliveryLifecycleService();
