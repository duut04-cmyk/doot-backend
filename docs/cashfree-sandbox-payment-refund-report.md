# Cashfree Sandbox Payment, Refund, Cancel, Webhook — Final Report

Date: 2026-10-10  
Scope: sandbox only. No production Cashfree charges. No COD. No Prisma migration.

## Verdict

Backend payment domain now enforces **PAID before confirm**, creates Cashfree refunds via PG API `2025-01-01`, refunds **100% remaining prepaid** after successful pre-pickup cancel, and processes **REFUND_SUCCESS / REFUND_FAILED** webhooks. Unit/integration suite is green. **Live sandbox cert was not completed in this run** (DB host unreachable from this environment); do not treat as production-ready until external webhook + live refund are verified on a reachable sandbox stack.

## Files changed (primary)

| Area            | Files                                                                                                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gateway refunds | `src/modules/payment/gateways/cashfree-payment.gateway.ts`, `payment-gateway.types.ts`, `payment-gateway.interface.ts`, `stub-payment.gateway.ts`                                                                                                 |
| Domain          | `src/modules/payment/payment.service.ts`, `payment.repository.ts`                                                                                                                                                                                 |
| Confirm gate    | `src/modules/booking/booking.service.ts`, `src/core/errors/error-codes.ts` (`PAYMENT_REQUIRED`)                                                                                                                                                   |
| Cancel → refund | `src/modules/cancellation/cancellation-refund.ts`, `cancellation.service.ts`, `cancellation.repository.ts`                                                                                                                                        |
| Webhooks        | `gateways/cashfree/cashfree-webhook.normalize.ts`, `webhook/payment-webhook.service.ts`, `webhook/cashfree-payment-webhook.service.ts`                                                                                                            |
| Env / docs      | `src/config/env.ts`, `.env.example`, `customer-platform/.env.local.example`                                                                                                                                                                       |
| Cert scripts    | `scripts/mock-customer-lifecycle-certification.ts`, `scripts/cashfree-sandbox-certification.ts`                                                                                                                                                   |
| Tests           | `tests/payment.service.test.ts`, `cashfree-payment.gateway.test.ts`, `cashfree-webhook.normalize.test.ts`, `cashfree-payment-webhook.service.test.ts`, `cancellation-refund.test.ts`, booking/cancellation test wiring + `seedPaidPayment` helper |

## Env name checklist (no values)

**Backend (secrets stay here / Render):**

- `PAYMENT_GATEWAY` — `stub` \| `cashfree`
- `CASHFREE_ENABLED`
- `CASHFREE_ENVIRONMENT` — must be `sandbox` (production rejected)
- `CASHFREE_CLIENT_ID`
- `CASHFREE_CLIENT_SECRET`
- `CASHFREE_API_VERSION` — default `2025-01-01`
- `CASHFREE_RETURN_URL`
- `CASHFREE_NOTIFY_URL` — public HTTPS (ngrok locally); alone does **not** prove delivery
- `CASHFREE_WEBHOOK_ENABLED`

**Customer platform (public only):**

- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_CASHFREE_CHECKOUT_ENABLED`
- `NEXT_PUBLIC_CASHFREE_CHECKOUT_MODE=sandbox`

## State transitions

**Payment:** `CREATED` → `PENDING` → `PAID` (Cashfree webhook / reconcile). STUB auto-marks `PAID` after checkout create.

**Confirm:** requires delivery payment `status === PAID`; else `422 PAYMENT_REQUIRED`.

**Refund:** `REQUESTED` → `PENDING` → `SUCCESS` \| `FAILED`. Gateway PENDING does not auto-SUCCESS. Over-refund blocked via `sumActiveRefundAmounts`.

**Cancel:** provider/local cancel success → refund remaining if `PAID` \| `PARTIALLY_REFUNDED` with idempotency `cancel-refund:{cancellationId}`. Cancel stays successful if refund fails; response includes refund summary.

**Webhooks:** `REFUND_SUCCESS` / `REFUND_FAILED` resolve Refund by gateway/merchant refund id; SUCCESS is not overwritten by later FAILED.

## Test results

| Check                           | Result                                                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                      | **486/486 passed** (74 files)                                                                                                           |
| `npm run typecheck`             | **pass**                                                                                                                                |
| `npm run cert:cashfree-sandbox` | **not completed** — Prisma `ENOTFOUND` for configured `DATABASE_URL` after health check; re-run with reachable DB + sandbox credentials |

## Local E2E commands

```bash
# Stub / mock lifecycle (backend with ENABLE_MOCK_PROVIDER_ADAPTER=true)
EXPOSE_OTP_FOR_CERTIFICATION=true npx tsx scripts/mock-customer-lifecycle-certification.ts

# Cashfree sandbox cert (backend running PAYMENT_GATEWAY=cashfree, CASHFREE_*=sandbox)
npm run cert:cashfree-sandbox
```

## Real sandbox checkout steps

1. Set backend Cashfree sandbox credentials; `PAYMENT_GATEWAY=cashfree`, `CASHFREE_ENABLED=true`, `CASHFREE_ENVIRONMENT=sandbox`.
2. Point `CASHFREE_RETURN_URL` at customer checkout success route.
3. Expose webhook with ngrok → `CASHFREE_NOTIFY_URL` + `CASHFREE_WEBHOOK_ENABLED=true`.
4. Create delivery → orchestrate → `POST .../payment` → Cashfree JS checkout → wait for `PAYMENT_SUCCESS` webhook → `POST .../confirm`.
5. Pre-pickup `POST .../cancel` → expect refund summary; confirm `REFUND_*` webhook or poll `reconcileRefundStatus`.

## Remaining manual Cashfree prerequisites

- Reachable Postgres for cert script user/delivery seed
- Cashfree sandbox app with refunds enabled
- Public notify URL verified in Cashfree dashboard / ngrok traffic (not only local signed posts)
- Optional: live refund SUCCESS on a real sandbox order (not claimed from unit tests alone)

## Out of scope (unchanged)

Borzo/Shadowfax, production Cashfree, inventing COD or cancellation fees, claiming external webhook success from local signed simulation alone.
