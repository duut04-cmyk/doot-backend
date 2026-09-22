import { env } from "../../config/env.js";
import {
  EMAIL_VERIFICATION_OTP_EXPIRY_MINUTES,
  OTP_RESEND_COOLDOWN_SECONDS,
} from "../auth/auth.constants.js";
import {
  REQUIRE_KNOWN_CANCELLATION_POLICY,
  SCORE_WEIGHTS,
} from "../orchestration/orchestration.constants.js";
import type { SettingsSnapshotDto } from "./settings.types.js";

export class SettingsService {
  getSnapshot(): { success: true; data: SettingsSnapshotDto } {
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
            quoteMaxAgeSeconds: env.BOOKING_QUOTE_MAX_AGE_SECONDS,
            priceTolerancePercent: env.BOOKING_PRICE_TOLERANCE_PERCENT,
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
        checkedAt: new Date().toISOString(),
      },
    };
  }
}

export const settingsService = new SettingsService();
