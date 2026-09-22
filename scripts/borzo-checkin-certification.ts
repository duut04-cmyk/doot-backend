/**
 * Borzo check-in code sandbox certification (OTP lifecycle investigation).
 *
 * Usage:
 *   BORZO_SANDBOX_SMOKE_TEST=true npx tsx scripts/borzo-checkin-certification.ts
 *
 * Requires BORZO_ACCESS_TOKEN in environment (.env). Never prints credentials.
 */
import { config as loadDotenv } from "dotenv";
import { BorzoClient } from "../src/modules/provider/adapters/borzo/borzo.client.js";
import {
  BORZO_AUTH_HEADER,
  BORZO_TEST_BASE_URL,
} from "../src/modules/provider/adapters/borzo/borzo.constants.js";
import {
  ProviderHttpClient,
  resolveProviderRequestUrl,
} from "../src/modules/provider/adapters/provider-http-client.js";
import type { ProviderRuntimeConfig } from "../src/modules/provider/adapters/provider-config.types.js";
import type {
  BorzoCreateOrderRequest,
  BorzoOrderDetail,
} from "../src/modules/provider/adapters/borzo/borzo.types.js";

loadDotenv({ override: false });

const PICKUP_TEST_CODE = "481731";
const DELIVERY_TEST_CODE = "629415";
const EDIT_PICKUP_CODE = "902184";
const EDIT_DELIVERY_CODE = "715306";

function log(step: string, payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ step, ...payload }, null, 2)}\n`);
}

function buildConfig(token: string): ProviderRuntimeConfig {
  return {
    providerId: "00000000-0000-0000-0000-000000000003",
    providerCode: "BORZO",
    environment: "SANDBOX",
    status: "ACTIVE",
    enabled: true,
    integrationStatus: "CONFIGURED",
    baseUrl: BORZO_TEST_BASE_URL,
    timeoutMs: 30000,
    connectTimeoutMs: 10000,
    maxRetries: 0,
    retryDelayMs: 1000,
    capabilities: ["BOOKING", "CANCELLATION"],
    services: [],
    credentials: { ACCESS_TOKEN: token },
  };
}

function baseOrderBody(checkinCodes?: {
  pickup?: string;
  delivery?: string;
}): BorzoCreateOrderRequest {
  const suffix = Date.now().toString().slice(-8);
  return {
    type: "standard",
    matter: "Documents",
    vehicle_type_id: 8,
    total_weight_kg: 1,
    points: [
      {
        address: "Saket, New Delhi, Delhi",
        contact_person: {
          phone: "919880000001",
          name: "Dutt Cert Pickup",
        },
        client_order_id: `dutt-cert-${suffix}`.slice(0, 32),
        ...(checkinCodes?.pickup ? { checkin_code: checkinCodes.pickup } : {}),
      },
      {
        address: "Janakpuri, New Delhi, Delhi",
        contact_person: {
          phone: "919880000002",
          name: "Dutt Cert Drop",
        },
        ...(checkinCodes?.delivery ? { checkin_code: checkinCodes.delivery } : {}),
      },
    ],
  };
}

type PointSummary = {
  pointIndex: number;
  pointId: number | null;
  deliveryId: number | null;
  checkin_code: string | null;
  checkin: unknown;
  courier_visit_datetime: string | null;
  deliveryStatus: string | null;
};

function summarizePoints(order: BorzoOrderDetail | null | undefined): PointSummary[] {
  if (!order?.points?.length) {
    return [];
  }
  return order.points.map((point, index) => {
    const raw = point as Record<string, unknown>;
    const delivery = point.delivery as { status?: string | null } | null | undefined;
    return {
      pointIndex: index,
      pointId: point.point_id ?? null,
      deliveryId: point.delivery_id ?? null,
      checkin_code:
        typeof raw.checkin_code === "string" || raw.checkin_code === null
          ? (raw.checkin_code as string | null)
          : null,
      checkin: raw.checkin ?? null,
      courier_visit_datetime:
        typeof raw.courier_visit_datetime === "string"
          ? raw.courier_visit_datetime
          : null,
      deliveryStatus: delivery?.status ?? null,
    };
  });
}

function summarizeOrder(order: BorzoOrderDetail | null | undefined) {
  return {
    orderId: order?.order_id ?? null,
    orderName: order?.order_name ?? null,
    status: order?.status ?? null,
    statusDescription: order?.status_description ?? null,
    courierPresent: order?.courier != null,
    points: summarizePoints(order),
  };
}

async function cancelOrder(
  client: BorzoClient,
  config: ProviderRuntimeConfig,
  requestId: string,
  orderId: number,
): Promise<boolean> {
  try {
    const result = await client.cancelOrder({
      config,
      requestId,
      body: { order_id: orderId },
    });
    return result.is_successful === true;
  } catch {
    return false;
  }
}

async function fetchOrder(
  client: BorzoClient,
  config: ProviderRuntimeConfig,
  requestId: string,
  orderId: number,
) {
  const list = await client.getOrder({ config, requestId, orderId });
  return list.orders?.[0] ?? null;
}

async function editOrder(input: {
  config: ProviderRuntimeConfig;
  requestId: string;
  orderId: number;
  points: Array<Record<string, unknown>>;
}): Promise<{
  httpStatus: number;
  isSuccessful: boolean;
  order: BorzoOrderDetail | null;
}> {
  const http = new ProviderHttpClient();
  const response = await http.request<{
    is_successful?: boolean;
    order?: BorzoOrderDetail;
    errors?: string[];
    parameter_errors?: unknown;
  }>({
    config: input.config,
    operation: "createBooking",
    requestId: input.requestId,
    allowErrorResponseBody: true,
    request: {
      method: "POST",
      path: "/edit-order",
      headers: {
        [BORZO_AUTH_HEADER]:
          input.config.credentials.ACCESS_TOKEN ??
          input.config.credentials.API_KEY ??
          "",
      },
      body: {
        order_id: input.orderId,
        points: input.points,
      },
    },
  });

  return {
    httpStatus: response.status,
    isSuccessful: response.data.is_successful === true,
    order: response.data.order ?? null,
  };
}

async function runExperiment1(
  client: BorzoClient,
  config: ProviderRuntimeConfig,
  requestId: string,
) {
  log("experiment1.start", { description: "create-order without checkin_code" });

  const body = baseOrderBody();
  log("experiment1.create_request_shape", {
    type: body.type,
    matter: body.matter,
    pointCount: body.points.length,
    points: body.points.map((point, index) => ({
      index,
      hasCheckinCode: "checkin_code" in point,
      address: point.address,
    })),
  });

  const created = await client.createOrder({
    config,
    requestId: `${requestId}-exp1-create`,
    body,
  });

  const orderId = created.order?.order_id;
  log("experiment1.create_order", {
    httpSuccessful: created.is_successful,
    ...summarizeOrder(created.order),
  });

  if (!orderId) {
    return;
  }

  const fetched = await fetchOrder(client, config, `${requestId}-exp1-get`, orderId);
  log("experiment1.get_orders", summarizeOrder(fetched));

  const courier = await client.getCourier({
    config,
    requestId: `${requestId}-exp1-courier`,
    orderId,
  });
  log("experiment1.courier", {
    isSuccessful: courier.is_successful,
    courierId: courier.courier?.courier_id ?? null,
    hasCheckinFields: false,
  });

  const cancelled = await cancelOrder(
    client,
    config,
    `${requestId}-exp1-cancel`,
    orderId,
  );
  log("experiment1.cancelled", { orderId, cancelled });
}

async function runExperiment2(
  client: BorzoClient,
  config: ProviderRuntimeConfig,
  requestId: string,
) {
  log("experiment2.start", {
    description: "create-order with client-supplied checkin_code values",
    pickupTestCode: PICKUP_TEST_CODE,
    deliveryTestCode: DELIVERY_TEST_CODE,
  });

  const body = baseOrderBody({
    pickup: PICKUP_TEST_CODE,
    delivery: DELIVERY_TEST_CODE,
  });

  const created = await client.createOrder({
    config,
    requestId: `${requestId}-exp2-create`,
    body,
  });

  const orderId = created.order?.order_id;
  log("experiment2.create_order", {
    httpSuccessful: created.is_successful,
    ...summarizeOrder(created.order),
  });

  if (!orderId) {
    return { orderId: null as number | null, points: [] as PointSummary[] };
  }

  const fetched = await fetchOrder(client, config, `${requestId}-exp2-get`, orderId);
  log("experiment2.get_orders", summarizeOrder(fetched));

  const points = summarizePoints(fetched);
  const pickupMatches = points[0]?.checkin_code === PICKUP_TEST_CODE ? true : false;
  const deliveryMatches = points[1]?.checkin_code === DELIVERY_TEST_CODE ? true : false;
  log("experiment2.code_echo", {
    pickupAccepted: pickupMatches,
    deliveryAccepted: deliveryMatches,
  });

  return { orderId, points, fetched };
}

async function runExperiment3(
  client: BorzoClient,
  config: ProviderRuntimeConfig,
  requestId: string,
  orderId: number,
  existingPoints: PointSummary[],
) {
  log("experiment3.start", {
    description: "edit-order checkin_code after booking",
    orderId,
  });

  const editPoints = existingPoints.map((point, index) => ({
    point_id: point.pointId,
    checkin_code: index === 0 ? EDIT_PICKUP_CODE : EDIT_DELIVERY_CODE,
  }));

  const edited = await editOrder({
    config,
    requestId: `${requestId}-exp3-edit`,
    orderId,
    points: editPoints,
  });

  log("experiment3.edit_order", {
    httpStatus: edited.httpStatus,
    isSuccessful: edited.isSuccessful,
    ...summarizeOrder(edited.order),
  });

  const fetched = await fetchOrder(client, config, `${requestId}-exp3-get`, orderId);
  const points = summarizePoints(fetched);
  log("experiment3.get_orders", {
    ...summarizeOrder(fetched),
    pickupCodeMatchesEdit: points[0]?.checkin_code === EDIT_PICKUP_CODE,
    deliveryCodeMatchesEdit: points[1]?.checkin_code === EDIT_DELIVERY_CODE,
  });

  const cancelled = await cancelOrder(
    client,
    config,
    `${requestId}-exp3-cancel`,
    orderId,
  );
  log("experiment3.cancelled", { orderId, cancelled });
}

async function main() {
  if (process.env.BORZO_SANDBOX_SMOKE_TEST !== "true") {
    process.stdout.write(
      "Set BORZO_SANDBOX_SMOKE_TEST=true to run check-in certification.\n",
    );
    process.exit(0);
  }

  const token = process.env.BORZO_ACCESS_TOKEN?.trim();
  if (!token) {
    console.error("BORZO_ACCESS_TOKEN is required.");
    process.exit(1);
  }

  const config = buildConfig(token);
  const client = new BorzoClient();
  const requestId = `checkin-cert-${Date.now()}`;

  log("config", {
    environment: config.environment,
    baseUrl: config.baseUrl,
    requestUrlExample: resolveProviderRequestUrl(config.baseUrl, "/create-order"),
  });

  const health = await client.ping({ config, requestId: `${requestId}-ping` });
  log("connection", { healthy: health.healthy, durationMs: health.durationMs });

  await runExperiment1(client, config, requestId);

  const exp2 = await runExperiment2(client, config, requestId);
  if (exp2.orderId && exp2.points.length >= 2) {
    await runExperiment3(client, config, requestId, exp2.orderId, exp2.points);
  } else if (exp2.orderId) {
    await cancelOrder(client, config, `${requestId}-exp2-cancel`, exp2.orderId);
  }

  log("certification.complete", {
    note: "Courier verification not sandbox-observable via Business API.",
  });
}

main().catch((error) => {
  console.error("Borzo check-in certification failed.");
  if (error instanceof Error) {
    console.error(error.message);
  }
  process.exit(1);
});
