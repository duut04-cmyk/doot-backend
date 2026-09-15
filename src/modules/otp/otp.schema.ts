import { z } from "zod";
import { OTP_CODE_REGEX } from "./otp.constants.js";

export const verifyOtpBodySchema = z.object({
  otp: z.string().regex(OTP_CODE_REGEX, "OTP must be exactly 6 digits."),
});

export type VerifyOtpBody = z.infer<typeof verifyOtpBodySchema>;
