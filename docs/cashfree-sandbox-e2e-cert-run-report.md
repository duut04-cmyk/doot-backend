# Cashfree Sandbox E2E Cert — Run Report (2026-10-10)

Automated run in CI/dev environment with short timeouts and simulated webhook path.

## Implementation delivered

- Cert library: [backend/scripts/lib/cashfree-cert/](../scripts/lib/cashfree-cert/)
- Rewritten harness: [backend/scripts/cashfree-sandbox-certification.ts](../scripts/cashfree-sandbox-certification.ts)
- Gateway success logging: [cashfree-payment.gateway.ts](../src/modules/payment/gateways/cashfree-payment.gateway.ts)
- Docs: [cashfree-sandbox-e2e-certification.md](./cashfree-sandbox-e2e-certification.md)
- Unit tests: `tests/cashfree-cert-*.test.ts` (14 cases)

## Automated tests

| Command             | Result                        |
| ------------------- | ----------------------------- |
| `npm test`          | **500/500 passed** (78 files) |
| `npm run typecheck` | **pass**                      |

## Certification script (this environment)

Command:

```bash
CASHFREE_CERT_PAID_TIMEOUT_MS=3000 \
CASHFREE_CERT_RUN_SIMULATED_WEBHOOK=true \
npm run cert:cashfree-sandbox
```

| Check                                                | Result                                                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Real Cashfree API — create order (via backend)       | **Yes** — LIVE_API PASS; session validated (prefix/length only in logs)                             |
| Real Cashfree API — GET order payments (cert client) | **Yes** — LIVE_API PASS (`normalized=PENDING` before pay)                                           |
| Real browser checkout                                | **No** — poll timeout (3s); not LIVE_E2E                                                            |
| Genuine external Cashfree webhook                    | **No** — SIMULATED webhook used (`sim-` cf_payment_id)                                              |
| PAID tier                                            | **SIMULATED**                                                                                       |
| Confirm + cancel via API                             | **PASS** (SIMULATED mode)                                                                           |
| Real Cashfree refund reconcile                       | **Attempted** — refund row **FAILED** in sandbox for this run; ledger refund entry **BLOCKED/SKIP** |
| Full E2E certified banner                            | **No** — requires LIVE_E2E + external webhook + refund SUCCESS                                      |

Exit code: **0** when all non-SKIP steps PASS (after recorder outcome fix); refund FAILURE remains BLOCKED, not a false PASS for full E2E.

## Remaining manual steps for full CERTIFIED run

1. Start backend with `PAYMENT_GATEWAY=cashfree`, mock provider, webhooks enabled.
2. Set ngrok `CASHFREE_NOTIFY_URL`; complete checkout in customer app for printed `deliveryId`.
3. Run cert with default `CASHFREE_CERT_PAID_TIMEOUT_MS=300000`, `CASHFREE_CERT_REQUIRE_EXTERNAL_WEBHOOK=true`, `CASHFREE_CERT_RUN_SIMULATED_WEBHOOK=false`.
4. Verify Cashfree sandbox refund completes (dashboard) if refund stays PENDING/FAILED.

## Gaps / notes

- Refund **FAILED** on simulated path may reflect Cashfree sandbox rules (no settled capture for sim webhook path) — investigate on real LIVE_E2E payment.
- Cert process and backend must share Cashfree credentials; PG host validated in cert process only (log server `cashfree_create_order_success` for server-side host).
