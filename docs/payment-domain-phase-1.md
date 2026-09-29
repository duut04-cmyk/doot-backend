# DOTT Payment Domain — Phase 1

Provider-neutral payment foundation. **Cashfree integration is NEXT PHASE** (not included here).

## No customer wallet

DOTT does **not** implement a spendable customer wallet (`CustomerWallet`, balances, wallet transactions).  
Financial activity is recorded in an **append-only internal ledger** (`LedgerEntry`) for audit and future reconciliation — not as stored spendable balance.

## Payment vs ledger

| Concept            | Role                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------ |
| **Payment**        | Business payment intent for a delivery (amount from orchestration quote, status lifecycle) |
| **PaymentAttempt** | Gateway collection attempts for one payment                                                |
| **Refund**         | Separate refund entity (partial/full)                                                      |
| **LedgerEntry**    | Immutable financial event (CUSTOMER_PAYMENT, REFUND, etc.)                                 |

## Payment lifecycle

```
CREATED → PENDING → PAID | FAILED | EXPIRED
PAID → PARTIALLY_REFUNDED → REFUNDED
```

Transitions are enforced in `payment.transitions.ts` and `PaymentService`.

## Refund lifecycle

```
REQUESTED → PENDING → SUCCESS | FAILED
REQUESTED → CANCELLED
```

Sum of active/successful refunds must never exceed paid amount.

## Idempotency

- **Payment create:** optional `Idempotency-Key` → `PaymentCreateIdempotencyKey`
- **Payment success ledger:** unique `LedgerEntry.idempotencyKey` (`payment-paid:{paymentId}`)
- **Refund ledger:** unique `refund:{refundId}`
- **Refund request:** unique `Refund.idempotencyKey`

Duplicate success processing must not double-create ledger rows.

## Gateway abstraction

`PaymentGateway` interface + `STUB` implementation only.  
Future: `CashfreeGateway implements PaymentGateway` in a controlled Phase 2 step.

## Delivery integration (deferred)

MOCK lifecycle remains: `OPTION_READY → BOOKING → BOOKED`.  
Payment is created at `OPTION_READY` without changing delivery status yet.  
Future: insert `PAYMENT_PENDING` / `PAYMENT_PAID` before confirm/booking.

## Cancellation → refund (boundary)

Cancellation policy remains in the cancellation module.  
Phase 2 will call `PaymentService.requestRefund()` after policy computes fee/refund — no gateway calls in Phase 1.

## Provider payable / payouts

Ledger type `PROVIDER_PAYABLE` is reserved for future provider settlement accounting. No Shiprocket/NimbusPost payout code in Phase 1.

## Security

- No gateway secrets, card data, CVV, or UPI PIN in the database
- Gateway credentials stay in environment/config (Phase 2)
- Do not log full payment payloads

## Reconciliation (future)

Fields `gatewayOrderId`, `gatewayPaymentId`, `gatewayRefundId` support future DOTT ↔ gateway reconciliation. Settlement is out of scope for Phase 1.
