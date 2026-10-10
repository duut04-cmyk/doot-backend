import type { PaymentGatewayCode } from "@prisma/client";
import { DELIVERY_REFERENCE_PREFIX } from "../../delivery/delivery.constants.js";
import { logger } from "../../../config/logger.js";
import { AppError } from "../../../core/errors/app-error.js";
import { ErrorCodes } from "../../../core/errors/error-codes.js";
import {
  env,
  getCashfreePgBaseUrl,
  requireCashfreeCredentials,
} from "../../../config/env.js";
import {
  buildSafeCashfreeClientMessage,
  extractCashfreeApiError,
} from "./cashfree/cashfree-api-errors.js";
import { formatCashfreeCustomerPhone } from "../gateway-customer-phone.js";
import type { PaymentGateway } from "./payment-gateway.interface.js";
import type {
  GatewayCreateOrderInput,
  GatewayCreateOrderResult,
  GatewayPaymentStatusResult,
  GatewayRefundInput,
  GatewayRefundResult,
  GatewayRefundStatusInput,
} from "./payment-gateway.types.js";

type FetchFn = typeof fetch;

type CashfreeCreateOrderResponse = {
  order_id?: string;
  payment_session_id?: string;
  order_status?: string;
  message?: string;
};

type CashfreePaymentRow = {
  cf_payment_id?: string;
  payment_status?: string;
  payment_amount?: number;
  payment_group?: string;
  payment_method?: string | { payment_method?: string };
};

type CashfreePaymentsResponse =
  CashfreePaymentRow[] | { payments?: CashfreePaymentRow[] };

function buildCashfreeOrderId(paymentId: string): string {
  return `${DELIVERY_REFERENCE_PREFIX}-${paymentId}`;
}

function mapCashfreeStatusToGateway(
  raw: string | undefined,
): GatewayPaymentStatusResult["status"] {
  if (!raw) return "PENDING";
  const upper = raw.toUpperCase();
  if (upper === "SUCCESS" || upper === "PAID") return "PAID";
  if (upper === "FAILED" || upper === "USER_DROPPED" || upper === "CANCELLED") {
    return "FAILED";
  }
  if (upper === "EXPIRED") return "EXPIRED";
  return "PENDING";
}

export class CashfreePaymentGateway implements PaymentGateway {
  readonly code: PaymentGatewayCode = "CASHFREE";

  constructor(private readonly fetchImpl: FetchFn = fetch) {}

  private headers() {
    const creds = requireCashfreeCredentials();
    return {
      "x-client-id": creds.clientId,
      "x-client-secret": creds.clientSecret,
      "x-api-version": creds.apiVersion,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  private pgUrl(path: string): string {
    return `${getCashfreePgBaseUrl()}${path}`;
  }

  async createPaymentOrder(
    input: GatewayCreateOrderInput,
  ): Promise<GatewayCreateOrderResult> {
    try {
      requireCashfreeCredentials();
    } catch {
      throw new AppError("Cashfree payment gateway is not configured.", {
        statusCode: 503,
        code: ErrorCodes.PAYMENT_GATEWAY_NOT_CONFIGURED,
      });
    }

    const orderId =
      input.existingGatewayOrderId ?? buildCashfreeOrderId(input.paymentId);
    const customerPhone = formatCashfreeCustomerPhone(input.customer?.phone);
    const body: Record<string, unknown> = {
      order_id: orderId,
      order_amount: input.amount,
      order_currency: input.currency,
      customer_details: {
        customer_id: input.customer?.customerId ?? input.paymentId,
        ...(input.customer?.email ? { customer_email: input.customer.email } : {}),
        ...(customerPhone ? { customer_phone: customerPhone } : {}),
      },
    };

    const orderMeta: Record<string, string> = {};
    if (env.CASHFREE_RETURN_URL) {
      const returnUrl = new URL(env.CASHFREE_RETURN_URL);
      returnUrl.searchParams.set("deliveryId", input.deliveryId);
      orderMeta.return_url = returnUrl.toString();
    }
    if (env.CASHFREE_NOTIFY_URL) {
      orderMeta.notify_url = env.CASHFREE_NOTIFY_URL;
    }
    if (Object.keys(orderMeta).length > 0) {
      body.order_meta = orderMeta;
    }

    const requestUrl = this.pgUrl("/orders");
    const response = await this.fetchImpl(requestUrl, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      logger.error(
        {
          gateway: "CASHFREE",
          operation: "create_order",
          httpStatus: response.status,
          httpStatusText: response.statusText,
          requestUrl,
          orderId,
          amount: input.amount,
          currency: input.currency,
          responseBodyPreview: text.slice(0, 500),
        },
        "cashfree_create_order_invalid_json",
      );
      throw new AppError("Cashfree order creation returned invalid JSON.", {
        statusCode: 502,
        code: ErrorCodes.PAYMENT_GATEWAY_ERROR,
      });
    }

    const cashfreeError = extractCashfreeApiError(parsed);

    if (!response.ok) {
      logger.error(
        {
          gateway: "CASHFREE",
          operation: "create_order",
          httpStatus: response.status,
          httpStatusText: response.statusText,
          requestUrl,
          orderId,
          amount: input.amount,
          currency: input.currency,
          cashfreeCode: cashfreeError.code,
          cashfreeType: cashfreeError.type,
          cashfreeMessage: cashfreeError.message,
          hasReturnUrl: Boolean(env.CASHFREE_RETURN_URL),
          hasNotifyUrl: Boolean(env.CASHFREE_NOTIFY_URL),
        },
        "cashfree_create_order_failed",
      );
      throw new AppError(buildSafeCashfreeClientMessage(cashfreeError), {
        statusCode: 502,
        code: ErrorCodes.PAYMENT_GATEWAY_ERROR,
      });
    }

    const orderResponse = parsed as CashfreeCreateOrderResponse;
    const gatewayOrderId = orderResponse.order_id ?? orderId;
    const paymentSessionId = orderResponse.payment_session_id;
    if (!paymentSessionId) {
      logger.error(
        {
          gateway: "CASHFREE",
          operation: "create_order",
          httpStatus: response.status,
          requestUrl,
          orderId: gatewayOrderId,
          amount: input.amount,
          currency: input.currency,
          cashfreeCode: cashfreeError.code,
          cashfreeMessage: cashfreeError.message,
          orderStatus: orderResponse.order_status,
        },
        "cashfree_create_order_missing_session",
      );
      throw new AppError("Cashfree order response missing payment_session_id.", {
        statusCode: 502,
        code: ErrorCodes.PAYMENT_GATEWAY_ERROR,
      });
    }

    let apiHost: string | undefined;
    try {
      apiHost = new URL(requestUrl).hostname;
    } catch {
      apiHost = undefined;
    }
    logger.info(
      {
        gateway: "CASHFREE",
        operation: "create_order",
        httpStatus: response.status,
        apiHost,
        orderId: gatewayOrderId,
        paymentSessionPresent: true,
        paymentSessionLength: paymentSessionId.length,
      },
      "cashfree_create_order_success",
    );

    return {
      gatewayOrderId,
      paymentSessionId,
      metadata: {
        orderStatus: orderResponse.order_status,
      },
    };
  }

  async getPaymentStatus(input: {
    gatewayOrderId: string;
  }): Promise<GatewayPaymentStatusResult> {
    const response = await this.fetchImpl(
      this.pgUrl(`/orders/${encodeURIComponent(input.gatewayOrderId)}/payments`),
      {
        method: "GET",
        headers: this.headers(),
      },
    );

    const text = await response.text();
    if (!response.ok) {
      throw new AppError("Cashfree payment status query failed.", {
        statusCode: 502,
        code: ErrorCodes.PAYMENT_GATEWAY_ERROR,
      });
    }

    let parsed: CashfreePaymentsResponse;
    try {
      parsed = JSON.parse(text) as CashfreePaymentsResponse;
    } catch {
      throw new AppError("Cashfree payment status returned invalid JSON.", {
        statusCode: 502,
        code: ErrorCodes.PAYMENT_GATEWAY_ERROR,
      });
    }

    const payments = Array.isArray(parsed) ? parsed : (parsed.payments ?? []);
    const latest = payments[payments.length - 1];
    if (!latest) {
      return { status: "PENDING", gatewayPaymentId: null };
    }

    const paymentMethod =
      typeof latest.payment_method === "string"
        ? latest.payment_method
        : (latest.payment_method?.payment_method ?? latest.payment_group ?? null);

    return {
      status: mapCashfreeStatusToGateway(latest.payment_status),
      gatewayPaymentId: latest.cf_payment_id ?? null,
      paymentMethod,
      metadata: { paymentCount: payments.length },
    };
  }

  async verifyPayment(input: {
    gatewayOrderId: string;
    gatewayPaymentId?: string | null;
  }): Promise<GatewayPaymentStatusResult> {
    return this.getPaymentStatus(input);
  }

  async createRefund(input: GatewayRefundInput): Promise<GatewayRefundResult> {
    try {
      requireCashfreeCredentials();
    } catch {
      throw new AppError("Cashfree payment gateway is not configured.", {
        statusCode: 503,
        code: ErrorCodes.PAYMENT_GATEWAY_NOT_CONFIGURED,
      });
    }

    const body: Record<string, unknown> = {
      refund_amount: input.amount,
      refund_id: input.merchantRefundId,
      refund_speed: "STANDARD",
    };
    if (input.refundNote?.trim()) {
      body.refund_note = input.refundNote.trim().slice(0, 100);
    }

    const requestUrl = this.pgUrl(
      `/orders/${encodeURIComponent(input.gatewayOrderId)}/refunds`,
    );
    const response = await this.fetchImpl(requestUrl, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      logger.error(
        {
          gateway: "CASHFREE",
          operation: "create_refund",
          httpStatus: response.status,
          orderId: input.gatewayOrderId,
          refundId: input.merchantRefundId,
          responseBodyPreview: text.slice(0, 500),
        },
        "cashfree_create_refund_invalid_json",
      );
      throw new AppError("Cashfree refund creation returned invalid JSON.", {
        statusCode: 502,
        code: ErrorCodes.PAYMENT_GATEWAY_ERROR,
      });
    }

    const cashfreeError = extractCashfreeApiError(parsed);
    if (!response.ok) {
      logger.error(
        {
          gateway: "CASHFREE",
          operation: "create_refund",
          httpStatus: response.status,
          orderId: input.gatewayOrderId,
          refundId: input.merchantRefundId,
          cashfreeCode: cashfreeError.code,
          cashfreeMessage: cashfreeError.message,
        },
        "cashfree_create_refund_failed",
      );
      throw new AppError(buildSafeCashfreeClientMessage(cashfreeError), {
        statusCode: 502,
        code: ErrorCodes.PAYMENT_GATEWAY_ERROR,
      });
    }

    return mapCashfreeRefundEntity(parsed, input.merchantRefundId);
  }

  async getRefundStatus(input: GatewayRefundStatusInput): Promise<GatewayRefundResult> {
    try {
      requireCashfreeCredentials();
    } catch {
      throw new AppError("Cashfree payment gateway is not configured.", {
        statusCode: 503,
        code: ErrorCodes.PAYMENT_GATEWAY_NOT_CONFIGURED,
      });
    }

    const requestUrl = this.pgUrl(
      `/orders/${encodeURIComponent(input.gatewayOrderId)}/refunds/${encodeURIComponent(input.gatewayRefundId)}`,
    );
    const response = await this.fetchImpl(requestUrl, {
      method: "GET",
      headers: this.headers(),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new AppError("Cashfree refund status query failed.", {
        statusCode: 502,
        code: ErrorCodes.PAYMENT_GATEWAY_ERROR,
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new AppError("Cashfree refund status returned invalid JSON.", {
        statusCode: 502,
        code: ErrorCodes.PAYMENT_GATEWAY_ERROR,
      });
    }

    return mapCashfreeRefundEntity(parsed, input.gatewayRefundId);
  }
}

type CashfreeRefundEntity = {
  refund_id?: string;
  cf_refund_id?: string;
  refund_status?: string;
  refund_amount?: number;
};

function mapCashfreeRefundStatus(
  raw: string | undefined,
): GatewayRefundResult["status"] {
  if (!raw) return "PENDING";
  const upper = raw.trim().toUpperCase();
  if (upper === "SUCCESS") return "SUCCESS";
  if (
    upper === "FAILED" ||
    upper === "CANCELLED" ||
    upper === "REJECTED" ||
    upper === "USER_DROPPED"
  ) {
    return "FAILED";
  }
  return "PENDING";
}

function mapCashfreeRefundEntity(
  parsed: unknown,
  fallbackMerchantRefundId: string,
): GatewayRefundResult {
  const entity = (parsed ?? {}) as CashfreeRefundEntity;
  return {
    gatewayRefundId: entity.refund_id ?? fallbackMerchantRefundId,
    gatewayRefundReference: entity.cf_refund_id ?? null,
    status: mapCashfreeRefundStatus(entity.refund_status),
  };
}

export const cashfreePaymentGateway = new CashfreePaymentGateway();
