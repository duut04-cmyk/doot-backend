export type DeliveryContactLegs = {
  pickup: {
    contactPhoneCountryCode: string | null;
    contactPhoneNumber: string | null;
  };
  drop: {
    contactPhoneCountryCode: string | null;
    contactPhoneNumber: string | null;
  };
};

export type StoredUserPhone = {
  phoneCountryCode?: string | null;
  phoneNumber?: string | null;
};

function isPresent(value: string | null | undefined): value is string {
  return Boolean(value?.trim());
}

/** Pickup contact phone, then drop — used when payer User phone is unavailable. */
export function deliveryContactPhoneFallback(
  delivery: DeliveryContactLegs,
): string | undefined {
  for (const leg of [delivery.pickup, delivery.drop]) {
    if (isPresent(leg.contactPhoneCountryCode) && isPresent(leg.contactPhoneNumber)) {
      return `${leg.contactPhoneCountryCode}${leg.contactPhoneNumber}`;
    }
  }
  return undefined;
}

/** Payer User phone first, then delivery contact fallback. */
export function resolveGatewayCustomerPhone(
  user: StoredUserPhone | null | undefined,
  phoneFallback?: string,
): string | undefined {
  if (!user) {
    return phoneFallback;
  }
  if (isPresent(user.phoneCountryCode) && isPresent(user.phoneNumber)) {
    return `${user.phoneCountryCode}${user.phoneNumber}`;
  }
  if (isPresent(user.phoneNumber)) {
    return user.phoneNumber;
  }
  return phoneFallback;
}

/** Digits-only phone for Cashfree `customer_details.customer_phone` (min 10 digits). */
export function formatCashfreeCustomerPhone(
  phone: string | null | undefined,
): string | undefined {
  if (!isPresent(phone)) {
    return undefined;
  }
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 ? digits : undefined;
}
