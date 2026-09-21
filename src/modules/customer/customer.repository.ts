import type { DeliveryStatus, OAuthProvider, Prisma, UserStatus } from "@prisma/client";
import { getPrismaClient } from "../../config/database.js";
import {
  ACTIVE_DELIVERY_STATUSES,
  RECENT_DELIVERIES_LIMIT,
} from "./customer.constants.js";
import type { CustomerStatsDto } from "./customer.types.js";

export type CustomerDbClient =
  Prisma.TransactionClient | ReturnType<typeof getPrismaClient>;

const customerSelect = {
  id: true,
  name: true,
  email: true,
  phoneCountryCode: true,
  phoneNumber: true,
  emailVerified: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type CustomerRecord = Prisma.UserGetPayload<{ select: typeof customerSelect }>;

export type CustomerListFilters = {
  search?: string;
  status?: UserStatus;
  emailVerified?: boolean;
};

function buildCustomerWhere(filters: CustomerListFilters): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {
    role: "CUSTOMER",
  };

  if (filters.status) {
    where.status = filters.status;
  } else {
    where.status = { not: "DELETED" };
  }

  if (filters.emailVerified !== undefined) {
    where.emailVerified = filters.emailVerified;
  }

  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: "insensitive" } },
      { email: { contains: filters.search, mode: "insensitive" } },
      { phoneNumber: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  return where;
}

export interface ICustomerRepository {
  listCustomers(
    page: number,
    limit: number,
    filters: CustomerListFilters,
  ): Promise<{ items: CustomerRecord[]; total: number }>;
  findCustomerById(customerId: string): Promise<CustomerRecord | null>;
  updateCustomerStatus(customerId: string, status: UserStatus): Promise<CustomerRecord>;
  getOAuthProviders(customerId: string): Promise<OAuthProvider[]>;
  getDeliveryStats(customerId: string): Promise<CustomerStatsDto>;
  getDeliveryStatsForCustomers(
    customerIds: string[],
  ): Promise<Map<string, Pick<CustomerStatsDto, "totalDeliveries" | "lastDeliveryAt">>>;
  getAverageRating(customerId: string): Promise<number | null>;
  listRecentDeliveries(customerId: string): Promise<
    Array<
      Prisma.DeliveryGetPayload<{
        include: { pickup: true; drop: true };
      }>
    >
  >;
}

export class CustomerRepository implements ICustomerRepository {
  async listCustomers(
    page: number,
    limit: number,
    filters: CustomerListFilters,
  ): Promise<{ items: CustomerRecord[]; total: number }> {
    const where = buildCustomerWhere(filters);
    const [total, items] = await Promise.all([
      getPrismaClient().user.count({ where }),
      getPrismaClient().user.findMany({
        where,
        select: customerSelect,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { items, total };
  }

  async findCustomerById(customerId: string): Promise<CustomerRecord | null> {
    return getPrismaClient().user.findFirst({
      where: {
        id: customerId,
        role: "CUSTOMER",
        status: { not: "DELETED" },
      },
      select: customerSelect,
    });
  }

  async updateCustomerStatus(
    customerId: string,
    status: UserStatus,
  ): Promise<CustomerRecord> {
    return getPrismaClient().user.update({
      where: { id: customerId },
      data: { status },
      select: customerSelect,
    });
  }

  async getOAuthProviders(customerId: string): Promise<OAuthProvider[]> {
    const accounts = await getPrismaClient().oAuthAccount.findMany({
      where: { userId: customerId },
      select: { provider: true },
    });
    return accounts.map((account) => account.provider);
  }

  async getDeliveryStats(customerId: string): Promise<CustomerStatsDto> {
    const prisma = getPrismaClient();
    const [counts, lastDelivery] = await Promise.all([
      prisma.delivery.groupBy({
        by: ["status"],
        where: { customerId },
        _count: { _all: true },
      }),
      prisma.delivery.findFirst({
        where: { customerId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);

    const countByStatus = new Map<DeliveryStatus, number>(
      counts.map((row) => [row.status, row._count._all]),
    );

    const totalDeliveries = counts.reduce((sum, row) => sum + row._count._all, 0);
    const activeDeliveries = ACTIVE_DELIVERY_STATUSES.reduce(
      (sum, status) => sum + (countByStatus.get(status) ?? 0),
      0,
    );

    return {
      totalDeliveries,
      activeDeliveries,
      completedDeliveries: countByStatus.get("DELIVERED") ?? 0,
      failedDeliveries: countByStatus.get("FAILED") ?? 0,
      cancelledDeliveries: countByStatus.get("CANCELLED") ?? 0,
      lastDeliveryAt: lastDelivery?.createdAt.toISOString() ?? null,
    };
  }

  async getDeliveryStatsForCustomers(
    customerIds: string[],
  ): Promise<
    Map<string, Pick<CustomerStatsDto, "totalDeliveries" | "lastDeliveryAt">>
  > {
    const stats = new Map<
      string,
      Pick<CustomerStatsDto, "totalDeliveries" | "lastDeliveryAt">
    >();

    if (customerIds.length === 0) {
      return stats;
    }

    const prisma = getPrismaClient();
    const [counts, lastDeliveries] = await Promise.all([
      prisma.delivery.groupBy({
        by: ["customerId"],
        where: { customerId: { in: customerIds } },
        _count: { _all: true },
      }),
      prisma.delivery.findMany({
        where: { customerId: { in: customerIds } },
        orderBy: { createdAt: "desc" },
        distinct: ["customerId"],
        select: { customerId: true, createdAt: true },
      }),
    ]);

    for (const customerId of customerIds) {
      stats.set(customerId, { totalDeliveries: 0, lastDeliveryAt: null });
    }

    for (const row of counts) {
      const current = stats.get(row.customerId);
      if (current) {
        current.totalDeliveries = row._count._all;
      }
    }

    for (const row of lastDeliveries) {
      const current = stats.get(row.customerId);
      if (current) {
        current.lastDeliveryAt = row.createdAt.toISOString();
      }
    }

    return stats;
  }

  async getAverageRating(customerId: string): Promise<number | null> {
    const aggregate = await getPrismaClient().deliveryRating.aggregate({
      where: { customerId },
      _avg: { deliveryRating: true },
    });

    return aggregate._avg.deliveryRating;
  }

  async listRecentDeliveries(customerId: string) {
    return getPrismaClient().delivery.findMany({
      where: { customerId },
      include: { pickup: true, drop: true },
      orderBy: { createdAt: "desc" },
      take: RECENT_DELIVERIES_LIMIT,
    });
  }
}

export const customerRepository = new CustomerRepository();
