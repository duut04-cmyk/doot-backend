export type DeliveryRatingDto = {
  id: string;
  deliveryId: string;
  driverRating: number;
  platformRating: number | null;
  deliveryRating: number;
  timelinessRating: number | null;
  packageHandlingRating: number | null;
  servicePresentationRating: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DeliveryRatingResponse = {
  id: string;
  deliveryId: string;
  driverRating: number;
  platformRating: number | null;
  deliveryRating: number;
  timelinessRating: number | null;
  packageHandlingRating: number | null;
  servicePresentationRating: number | null;
  createdAt: string;
  updatedAt: string;
};

export type SubmitRatingResult = {
  success: true;
  data: DeliveryRatingResponse;
};

export type GetRatingResult = {
  success: true;
  data: DeliveryRatingResponse;
};

export type CreateExperienceRatingInput = {
  deliveryId: string;
  customerId: string;
  driverRating: number;
  platformRating: number;
  deliveryRating: number;
  timelinessRating: number;
  packageHandlingRating: number;
  servicePresentationRating: number;
};
