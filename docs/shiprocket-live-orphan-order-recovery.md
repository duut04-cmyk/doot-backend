# Shiprocket LIVE — Orphan order recovery (operational runbook)

This runbook covers the case where **Shiprocket may have created an order** but Doot cannot treat the booking as **BOOKED** with a valid AWB (for example `BOOKING_UNKNOWN`, missing AWB after assign, or live lifecycle execute stopped after book).

**Do not** run `verify:shiprocket-live-lifecycle --execute` again on the same delivery to “retry” booking. The runner rejects already-**BOOKED** deliveries and Doot booking confirm must not blindly create a second order for the same channel order id.

## Symptoms

- Doot: latest `ProviderBooking.status === UNKNOWN`, or live lifecycle stop codes `BOOKING_UNKNOWN` / `MISSING_AWB`.
- Customer delivery may still be `OPTION_READY` or `BOOKING` depending on where confirm stopped.
- Shiprocket: order may exist with channel order id equal to Doot’s external order id (`buildShiprocketExternalOrderId` / delivery reference flow in `shiprocket-order.util.ts`).

## 1. Identify the order

| Identifier                      | Where to find it                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Channel order id**            | Doot delivery reference / external order id used as `order_id` on Shiprocket create (`shiprocket-booking-payload.ts`). |
| **Shiprocket numeric order id** | `ProviderBooking.providerOrderId` or booking metadata `shiprocketOrderId` if persisted despite UNKNOWN.                |
| **Run evidence**                | `reports/shiprocket-live-lifecycle/<run-id>/` — `run-summary.json`, `*-exchange.json`, `db-*.json`.                    |

## 2. Query order details (read-only)

Use existing verified paths only (production host `apiv2.shiprocket.in`):

- **Order show:** `GET /v1/external/orders/show/{id}` — constant `SHIPROCKET_ORDER_SHOW_PATH_PREFIX` in `shiprocket.constants.ts`.
- **Via Doot adapter:** `ProviderAdapterExecutor` operation `getBooking` with `providerBookingId` set to the numeric order id or channel id per adapter behavior (`ShiprocketLifecycleService.getBooking`).

For sandbox-only read tooling pattern, see `npm run verify:shiprocket-sandbox-cancel -- --phase read` in `scripts/shiprocket-sandbox-cancel-verify.ts`. **Production:** use read-only order show / getBooking through approved ops tooling—not a second adhoc create.

## 3. Determine AWB / courier assignment

From order-show / `getBooking` metadata (`shiprocket-lifecycle.service.ts`):

- Valid AWB: `isValidShiprocketAwbCode` on `awbCode` / `shiprocketAwbCode`.
- Shipment id: `shiprocketShipmentId` / `providerReference`.

Optional tracking read (read-only):

- `GET /v1/external/courier/track/awb/{awb}` — `SHIPROCKET_TRACK_AWB_PATH_PREFIX`
- `GET /v1/external/courier/track/shipment/{id}` — `SHIPROCKET_TRACK_SHIPMENT_PATH_PREFIX`

## 4. Manual provider cancellation (decision)

- If the order is still **pre-pickup** and cancellable at Shiprocket, ops may cancel **once** using the same documented path Doot uses: `POST /v1/external/orders/cancel` (`SHIPROCKET_CANCEL_ORDERS_PATH`), via dashboard or controlled tooling—not a second `create/adhoc`.
- If Doot delivery is **not BOOKED**, do **not** use live lifecycle `--execute` cancel; eligibility is enforced in `CancellationService`.
- If order is in-transit, delivered, or cancel preflight is indeterminate (`isShiprocketCancelPreflightIndeterminate` in `shiprocket-cancel.reconcile.ts`), **stop** and escalate.

## 5. Reconcile Doot without creating another order

1. Read order-show with channel order id and/or numeric id.
2. If AWB is confirmed at provider, use normal Doot **reconciliation** paths (`BookingService.tryReconcileUnknownBooking` / operator workflows)—not a second live lifecycle execute book.
3. Shiprocket booking idempotency in code: `fetchExistingOrderSnapshot` before create (`shiprocket-booking.service.ts`) — never intentionally bypass with a new channel id for the same delivery.

## 6. When to escalate

- Non-cancellable provider state (in transit, delivered, RTO).
- Cancel outcome UNKNOWN or rejected at provider.
- Payment/refund already triggered (see `shiprocket-live-lifecycle-payment-effects.md`).
- Conflicting ids between artifacts, DB, and order-show.

**No automatic cancellation or blind retries are implemented in the live lifecycle runner by design.**
