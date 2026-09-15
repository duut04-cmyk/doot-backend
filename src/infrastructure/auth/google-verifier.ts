import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { env } from "../../config/env.js";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import { logger } from "../../config/logger.js";

export type VerifiedGoogleIdentity = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
};

export interface GoogleCredentialVerifier {
  verifyIdToken(credential: string): Promise<VerifiedGoogleIdentity>;
}

const GOOGLE_ISSUERS = new Set([
  "accounts.google.com",
  "https://accounts.google.com",
]);

export class GoogleIdTokenVerifier implements GoogleCredentialVerifier {
  private readonly client: OAuth2Client;

  constructor(private readonly audience = env.GOOGLE_CLIENT_ID) {
    this.client = new OAuth2Client(audience);
  }

  async verifyIdToken(credential: string): Promise<VerifiedGoogleIdentity> {
    if (!this.audience) {
      logger.error("google_authentication_failed: missing GOOGLE_CLIENT_ID");
      throw new AppError("Google authentication is not configured", {
        statusCode: 503,
        code: ErrorCodes.GOOGLE_AUTHENTICATION_FAILED,
      });
    }

    try {
      const ticket = await this.client.verifyIdToken({
        idToken: credential,
        audience: this.audience,
      });
      const payload = ticket.getPayload();
      return this.normalizePayload(payload);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.info(
        {
          err:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : { message: "unknown google verification error" },
        },
        "google_authentication_failed",
      );

      throw new AppError("Invalid Google credential.", {
        statusCode: 401,
        code: ErrorCodes.INVALID_GOOGLE_CREDENTIAL,
        cause: error,
      });
    }
  }

  private normalizePayload(
    payload: TokenPayload | undefined,
  ): VerifiedGoogleIdentity {
    if (!payload) {
      throw new AppError("Invalid Google credential.", {
        statusCode: 401,
        code: ErrorCodes.INVALID_GOOGLE_CREDENTIAL,
      });
    }

    if (!payload.iss || !GOOGLE_ISSUERS.has(payload.iss)) {
      throw new AppError("Invalid Google credential.", {
        statusCode: 401,
        code: ErrorCodes.INVALID_GOOGLE_CREDENTIAL,
      });
    }

    if (!payload.sub) {
      throw new AppError("Invalid Google credential.", {
        statusCode: 401,
        code: ErrorCodes.INVALID_GOOGLE_CREDENTIAL,
      });
    }

    if (!payload.email) {
      throw new AppError("Invalid Google credential.", {
        statusCode: 401,
        code: ErrorCodes.INVALID_GOOGLE_CREDENTIAL,
      });
    }

    if (payload.email_verified !== true) {
      throw new AppError("Google email is not verified.", {
        statusCode: 401,
        code: ErrorCodes.INVALID_GOOGLE_CREDENTIAL,
      });
    }

    const name =
      payload.name?.trim() ||
      [payload.given_name, payload.family_name]
        .filter((part): part is string => Boolean(part?.trim()))
        .join(" ")
        .trim() ||
      null;

    return {
      sub: payload.sub,
      email: payload.email,
      emailVerified: true,
      name,
      picture: payload.picture ?? null,
    };
  }
}

export const googleIdTokenVerifier = new GoogleIdTokenVerifier();
