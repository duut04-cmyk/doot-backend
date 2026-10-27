import { SHIPROCKET_HYPERLOCAL_SERVICEABILITY_PATH } from "./shiprocket.constants.js";

export type HyperlocalServiceabilityQueryInput = {
  pickupPostcode: string;
  deliveryPostcode: string;
  latFrom: number;
  longFrom: number;
  latTo: number;
  longTo: number;
  weightKg: number;
  cod?: string | number;
};

export function buildHyperlocalServiceabilityPath(
  input: HyperlocalServiceabilityQueryInput,
): string {
  const query = new URLSearchParams({
    pickup_postcode: input.pickupPostcode,
    delivery_postcode: input.deliveryPostcode,
    is_new_hyperlocal: "1",
    lat_from: String(input.latFrom),
    long_from: String(input.longFrom),
    lat_to: String(input.latTo),
    long_to: String(input.longTo),
    cod: String(input.cod ?? "0"),
    weight: String(input.weightKg),
  });

  return `${SHIPROCKET_HYPERLOCAL_SERVICEABILITY_PATH}?${query.toString()}`;
}
