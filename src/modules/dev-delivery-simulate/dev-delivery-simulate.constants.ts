import type { NormalizedDriver } from "../provider/contracts/common.js";

/** Fixed OTP for dev simulation responses (pickup/delivery issue steps). */
export const DEV_SIMULATE_OTP = "123456";

export const DEV_MOCK_DRIVER: NormalizedDriver = {
  providerDriverId: "MOCK-DRIVER-DEV",
  name: "Aman Singh",
  phone: { countryCode: "+91", number: "9876543210" },
  photoUrl: null,
  providerRating: 4.8,
  vehicleType: "BIKE",
  vehicleNumber: "PB10AB1234",
  assignedAt: new Date().toISOString(),
};

export const DEV_SIMULATE_STEPS = [
  "ASSIGN_DRIVER",
  "ISSUE_PICKUP_OTP",
  "CONFIRM_PICKUP",
  "START_TRANSIT",
  "ISSUE_DELIVERY_OTP",
  "CONFIRM_DELIVERY",
] as const;

export type DevSimulateStep = (typeof DEV_SIMULATE_STEPS)[number];
