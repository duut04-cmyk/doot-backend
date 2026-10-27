import { describe, expect, it } from "vitest";
import {
  mapVehicleConflictError,
  validateCreateVehicleForm,
  validateUpdateVehicleForm,
} from "../../admin-panel/src/providers/providerVehicleValidation.ts";

describe("admin-panel provider vehicle validation", () => {
  it("builds create payloads with optional limits", () => {
    const result = validateCreateVehicleForm({
      vehicleType: "VAN",
      enabled: true,
      maxWeightKg: "25",
      maxLengthCm: "",
      maxWidthCm: "",
      maxHeightCm: "",
    });
    expect("body" in result).toBe(true);
    if ("body" in result) {
      expect(result.body.vehicleType).toBe("VAN");
      expect(result.body.maxWeightKg).toBe(25);
      expect(result.body.maxLengthCm).toBeNull();
    }
  });

  it("rejects non-positive limit values", () => {
    const result = validateCreateVehicleForm({
      vehicleType: "BIKE",
      enabled: true,
      maxWeightKg: "0",
      maxLengthCm: "",
      maxWidthCm: "",
      maxHeightCm: "",
    });
    expect("fieldErrors" in result).toBe(true);
  });

  it("builds update payloads", () => {
    const result = validateUpdateVehicleForm({
      enabled: false,
      maxWeightKg: "15",
      maxLengthCm: "100",
      maxWidthCm: "50",
      maxHeightCm: "40",
    });
    expect("body" in result).toBe(true);
    if ("body" in result) {
      expect(result.body.enabled).toBe(false);
      expect(result.body.maxLengthCm).toBe(100);
    }
  });

  it("maps duplicate vehicle type conflicts", () => {
    expect(mapVehicleConflictError("Vehicle type conflict")).toMatch(
      /already configured/,
    );
  });
});
