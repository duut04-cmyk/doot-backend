import type { DeliveryOtpType, DeliveryStatus, UserRole } from "@prisma/client";
import { logger } from "../../config/logger.js";
import {
  OTP_EXPIRY_SECONDS,
  OTP_GENERATION_COOLDOWN_SECONDS,
  OTP_MAX_ATTEMPTS,
} from "../../config/env.js";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import {
  generateEmailVerificationOtp,
  hashOtp,
  verifyOtpHash,
} from "../auth/auth.crypto.js";
import { buildOtpSmsTemplateVariables } from "../../infrastructure/sms/sms.mapper.js";
import {
  isAmbiguousSmsOutcome,
  readSmsOutcomeFromError,
  shouldInvalidateOtpAfterSmsFailure,
} from "../../infrastructure/sms/sms-outcome.js";
import { smsService, type SmsSender } from "../../infrastructure/sms/sms.service.js";
import { toPhoneResponse } from "../../core/phone/phone.js";
import {
  driverRepository,
  type IDriverRepository,
} from "../driver/driver.repository.js";
import { loadAuthorizedDelivery } from "../delivery/delivery-access.js";
import {
  deliveryRepository,
  type IDeliveryRepository,
} from "../delivery/delivery.repository.js";
import {
  deliveryLifecycleService,
  type DeliveryLifecycleService,
} from "../delivery/delivery-lifecycle.service.js";
import { GENERIC_OTP_ERROR } from "./otp.constants.js";
import {
  otpRepository,
  type DeliveryOtpDto,
  type IOtpRepository,
} from "./otp.repository.js";

const PICKUP_GENERATION_STATUSES: DeliveryStatus[] = [
  "BOOKED",
  "DRIVER_ASSIGNED",
  "PICKUP_OTP_PENDING",
];
const PICKUP_VERIFY_STATUSES: DeliveryStatus[] = ["PICKUP_OTP_PENDING"];
const DELIVERY_GENERATION_STATUSES: DeliveryStatus[] = [
  "IN_TRANSIT",
  "DELIVERY_OTP_PENDING",
];
const DELIVERY_VERIFY_STATUSES: DeliveryStatus[] = ["DELIVERY_OTP_PENDING"];

export class OtpService {
  constructor(
    private readonly deliveryRepo: IDeliveryRepository = deliveryRepository,
    private readonly otpRepo: IOtpRepository = otpRepository,
    private readonly lifecycle: DeliveryLifecycleService = deliveryLifecycleService,
    private readonly sms: SmsSender = smsService,
    private readonly driverRepo: IDriverRepository = driverRepository,
  ) {}

  async generatePickupOtp(input: {
    deliveryId: string;
    userId: string;
    role: UserRole;
    requestId: string;
  }) {
    const delivery = await loadAuthorizedDelivery(
      this.deliveryRepo,
      input.deliveryId,
      input.userId,
      input.role,
    );
    if (!PICKUP_GENERATION_STATUSES.includes(delivery.status)) {
      throw new AppError("Pickup OTP cannot be generated for this delivery.", {
        statusCode: 422,
        code: ErrorCodes.OTP_NOT_ALLOWED,
      });
    }

    const previousStatus = delivery.status;
    const { code, expiresAt } = await this.createOperationalOtpRecord({
      deliveryId: input.deliveryId,
      type: "PICKUP",
      contact: delivery.pickup,
      contactRole: "pickup",
      sendSms: async (otp) => {
        await this.sendPickupOtpSms({
          pickup: delivery.pickup,
          deliveryId: input.deliveryId,
          deliveryReference: delivery.reference,
          otp,
          requestId: input.requestId,
        });
      },
    });

    if (previousStatus === "DRIVER_ASSIGNED" || previousStatus === "BOOKED") {
      await this.lifecycle.transition({
        deliveryId: input.deliveryId,
        currentStatus: previousStatus,
        toStatus: "PICKUP_OTP_PENDING",
        expectedFromStatuses: ["DRIVER_ASSIGNED", "BOOKED"],
        source: "OTP",
        reason: "Pickup OTP generated",
      });
    }

    logger.info(
      { requestId: input.requestId, deliveryId: input.deliveryId, type: "PICKUP" },
      "otp.generated",
    );

    return {
      success: true as const,
      data: {
        deliveryId: input.deliveryId,
        type: "PICKUP" as const,
        expiresAt: expiresAt.toISOString(),
        ...(process.env.NODE_ENV === "test" ||
        process.env.EXPOSE_OTP_FOR_CERTIFICATION === "true"
          ? { _testOtp: code }
          : {}),
      },
    };
  }

  async verifyPickupOtp(input: {
    deliveryId: string;
    userId: string;
    role: UserRole;
    otp: string;
    requestId: string;
  }) {
    const delivery = await loadAuthorizedDelivery(
      this.deliveryRepo,
      input.deliveryId,
      input.userId,
      input.role,
    );
    if (!PICKUP_VERIFY_STATUSES.includes(delivery.status)) {
      throw new AppError(GENERIC_OTP_ERROR, {
        statusCode: 422,
        code: ErrorCodes.OTP_NOT_ALLOWED,
      });
    }

    await this.verifyOtp({
      deliveryId: input.deliveryId,
      type: "PICKUP",
      otp: input.otp,
      requestId: input.requestId,
    });

    await this.lifecycle.transition({
      deliveryId: input.deliveryId,
      currentStatus: delivery.status,
      toStatus: "PICKED_UP",
      expectedFromStatuses: ["PICKUP_OTP_PENDING"],
      source: "OTP",
      reason: "Pickup OTP verified",
    });

    return {
      success: true as const,
      data: { deliveryId: input.deliveryId, status: "PICKED_UP" as const },
    };
  }

  async generateDeliveryOtp(input: {
    deliveryId: string;
    userId: string;
    role: UserRole;
    requestId: string;
  }) {
    const delivery = await loadAuthorizedDelivery(
      this.deliveryRepo,
      input.deliveryId,
      input.userId,
      input.role,
    );
    if (!DELIVERY_GENERATION_STATUSES.includes(delivery.status)) {
      throw new AppError("Delivery OTP cannot be generated for this delivery.", {
        statusCode: 422,
        code: ErrorCodes.OTP_NOT_ALLOWED,
      });
    }

    const previousStatus = delivery.status;
    const { code, expiresAt } = await this.createOperationalOtpRecord({
      deliveryId: input.deliveryId,
      type: "DELIVERY",
      contact: delivery.drop,
      contactRole: "drop",
      sendSms: async (otp) => {
        await this.sendDeliveryOtpSms({
          drop: delivery.drop,
          deliveryId: input.deliveryId,
          deliveryReference: delivery.reference,
          otp,
          requestId: input.requestId,
        });
      },
    });

    if (previousStatus === "IN_TRANSIT") {
      await this.lifecycle.transition({
        deliveryId: input.deliveryId,
        currentStatus: previousStatus,
        toStatus: "DELIVERY_OTP_PENDING",
        expectedFromStatuses: ["IN_TRANSIT"],
        source: "OTP",
        reason: "Delivery OTP generated",
      });
    }

    logger.info(
      {
        requestId: input.requestId,
        deliveryId: input.deliveryId,
        type: "DELIVERY",
      },
      "otp.generated",
    );

    return {
      success: true as const,
      data: {
        deliveryId: input.deliveryId,
        type: "DELIVERY" as const,
        expiresAt: expiresAt.toISOString(),
        ...(process.env.NODE_ENV === "test" ||
        process.env.EXPOSE_OTP_FOR_CERTIFICATION === "true"
          ? { _testOtp: code }
          : {}),
      },
    };
  }

  async verifyDeliveryOtp(input: {
    deliveryId: string;
    userId: string;
    role: UserRole;
    otp: string;
    requestId: string;
  }) {
    const delivery = await loadAuthorizedDelivery(
      this.deliveryRepo,
      input.deliveryId,
      input.userId,
      input.role,
    );
    if (!DELIVERY_VERIFY_STATUSES.includes(delivery.status)) {
      throw new AppError(GENERIC_OTP_ERROR, {
        statusCode: 422,
        code: ErrorCodes.OTP_NOT_ALLOWED,
      });
    }

    await this.verifyOtp({
      deliveryId: input.deliveryId,
      type: "DELIVERY",
      otp: input.otp,
      requestId: input.requestId,
    });

    await this.lifecycle.transition({
      deliveryId: input.deliveryId,
      currentStatus: delivery.status,
      toStatus: "DELIVERED",
      expectedFromStatuses: ["DELIVERY_OTP_PENDING"],
      source: "OTP",
      reason: "Delivery OTP verified",
    });

    return {
      success: true as const,
      data: { deliveryId: input.deliveryId, status: "DELIVERED" as const },
    };
  }

  private async createOperationalOtpRecord(input: {
    deliveryId: string;
    type: DeliveryOtpType;
    contact: {
      contactPhoneCountryCode: string | null;
      contactPhoneNumber: string | null;
    };
    contactRole: "pickup" | "drop";
    sendSms: (otp: string) => Promise<void>;
  }): Promise<{ code: string; expiresAt: Date }> {
    await this.ensureGenerationAllowed(input.deliveryId, input.type);
    this.ensureSmsAvailable();
    this.assertContactPhoneForOtpSms(input.contact, input.contactRole);

    const code = generateEmailVerificationOtp();
    const codeHash = await hashOtp(code);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_SECONDS * 1000);

    // Previous active OTP is invalidated before send; only the new row is rolled back on definite SMS failure.
    await this.otpRepo.invalidateActive(input.deliveryId, input.type);
    const created = await this.otpRepo.create({
      deliveryId: input.deliveryId,
      type: input.type,
      codeHash,
      expiresAt,
      maxAttempts: OTP_MAX_ATTEMPTS,
    });

    try {
      await input.sendSms(code);
    } catch (error) {
      await this.recoverOtpAfterSmsFailure(created, error);
      throw error;
    }

    return { code, expiresAt };
  }

  private ensureSmsAvailable() {
    if (!this.sms.isEnabled()) {
      throw new AppError("SMS delivery is not configured.", {
        statusCode: 503,
        code: ErrorCodes.SMS_NOT_CONFIGURED,
      });
    }
  }

  private assertContactPhoneForOtpSms(
    contact: {
      contactPhoneCountryCode: string | null;
      contactPhoneNumber: string | null;
    },
    role: "pickup" | "drop",
  ) {
    const phone = toPhoneResponse(
      contact.contactPhoneCountryCode,
      contact.contactPhoneNumber,
    );
    if (!phone) {
      throw new AppError(
        `A valid ${role} contact phone number is required for SMS verification.`,
        {
          statusCode: 422,
          code: ErrorCodes.OTP_NOT_ALLOWED,
        },
      );
    }
  }

  private async recoverOtpAfterSmsFailure(
    created: DeliveryOtpDto,
    error: unknown,
  ): Promise<void> {
    const outcome = readSmsOutcomeFromError(error);
    if (!shouldInvalidateOtpAfterSmsFailure(outcome)) {
      if (isAmbiguousSmsOutcome(outcome) || outcome === "ACCEPTED") {
        logger.warn(
          {
            deliveryId: created.deliveryId,
            type: created.type,
            smsOutcome: outcome,
          },
          "otp.sms_delivery_ambiguous",
        );
      }
      return;
    }

    try {
      await this.otpRepo.consume(created.id);
    } catch (cleanupError) {
      logger.error(
        {
          deliveryId: created.deliveryId,
          type: created.type,
          otpRecordId: created.id,
          err: cleanupError instanceof Error ? cleanupError.message : "cleanup_failed",
        },
        "otp.sms_recovery_cleanup_failed",
      );
    }
  }

  private async sendPickupOtpSms(input: {
    pickup: {
      contactPhoneCountryCode: string | null;
      contactPhoneNumber: string | null;
    };
    deliveryId: string;
    deliveryReference: string;
    otp: string;
    requestId: string;
  }) {
    const phone = toPhoneResponse(
      input.pickup.contactPhoneCountryCode,
      input.pickup.contactPhoneNumber,
    );
    if (!phone) {
      throw new AppError("Pickup contact phone is unavailable.", {
        statusCode: 422,
        code: ErrorCodes.OTP_NOT_ALLOWED,
      });
    }

    const driverAssignment = await this.driverRepo.findLatestByDeliveryId(
      input.deliveryId,
    );
    const templateVariables = buildOtpSmsTemplateVariables({
      eventType: "PICKUP",
      otp: input.otp,
      deliveryReference: input.deliveryReference,
      driverAssignment,
    });

    await this.sms.sendPickupOtpSms({
      recipientMobile: phone.e164.replace(/^\+/, ""),
      deliveryReference: input.deliveryReference,
      otp: input.otp,
      correlationId: input.requestId,
      templateVariables: {
        driver_name: templateVariables.driver_name,
        vehicle_type: templateVariables.vehicle_type,
        vehicle_number: templateVariables.vehicle_number,
        driver_phone_masked: templateVariables.driver_phone_masked,
        event_type: templateVariables.event_type,
      },
    });
  }

  private async sendDeliveryOtpSms(input: {
    drop: {
      contactPhoneCountryCode: string | null;
      contactPhoneNumber: string | null;
    };
    deliveryId: string;
    deliveryReference: string;
    otp: string;
    requestId: string;
  }) {
    const phone = toPhoneResponse(
      input.drop.contactPhoneCountryCode,
      input.drop.contactPhoneNumber,
    );
    if (!phone) {
      throw new AppError("Drop contact phone is unavailable.", {
        statusCode: 422,
        code: ErrorCodes.OTP_NOT_ALLOWED,
      });
    }

    const driverAssignment = await this.driverRepo.findLatestByDeliveryId(
      input.deliveryId,
    );
    const templateVariables = buildOtpSmsTemplateVariables({
      eventType: "DELIVERY",
      otp: input.otp,
      deliveryReference: input.deliveryReference,
      driverAssignment,
    });

    await this.sms.sendDeliveryOtpSms({
      recipientMobile: phone.e164.replace(/^\+/, ""),
      deliveryReference: input.deliveryReference,
      otp: input.otp,
      correlationId: input.requestId,
      templateVariables: {
        driver_name: templateVariables.driver_name,
        vehicle_type: templateVariables.vehicle_type,
        vehicle_number: templateVariables.vehicle_number,
        driver_phone_masked: templateVariables.driver_phone_masked,
        event_type: templateVariables.event_type,
      },
    });
  }

  private async ensureGenerationAllowed(deliveryId: string, type: DeliveryOtpType) {
    const active = await this.otpRepo.findActive(deliveryId, type);
    if (!active) {
      return;
    }
    const cooldownMs = OTP_GENERATION_COOLDOWN_SECONDS * 1000;
    const elapsed = Date.now() - active.createdAt.getTime();
    if (elapsed < cooldownMs) {
      throw new AppError("OTP generation is on cooldown.", {
        statusCode: 429,
        code: ErrorCodes.OTP_GENERATION_COOLDOWN,
      });
    }
  }

  private async verifyOtp(input: {
    deliveryId: string;
    type: DeliveryOtpType;
    otp: string;
    requestId: string;
  }) {
    const record = await this.otpRepo.findActive(input.deliveryId, input.type);
    if (!record) {
      throw new AppError(GENERIC_OTP_ERROR, {
        statusCode: 422,
        code: ErrorCodes.OTP_NOT_FOUND,
      });
    }

    if (record.consumedAt) {
      throw new AppError(GENERIC_OTP_ERROR, {
        statusCode: 422,
        code: ErrorCodes.OTP_INVALID,
      });
    }

    if (record.expiresAt.getTime() < Date.now()) {
      logger.info({ deliveryId: input.deliveryId, type: input.type }, "otp.expired");
      throw new AppError(GENERIC_OTP_ERROR, {
        statusCode: 422,
        code: ErrorCodes.OTP_EXPIRED,
      });
    }

    if (record.attempts >= record.maxAttempts) {
      throw new AppError(GENERIC_OTP_ERROR, {
        statusCode: 422,
        code: ErrorCodes.OTP_LOCKED,
      });
    }

    const matches = await verifyOtpHash(input.otp, record.codeHash);
    if (!matches) {
      const updated = await this.otpRepo.incrementAttempts(record.id);
      logger.info(
        { deliveryId: input.deliveryId, type: input.type },
        "otp.verification_failed",
      );
      if (updated.attempts >= updated.maxAttempts) {
        throw new AppError(GENERIC_OTP_ERROR, {
          statusCode: 422,
          code: ErrorCodes.OTP_LOCKED,
        });
      }
      throw new AppError(GENERIC_OTP_ERROR, {
        statusCode: 422,
        code: ErrorCodes.OTP_INVALID,
      });
    }

    const consumed = await this.otpRepo.consume(record.id);
    if (!consumed) {
      throw new AppError(GENERIC_OTP_ERROR, {
        statusCode: 422,
        code: ErrorCodes.OTP_INVALID,
      });
    }
    logger.info(
      { deliveryId: input.deliveryId, type: input.type, requestId: input.requestId },
      "otp.verification_succeeded",
    );
  }
}

export const otpService = new OtpService();
