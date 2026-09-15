/**
 * Resolves Dutt Delivery IDs from provider booking references.
 * Full linkage becomes active when create-order/booking is implemented in Phase 4C.
 */
export interface ProviderDeliveryLinkResolver {
  findDeliveryIdByProviderRefs(input: {
    providerCode: string;
    providerOrderId?: string | null;
    providerDeliveryId?: string | null;
  }): Promise<string | null>;
}

export class NullProviderDeliveryLinkResolver
  implements ProviderDeliveryLinkResolver
{
  async findDeliveryIdByProviderRefs(): Promise<string | null> {
    return null;
  }
}

export const nullProviderDeliveryLinkResolver =
  new NullProviderDeliveryLinkResolver();

export { prismaProviderDeliveryLinkResolver } from "./provider.delivery-link.prisma.js";
