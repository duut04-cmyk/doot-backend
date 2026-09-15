import type { DeliveryRatingDto } from "./rating.types.js";

export function toRatingResponse(rating: DeliveryRatingDto) {
  return {
    id: rating.id,
    deliveryId: rating.deliveryId,
    driverRating: rating.driverRating,
    deliveryRating: rating.deliveryRating,
    createdAt: rating.createdAt.toISOString(),
    updatedAt: rating.updatedAt.toISOString(),
  };
}
