import { z } from "zod";

const phoneRegex = /^\+?[1-9]\d{7,14}$/;

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password is too long");

export const signupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name is too short")
    .max(100, "Name is too long"),
  email: z
    .string()
    .trim()
    .email("Invalid email address")
    .transform((value) => value.toLowerCase()),
  phone: z.preprocess(
    (value) => {
      if (typeof value !== "string") {
        return value;
      }
      const trimmed = value.trim();
      return trimmed === "" ? undefined : trimmed;
    },
    z.string().regex(phoneRegex, "Invalid phone number").optional(),
  ),
  password: passwordSchema,
});

export const verifyOtpSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Invalid email address")
    .transform((value) => value.toLowerCase()),
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Verification code must be 6 digits"),
});

export const resendOtpSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Invalid email address")
    .transform((value) => value.toLowerCase()),
});

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Invalid email address")
    .transform((value) => value.toLowerCase()),
  password: z.string().min(1, "Password is required").max(128),
});

export const refreshSessionSchema = z.object({
  refreshToken: z.string().trim().min(1, "Refresh token is required"),
});

export const logoutSchema = z.object({
  refreshToken: z.string().trim().min(1, "Refresh token is required"),
});

export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Invalid email address")
    .transform((value) => value.toLowerCase()),
});

export const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(1, "Reset token is required"),
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const googleLoginSchema = z.object({
  credential: z.string().trim().min(1, "Google credential is required"),
});

export type SignupBody = z.infer<typeof signupSchema>;
export type VerifyOtpBody = z.infer<typeof verifyOtpSchema>;
export type ResendOtpBody = z.infer<typeof resendOtpSchema>;
export type LoginBody = z.infer<typeof loginSchema>;
export type RefreshSessionBody = z.infer<typeof refreshSessionSchema>;
export type LogoutBody = z.infer<typeof logoutSchema>;
export type ForgotPasswordBody = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordBody = z.infer<typeof resetPasswordSchema>;
export type GoogleLoginBody = z.infer<typeof googleLoginSchema>;
