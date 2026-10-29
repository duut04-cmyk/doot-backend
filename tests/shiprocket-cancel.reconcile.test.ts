import { describe, expect, it } from "vitest";
import {
  isShiprocketCancelPreflightIndeterminate,
  isShiprocketOrderNonCancellableAtProvider,
  reconcileShiprocketCancelFromOrderShow,
} from "../src/modules/provider/adapters/shiprocket/shiprocket-cancel.reconcile.js";
import type { ShiprocketOrderShowDetails } from "../src/modules/provider/adapters/shiprocket/shiprocket-order-show.parse.js";

function details(
  overrides: Partial<ShiprocketOrderShowDetails>,
): ShiprocketOrderShowDetails {
  return {
    orderId: "1",
    channelOrderId: null,
    status: "NEW",
    statusCode: null,
    subStatus: null,
    shipmentId: null,
    awbCode: null,
    courierName: null,
    courierId: null,
    shipmentStatus: null,
    estimatedDelivery: null,
    deliveredDate: null,
    ...overrides,
  };
}

describe("Shiprocket cancel reconciliation", () => {
  it("confirms cancelled provider status", () => {
    expect(
      reconcileShiprocketCancelFromOrderShow(details({ status: "CANCELLED" })),
    ).toBe("CONFIRMED_CANCELLED");
  });

  it("treats in-transit as still active after cancel", () => {
    expect(
      reconcileShiprocketCancelFromOrderShow(details({ shipmentStatus: "IN TRANSIT" })),
    ).toBe("STILL_ACTIVE");
  });

  it("treats unchanged NEW as still active after cancel POST", () => {
    expect(reconcileShiprocketCancelFromOrderShow(details({ status: "NEW" }))).toBe(
      "STILL_ACTIVE",
    );
  });

  it("flags indeterminate preflight when AWB exists with UNKNOWN status", () => {
    expect(
      isShiprocketCancelPreflightIndeterminate(
        details({ status: "UNKNOWN", awbCode: "SR123456789IN" }),
      ),
    ).toBe(true);
    expect(
      isShiprocketCancelPreflightIndeterminate(
        details({ status: "NEW", awbCode: "SR123456789IN" }),
      ),
    ).toBe(false);
  });

  it("blocks pre-cancel only for in-motion states", () => {
    expect(isShiprocketOrderNonCancellableAtProvider(details({ status: "NEW" }))).toBe(
      false,
    );
    expect(
      isShiprocketOrderNonCancellableAtProvider(
        details({ shipmentStatus: "OUT FOR DELIVERY" }),
      ),
    ).toBe(true);
  });
});
