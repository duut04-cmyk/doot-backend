import type { ProviderCapability } from "@prisma/client";
import type { BookingRequest } from "../../contracts/booking.js";
import type { CancellationRequest } from "../../contracts/cancellation.js";
import type { QuoteRequest } from "../../contracts/quote.js";
import type { TrackingRequest } from "../../contracts/tracking.js";
import type { WebhookParseRequest } from "../../contracts/webhook.js";
import { ProviderAdapterError } from "../../contracts/provider-error.js";
import type {
  AdapterExecutionContext,
  AdapterOperation,
  AdapterOperationInput,
  AdapterOperationOutput,
  HealthCheckResult,
  ProviderAdapter,
  ProviderAdapterMetadata,
  ProviderQuoteProbeAdapter,
  ProviderQuoteProbeResult,
} from "../provider-adapter.types.js";
import { BorzoClient, borzoClient } from "./borzo.client.js";
import {
  BORZO_ADAPTER_VERSION,
  BORZO_PROVIDER_CODE,
} from "./borzo.constants.js";
import {
  mapBorzoCancelOrderToCancellationResult,
  mapBorzoCourierToNormalizedDriver,
  mapBorzoOrderToBookingResult,
  mapBorzoTrackingResult,
  mapBookingRequestToBorzoCreateOrder,
  parseBorzoOrderId,
} from "./borzo-operational.mapper.js";
import {
  mapBorzoCalculateOrderToProbeResult,
  mapBorzoCalculateOrderToQuote,
  mapQuoteRequestToBorzoCalculateOrder,
} from "./borzo.mapper.js";
import { parseBorzoWebhookCallback } from "./borzo.webhook.schemas.js";
import { mapBorzoWebhookCallbackToNormalizedEvent } from "./borzo.webhook.mapper.js";

const BORZO_CAPABILITIES: ProviderCapability[] = [
  "PRICING",
  "SERVICEABILITY",
  "BOOKING",
  "CANCELLATION",
  "LIVE_TRACKING",
  "WEBHOOKS",
];

const BORZO_OPERATIONS: AdapterOperation[] = [
  "getQuote",
  "createBooking",
  "getBooking",
  "cancelBooking",
  "getTracking",
  "healthCheck",
  "parseWebhook",
];

export class BorzoAdapter implements ProviderAdapter, ProviderQuoteProbeAdapter {
  readonly metadata: ProviderAdapterMetadata = {
    providerCode: BORZO_PROVIDER_CODE,
    adapterVersion: BORZO_ADAPTER_VERSION,
    supportedCapabilities: BORZO_CAPABILITIES,
    supportedOperations: BORZO_OPERATIONS,
  };

  constructor(private readonly client: BorzoClient = borzoClient) {}

  supportsOperation(operation: AdapterOperation): boolean {
    return BORZO_OPERATIONS.includes(operation);
  }

  async execute<T extends AdapterOperation>(
    operation: T,
    input: AdapterOperationInput<T>,
    ctx: AdapterExecutionContext,
  ): Promise<AdapterOperationOutput<T>> {
    let result: AdapterOperationOutput<T>;
    switch (operation) {
      case "getQuote":
        result = (await this.getQuote(
          input as QuoteRequest,
          ctx,
        )) as AdapterOperationOutput<T>;
        break;
      case "createBooking":
        result = (await this.createBooking(
          input as BookingRequest,
          ctx,
        )) as AdapterOperationOutput<T>;
        break;
      case "getBooking":
        result = (await this.getBooking(
          input as { providerBookingId: string },
          ctx,
        )) as AdapterOperationOutput<T>;
        break;
      case "cancelBooking":
        result = (await this.cancelBooking(
          input as CancellationRequest,
          ctx,
        )) as AdapterOperationOutput<T>;
        break;
      case "getTracking":
        result = (await this.getTracking(
          input as TrackingRequest,
          ctx,
        )) as AdapterOperationOutput<T>;
        break;
      case "healthCheck":
        result = (await this.healthCheck(ctx)) as AdapterOperationOutput<T>;
        break;
      case "parseWebhook":
        result = this.parseWebhook(
          input as WebhookParseRequest,
        ) as AdapterOperationOutput<T>;
        break;
      default:
        throw new ProviderAdapterError({
          providerCode: BORZO_PROVIDER_CODE,
          operation,
          category: "PROVIDER_UNSUPPORTED_OPERATION",
          safeMessage: "Unsupported Borzo adapter operation.",
          requestId: ctx.requestId,
        });
    }
    return result;
  }

  async probeQuote(
    input: QuoteRequest,
    ctx: AdapterExecutionContext,
  ): Promise<ProviderQuoteProbeResult> {
    const borzoRequest = mapQuoteRequestToBorzoCalculateOrder(input);
    const response = await this.client.calculateOrder({
      config: ctx.config,
      requestId: ctx.requestId,
      body: borzoRequest,
      operation: "getQuote",
    });
    const probe = mapBorzoCalculateOrderToProbeResult(response, input);
    return {
      providerCode: BORZO_PROVIDER_CODE,
      quote: probe.quote,
      serviceability: probe.serviceability,
      availability: probe.availability,
      warnings: probe.warnings,
      providerMetadata: probe.providerMetadata,
    };
  }

  private async getQuote(input: QuoteRequest, ctx: AdapterExecutionContext) {
    const borzoRequest = mapQuoteRequestToBorzoCalculateOrder(input);
    const response = await this.client.calculateOrder({
      config: ctx.config,
      requestId: ctx.requestId,
      body: borzoRequest,
      operation: "getQuote",
    });
    return mapBorzoCalculateOrderToQuote(response, input);
  }

  private async createBooking(
    input: BookingRequest,
    ctx: AdapterExecutionContext,
  ) {
    const borzoRequest = mapBookingRequestToBorzoCreateOrder(input);
    const response = await this.client.createOrder({
      config: ctx.config,
      requestId: ctx.requestId,
      body: borzoRequest,
      operation: "createBooking",
    });
    return mapBorzoOrderToBookingResult({ response, request: input });
  }

  private async getBooking(
    input: { providerBookingId: string },
    ctx: AdapterExecutionContext,
  ) {
    const orderId = parseBorzoOrderId(input.providerBookingId);
    const ordersResponse = await this.client.getOrder({
      config: ctx.config,
      requestId: ctx.requestId,
      orderId,
      operation: "getBooking",
    });

    const order = ordersResponse.orders?.[0] ?? null;
    if (!ordersResponse.is_successful || !order?.order_id) {
      throw new ProviderAdapterError({
        providerCode: BORZO_PROVIDER_CODE,
        operation: "getBooking",
        category: "PROVIDER_NOT_FOUND",
        safeMessage: "Borzo booking not found.",
        requestId: ctx.requestId,
        retryable: false,
      });
    }

    return mapBorzoOrderToBookingResult({
      response: { is_successful: true, order },
      request: {
        deliveryId: input.providerBookingId,
        deliveryReference: input.providerBookingId,
        pickup: {
          addressText: "unknown",
          contactName: "unknown",
          contactPhoneCountryCode: "+91",
          contactPhoneNumber: "9000000000",
        },
        drop: {
          addressText: "unknown",
          contactName: "unknown",
          contactPhoneCountryCode: "+91",
          contactPhoneNumber: "9000000001",
        },
        package: {
          packageType: "OTHER",
          weightKg: 1,
          quantity: 1,
        },
        schedule: { mode: "ASAP", timezone: "Asia/Kolkata" },
        requirements: [],
      },
    });
  }

  private async cancelBooking(
    input: CancellationRequest,
    ctx: AdapterExecutionContext,
  ) {
    const orderId = parseBorzoOrderId(input.providerBookingId);
    const response = await this.client.cancelOrder({
      config: ctx.config,
      requestId: ctx.requestId,
      body: { order_id: orderId },
      operation: "cancelBooking",
    });
    return mapBorzoCancelOrderToCancellationResult(
      response,
      input.providerBookingId,
    );
  }

  private async getTracking(
    input: TrackingRequest,
    ctx: AdapterExecutionContext,
  ) {
    const orderId = parseBorzoOrderId(input.providerBookingId);

    const [courierResponse, ordersResponse] = await Promise.all([
      this.client.getCourier({
        config: ctx.config,
        requestId: ctx.requestId,
        orderId,
        operation: "getTracking",
      }),
      this.client.getOrder({
        config: ctx.config,
        requestId: ctx.requestId,
        orderId,
        operation: "getTracking",
      }),
    ]);

    const order = ordersResponse.orders?.[0] ?? null;

    return mapBorzoTrackingResult({
      order,
      courierResponse,
      providerBookingId: input.providerBookingId,
    });
  }

  private parseWebhook(request: WebhookParseRequest) {
    const callback = parseBorzoWebhookCallback(request.body);
    return mapBorzoWebhookCallbackToNormalizedEvent(
      callback,
      new Date().toISOString(),
    );
  }

  private async healthCheck(
    ctx: AdapterExecutionContext,
  ): Promise<HealthCheckResult> {
    const result = await this.client.ping({
      config: ctx.config,
      requestId: ctx.requestId,
      operation: "healthCheck",
    });
    return {
      healthy: result.healthy,
      checkedAt: new Date().toISOString(),
      message: result.healthy ? null : "Borzo connectivity check failed.",
    };
  }
}

export { mapBorzoCourierToNormalizedDriver };
