# Shiprocket LIVE lifecycle — payment and refund side effects

The live lifecycle runner (`npm run verify:shiprocket-live-lifecycle`) uses **`CancellationService.cancel`** when `--execute` reaches the cancel phase (after `--confirm-cancel I_UNDERSTAND_CANCEL_ONCE`). It does **not** change payment or refund code.

## When refunds run

After a cancellation record finalizes as **`CANCELLED`**, `CancellationService` calls `refundPrepaidAfterCancellation` (`cancellation.service.ts`, `cancellation-refund.ts`).

Refund is attempted only when:

- A payment exists for the delivery with status **`PAID`** or **`PARTIALLY_REFUNDED`**, and
- Remaining refundable amount is greater than zero.

## Gateway behavior (stored on the Payment row)

Refund uses **`payment.gateway`** on the existing payment record, not the lifecycle runner flags.

| `Payment.gateway` | Behavior                                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **STUB**          | `PaymentService.requestRefund` → STUB gateway — in-process refund handling, **no Cashfree HTTP**.                                                   |
| **CASHFREE**      | `getPaymentGateway(payment.gateway).createRefund(...)` — **Cashfree Refund API** (sandbox or production per that payment’s Cashfree configuration). |

The `PAYMENT_GATEWAY` environment variable affects **new** payment creation defaults (`payment-gateway.config.ts`); it does **not** retroactively change an existing PAID row’s gateway.

## Guidance for live logistics verification

1. **Preferred for isolated Shiprocket LIVE tests:** use a delivery whose payment is **PAID with gateway STUB**, if your business and validation rules allow (same payment gate as booking confirm).
2. **If the delivery is PAID with gateway CASHFREE:** a successful Doot cancellation can trigger a **real Cashfree refund** for the remaining prepaid amount. Require explicit operator acceptance before passing `--confirm-cancel`.
3. The lifecycle runner does **not** disable, stub, or skip refunds; plan payment state before `--execute`.

## Related docs

- Orphan Shiprocket orders when booking is UNKNOWN: `shiprocket-live-orphan-order-recovery.md`
