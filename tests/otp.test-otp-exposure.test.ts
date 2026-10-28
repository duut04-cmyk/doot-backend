/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryLifecycleService } from "../src/modules/delivery/delivery-lifecycle.service.js";
import { InMemoryDeliveryRepository } from "./helpers/in-memory-delivery-repository.js";
import { InMemoryDriverRepository } from "./helpers/in-memory-driver-repository.js";
import { InMemoryOtpRepository } from "./helpers/in-memory-otp-repository.js";
import { createOtpTestSmsSender } from "./helpers/sms-test-helpers.js";
import {
  seedCustomerUser,
  seedDriverAssignedDelivery,
} from "./helpers/otp-test-helpers.js";
import { InMemoryAuthRepository } from "./helpers/in-memory-auth-repository.js";
import { InMemoryBookingRepository } from "./helpers/in-memory-booking-repository.js";
import { InMemoryOrchestrationRepository } from "./helpers/in-memory-orchestration-repository.js";
import { InMemoryProviderRepository } from "./helpers/in-memory-provider-repository.js";

const customerId = "11111111-1111-4111-8111-111111111111";

describe("OtpService _testOtp exposure", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.doUnmock("../src/config/env.js");
    vi.unstubAllEnvs();
  });

  async function generatePickupWithMockedEnv(envMock: Record<string, unknown>) {
    vi.doMock("../src/config/env.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/config/env.js")>();
      return {
        ...actual,
        env: {
          ...actual.env,
          ...envMock,
        },
      };
    });

    const { OtpService: OtpServiceFresh } =
      await import("../src/modules/otp/otp.service.js");

    const deliveryRepo = new InMemoryDeliveryRepository();
    const otpRepo = new InMemoryOtpRepository();
    const authRepo = new InMemoryAuthRepository();
    seedCustomerUser(authRepo, { id: customerId });
    const bookingRepo = new InMemoryBookingRepository();
    const orchestrationRepo = new InMemoryOrchestrationRepository();
    const providerRepo = new InMemoryProviderRepository();
    const driverRepo = new InMemoryDriverRepository();

    const seeded = await seedDriverAssignedDelivery({
      deliveryRepo,
      orchestrationRepo,
      providerRepo,
      bookingRepo,
      customerId,
    });

    const service = new OtpServiceFresh(
      deliveryRepo,
      otpRepo,
      new DeliveryLifecycleService(deliveryRepo),
      createOtpTestSmsSender(),
      driverRepo,
    );

    const result = await service.generatePickupOtp({
      deliveryId: seeded.deliveryId,
      userId: customerId,
      role: "CUSTOMER",
      requestId: "req-exposure-1",
    });

    return result;
  }

  it("never includes _testOtp when parsed NODE_ENV is production", async () => {
    const result = await generatePickupWithMockedEnv({
      NODE_ENV: "production",
      EXPOSE_OTP_FOR_CERTIFICATION: true,
    });
    expect(result.data._testOtp).toBeUndefined();
  });

  it("does not expose _testOtp when raw process.env.NODE_ENV is test but parsed env is development", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const result = await generatePickupWithMockedEnv({
      NODE_ENV: "development",
      EXPOSE_OTP_FOR_CERTIFICATION: false,
    });
    expect(result.data._testOtp).toBeUndefined();
  });

  it("includes _testOtp in development only when EXPOSE_OTP_FOR_CERTIFICATION is true", async () => {
    const result = await generatePickupWithMockedEnv({
      NODE_ENV: "development",
      EXPOSE_OTP_FOR_CERTIFICATION: true,
    });
    expect(result.data._testOtp).toMatch(/^\d{6}$/);
  });
});
