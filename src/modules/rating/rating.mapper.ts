import type { DeliveryRatingDto, DeliveryRatingResponse } from "./rating.types.js";

export function toRatingResponse(rating: DeliveryRatingDto): DeliveryRatingResponse {
  return {
    id: rating.id,
    deliveryId: rating.deliveryId,
    driverRating: rating.driverRating,
    platformRating: rating.platformRating,
    deliveryRating: rating.deliveryRating,
    timelinessRating: rating.timelinessRating,
    packageHandlingRating: rating.packageHandlingRating,
    servicePresentationRating: rating.servicePresentationRating,
    createdAt: rating.createdAt.toISOString(),
    updatedAt: rating.updatedAt.toISOString(),
  };
}
