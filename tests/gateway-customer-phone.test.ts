import { describe, expect, it } from "vitest";
import {
  deliveryContactPhoneFallback,
  formatCashfreeCustomerPhone,
  resolveGatewayCustomerPhone,
} from "../src/modules/payment/gateway-customer-phone.js";

const pickup888 = {
  contactPhoneCountryCode: "+91",
  contactPhoneNumber: "8888888888",
};

const drop777 = {
  contactPhoneCountryCode: "+91",
  contactPhoneNumber: "7777777777",
};

const deliveryContacts = {
  pickup: pickup888,
  drop: drop777,
};

function cashfreePhoneFromFlow(input: {
  user: { phoneCountryCode?: string | null; phoneNumber?: string | null } | null;
  delivery?: typeof deliveryContacts;
}): string | undefined {
  const fallback = input.delivery
    ? deliveryContactPhoneFallback(input.delivery)
    : undefined;
  const resolved = resolveGatewayCustomerPhone(input.user, fallback);
  return formatCashfreeCustomerPhone(resolved);
}

describe("gateway customer phone priority (payer → pickup → drop)", () => {
  it("uses payer User phone when pickup and drop differ", () => {
    expect(
      cashfreePhoneFromFlow({
        user: { phoneCountryCode: "+91", phoneNumber: "9999999999" },
        delivery: deliveryContacts,
      }),
    ).toBe("919999999999");
  });

  it("falls back to pickup when payer phone is missing", () => {
    expect(
      cashfreePhoneFromFlow({
        user: { phoneCountryCode: null, phoneNumber: null },
        delivery: deliveryContacts,
      }),
    ).toBe("918888888888");
  });

  it("falls back to drop when payer and pickup phones are missing", () => {
    expect(
      cashfreePhoneFromFlow({
        user: null,
        delivery: {
          pickup: { contactPhoneCountryCode: null, contactPhoneNumber: null },
          drop: drop777,
        },
      }),
    ).toBe("917777777777");
  });

  it("treats blank payer phone as missing and uses pickup", () => {
    expect(
      resolveGatewayCustomerPhone(
        { phoneCountryCode: "+91", phoneNumber: "   " },
        deliveryContactPhoneFallback(deliveryContacts),
      ),
    ).toBe("+918888888888");
  });
});
