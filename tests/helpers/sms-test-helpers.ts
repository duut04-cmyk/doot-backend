import { vi } from "vitest";
import type { SmsSender } from "../../src/infrastructure/sms/sms.service.js";

export function createNoopSmsSender(overrides?: Partial<SmsSender>): SmsSender {
  return {
    isEnabled: vi.fn(() => false),
    canSendToCustomer: vi.fn(() => false),
    sendPickupOtpSms: vi.fn(async () => undefined),
    sendDeliveryOtpSms: vi.fn(async () => undefined),
    ...overrides,
  };
}
