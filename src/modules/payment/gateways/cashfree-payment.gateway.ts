import type { PaymentGatewayCode } from "@prisma/client";
import { AppError } from "../../../core/errors/app-error.js";
import { ErrorCodes } from "../../../core/errors/error-codes.js";
import {
  env,
  getCashfreePgBaseUrl,
  requireCashfreeCredentials,
} from "../../../config/env.js";
import type { PaymentGateway } from "./payment-gateway.interface.js";
import type {
  GatewayCreateOrderInput,
  GatewayCreateOrderResult,
  GatewayPaymentStatusResult,
  GatewayRefundInput,
  GatewayRefundResult,
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
  return `DOTT-${paymentId}`;
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

function formatCustomerPhone(
  customer: GatewayCreateOrderInput["customer"],
): string | undefined {
  if (!customer?.phone) return undefined;
  const digits = customer.phone.replace(/\D/g, "");
  return digits.length >= 10 ? digits : undefined;
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
    const customerPhone = formatCustomerPhone(input.customer);
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
      orderMeta.return_url = env.CASHFREE_RETURN_URL;
    }
    if (env.CASHFREE_NOTIFY_URL) {
      orderMeta.notify_url = env.CASHFREE_NOTIFY_URL;
    }
    if (Object.keys(orderMeta).length > 0) {
      body.order_meta = orderMeta;
    }

    const response = await this.fetchImpl(this.pgUrl("/orders"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let parsed: CashfreeCreateOrderResponse;
    try {
      parsed = JSON.parse(text) as CashfreeCreateOrderResponse;
    } catch {
      throw new AppError("Cashfree order creation returned invalid JSON.", {
        statusCode: 502,
        code: ErrorCodes.PAYMENT_GATEWAY_ERROR,
      });
    }

    if (!response.ok) {
      throw new AppError(parsed.message ?? "Cashfree order creation failed.", {
        statusCode: 502,
        code: ErrorCodes.PAYMENT_GATEWAY_ERROR,
      });
    }

    const gatewayOrderId = parsed.order_id ?? orderId;
    const paymentSessionId = parsed.payment_session_id;
    if (!paymentSessionId) {
      throw new AppError("Cashfree order response missing payment_session_id.", {
        statusCode: 502,
        code: ErrorCodes.PAYMENT_GATEWAY_ERROR,
      });
    }

    return {
      gatewayOrderId,
      paymentSessionId,
      metadata: {
        orderStatus: parsed.order_status,
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

  async createRefund(_input: GatewayRefundInput): Promise<GatewayRefundResult> {
    throw new AppError("Cashfree refunds are not implemented in Phase 2A.", {
      statusCode: 501,
      code: ErrorCodes.PAYMENT_GATEWAY_ERROR,
    });
  }

  async getRefundStatus(_input: {
    gatewayRefundId: string;
  }): Promise<GatewayRefundResult> {
    throw new AppError("Cashfree refunds are not implemented in Phase 2A.", {
      statusCode: 501,
      code: ErrorCodes.PAYMENT_GATEWAY_ERROR,
    });
  }
}

export const cashfreePaymentGateway = new CashfreePaymentGateway();
