import { env } from "../../config/env.js";
import {
  EMAIL_VERIFICATION_OTP_EXPIRY_MINUTES,
  OTP_RESEND_COOLDOWN_SECONDS,
} from "../auth/auth.constants.js";
import {
  REQUIRE_KNOWN_CANCELLATION_POLICY,
  SCORE_WEIGHTS,
} from "../orchestration/orchestration.constants.js";
import {
  runtimeSettingsService,
  type RuntimeSettingsService,
} from "../runtime-settings/runtime-settings.service.js";
import type { PatchBookingPoliciesInput } from "../runtime-settings/runtime-settings.schema.js";
import type {
  PatchBookingPoliciesResponseDto,
  SettingsSnapshotDto,
} from "./settings.types.js";

export class SettingsService {
  constructor(
    private readonly runtimeSettings: RuntimeSettingsService = runtimeSettingsService,
  ) {}

  async getSnapshot(): Promise<{ success: true; data: SettingsSnapshotDto }> {
    const bookingStates = await this.runtimeSettings.getBookingSettingStates();
    const pricingStates = await this.runtimeSettings.getPricingSettingStates();

    return {
      success: true,
      data: {
        platform: {
          appName: env.APP_NAME,
          nodeEnv: env.NODE_ENV,
          port: env.PORT,
          frontendUrl: env.FRONTEND_URL ?? null,
          adminFrontendUrl: env.ADMIN_FRONTEND_URL ?? null,
        },
        policies: {
          booking: {
            quoteMaxAgeSeconds: bookingStates.quoteMaxAgeSeconds.value,
            priceTolerancePercent: bookingStates.priceTolerancePercent.value,
          },
          pricing: {
            platformServiceFeePercent: pricingStates.platformServiceFeePercent.value,
          },
          auth: {
            jwtAccessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
            refreshTokenExpiresInDays: env.REFRESH_TOKEN_EXPIRES_IN_DAYS,
            bcryptRounds: env.BCRYPT_ROUNDS,
            passwordResetTokenExpirySeconds:
              env.PASSWORD_RESET_VERIFICATION_TOKEN_EXPIRY_SECONDS,
            emailVerificationOtpExpiryMinutes: EMAIL_VERIFICATION_OTP_EXPIRY_MINUTES,
            otpResendCooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS,
          },
          deliveryOtp: {
            expirySeconds: env.OTP_EXPIRY_SECONDS,
            maxAttempts: env.OTP_MAX_ATTEMPTS,
            generationCooldownSeconds: env.OTP_GENERATION_COOLDOWN_SECONDS,
          },
          orchestration: {
            requireKnownCancellationPolicy: REQUIRE_KNOWN_CANCELLATION_POLICY,
            scoreWeights: {
              price: SCORE_WEIGHTS.PRICE,
              eta: SCORE_WEIGHTS.ETA,
              availability: SCORE_WEIGHTS.AVAILABILITY,
              providerPriority: SCORE_WEIGHTS.PROVIDER_PRIORITY,
              serviceQuality: SCORE_WEIGHTS.SERVICE_QUALITY,
            },
          },
        },
        flags: {
          mockProviderAdapter: env.ENABLE_MOCK_PROVIDER_ADAPTER,
          developmentMode: env.NODE_ENV === "development",
        },
        runtime: {
          booking: bookingStates,
          pricing: pricingStates,
        },
        checkedAt: new Date().toISOString(),
      },
    };
  }

  async patchBookingPolicies(input: {
    adminUserId: string;
    requestId: string;
    body: PatchBookingPoliciesInput;
  }): Promise<{ success: true; data: PatchBookingPoliciesResponseDto }> {
    const result = await this.runtimeSettings.patchBookingPolicies(input);
    return {
      success: true,
      data: {
        booking: result.booking,
        pricing: result.pricing,
        audit: {
          outcome: result.audit.outcome,
          changes: result.audit.changes.map((change) => ({
            key: change.key,
            previousValue: change.previousValue,
            newValue: change.newValue,
            previousVersion: change.previousVersion,
            newVersion: change.newVersion,
          })),
        },
      },
    };
  }
}

export const settingsService = new SettingsService();
