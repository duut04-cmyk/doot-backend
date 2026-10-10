# Cashfree Sandbox E2E Certification

Sandbox-only certification for payment create → checkout → PAID → confirm → cancel → refund. Does not enable production Cashfree.

## Prerequisites

**Backend (running process):**

- `PAYMENT_GATEWAY=cashfree`
- `CASHFREE_ENABLED=true`
- `CASHFREE_ENVIRONMENT=sandbox`
- `CASHFREE_CLIENT_ID` / `CASHFREE_CLIENT_SECRET`
- `CASHFREE_API_VERSION=2025-01-01`
- `ENABLE_MOCK_PROVIDER_ADAPTER=true` (orchestration for cert delivery)
- Restart backend after changing payment gateway env.

**Cert script (same `.env` as backend for credentials):**

- Same Cashfree variables; cert validates PG base URL is exactly `https://sandbox.cashfree.com/pg`.

**Customer platform (manual checkout):**

- `NEXT_PUBLIC_API_BASE_URL=http://localhost:5000/api/v1`
- `NEXT_PUBLIC_CASHFREE_CHECKOUT_ENABLED=true`
- `NEXT_PUBLIC_CASHFREE_CHECKOUT_MODE=sandbox`

## Domain routes (reuse — no cert-specific APIs)

| Step    | Route                                                           |
| ------- | --------------------------------------------------------------- |
| Payment | `POST/GET /api/v1/deliveries/:id/payment`                       |
| Confirm | `POST /api/v1/deliveries/:id/confirm` (requires payment `PAID`) |
| Cancel  | `POST /api/v1/deliveries/:id/cancel`                            |
| Webhook | `POST /api/v1/payments/webhooks/cashfree`                       |

Refund policy: after successful pre-pickup cancel, 100% of remaining prepaid amount; idempotency `cancel-refund:{cancellationId}`.

## Run certification

```bash
cd backend
npm run cert:cashfree-sandbox
```

The script prints a **delivery ID** and polls `GET /payment` for up to `CASHFREE_CERT_PAID_TIMEOUT_MS` (default 5 minutes).

### Manual browser checkout

1. Open customer app; sign in as the cert user (or use the delivery from the printed ID in admin/history if needed).
2. Complete booking payment flow: backend returns `paymentSessionId` → Cashfree JS checkout (sandbox) → **do not** treat checkout close as PAID.
3. Frontend polls backend until `status === PAID` ([wait-for-paid.ts](../../customer-platform/src/lib/payments/wait-for-paid.ts)).

Cert classifies **LIVE_E2E** when payment is PAID and latest `PaymentAttempt.gatewayPaymentId` does **not** start with `sim-` (cert simulated webhooks use `sim-`).

### External webhook (ngrok)

1. Start HTTPS tunnel to backend, e.g. `https://<id>.ngrok.io` → `localhost:5000`.
2. Set `CASHFREE_NOTIFY_URL=https://<id>.ngrok.io/api/v1/payments/webhooks/cashfree`.
3. `CASHFREE_WEBHOOK_ENABLED=true` on backend; match URL in Cashfree sandbox dashboard.
4. Complete sandbox payment; confirm tunnel receives POST from Cashfree (not only the cert script).
5. Optional strict mode: `CASHFREE_CERT_REQUIRE_EXTERNAL_WEBHOOK=true` → cert fails/blocks if PAID tier is not LIVE_E2E.

**Troubleshooting PENDING / strict BLOCKED**

- `GET /payment` and Cashfree GET order payments both **PENDING** → checkout not completed in sandbox (or payment still in flight). Open customer app for the printed **delivery ID**, finish Cashfree modal payment during the cert poll window.
- Backend log **`cashfree_webhook_ignored`** with `cashfreeWebhookType: WEBHOOK` and no `order_id` → dashboard connectivity test only; **HTTP 200 does not mean PAID**. Strict E2E needs **`cashfree_webhook_received`** with `eventType: PAYMENT_SUCCESS` and matching **`gatewayOrderId`** (`DOOT-<payment-uuid>` from cert output).
- **`PAYMENT_REQUIRED` on confirm** is expected while status is not PAID.
- Resume without recreating delivery: `CASHFREE_CERT_DELIVERY_ID=<uuid> npm run cert:cashfree-sandbox` after you complete payment.

Stop the tunnel when finished.

### Simulated webhook (handler regression only)

- `CASHFREE_CERT_RUN_SIMULATED_WEBHOOK=true` and `CASHFREE_WEBHOOK_ENABLED=true` on backend.
- Always labeled **SIMULATED** in cert output; does **not** prove external delivery.

### Resume after manual checkout

If the cert process exits during the poll window:

```bash
CASHFREE_CERT_DELIVERY_ID=<uuid-from-output> npm run cert:cashfree-sandbox
```

## Cert env flags

| Variable                                 | Default | Purpose                      |
| ---------------------------------------- | ------- | ---------------------------- |
| `CASHFREE_CERT_PAID_TIMEOUT_MS`          | 300000  | Poll for PAID after create   |
| `CASHFREE_CERT_REFUND_TIMEOUT_MS`        | 120000  | Poll refund reconcile        |
| `CASHFREE_CERT_POLL_INTERVAL_MS`         | 2500    | Poll interval                |
| `CASHFREE_CERT_RUN_SIMULATED_WEBHOOK`    | false   | Local signed PAYMENT_SUCCESS |
| `CASHFREE_CERT_REQUIRE_EXTERNAL_WEBHOOK` | false   | Require LIVE_E2E PAID tier   |
| `CASHFREE_CERT_DELIVERY_ID`              | —       | Resume run for same delivery |

## Step modes in output

| Mode      | Meaning                                                      |
| --------- | ------------------------------------------------------------ |
| LIVE_API  | Cashfree PG HTTP from cert client or API-driven setup        |
| LIVE_E2E  | PAID with non-`sim-` gateway payment id (checkout/webhook)   |
| SIMULATED | Locally signed webhook or sim PAID path                      |
| BLOCKED   | Not verified in this run (timeout, no refund terminal state) |

Full **CERTIFIED** headline only when automated steps pass, LIVE_E2E PAID, external webhook verified, and refund reconciled to SUCCESS.
