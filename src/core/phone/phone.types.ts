/** Canonical phone representation with derived E.164. */
export type PhoneNumberValue = {
  countryCode: string;
  number: string;
  e164: string;
};

/** Persisted phone components (no derived e164 column). */
export type StoredPhone = {
  countryCode: string;
  number: string;
};

/** API response shape for optional phone fields. */
export type PhoneResponse = PhoneNumberValue;
