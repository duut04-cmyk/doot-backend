import type { UserStatus } from "@prisma/client";
import { AppError } from "../../core/errors/app-error.js";
import { ErrorCodes } from "../../core/errors/error-codes.js";
import {
  toCustomerDeliverySummaryDto,
  toCustomerDetailDto,
  toCustomerSummaryDto,
} from "./customer.mapper.js";
import { customerRepository, type ICustomerRepository } from "./customer.repository.js";
import type { ListCustomersQuery, UpdateCustomerBody } from "./customer.schema.js";
import type {
  CustomerDetailDto,
  CustomerSummaryDto,
  PaginatedCustomersDto,
} from "./customer.types.js";

export class CustomerService {
  constructor(private readonly repository: ICustomerRepository = customerRepository) {}

  async listCustomers(
    query: ListCustomersQuery,
  ): Promise<{ success: true; data: PaginatedCustomersDto }> {
    const { page, limit, search, status, emailVerified } = query;
    const result = await this.repository.listCustomers(page, limit, {
      search,
      status,
      emailVerified,
    });

    const customerIds = result.items.map((item) => item.id);
    const [statsByCustomer, oauthByCustomer] = await Promise.all([
      this.repository.getDeliveryStatsForCustomers(customerIds),
      Promise.all(
        customerIds.map(async (customerId) => ({
          customerId,
          providers: await this.repository.getOAuthProviders(customerId),
        })),
      ),
    ]);

    const oauthMap = new Map(
      oauthByCustomer.map((entry) => [entry.customerId, entry.providers]),
    );

    const items: CustomerSummaryDto[] = result.items.map((user) =>
      toCustomerSummaryDto({
        user,
        oauthProviders: oauthMap.get(user.id) ?? [],
        stats: statsByCustomer.get(user.id) ?? {
          totalDeliveries: 0,
          lastDeliveryAt: null,
        },
      }),
    );

    return {
      success: true,
      data: {
        items,
        page,
        limit,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / limit)),
      },
    };
  }

  async getCustomer(
    customerId: string,
  ): Promise<{ success: true; data: CustomerDetailDto }> {
    const user = await this.requireCustomer(customerId);
    const [oauthProviders, stats, averageRating, recentDeliveries] = await Promise.all([
      this.repository.getOAuthProviders(customerId),
      this.repository.getDeliveryStats(customerId),
      this.repository.getAverageRating(customerId),
      this.repository.listRecentDeliveries(customerId),
    ]);

    return {
      success: true,
      data: toCustomerDetailDto({
        user,
        oauthProviders,
        stats,
        averageRating,
        recentDeliveries: recentDeliveries
          .map(toCustomerDeliverySummaryDto)
          .filter(
            (delivery): delivery is NonNullable<typeof delivery> => delivery !== null,
          ),
      }),
    };
  }

  async updateCustomer(input: {
    customerId: string;
    body: UpdateCustomerBody;
  }): Promise<{ success: true; data: CustomerDetailDto }> {
    await this.requireCustomer(input.customerId);

    if (input.body.status) {
      await this.repository.updateCustomerStatus(
        input.customerId,
        input.body.status as UserStatus,
      );
    }

    return this.getCustomer(input.customerId);
  }

  private async requireCustomer(customerId: string) {
    const user = await this.repository.findCustomerById(customerId);
    if (!user) {
      throw new AppError("Customer not found.", {
        statusCode: 404,
        code: ErrorCodes.NOT_FOUND,
      });
    }
    return user;
  }
}

export const customerService = new CustomerService();
