import { vi } from "vitest";
import type { EmailSender } from "../../src/infrastructure/email/email.service.js";

export function createNoopEmailSender(
  overrides?: Partial<EmailSender>,
): EmailSender {
  return {
    sendVerificationEmail: vi.fn(async () => undefined),
    sendPasswordResetOtpEmail: vi.fn(async () => undefined),
    sendPickupOtpEmail: vi.fn(async () => undefined),
    sendDeliveryOtpEmail: vi.fn(async () => undefined),
    ...overrides,
  };
}
