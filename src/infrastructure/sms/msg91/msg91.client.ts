import { logger } from "../../../config/logger.js";
import type { Msg91FlowRequest, Msg91FlowResponse } from "./msg91.types.js";

const REDACTED_HEADERS = new Set(["authkey"]);

export type Msg91ClientConfig = {
  baseUrl: string;
  authKey: string;
  timeoutMs: number;
};

type FetchFn = typeof fetch;

export class Msg91Client {
  constructor(
    private readonly config: Msg91ClientConfig,
    private readonly fetchImpl: FetchFn = fetch,
  ) {}

  async sendFlow(
    payload: Msg91FlowRequest,
    correlationId: string,
  ): Promise<Msg91FlowResponse> {
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/flow/`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const started = Date.now();

    const headers = {
      authkey: this.config.authKey,
      "content-type": "application/json",
    };

    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const durationMs = Date.now() - started;
      const text = await response.text();
      let data: Msg91FlowResponse;
      try {
        data = text ? (JSON.parse(text) as Msg91FlowResponse) : {};
      } catch {
        data = { message: text };
      }

      logger.info(
        {
          correlationId,
          provider: "MSG91",
          status: response.status,
          durationMs,
          requestHeaders: redactMsg91Headers(headers),
          providerRequestId: data.request_id ?? data.requestId,
          providerType: data.type,
        },
        "msg91_flow_response",
      );

      if (!response.ok) {
        throw new Msg91RequestError(
          `MSG91 request failed with status ${response.status}.`,
          response.status,
          data,
        );
      }

      return data;
    } catch (error) {
      const durationMs = Date.now() - started;
      const isAbort = error instanceof Error && error.name === "AbortError";

      logger.warn(
        {
          correlationId,
          provider: "MSG91",
          durationMs,
          errorCategory: isAbort ? "TIMEOUT" : "FAILED",
          requestHeaders: redactMsg91Headers(headers),
        },
        "msg91_flow_failed",
      );

      if (error instanceof Msg91RequestError) {
        throw error;
      }

      throw new Msg91RequestError(
        isAbort ? "MSG91 request timed out." : "MSG91 request failed.",
        isAbort ? 408 : 502,
        undefined,
        error,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export class Msg91RequestError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly response?: Msg91FlowResponse,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "Msg91RequestError";
  }
}

export function redactMsg91Headers(
  headers: Record<string, string>,
): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    redacted[key] = REDACTED_HEADERS.has(key.toLowerCase()) ? "[REDACTED]" : value;
  }
  return redacted;
}
