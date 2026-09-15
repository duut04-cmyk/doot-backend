import type { UserRole } from "@prisma/client";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import {
  deliveryRepository,
  type DeliveryWithRelations,
  type IDeliveryRepository,
} from "./delivery.repository.js";

export async function loadAuthorizedDelivery(
  deliveryRepo: IDeliveryRepository,
  deliveryId: string,
  userId: string,
  role: UserRole,
): Promise<DeliveryWithRelations> {
  const delivery =
    role === "ADMIN"
      ? await deliveryRepo.findById(deliveryId)
      : await deliveryRepo.findByIdForCustomer(deliveryId, userId);
  if (!delivery) {
    throw new AppError("Delivery not found.", {
      statusCode: 404,
      code: ErrorCodes.DELIVERY_NOT_FOUND,
    });
  }
  return delivery;
}

export const defaultDeliveryAccess = {
  loadAuthorizedDelivery: (
    deliveryId: string,
    userId: string,
    role: UserRole,
  ) => loadAuthorizedDelivery(deliveryRepository, deliveryId, userId, role),
};
