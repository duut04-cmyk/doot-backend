import { describe, expect, it } from "vitest";
import {
  mapServiceConflictError,
  validateCreateServiceForm,
  validateServiceCode,
  validateUpdateServiceForm,
} from "../../admin-panel/src/providers/providerServiceValidation.ts";

describe("admin-panel provider service validation", () => {
  it("normalizes and validates service codes", () => {
    expect(validateServiceCode(" express_1 ")).toBeNull();
    expect(validateServiceCode("bad code")).toMatch(/uppercase/);
  });

  it("builds create payloads from valid form input", () => {
    const result = validateCreateServiceForm({
      code: "same_day",
      name: " Same day ",
      serviceType: "SAME_DAY",
      description: "",
      priority: "50",
    });
    expect("body" in result).toBe(true);
    if ("body" in result) {
      expect(result.body.code).toBe("SAME_DAY");
      expect(result.body.name).toBe("Same day");
      expect(result.body.priority).toBe(50);
      expect(result.body.description).toBeNull();
    }
  });

  it("rejects invalid create form fields", () => {
    const result = validateCreateServiceForm({
      code: "",
      name: "",
      serviceType: "INVALID",
      description: "",
      priority: "abc",
    });
    expect("fieldErrors" in result).toBe(true);
  });

  it("builds update payloads including enabled flag", () => {
    const result = validateUpdateServiceForm({
      name: "Updated",
      serviceType: "BIKE",
      description: "Note",
      priority: "10",
      enabled: false,
    });
    expect("body" in result).toBe(true);
    if ("body" in result) {
      expect(result.body.enabled).toBe(false);
    }
  });

  it("maps duplicate service conflicts to a friendly message", () => {
    expect(mapServiceConflictError("Service already exists for provider")).toMatch(
      /code already exists/,
    );
  });
});
