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
import { otpRepository, type IOtpRepository } from "./otp.repository.js";

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

    await this.ensureGenerationAllowed(input.deliveryId, "PICKUP");
    const code = generateEmailVerificationOtp();
    const codeHash = await hashOtp(code);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_SECONDS * 1000);

    await this.otpRepo.invalidateActive(input.deliveryId, "PICKUP");
    await this.otpRepo.create({
      deliveryId: input.deliveryId,
      type: "PICKUP",
      codeHash,
      expiresAt,
      maxAttempts: OTP_MAX_ATTEMPTS,
    });

    if (
      delivery.status === "DRIVER_ASSIGNED" ||
      delivery.status === "BOOKED"
    ) {
      await this.lifecycle.transition({
        deliveryId: input.deliveryId,
        currentStatus: delivery.status,
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
        ...(process.env.NODE_ENV === "test" ? { _testOtp: code } : {}),
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

    await this.ensureGenerationAllowed(input.deliveryId, "DELIVERY");
    const code = generateEmailVerificationOtp();
    const codeHash = await hashOtp(code);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_SECONDS * 1000);

    await this.otpRepo.invalidateActive(input.deliveryId, "DELIVERY");
    await this.otpRepo.create({
      deliveryId: input.deliveryId,
      type: "DELIVERY",
      codeHash,
      expiresAt,
      maxAttempts: OTP_MAX_ATTEMPTS,
    });

    if (delivery.status === "IN_TRANSIT") {
      await this.lifecycle.transition({
        deliveryId: input.deliveryId,
        currentStatus: delivery.status,
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
        ...(process.env.NODE_ENV === "test" ? { _testOtp: code } : {}),
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

  private async ensureGenerationAllowed(
    deliveryId: string,
    type: DeliveryOtpType,
  ) {
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
      logger.info(
        { deliveryId: input.deliveryId, type: input.type },
        "otp.expired",
      );
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
