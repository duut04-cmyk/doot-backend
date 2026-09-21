import type { DeliveryStatus, OAuthProvider, UserStatus } from "@prisma/client";
import type { PhoneResponse } from "../../core/phone/phone.types.js";

export type CustomerStatsDto = {
  totalDeliveries: number;
  activeDeliveries: number;
  completedDeliveries: number;
  failedDeliveries: number;
  cancelledDeliveries: number;
  lastDeliveryAt: string | null;
};

export type CustomerSummaryDto = {
  id: string;
  name: string;
  email: string;
  phone: PhoneResponse | null;
  emailVerified: boolean;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
  oauthProviders: OAuthProvider[];
  stats: Pick<CustomerStatsDto, "totalDeliveries" | "lastDeliveryAt">;
};

export type CustomerDetailDto = CustomerSummaryDto & {
  stats: CustomerStatsDto;
  averageRating: number | null;
  recentDeliveries: CustomerDeliverySummaryDto[];
};

export type CustomerDeliverySummaryDto = {
  id: string;
  reference: string;
  status: DeliveryStatus;
  pickup: { addressText: string; contactName: string };
  drop: { addressText: string; contactName: string };
  createdAt: string;
  updatedAt: string;
};

export type PaginatedCustomersDto = {
  items: CustomerSummaryDto[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};
