# Borzo OTP / Check-in Code Certification

**Provider:** Borzo Business API 1.8 (India sandbox)  
**Environment:** `https://robotapitest-in.borzodelivery.com/api/business/1.8`  
**Date:** 2026-09-22  
**Certification status:** Sandbox contract verified; courier check-in **not** observable

---

## 1. Objective

Determine how DOTT pickup/delivery OTP relates to Borzo `checkin_code`, and whether DOTT should map OTP into Borzo or remain authoritative.

---

## 2. Terminology correction

Borzo Business API 1.8 does **not** define `pickup_checkin_code`.

| Borzo field                 | Scope                                                                 |
| --------------------------- | --------------------------------------------------------------------- |
| `points[].checkin_code`     | Per-point courier arrival PIN (pickup = index 0, delivery = index 1+) |
| `points[].checkin`          | Read-only output after courier closes a point                         |
| `return_point.checkin_code` | Return-point PIN (failed delivery)                                    |

---

## 3. DOTT OTP findings

| Question                            | Answer                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------ |
| DOTT generates pickup OTP?          | **Yes** — `OtpService.generatePickupOtp()`                               |
| DOTT generates delivery OTP?        | **Yes** — `OtpService.generateDeliveryOtp()`                             |
| Customer delivery channel           | Email (always); MSG91 SMS when configured                                |
| Verification owner                  | **DOTT only** — bcrypt hash, expiry, attempts, consume                   |
| State transitions                   | `PICKUP_OTP_PENDING` → `PICKED_UP`; `DELIVERY_OTP_PENDING` → `DELIVERED` |
| Provider can drive OTP states?      | **No** — `tracking.service.ts` blocks provider `PICKED_UP` / `DELIVERED` |
| Borzo adapter sends `checkin_code`? | **No** — explicit negative test                                          |
| Borzo `OTP` capability declared?    | **No** — `BORZO_CERTIFICATION.md`                                        |

Verify endpoints are customer-authenticated (`loadAuthorizedDelivery`). There is no separate driver OTP verify API today.

---

## 4. Borzo API documentation findings

Source: [Borzo Business API 1.8](https://borzodelivery.com/in/business-api/doc)

| Property                             | Documented behavior                                      |
| ------------------------------------ | -------------------------------------------------------- |
| `checkin_code` request (create/edit) | Optional, client-writable, max 255 chars                 |
| `checkin_code` response              | Returned on each point                                   |
| `checkin` object                     | Output after point closure (`recipient_full_name`, etc.) |
| `courier_visit_datetime`             | Actual arrival timestamp (output)                        |
| Verification API                     | **None** — verification is courier-app internal          |
| `/courier`                           | No check-in fields                                       |
| Webhooks                             | Status/courier/tracking; check-in fields not guaranteed  |

---

## 5. Sandbox experiments

All orders were fresh. Orders **331467**, **DOTT-1004**, **DOTT-1005** were not reused.

### Experiment #1 — No check-in codes

| Item                          | Result                     |
| ----------------------------- | -------------------------- |
| Borzo order ID                | `331468`                   |
| create-order HTTP             | 200, `is_successful: true` |
| Order status (create)         | `new` / `Created`          |
| Order status (GET)            | `available` / `Available`  |
| Pickup point `checkin_code`   | `null`                     |
| Delivery point `checkin_code` | `null`                     |
| `checkin`                     | `null` on both points      |
| `courier_visit_datetime`      | `null`                     |
| Delivery status (drop point)  | `planned`                  |
| Courier assigned              | No                         |
| Cancelled after test          | Yes                        |

### Experiment #2 — Client-supplied codes

Synthetic test values only (not real customer OTP):

- Pickup `points[0].checkin_code`: `481731`
- Delivery `points[1].checkin_code`: `629415`

| Item                                 | Result                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| Borzo order ID                       | `331469` (also confirmed on raw HTTP order `331471`)                                 |
| create-order HTTP                    | 200 — **not rejected**                                                               |
| API errors / parameter_errors        | None                                                                                 |
| create-order response `checkin_code` | **`null` on both points** (not echoed)                                               |
| GET /orders `checkin_code`           | **`null` on both points**                                                            |
| Courier endpoint                     | No check-in fields                                                                   |
| Conclusion                           | **Request accepted; values silently not persisted/returned on this sandbox account** |

### Experiment #3 — Edit after booking

Edited order `331469` via `POST /edit-order`:

```json
{
  "order_id": 331469,
  "points": [
    { "point_id": 715225, "checkin_code": "902184" },
    { "point_id": 715226, "checkin_code": "715306" }
  ]
}
```

| Item                          | Result                                                     |
| ----------------------------- | ---------------------------------------------------------- |
| edit-order HTTP               | 200, `is_successful: true`                                 |
| Response / GET `checkin_code` | **`null` on both points**                                  |
| Conclusion                    | Edit accepted but codes **not reflected** in API responses |

### Courier verification

**Code association verified; courier verification not sandbox-observable.**

No sandbox path to simulate courier PIN entry. `checkin` and `courier_visit_datetime` remained null without live courier completion.

---

## 6. Webhook certification

### A. Parser / integration tests (local)

Existing signed webhook tests validate signature, idempotency, parsing, ingestion. Fixtures do **not** include `checkin_code` or `checkin`. Schemas use `.passthrough()` so unknown fields would not break parsing; mappers do **not** extract check-in fields.

### B. Real Borzo sandbox callbacks

**Not certified in this run.** No live callback with check-in fields was captured.

---

## 7. Architecture decision

### Selected: **Architecture A — DOTT-authoritative OTP**

```
DOTT generates pickup/delivery OTP
  → customer receives (email + optional SMS)
  → customer shares OTP with driver (out of band)
  → DOTT verifies OTP (platform API)
  → DOTT transitions PICKED_UP / DELIVERED

Borzo checkin_code: NOT mapped, NOT treated as DOTT OTP
Borzo webhooks/tracking: MUST NOT drive OTP-gated states
```

### Why (sandbox + code evidence)

1. DOTT OTP stack is complete, hashed, rate-limited, and isolated from providers.
2. Borzo adapter intentionally excludes `checkin_code` (test-enforced).
3. **Sandbox account does not persist or return client-supplied `checkin_code`** despite HTTP 200 — Architecture B cannot be implemented reliably on this account without Borzo account enablement.
4. No Business API verification endpoint exists; even with mapping, DOTT would remain the verification authority.
5. Tracking guards already prevent false pickup/delivery completion from Borzo `finished` status.

### Architecture B (DOTT OTP → Borzo `checkin_code`) — **deferred**

Requires evidence that:

- Sandbox/production account **persists and returns** supplied codes, and
- Courier app **uses** them (not observable here).

Contact `api.in@borzodelivery.com` to confirm whether check-in codes require account-level feature enablement.

### Architecture C (two-code model) — **not indicated**

No provider-generated codes appeared when client omitted `checkin_code`.

---

## 8. Implementation

**No production adapter changes required** for Architecture A.

| File                                     | Change                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| `scripts/borzo-checkin-certification.ts` | **Added** — repeatable sandbox certification runner                             |
| `BORZO_OTP_CHECKIN_CERTIFICATION.md`     | **Added** — this document                                                       |
| `tests/borzo.schemas.test.ts`            | **Added** — schema passthrough for `checkin_code` when present in provider JSON |

DOTT OTP implementation unchanged. Borzo mapper unchanged (still does not send `checkin_code`).

---

## 9. Security

| Rule                                   | Status                               |
| -------------------------------------- | ------------------------------------ |
| No OTP in production logs              | OK                                   |
| No checkin_code in logs                | OK — not sent by adapter             |
| No credentials in certification output | OK                                   |
| Test OTP exposure                      | `_testOtp` only when `NODE_ENV=test` |

---

## 10. Test results

Run after certification (see CI output in session):

- Targeted: `borzo-operational.mapper.test.ts`, `borzo.schemas.test.ts`, `otp.service.test.ts`, `provider.borzo-webhook*.test.ts`
- Full suite, typecheck, lint, build

`OPERATIONAL_POLLING_ENABLED` remains `false`.

---

## 11. Remaining blockers for full Borzo lifecycle

```
CREATE → ORCHESTRATE → CONFIRM → BOOKED → DRIVER_ASSIGNED
  → PICKUP OTP → PICKED_UP → IN_TRANSIT → DELIVERY OTP → DELIVERED
```

| Stage                                                  | Status                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------- |
| Borzo booking / tracking / cancel / webhooks (adapter) | Certified (`BORZO_CERTIFICATION.md`)                                |
| OTP/check-in Borzo integration                         | **Not applicable** — Architecture A                                 |
| DOTT OTP lifecycle (platform)                          | Implemented; independent of Borzo                                   |
| Borzo courier check-in verification                    | **Not sandbox-observable**                                          |
| Orchestration selection                                | Still blocked by **cancellation policy** (`BORZO_CERTIFICATION.md`) |
| Driver OTP verify UX                                   | Customer-authenticated API only; driver app TBD                     |

**Verdict:** Proceed with DOTT-authoritative OTP for the sandbox lifecycle. Do **not** map DOTT OTP to Borzo `checkin_code` until Borzo confirms account support and sandbox echoes persisted codes.

---

## 12. Reproduction

```bash
cd backend
BORZO_SANDBOX_SMOKE_TEST=true npx tsx scripts/borzo-checkin-certification.ts
```

Requires `BORZO_ACCESS_TOKEN` in `.env`. Script cancels all created orders.
