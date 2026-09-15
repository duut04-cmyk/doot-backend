import type { UserRole } from "@prisma/client";
import { loadAuthorizedDelivery } from "./delivery-access.js";
import {
  deliveryRepository,
  type IDeliveryRepository,
} from "./delivery.repository.js";
import { toDeliveryHistoryDetail } from "./delivery-history.mapper.js";
import type { GetDeliveryHistoryResult } from "./delivery-history.types.js";
import {
  cancellationRepository,
  type ICancellationRepository,
} from "../cancellation/cancellation.repository.js";
import {
  bookingRepository,
  type IBookingRepository,
} from "../booking/booking.repository.js";
import {
  driverRepository,
  type IDriverRepository,
} from "../driver/driver.repository.js";
import {
  feedbackRepository,
  type IFeedbackRepository,
} from "../feedback/feedback.repository.js";
import {
  orchestrationRepository,
  type IOrchestrationRepository,
} from "../orchestration/orchestration.repository.js";
import { otpRepository, type IOtpRepository } from "../otp/otp.repository.js";
import {
  ratingRepository,
  type IRatingRepository,
} from "../rating/rating.repository.js";
import {
  trackingRepository,
  type ITrackingRepository,
} from "../tracking/tracking.repository.js";

const TRACKING_HISTORY_LIMIT = 20;

export class DeliveryHistoryService {
  constructor(
    private readonly deliveryRepo: IDeliveryRepository = deliveryRepository,
    private readonly orchestrationRepo: IOrchestrationRepository = orchestrationRepository,
    private readonly bookingRepo: IBookingRepository = bookingRepository,
    private readonly driverRepo: IDriverRepository = driverRepository,
    private readonly trackingRepo: ITrackingRepository = trackingRepository,
    private readonly cancellationRepo: ICancellationRepository = cancellationRepository,
    private readonly otpRepo: IOtpRepository = otpRepository,
    private readonly ratingRepo: IRatingRepository = ratingRepository,
    private readonly feedbackRepo: IFeedbackRepository = feedbackRepository,
  ) {}

  async getHistoryDetail(input: {
    deliveryId: string;
    userId: string;
    role: UserRole;
  }): Promise<GetDeliveryHistoryResult> {
    const delivery = await loadAuthorizedDelivery(
      this.deliveryRepo,
      input.deliveryId,
      input.userId,
      input.role,
    );

    const [
      timeline,
      orchestration,
      booking,
      driver,
      latestTracking,
      trackingHistory,
      cancellation,
      otps,
      rating,
      feedback,
    ] = await Promise.all([
      this.deliveryRepo.findStatusEvents(input.deliveryId),
      this.orchestrationRepo.findSelectedOptionForDelivery(input.deliveryId),
      this.bookingRepo.findLatestByDeliveryId(input.deliveryId),
      this.driverRepo.findLatestByDeliveryId(input.deliveryId),
      this.trackingRepo.findLatestByDeliveryId(input.deliveryId),
      this.trackingRepo.listByDeliveryId(
        input.deliveryId,
        1,
        TRACKING_HISTORY_LIMIT,
      ),
      this.cancellationRepo.findLatestByDeliveryId(input.deliveryId),
      this.otpRepo.listByDeliveryId(input.deliveryId),
      this.ratingRepo.findByDeliveryId(input.deliveryId),
      this.feedbackRepo.findByDeliveryId(input.deliveryId),
    ]);

    const pickupOtp =
      otps.find((otp) => otp.type === "PICKUP" && otp.consumedAt) ??
      otps.find((otp) => otp.type === "PICKUP") ??
      null;
    const deliveryOtp =
      otps.find((otp) => otp.type === "DELIVERY" && otp.consumedAt) ??
      otps.find((otp) => otp.type === "DELIVERY") ??
      null;

    return {
      success: true,
      data: toDeliveryHistoryDetail({
        delivery,
        role: input.role,
        timeline,
        orchestration,
        booking,
        driver,
        latestTracking,
        trackingHistory: trackingHistory.items,
        cancellation,
        pickupOtp,
        deliveryOtp,
        rating,
        feedback,
      }),
    };
  }
}

export const deliveryHistoryService = new DeliveryHistoryService();
