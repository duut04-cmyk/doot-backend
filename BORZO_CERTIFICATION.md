# Borzo Integration Certification

**Provider:** Borzo  
**Environment:** Sandbox  
**Certification status:** Operational sandbox certification passed  
**Date:** 2026-09-22

## 1. Scope

This document records the certification evidence for the DOTT Borzo provider integration.

The certification covers:

- Provider authentication and connectivity
- Quote and serviceability
- Sandbox booking
- Booking retrieval
- Tracking and courier lookup
- GPS/tracking URL retrieval
- Sandbox cancellation
- Webhook signature verification
- Webhook idempotency and duplicate handling
- Webhook payload validation
- Webhook event ingestion and persistence

This certification does **not** authorize production Borzo usage.

---

## 2. Provider Configuration

The certified Borzo configuration is:

- Environment: `SANDBOX`
- Base URL: `https://robotapitest-in.borzodelivery.com/api/business/1.8`
- Authentication: `X-DV-Auth-Token`
- Preferred credential: `ACCESS_TOKEN`
- Credentials: encrypted at rest; no credential values are recorded in this document
- Production Borzo endpoints are intentionally blocked by the DOTT Phase 4 environment guard

Certified capabilities:

```text
PRICING
SERVICEABILITY
BOOKING
CANCELLATION
LIVE_TRACKING
WEBHOOKS
```

The following capabilities are intentionally **not** declared:

```text
AVAILABILITY
OTP
```

Borzo `checkin_code` is a provider-side field and is not mapped to DOTT's platform-owned OTP flow.

See **`BORZO_OTP_CHECKIN_CERTIFICATION.md`** for the OTP/check-in sandbox certification (Architecture A: DOTT-authoritative OTP).

---

## 3. Provider Connectivity

### Admin test connection

Endpoint:

```text
POST /api/v1/admin/providers/{providerId}/test-connection
```

Result:

```json
{
  "success": true,
  "data": {
    "providerCode": "BORZO",
    "environment": "SANDBOX",
    "connected": true
  }
}
```

Observed latency was approximately 2.2 seconds.

Provider state after successful connection testing:

```text
integrationStatus = READY
health = HEALTHY
status = ACTIVE
enabled = true
orchestrationEnabled = true
```

---

## 4. Quote and Serviceability

### Admin test quote

A Chandigarh Sector 17 → Sector 22 route was used for the DOTT provider test.

Result:

```text
quoteAvailable: true
serviceable: true
amount: INR 55
service: standard
packageCompatible: true
availability.known: false
```

The provider returned:

```text
borzoOrderType: standard
borzoVehicleTypeId: 8
```

Fee breakdown:

```text
deliveryFee: INR 55
weightFee: INR 0
insuranceFee: INR 0
loadingFee: INR 0
waitingFee: INR 0
returnFee: INR 0
```

The availability result is intentionally treated as unknown because Borzo's price-calculation response does not provide driver availability.

---

## 5. Sandbox Operational Smoke Test

A dedicated Borzo sandbox order was created and then cancelled during the operational smoke test.

### Fixture

```text
Pickup: Saket, New Delhi, Delhi
Drop: Janakpuri, New Delhi, Delhi
Package: Documents
Weight: 1 kg
Vehicle type: 8 (motorbike)
Order type: standard
Schedule: ASAP
```

### Results

| Operation                 | HTTP | Result             |
| ------------------------- | ---: | ------------------ |
| Health / connection       |  200 | Connected          |
| `calculate-order`         |  200 | Available; INR 257 |
| `create-order`            |  200 | Created            |
| Tracking / courier lookup |  200 | Successful         |
| `cancel-order`            |  200 | Cancelled          |

Sandbox booking:

```text
providerBookingId: 331467
initial provider status: new
```

Tracking returned:

```text
provider status: available
driver present: false
GPS coordinates: returned
tracking URL: returned
```

Cancellation returned:

```text
outcome: CANCELLED
provider status: canceled
```

The order was cancelled successfully and no DOTT database records were created by the standalone operational smoke script.

---

## 6. `getBooking` Certification

A read-only `getBooking` verification was performed against the existing sandbox order `331467`.

DOTT adapter operation:

```text
GET /orders?order_id=331467
```

Result:

```json
{
  "success": true,
  "outcome": "BOOKED",
  "providerBookingId": "331467",
  "providerReference": "31467",
  "status": "canceled",
  "trackingUrl": "https://apitest.borzodelivery.com/in/track/PGEKYG99H341IN",
  "driverPresent": false
}
```

The response also contained the Borzo order status metadata and fee breakdown.

The provider booking ID matched the requested ID and Borzo reported the order as cancelled.

### Current mapper behavior

The normalized adapter result reports:

```text
outcome = BOOKED
status  = canceled
```

This reflects the current DOTT adapter contract/mapper. It should not be interpreted as the provider order still being active.

No code change was made as part of this certification.

---

## 7. Webhook Certification

Webhook endpoint:

```text
POST /api/v1/providers/borzo/webhooks
```

Local certification target:

```text
http://localhost:5000/api/v1/providers/borzo/webhooks
```

Headers:

```text
Content-Type: application/json
X-DV-Signature
```

Signature:

```text
HMAC-SHA256
hex encoded
computed over the raw request body
```

### Test results

| Test                              | HTTP | Result                               |
| --------------------------------- | ---: | ------------------------------------ |
| Valid `order-created.json`        |  200 | `received: true`, `duplicate: false` |
| Duplicate same fixture            |  200 | `received: true`, `duplicate: true`  |
| Invalid signature                 |  401 | `INVALID_PROVIDER_WEBHOOK_SIGNATURE` |
| Missing signature                 |  401 | `INVALID_PROVIDER_WEBHOOK_SIGNATURE` |
| Unknown event type                |  400 | `VALIDATION_ERROR`                   |
| Malformed JSON                    |  400 | `VALIDATION_ERROR`                   |
| `order-changed.json`              |  200 | Ingested                             |
| `order-created-with-courier.json` |  200 | Ingested                             |
| `delivery-created.json`           |  200 | Ingested                             |
| `delivery-changed.json`           |  200 | Ingested                             |

Five `ProviderWebhookEvent` records were persisted.

All five had:

```text
processingStatus = IGNORED
```

because the fixture provider IDs did not correspond to a persisted DOTT `ProviderBooking`.

No DOTT delivery, tracking, or driver rows were modified.

### Webhook events covered

```text
order_created
order_changed
delivery_created
delivery_changed
```

### Important scope limitation

This certification exercised DOTT's local webhook ingestion endpoint.

It did **not** verify Borzo sandbox → public HTTPS endpoint → DOTT callback delivery.

That requires:

1. A publicly reachable HTTPS endpoint/tunnel.
2. Borzo callback configuration.
3. A Borzo-generated callback.

This is a separate infrastructure/integration test.

---

## 8. Current Orchestration Status

Borzo is currently:

```text
integrationStatus = READY
health = HEALTHY
```

However, Borzo is **not currently eligible for DOTT orchestration**.

The current orchestration exclusion is:

```text
CANCELLATION_POLICY_UNKNOWN
```

This is intentional.

DOTT currently requires a known cancellation policy before selecting a provider for orchestration.

Borzo's public India documentation does not provide a single sufficiently reliable account-specific cancellation-fee schedule for DOTT to hardcode.

The available public material contains differing cancellation-fee descriptions. Therefore DOTT must not infer or hardcode a specific Borzo cancellation fee from those documents.

---

## 9. Cancellation Policy Resolution Required

Before enabling Borzo for actual DOTT orchestration, obtain written confirmation from Borzo for the DOTT business account covering:

1. Cancellation eligibility before pickup/collection.
2. Cancellation eligibility after pickup/collection.
3. Whether "address visited" in the API maps to DOTT's pickup boundary.
4. Exact cancellation fee schedule.
5. Whether the fee differs by order status.
6. Whether the fee differs between sandbox and production.
7. Whether the fee is account-specific or globally applicable to the India Business API.
8. Any refund behavior associated with cancellation.

Once verified, the DOTT adapter can expose a documented cancellation policy with an appropriate source such as:

```text
DUTT_CONFIG
```

or a documented hybrid/provider source where appropriate.

Until then:

```text
policyKnown = false
```

must remain the honest representation.

---

## 10. Safety and Production Boundary

The certification above is sandbox-only.

Do not:

- Use production Borzo credentials for this certification.
- Change the Borzo base URL to production.
- Enable `OTP` or `AVAILABILITY` merely to make orchestration eligible.
- Hardcode an unverified cancellation fee.
- Reuse the cancelled certification order for a new DOTT delivery.
- Treat Borzo `checkin_code` as DOTT's OTP.
- Consider local webhook testing equivalent to public callback delivery.

Production Borzo use remains blocked until the provider certification and DOTT orchestration requirements are explicitly completed.

---

## 11. Known Test Artifacts

### DOTT delivery

The following delivery was used during early provider/orchestration probing:

```text
DOTT-1005
```

It produced a `OPTION_READY` orchestration result with MOCK selected and should **not** be reused for Borzo confirmation testing.

Use a fresh delivery for the eventual Borzo orchestration certification.

### Borzo sandbox order

```text
providerBookingId: 331467
providerReference: 31467
final provider status: canceled
```

This order is a completed certification artifact and should not be reused.

---

## 12. Certification Verdict

### Borzo sandbox adapter

**PASSED**

The following areas are certified:

```text
Authentication
Connectivity
Health check
Quote
Serviceability
Booking
Booking retrieval
Tracking
Courier lookup
GPS retrieval
Tracking URL
Cancellation
Webhook signature verification
Webhook idempotency
Webhook validation
Webhook event ingestion
```

### DOTT orchestration readiness

**BLOCKED BY CANCELLATION POLICY**

Borzo is technically configured and healthy, but DOTT should not select it for orchestration until the account-specific cancellation policy has been verified and implemented.

### Remaining work

1. Obtain written Borzo cancellation-policy confirmation.
2. Implement `getCancellationPolicy()` using the verified terms.
3. Re-run provider readiness/orchestration certification.
4. Use a fresh DOTT delivery for the first DOTT-managed Borzo sandbox booking.
5. Verify persisted booking, tracking, driver, refresh, webhook, and cancellation behavior on that DOTT-linked booking.
6. Separately test public HTTPS Borzo callbacks if required.

---

## 13. Certification Principle

No provider behavior is considered certified merely because the adapter can parse or construct an API request.

Certification requires evidence from the actual sandbox/provider behavior where applicable, while account-specific commercial policies must be explicitly verified rather than inferred.
