# Local customer app + live (Render) backend

Use this when the browser runs at **http://localhost:3000** but API calls go to **https://doot-backend.onrender.com/api/v1**.

## 1. Customer platform (`.env.local`)

```env
NEXT_PUBLIC_API_BASE_URL=https://doot-backend.onrender.com/api/v1

NEXT_PUBLIC_CASHFREE_CHECKOUT_ENABLED=true
NEXT_PUBLIC_CASHFREE_CHECKOUT_MODE=sandbox

# Show "Simulate next step" on tracking (MOCK deliveries only)
NEXT_PUBLIC_DEV_SIMULATE_DELIVERY=true
# Optional: inject MOCK quote in UI when orchestration returns no option
NEXT_PUBLIC_DEV_MOCK_ORCHESTRATION=true
```

Restart `npm run dev` after changes.

## 2. Render backend — CORS

The backend only allows browser origins listed in **`FRONTEND_URL`** and **`ADMIN_FRONTEND_URL`** (`src/app.ts`).

For local UI against Render API, set on Render:

```env
FRONTEND_URL=http://localhost:3000
```

(Use your production customer URL in production; for mixed local testing you may need a comma-separated origins feature or temporarily point `FRONTEND_URL` at localhost.)

Redeploy after changing env.

## 3. Render backend — delivery simulation (`/dev/advance`)

Simulation is **opt-in** via **`ENABLE_DEV_DELIVERY_SIMULATE=true`** for backends where **`NODE_ENV` is not `production`**. When **`NODE_ENV=production`**, startup validation rejects this flag.

For hosted `/dev/advance` testing, use a **dedicated isolated staging** API (access-controlled, not customer-facing) with explicit non-production env flags. Do **not** weaken `NODE_ENV` on a production-like public service; see the backend README “Staging on a public URL” note.

Requirements for a delivery:

1. **`provider_bookings.status = BOOKED`** (complete payment → **confirm booking** successfully).
2. **`providerCode = MOCK`** (simulator rejects real providers).

For MOCK bookings on live API, also set:

```env
ENABLE_MOCK_PROVIDER_ADAPTER=true
ENABLE_DEV_DELIVERY_SIMULATE=true
```

Optional for faster quotes in non-prod:

```env
ORCHESTRATION_MOCK_ONLY=true
```

**`BOOKING_NOT_FOUND`** on `dev/advance` means there is no **BOOKED** provider row for that delivery—fix confirm booking after payment, not the simulate flag alone.

## 4. Cashfree sandbox — local frontend + live backend

Payment **return URL** and **webhooks** are configured on the **backend** (Render), not in Next.js.

### Render env (sandbox)

```env
PAYMENT_GATEWAY=cashfree
CASHFREE_ENABLED=true
CASHFREE_ENVIRONMENT=sandbox
CASHFREE_CLIENT_ID=<sandbox app id>
CASHFREE_CLIENT_SECRET=<sandbox secret>
CASHFREE_API_VERSION=2025-01-01

# Where Cashfree sends the customer after pay — use LOCAL app while testing from localhost
CASHFREE_RETURN_URL=http://localhost:3000/checkout/success

# Public HTTPS URL Cashfree calls for PAYMENT_SUCCESS (required for PAID → confirm)
CASHFREE_NOTIFY_URL=https://doot-backend.onrender.com/api/v1/payments/webhooks/cashfree
CASHFREE_WEBHOOK_ENABLED=true
```

Cashfree sandbox generally allows `http://localhost:3000` as return URL when set in **`CASHFREE_RETURN_URL`**.

### Ngrok (webhooks to Render)

1. Run ngrok pointing at **Render** (not localhost), e.g. if you only have Render as backend, tunnel is unnecessary for API—but Cashfree must reach **Render’s webhook route**. Use Render’s public URL directly in **`CASHFREE_NOTIFY_URL`**:

   `https://doot-backend.onrender.com/api/v1/payments/webhooks/cashfree`

2. Register that URL in the Cashfree sandbox dashboard.
3. Without a successful **PAYMENT_SUCCESS** webhook, payment may stay **PENDING** and **confirm booking** will fail with **PAYMENT_REQUIRED**.

### End-to-end flow

1. Create delivery → orchestrate (MOCK if mock flags on).
2. **POST** `/deliveries/:id/payment` → open Cashfree checkout (modal).
3. Pay in sandbox → Cashfree hits **notify URL** → backend marks payment **PAID**.
4. App polls/waits (`waitForPaymentPaid`) then **POST confirm**.
5. Tracking → **Simulate next step** calls **POST** `/deliveries/:id/dev/advance`.

### Other Render env (auth / email)

- **`GOOGLE_CLIENT_ID`** — same Web client as `NEXT_PUBLIC_GOOGLE_CLIENT_ID`; add `http://localhost:3000` in Google Console **JavaScript origins**.
- **`RESEND_API_KEY`** + **`RESEND_FROM_EMAIL`** — required for email signup OTP.

## 5. All-local alternative (simplest)

```env
# customer-platform
NEXT_PUBLIC_API_BASE_URL=http://localhost:5000/api/v1

# backend .env
FRONTEND_URL=http://localhost:3000
CASHFREE_RETURN_URL=http://localhost:3000/checkout/success
CASHFREE_NOTIFY_URL=https://<ngrok>/api/v1/payments/webhooks/cashfree
```

No CORS mismatch; return URL and webhooks stay on your machine.
