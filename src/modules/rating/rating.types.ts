export type DeliveryRatingDto = {
  id: string;
  deliveryId: string;
  driverRating: number;
  deliveryRating: number;
  createdAt: Date;
  updatedAt: Date;
};

export type SubmitRatingResult = {
  success: true;
  data: {
    id: string;
    deliveryId: string;
    driverRating: number;
    deliveryRating: number;
    createdAt: string;
    updatedAt: string;
  };
};

export type GetRatingResult = {
  success: true;
  data: {
    id: string;
    deliveryId: string;
    driverRating: number;
    deliveryRating: number;
    createdAt: string;
    updatedAt: string;
  };
};
