import {
  env,
  getEmailFromAddress,
  OTP_EXPIRY_SECONDS,
} from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import { EMAIL_VERIFICATION_OTP_EXPIRY_MINUTES } from "../../modules/auth/auth.constants.js";
import { emailDomain } from "../../modules/auth/auth.crypto.js";
import { sendWithResend } from "./resend.client.js";
import { buildPasswordResetOtpEmail } from "./templates/password-reset-otp-email.js";
import { buildVerificationEmail } from "./templates/verification-email.js";

export type SendVerificationEmailInput = {
  to: string;
  recipientName: string;
  otp: string;
};

export type SendPasswordResetOtpEmailInput = {
  to: string;
  recipientName: string;
  otp: string;
};

export interface EmailSender {
  sendVerificationEmail(input: SendVerificationEmailInput): Promise<void>;
  sendPasswordResetOtpEmail(input: SendPasswordResetOtpEmailInput): Promise<void>;
}

export class EmailService implements EmailSender {
  async sendVerificationEmail(input: SendVerificationEmailInput): Promise<void> {
    const from = getEmailFromAddress();
    if (!env.RESEND_API_KEY || !from) {
      logger.error(
        { emailDomain: emailDomain(input.to) },
        "email delivery failed: missing Resend configuration",
      );
      throw new AppError("Unable to send verification email at this time", {
        statusCode: 503,
        code: ErrorCodes.EMAIL_DELIVERY_FAILED,
      });
    }

    const content = buildVerificationEmail({
      appName: env.APP_NAME,
      recipientName: input.recipientName,
      otp: input.otp,
      expiryMinutes: EMAIL_VERIFICATION_OTP_EXPIRY_MINUTES,
    });

    try {
      await sendWithResend({
        from,
        to: input.to,
        subject: content.subject,
        html: content.html,
        text: content.text,
      });
      logger.info(
        { emailDomain: emailDomain(input.to) },
        "verification email sent",
      );
    } catch (error) {
      logger.error(
        {
          emailDomain: emailDomain(input.to),
          err:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : { message: "unknown email provider error" },
        },
        "email delivery failed",
      );
      throw new AppError("Unable to send verification email at this time", {
        statusCode: 503,
        code: ErrorCodes.EMAIL_DELIVERY_FAILED,
        cause: error,
      });
    }
  }

  async sendPasswordResetOtpEmail(
    input: SendPasswordResetOtpEmailInput,
  ): Promise<void> {
    const from = getEmailFromAddress();
    if (!env.RESEND_API_KEY || !from) {
      logger.error(
        { emailDomain: emailDomain(input.to) },
        "email delivery failed: missing Resend configuration",
      );
      throw new AppError("Unable to send password reset email at this time", {
        statusCode: 503,
        code: ErrorCodes.EMAIL_DELIVERY_FAILED,
      });
    }

    const expiryMinutes = Math.max(1, Math.ceil(OTP_EXPIRY_SECONDS / 60));
    const content = buildPasswordResetOtpEmail({
      appName: env.APP_NAME,
      recipientName: input.recipientName,
      otp: input.otp,
      expiryMinutes,
    });

    try {
      await sendWithResend({
        from,
        to: input.to,
        subject: content.subject,
        html: content.html,
        text: content.text,
      });
      logger.info(
        { emailDomain: emailDomain(input.to) },
        "password_reset_otp_email_sent",
      );
    } catch (error) {
      logger.error(
        {
          emailDomain: emailDomain(input.to),
          err:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : { message: "unknown email provider error" },
        },
        "email delivery failed",
      );
      throw new AppError("Unable to send password reset email at this time", {
        statusCode: 503,
        code: ErrorCodes.EMAIL_DELIVERY_FAILED,
        cause: error,
      });
    }
  }
}

export const emailService = new EmailService();
