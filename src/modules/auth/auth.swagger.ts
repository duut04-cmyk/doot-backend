import { phoneResponseSchema } from "../../core/phone/phone.swagger.js";

const successMessageSchema = {
  type: "object",
  properties: {
    success: { type: "boolean", example: true },
    message: { type: "string" },
  },
  required: ["success", "message"],
} as const;

const errorSchema = {
  type: "object",
  properties: {
    success: { type: "boolean", example: false },
    error: {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" },
      },
      required: ["code", "message"],
    },
    requestId: { type: "string" },
  },
  required: ["success", "error", "requestId"],
} as const;

const publicUserSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    name: { type: "string" },
    email: { type: "string", format: "email" },
    phone: phoneResponseSchema,
    emailVerified: { type: "boolean" },
    role: { type: "string", enum: ["CUSTOMER", "ADMIN"] },
  },
  required: ["id", "name", "email", "phone", "emailVerified", "role"],
} as const;

export const authSwaggerComponents = {
  AuthSuccessMessage: successMessageSchema,
  AuthError: errorSchema,
  SignupRequest: {
    type: "object",
    required: ["name", "email", "password"],
    properties: {
      name: { type: "string", example: "John Doe", minLength: 2, maxLength: 100 },
      email: { type: "string", format: "email", example: "john@example.com" },
      phoneCountryCode: {
        type: "string",
        example: "+91",
        description: "Optional international dialing code (required with phoneNumber)",
      },
      phoneNumber: {
        type: "string",
        example: "9876543210",
        description: "Optional national number (required with phoneCountryCode)",
      },
      password: {
        type: "string",
        format: "password",
        minLength: 8,
        maxLength: 128,
        example: "StrongPassword123!",
      },
    },
  },
  VerifyOtpRequest: {
    type: "object",
    required: ["email", "otp"],
    properties: {
      email: { type: "string", format: "email", example: "john@example.com" },
      otp: {
        type: "string",
        pattern: "^\\d{6}$",
        example: "123456",
        description: "6-digit verification code from email",
      },
    },
  },
  ResendOtpRequest: {
    type: "object",
    required: ["email"],
    properties: {
      email: { type: "string", format: "email", example: "john@example.com" },
    },
  },
  LoginRequest: {
    type: "object",
    required: ["email", "password"],
    properties: {
      email: { type: "string", format: "email", example: "john@example.com" },
      password: {
        type: "string",
        format: "password",
        example: "StrongPassword123!",
      },
    },
  },
  RefreshRequest: {
    type: "object",
    required: ["refreshToken"],
    properties: {
      refreshToken: { type: "string" },
    },
  },
  LogoutRequest: {
    type: "object",
    required: ["refreshToken"],
    properties: {
      refreshToken: { type: "string" },
    },
  },
  ForgotPasswordRequest: {
    type: "object",
    required: ["email"],
    properties: {
      email: { type: "string", format: "email", example: "john@example.com" },
    },
  },
  VerifyPasswordResetOtpRequest: {
    type: "object",
    required: ["email", "otp"],
    properties: {
      email: { type: "string", format: "email", example: "john@example.com" },
      otp: {
        type: "string",
        pattern: "^\\d{6}$",
        example: "123456",
        description: "6-digit password reset verification code",
      },
    },
  },
  PasswordResetVerifyResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      data: {
        type: "object",
        properties: {
          resetToken: {
            type: "string",
            example: "fake-reset-verification-token-placeholder",
            description:
              "Short-lived opaque token authorizing password reset only",
          },
          expiresAt: {
            type: "string",
            format: "date-time",
            example: "2026-09-15T10:10:00.000Z",
          },
        },
      },
    },
  },
  ResendPasswordResetOtpRequest: {
    type: "object",
    required: ["email"],
    properties: {
      email: { type: "string", format: "email", example: "john@example.com" },
    },
  },
  ResetPasswordRequest: {
    type: "object",
    required: ["resetToken", "newPassword"],
    properties: {
      resetToken: {
        type: "string",
        description:
          "Opaque verification token returned by verify-password-reset-otp",
        example: "fake-reset-verification-token-placeholder",
      },
      newPassword: {
        type: "string",
        format: "password",
        minLength: 8,
        maxLength: 128,
        example: "NewStrongPassword123!",
      },
    },
  },
  GoogleLoginRequest: {
    type: "object",
    required: ["credential"],
    properties: {
      credential: {
        type: "string",
        description: "Google ID token from Google Sign-In",
      },
    },
  },
  LoginResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      message: { type: "string", example: "Login successful." },
      data: {
        type: "object",
        properties: {
          accessToken: { type: "string" },
          refreshToken: { type: "string" },
          tokenType: { type: "string", example: "Bearer" },
          expiresIn: { type: "integer", example: 900 },
          user: publicUserSchema,
        },
        required: [
          "accessToken",
          "refreshToken",
          "tokenType",
          "expiresIn",
          "user",
        ],
      },
    },
    required: ["success", "message", "data"],
  },
  RefreshResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      message: { type: "string", example: "Token refreshed." },
      data: {
        type: "object",
        properties: {
          accessToken: { type: "string" },
          refreshToken: { type: "string" },
          tokenType: { type: "string", example: "Bearer" },
          expiresIn: { type: "integer", example: 900 },
        },
        required: ["accessToken", "refreshToken", "tokenType", "expiresIn"],
      },
    },
    required: ["success", "message", "data"],
  },
  MeResponse: {
    type: "object",
    properties: {
      success: { type: "boolean", example: true },
      data: {
        type: "object",
        properties: {
          user: {
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              name: { type: "string" },
              email: { type: "string", format: "email" },
              phone: phoneResponseSchema,
              emailVerified: { type: "boolean" },
              status: {
                type: "string",
                enum: ["ACTIVE", "SUSPENDED", "DELETED"],
              },
              role: {
                type: "string",
                enum: ["CUSTOMER", "ADMIN"],
              },
            },
            required: [
              "id",
              "name",
              "email",
              "phone",
              "emailVerified",
              "status",
              "role",
            ],
          },
        },
        required: ["user"],
      },
    },
    required: ["success", "data"],
  },
} as const;

export const authSwaggerPaths = {
  "/api/v1/auth/signup": {
    post: {
      tags: ["Auth"],
      summary: "Sign up with email and password",
      description:
        "Creates an unverified account (or refreshes OTP for an existing unverified account) and emails a verification code. The OTP is never returned in the response.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/SignupRequest" },
          },
        },
      },
      responses: {
        201: {
          description: "Account created / verification email sent",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthSuccessMessage" },
            },
          },
        },
        400: {
          description: "Validation error",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthError" },
            },
          },
        },
        409: {
          description: "Email already registered and verified",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthError" },
            },
          },
        },
        503: {
          description: "Email delivery failed",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthError" },
            },
          },
        },
      },
    },
  },
  "/api/v1/auth/verify-otp": {
    post: {
      tags: ["Auth"],
      summary: "Verify email with OTP",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/VerifyOtpRequest" },
          },
        },
      },
      responses: {
        200: {
          description: "Email verified",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthSuccessMessage" },
            },
          },
        },
        400: {
          description: "Invalid/expired OTP or validation error",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthError" },
            },
          },
        },
      },
    },
  },
  "/api/v1/auth/resend-otp": {
    post: {
      tags: ["Auth"],
      summary: "Resend email verification OTP",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ResendOtpRequest" },
          },
        },
      },
      responses: {
        200: {
          description: "Resend accepted",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthSuccessMessage" },
            },
          },
        },
        429: {
          description: "Resend cooldown active",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthError" },
            },
          },
        },
        503: {
          description: "Email delivery failed",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthError" },
            },
          },
        },
      },
    },
  },
  "/api/v1/auth/login": {
    post: {
      tags: ["Auth"],
      summary: "Login with email and password",
      description:
        "Issues a short-lived JWT access token and an opaque refresh token. Requires a verified ACTIVE account.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/LoginRequest" },
          },
        },
      },
      responses: {
        200: {
          description: "Login successful",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/LoginResponse" },
            },
          },
        },
        401: {
          description: "Invalid credentials",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthError" },
            },
          },
        },
        403: {
          description: "Email not verified or account suspended/deleted",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthError" },
            },
          },
        },
      },
    },
  },
  "/api/v1/auth/refresh": {
    post: {
      tags: ["Auth"],
      summary: "Rotate refresh token and issue new access token",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/RefreshRequest" },
          },
        },
      },
      responses: {
        200: {
          description: "Token pair rotated",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RefreshResponse" },
            },
          },
        },
        401: {
          description: "Invalid or expired refresh token",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthError" },
            },
          },
        },
      },
    },
  },
  "/api/v1/auth/logout": {
    post: {
      tags: ["Auth"],
      summary: "Revoke a refresh token",
      description: "Idempotent. Does not require an access token.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/LogoutRequest" },
          },
        },
      },
      responses: {
        200: {
          description: "Logged out",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthSuccessMessage" },
            },
          },
        },
      },
    },
  },
  "/api/v1/auth/me": {
    get: {
      tags: ["Auth"],
      summary: "Get current authenticated user",
      security: [{ bearerAuth: [] }],
      responses: {
        200: {
          description: "Current user profile",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/MeResponse" },
            },
          },
        },
        401: {
          description: "Missing/invalid access token",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthError" },
            },
          },
        },
        403: {
          description: "Account suspended or deleted",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthError" },
            },
          },
        },
      },
    },
  },
  "/api/v1/auth/forgot-password": {
    post: {
      tags: ["Auth"],
      summary: "Request a password reset verification code",
      description:
        "Always returns a generic success message to avoid account enumeration. Eligible ACTIVE users with a local password receive a 6-digit OTP by email.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ForgotPasswordRequest" },
          },
        },
      },
      responses: {
        200: {
          description: "Generic acknowledgment",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthSuccessMessage" },
              example: {
                success: true,
                message:
                  "If an account exists for this email, a verification code has been sent.",
              },
            },
          },
        },
        400: {
          description: "Validation error",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthError" },
            },
          },
        },
        503: {
          description: "Email delivery failed for an eligible account",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthError" },
            },
          },
        },
      },
    },
  },
  "/api/v1/auth/verify-password-reset-otp": {
    post: {
      tags: ["Auth"],
      summary: "Verify password reset OTP",
      description:
        "Validates the 6-digit email OTP and returns a short-lived opaque resetToken for the final password change step.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/VerifyPasswordResetOtpRequest",
            },
          },
        },
      },
      responses: {
        200: {
          description: "OTP verified; reset token issued",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/PasswordResetVerifyResponse",
              },
            },
          },
        },
        400: {
          description: "Invalid, expired, or exhausted OTP",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthError" },
            },
          },
        },
      },
    },
  },
  "/api/v1/auth/resend-password-reset-otp": {
    post: {
      tags: ["Auth"],
      summary: "Resend password reset OTP",
      description:
        "Enumeration-safe resend with cooldown. Invalidates the previous unused OTP when a new one is issued.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/ResendPasswordResetOtpRequest",
            },
          },
        },
      },
      responses: {
        200: {
          description: "Generic acknowledgment",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthSuccessMessage" },
            },
          },
        },
        429: {
          description: "Resend cooldown active",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthError" },
            },
          },
        },
      },
    },
  },
  "/api/v1/auth/reset-password": {
    post: {
      tags: ["Auth"],
      summary: "Reset password with verification token",
      description:
        "Validates the opaque resetToken from verify-password-reset-otp, updates the bcrypt password hash, marks the token used, and revokes all refresh sessions.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ResetPasswordRequest" },
          },
        },
      },
      responses: {
        200: {
          description: "Password reset successful",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthSuccessMessage" },
              example: {
                success: true,
                message: "Password reset successfully. Please log in again.",
              },
            },
          },
        },
        400: {
          description: "Validation error or invalid/expired reset token",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthError" },
            },
          },
        },
      },
    },
  },
  "/api/v1/auth/google": {
    post: {
      tags: ["Auth"],
      summary: "Authenticate with Google ID token",
      description:
        "Verifies a Google ID token, finds or creates the linked Dutt user, and returns the same Dutt access/refresh session as password login.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/GoogleLoginRequest" },
          },
        },
      },
      responses: {
        200: {
          description: "Google authentication successful",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/LoginResponse" },
            },
          },
        },
        400: {
          description: "Validation error",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthError" },
            },
          },
        },
        401: {
          description: "Invalid Google credential",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthError" },
            },
          },
        },
        403: {
          description: "Account suspended or deleted",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthError" },
            },
          },
        },
        503: {
          description: "Google authentication is not configured",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AuthError" },
            },
          },
        },
      },
    },
  },
} as const;
