import type { ProviderCapability } from "@prisma/client";
import type { QuoteRequest } from "../../contracts/quote.js";
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
  mapBorzoCalculateOrderToProbeResult,
  mapBorzoCalculateOrderToQuote,
  mapQuoteRequestToBorzoCalculateOrder,
} from "./borzo.mapper.js";
import { parseBorzoWebhookCallback } from "./borzo.webhook.schemas.js";
import { mapBorzoWebhookCallbackToNormalizedEvent } from "./borzo.webhook.mapper.js";

const BORZO_CAPABILITIES: ProviderCapability[] = [
  "PRICING",
  "SERVICEABILITY",
  "WEBHOOKS",
];

const BORZO_OPERATIONS: AdapterOperation[] = [
  "getQuote",
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

  private async getQuote(
    input: QuoteRequest,
    ctx: AdapterExecutionContext,
  ) {
    const borzoRequest = mapQuoteRequestToBorzoCalculateOrder(input);
    const response = await this.client.calculateOrder({
      config: ctx.config,
      requestId: ctx.requestId,
      body: borzoRequest,
      operation: "getQuote",
    });
    return mapBorzoCalculateOrderToQuote(response, input);
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
