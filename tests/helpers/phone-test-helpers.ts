import { toE164 } from "../../src/core/phone/phone.js";

/** Nested phone for API request bodies (before schema parse). */
export function phoneRequest(countryCode = "+91", number = "9876543210") {
  return { countryCode, number };
}

/** Parsed phone value for CreateDeliveryBody and DeliveryDetailDto. */
export function phoneValue(countryCode = "+91", number = "9876543210") {
  return { countryCode, number, e164: toE164(countryCode, number) };
}

/** Split storage fields for repository persist inputs. */
export function storedPhone(countryCode = "+91", number = "9876543210") {
  return { contactPhoneCountryCode: countryCode, contactPhoneNumber: number };
}

export function storedDriverPhone(countryCode = "+91", number = "9900000001") {
  return { driverPhoneCountryCode: countryCode, driverPhoneNumber: number };
}

export function storedUserPhone(countryCode = "+91", number = "9876543210") {
  return { phoneCountryCode: countryCode, phoneNumber: number };
}
