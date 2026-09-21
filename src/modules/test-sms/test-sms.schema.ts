import { z } from "zod";

export const SMS_TEST_TYPES = ["ACCOUNT_OTP", "PICKUP_OTP", "DELIVERY_OTP"] as const;

export type SmsTestType = (typeof SMS_TEST_TYPES)[number];

export const testSmsBodySchema = z.object({
  phone: z.string().trim().min(1, "Phone number is required."),
  type: z.enum(SMS_TEST_TYPES, "Invalid SMS type."),
});
