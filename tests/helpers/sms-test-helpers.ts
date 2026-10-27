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

/** SMS enabled with successful noop sends — use for OtpService generation tests. */
export function createOtpTestSmsSender(overrides?: Partial<SmsSender>): SmsSender {
  return createNoopSmsSender({
    isEnabled: vi.fn(() => true),
    canSendToCustomer: vi.fn(() => true),
    sendPickupOtpSms: vi.fn(async () => undefined),
    sendDeliveryOtpSms: vi.fn(async () => undefined),
    ...overrides,
  });
}
