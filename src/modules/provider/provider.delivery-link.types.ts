export type ShiprocketTrackingWebhookDeliveryLink =
  | {
      outcome: "matched";
      deliveryId: string;
      bookingId: string;
      providerId: string;
    }
  | { outcome: "not_found" }
  | { outcome: "ambiguous"; deliveryIds: string[] };

export type ShiprocketTrackingWebhookLinkInput = {
  awb?: string | null;
  srOrderId?: string | null;
  orderId?: string | null;
};
