import { env, getEmailFromAddress } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import {
  EMAIL_VERIFICATION_OTP_EXPIRY_MINUTES,
  PASSWORD_RESET_TOKEN_EXPIRY_MINUTES,
} from "../../modules/auth/auth.constants.js";
import {
  emailDomain,
  getPasswordResetTokenExpiresMinutes,
} from "../../modules/auth/auth.crypto.js";
import { sendWithResend } from "./resend.client.js";
import { buildPasswordResetEmail } from "./templates/password-reset-email.js";
import { buildVerificationEmail } from "./templates/verification-email.js";

export type SendVerificationEmailInput = {
  to: string;
  recipientName: string;
  otp: string;
};

export type SendPasswordResetEmailInput = {
  to: string;
  recipientName: string;
  resetUrl: string;
};

export interface EmailSender {
  sendVerificationEmail(input: SendVerificationEmailInput): Promise<void>;
  sendPasswordResetEmail(input: SendPasswordResetEmailInput): Promise<void>;
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

  async sendPasswordResetEmail(
    input: SendPasswordResetEmailInput,
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

    const content = buildPasswordResetEmail({
      appName: env.APP_NAME,
      recipientName: input.recipientName,
      resetUrl: input.resetUrl,
      expiryMinutes:
        getPasswordResetTokenExpiresMinutes() ||
        PASSWORD_RESET_TOKEN_EXPIRY_MINUTES,
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
        "password_reset_email_sent",
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
