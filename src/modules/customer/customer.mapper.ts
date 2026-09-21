import type {
  Delivery,
  DeliveryDrop,
  DeliveryPickup,
  OAuthProvider,
  User,
} from "@prisma/client";
import { toPhoneResponse } from "../../core/phone/phone.js";
import type {
  CustomerDeliverySummaryDto,
  CustomerDetailDto,
  CustomerStatsDto,
  CustomerSummaryDto,
} from "./customer.types.js";

type CustomerUser = Pick<
  User,
  | "id"
  | "name"
  | "email"
  | "phoneCountryCode"
  | "phoneNumber"
  | "emailVerified"
  | "status"
  | "createdAt"
  | "updatedAt"
>;

type DeliveryWithLocations = Delivery & {
  pickup: DeliveryPickup | null;
  drop: DeliveryDrop | null;
};

export function toCustomerDeliverySummaryDto(
  delivery: DeliveryWithLocations,
): CustomerDeliverySummaryDto | null {
  if (!delivery.pickup || !delivery.drop) {
    return null;
  }

  return {
    id: delivery.id,
    reference: delivery.reference,
    status: delivery.status,
    pickup: {
      addressText: delivery.pickup.addressText,
      contactName: delivery.pickup.contactName,
    },
    drop: {
      addressText: delivery.drop.addressText,
      contactName: delivery.drop.contactName,
    },
    createdAt: delivery.createdAt.toISOString(),
    updatedAt: delivery.updatedAt.toISOString(),
  };
}

export function toCustomerSummaryDto(input: {
  user: CustomerUser;
  oauthProviders: OAuthProvider[];
  stats: Pick<CustomerStatsDto, "totalDeliveries" | "lastDeliveryAt">;
}): CustomerSummaryDto {
  return {
    id: input.user.id,
    name: input.user.name,
    email: input.user.email,
    phone: toPhoneResponse(input.user.phoneCountryCode, input.user.phoneNumber),
    emailVerified: input.user.emailVerified,
    status: input.user.status,
    createdAt: input.user.createdAt.toISOString(),
    updatedAt: input.user.updatedAt.toISOString(),
    oauthProviders: input.oauthProviders,
    stats: input.stats,
  };
}

export function toCustomerDetailDto(input: {
  user: CustomerUser;
  oauthProviders: OAuthProvider[];
  stats: CustomerStatsDto;
  averageRating: number | null;
  recentDeliveries: CustomerDeliverySummaryDto[];
}): CustomerDetailDto {
  return {
    ...toCustomerSummaryDto({
      user: input.user,
      oauthProviders: input.oauthProviders,
      stats: {
        totalDeliveries: input.stats.totalDeliveries,
        lastDeliveryAt: input.stats.lastDeliveryAt,
      },
    }),
    stats: input.stats,
    averageRating: input.averageRating,
    recentDeliveries: input.recentDeliveries,
  };
}
