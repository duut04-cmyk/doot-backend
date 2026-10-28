# Dutt Backend

API for the Dutt logistics and orchestration platform.

## Stack

- Node.js + TypeScript (ES modules)
- Express
- Prisma + PostgreSQL
- Zod
- Pino
- Vitest + Supertest
- Swagger / OpenAPI 3

## Project structure

```
src/
  config/           # Environment, logger, database, Swagger
  core/             # Errors, middleware, validation, utils
  infrastructure/   # Database and email adapters
  modules/          # Feature modules (auth scaffolded for later)
  routes/           # API version mounting
  app.ts            # Express application
  server.ts         # Process bootstrap and graceful shutdown
prisma/             # Prisma schema
tests/              # Vitest suites
```

## Setup

```bash
npm install
cp .env.example .env
# Set DATABASE_URL / DIRECT_URL when you are ready to use Postgres
npm run prisma:generate
```

## Environment

Copy `.env.example` to `.env` and fill values as features are implemented.

Required to start the HTTP server today:

- `NODE_ENV`
- `PORT`

### Production deployment (`NODE_ENV=production`)

The server **refuses to start** in production when development-only settings are active. Configure real integrations instead of `.env.example` defaults.

| Variable                       | Production requirement                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| `PAYMENT_GATEWAY`              | Must be `cashfree` (not `stub`) with `CASHFREE_ENABLED=true` and sandbox credentials |
| `SMS_PROVIDER`                 | Must be `msg91` or `twilio` with full credentials (not `mock`)                       |
| `ENABLE_MOCK_PROVIDER_ADAPTER` | Must be `false`                                                                      |
| `ENABLE_DEV_DELIVERY_SIMULATE` | Must be `false`                                                                      |
| `EXPOSE_OTP_FOR_CERTIFICATION` | Must be `false`                                                                      |
| `ORCHESTRATION_MOCK_ONLY`      | Must be `false`                                                                      |
| `SMS_OTP_RECIPIENT_OVERRIDE`   | Must be unset                                                                        |
| `SHIPROCKET_BOOKING_ENABLED`   | Keep `false` until booking is explicitly approved                                    |

Local and test environments (`NODE_ENV=development` or `test`) may keep stub payment, mock SMS, and certification flags as documented in `.env.example`.

**Staging on a public URL:** A service running with `NODE_ENV=development` (or `test`) does **not** receive the production startup safeguards above. Do not lower `NODE_ENV` on a production-like public host just to enable delivery simulation, mock providers, or stub payments. Use an **isolated staging** deployment (network or access controls, non-customer data) and treat it as non-production.

### Supabase PostgreSQL

- `DATABASE_URL` — pooled runtime URL (Supabase pooler, typically port `6543`, often with `?pgbouncer=true`)
- `DIRECT_URL` — direct (non-pooled) URL for Prisma Migrate (host like `db.<project-ref>.supabase.co:5432`)

Do not log these values. The HTTP server starts even if the database is unavailable; connect explicitly when features need Prisma.

Apply auth schema migrations after credentials are valid:

```bash
npx prisma migrate deploy
# or during local development:
npx prisma migrate dev
```

## Scripts

| Script                    | Description                              |
| ------------------------- | ---------------------------------------- |
| `npm run dev`             | Start development server with hot reload |
| `npm run build`           | Compile TypeScript to `dist/`            |
| `npm run start`           | Run compiled server                      |
| `npm run typecheck`       | TypeScript check without emit            |
| `npm run lint`            | ESLint                                   |
| `npm test`                | Run tests once                           |
| `npm run test:watch`      | Vitest watch mode                        |
| `npm run prisma:generate` | Generate Prisma Client                   |
| `npm run prisma:validate` | Validate Prisma schema                   |

## Health check

```http
GET /api/v1/health
```

```json
{
  "success": true,
  "data": {
    "status": "ok"
  }
}
```

## Auth

```http
POST /api/v1/auth/signup
POST /api/v1/auth/verify-otp
POST /api/v1/auth/resend-otp
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET  /api/v1/auth/me
POST /api/v1/auth/forgot-password
POST /api/v1/auth/verify-password-reset-otp
POST /api/v1/auth/resend-password-reset-otp
POST /api/v1/auth/reset-password
POST /api/v1/auth/google
```

Requires Resend configuration (`RESEND_API_KEY` and `RESEND_FROM_EMAIL` or `EMAIL_FROM`) to deliver verification and password-reset emails.

Requires `JWT_ACCESS_SECRET` (min 32 characters) for login/session APIs.

Requires `GOOGLE_CLIENT_ID` for Google ID-token verification (`POST /api/v1/auth/google`).

### Session examples

```bash
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"john@example.com","password":"StrongPassword123!"}'

curl -X POST http://localhost:5000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<REFRESH_TOKEN>"}'

curl http://localhost:5000/api/v1/auth/me \
  -H "Authorization: Bearer <ACCESS_TOKEN>"

curl -X POST http://localhost:5000/api/v1/auth/logout \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<REFRESH_TOKEN>"}'
```

### Password reset examples

```bash
curl -X POST http://localhost:5000/api/v1/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"john@example.com"}'

curl -X POST http://localhost:5000/api/v1/auth/verify-password-reset-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"john@example.com","otp":"123456"}'

curl -X POST http://localhost:5000/api/v1/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{"resetToken":"<RESET_TOKEN>","newPassword":"NewStrongPassword123!"}'
```

### Google authentication

1. Configure a Google OAuth client (Web) and set `GOOGLE_CLIENT_ID` in `.env`.
2. Frontend uses Google Sign-In / GIS to obtain a Google ID token (`credential`).
3. Frontend sends that credential to Dutt — do **not** use Google's token as the Dutt access token.

```bash
curl -X POST http://localhost:5000/api/v1/auth/google \
  -H "Content-Type: application/json" \
  -d '{"credential":"GOOGLE_ID_TOKEN"}'
```

Success returns the same session shape as password login (`accessToken`, `refreshToken`, `user`).

## Deliveries (Phase 1 foundation)

```http
POST /api/v1/deliveries
GET  /api/v1/deliveries
GET  /api/v1/deliveries/:id
```

Authenticated customers create, list, and retrieve **their own** deliveries. `POST` requires an `Idempotency-Key` header and the `CUSTOMER` role. New deliveries start at `CREATED` with a server-generated `DOOT-{n}` reference. Pickup/drop may include optional WGS84 coordinates; providers, orchestration, booking, OTP, tracking, and pricing follow in later lifecycle steps.

### Roles and authorization

Platform roles (exactly two):

| Role       | Meaning                                            |
| ---------- | -------------------------------------------------- |
| `CUSTOMER` | Default for public signup and Google-created users |
| `ADMIN`    | Privileged platform role                           |

- Public signup and Google login always create `CUSTOMER`. Clients cannot send `role: "ADMIN"` to elevate themselves.
- Access JWTs identify the user (`sub` + `type=access`) only. Authorization reads the current role from the database on each authenticated request.
- Use `authenticate` then `requireRole(UserRole.ADMIN)` (or `CUSTOMER`) on protected routes.
- **401** = missing/invalid authentication; **403** = authenticated but forbidden (wrong role), or suspended/deleted account.
- There is no public role-change or signup-as-admin API. Provision an admin via seed:

```bash
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='your-strong-password' npx prisma db seed
```

Do not commit real admin passwords. Role changes for other users are intentional DB/ops actions for this MVP.

## Admin providers (Phase 2 registry)

```http
POST   /api/v1/admin/providers
GET    /api/v1/admin/providers
GET    /api/v1/admin/providers/:id
PATCH  /api/v1/admin/providers/:id
PATCH  /api/v1/admin/providers/:id/status
PUT    /api/v1/admin/providers/:id/credentials
PUT    /api/v1/admin/providers/:id/capabilities
POST   /api/v1/admin/providers/:id/services
GET    /api/v1/admin/providers/:id/services
PATCH  /api/v1/admin/providers/:id/services/:serviceId
POST   /api/v1/admin/providers/:id/vehicles
GET    /api/v1/admin/providers/:id/vehicles
PATCH  /api/v1/admin/providers/:id/vehicles/:vehicleId
```

All routes require `authenticate` + `ADMIN` role. Provider credentials are encrypted at rest with `PROVIDER_CREDENTIALS_ENCRYPTION_KEY` (AES-256-GCM). GET responses expose credential metadata only (`configured`, field names) — never secret values.

Apply the provider registry migration after database credentials are valid:

```bash
npx prisma migrate deploy
```

## Provider adapter framework (Phase 3)

```
Provider Registry (Phase 2 config)
        ↓
Provider Adapter Resolver
        ↓
Provider Adapter Executor (capability gate)
        ↓
ProviderAdapter (provider-specific code)
        ↓
Normalized Dutt contracts
```

Phase 3 adds the adapter abstraction layer only — no real Shadowfax/Shiprocket/Innofulfill HTTP integrations yet.

- **Contracts:** normalized serviceability, availability, quote, booking, tracking, cancellation, and webhook types under `src/modules/provider/contracts/`
- **Registry:** `ProviderAdapterRegistry` maps stable provider codes to adapter implementations
- **Resolver:** loads admin configuration + decrypted credentials via `ProviderConfigResolver` (adapters never touch Prisma)
- **Executor:** enforces admin-configured capabilities and adapter-supported operations before invocation
- **HTTP boundary:** `ProviderHttpClient` centralizes fetch, timeouts, safe logging, and error mapping (used by future real adapters)
- **Mock adapter:** `MOCK` test adapter registered in `NODE_ENV=test` or when `ENABLE_MOCK_PROVIDER_ADAPTER=true`

**Local orchestration latency:** Each provider evaluation shares a wall-clock budget (`ORCHESTRATION_MAX_DURATION_MS`, default 15s outside production). Slow or misconfigured sandbox providers are marked `ERROR`/`PROVIDER_TIMEOUT` instead of blocking the full adapter HTTP timeout (~30s each). For the fastest local path, keep only the `MOCK` provider enabled in admin (or set `ENABLE_MOCK_PROVIDER_ADAPTER=true`) and disable other providers until their credentials are ready.

### Shiprocket hyperlocal (Phase 1)

Phase 1 covers sandbox JWT auth, hyperlocal serviceability, Google reverse geocoding for Indian postcodes, multi-rate fan-out into orchestration scoring, and preferred-provider fallback (`ORCHESTRATION_PREFERRED_PROVIDER_CODE`).

Booking lifecycle (documented adhoc order + AWB assign, cancel, tracking) is implemented behind **`SHIPROCKET_BOOKING_ENABLED=false` by default** and requires `SHIPROCKET_PICKUP_LOCATION`. Customer refunds after cancellation remain on the existing Doot payment path — Shiprocket cancel does not trigger Cashfree refunds automatically.

**Environment (see `.env.example`):**

- `SHIPROCKET_ENABLED`, `SHIPROCKET_API_BASE_URL`, `SHIPROCKET_AUTH_EMAIL`, `SHIPROCKET_AUTH_PASSWORD`
- `GOOGLE_GEOCODING_API_KEY` (server-only Geocoding API)
- `ORCHESTRATION_PREFERRED_PROVIDER_CODE=SHIPROCKET` (optional)

**Sandbox-only serviceability probe (login + one GET, no orders):**

```bash
cd backend
# .env: SHIPROCKET_API_BASE_URL=https://api-sandbox.shiprocket.in
#       SHIPROCKET_AUTH_EMAIL=... SHIPROCKET_AUTH_PASSWORD=...
# Optional postcodes; otherwise set GOOGLE_GEOCODING_API_KEY for reverse geocode.

npm run probe:shiprocket-sandbox -- \
  --pickup-postcode 110030 \
  --delivery-postcode 122002 \
  --lat-from 28.509223937988 \
  --long-from 77.067848205566 \
  --lat-to 28.50724220275879 \
  --long-to 77.06745147705078 \
  --weight 1.2
```

The probe refuses any host other than `https://api-sandbox.shiprocket.in`, never prints JWTs or credentials, and does not write live responses into the repo. Use `--help` for env aliases (`SHIPROCKET_PROBE_*`).

**Manual sandbox checklist:**

1. Enable Geocoding API on Google Cloud; restrict the key to Geocoding API (and server IPs if possible).
2. Set Shiprocket sandbox credentials in `.env` and register admin provider `code=SHIPROCKET` with `SERVICEABILITY` + `PRICING`, `orchestrationEnabled=true`, lowest `priority`.
3. Run `npm run probe:shiprocket-sandbox` with your test coordinates/postcodes; save a **redacted** JSON fixture under `tests/fixtures/shiprocket/` manually if the live shape differs from fixtures.
4. Create a delivery with coordinates and orchestrate; confirm `OPTION_READY` and winning option metadata includes `shiprocketHyperlocalRates`.

**API ambiguities (Phase 1):** Live sandbox responses may expose additional courier/rate identifier fields beyond the documented example — raw entries are stored in `providerMetadata.shiprocketHyperlocalRates` for Phase 2 booking. Confirm `weight` query unit (assumed kg) against sandbox once.

`integrationStatus` remains `CONFIGURED` until an adapter is registered, credentials/capabilities exist, and health is `HEALTHY`. Real providers are not marked `READY` automatically.

### Adding a real provider adapter (Phase 4)

1. Add trusted sandbox/live base URLs in `provider.adapter-urls.ts`
2. Implement `ProviderAdapter` for the provider using `ProviderHttpClient`
3. Map provider JSON to normalized contracts inside the adapter — keep provider-specific logic out of core services
4. Register the adapter in `adapters/bootstrap.ts`
5. Configure the provider via admin APIs (credentials, capabilities, services)
6. Verify sandbox health/booking before setting `healthStatus: HEALTHY` and `integrationStatus: READY`

### Orchestration engine (Phase 5)

Customer endpoint:

```text
POST /api/v1/deliveries/:deliveryId/orchestrate
GET  /api/v1/deliveries/:deliveryId/orchestration
```

Lifecycle implemented in Phase 5:

```text
CREATED → ORCHESTRATING → OPTION_READY
                       └→ FAILED (no eligible provider)
```

- Discovers orchestration-eligible providers from the Provider Registry
- Evaluates providers concurrently via `ProviderAdapterExecutor` (never direct provider HTTP from orchestration code)
- Required adapter operations: quote (+ serviceability or quote-probe adapters)
- Optional availability; `availability.known = false` is treated as UNKNOWN, not unavailable
- Deterministic scoring with weight renormalization when factors are unknown
- Persists `OrchestrationRequest`, `OrchestrationEvaluation`, and `OrchestrationOption`
- Does **not** book/create-order — Phase 5 ends at `OPTION_READY`

### Customer confirmation + provider booking (Phase 6)

Customer endpoints:

```text
POST /api/v1/deliveries/:deliveryId/confirm
GET  /api/v1/deliveries/:deliveryId/booking
```

Lifecycle:

```text
OPTION_READY → BOOKING → BOOKED
                       ├→ FAILED (confirmed provider rejection)
                       └→ UNKNOWN booking (delivery stays BOOKING)
```

- Uses the persisted Phase 5 selected orchestration option — clients cannot choose provider, price, or service
- Optional `Idempotency-Key` header on confirm (same pattern as delivery create)
- Stable provider correlation reference: `{reference}-BOOKING-{attempt}` (e.g. `DOOT-1000-BOOKING-1`)
- Quote freshness via `BOOKING_QUOTE_MAX_AGE_SECONDS` (default 300); stale quotes revalidated when provider supports `getQuote`
- Material price changes return `409 BOOKING_OPTION_CHANGED` (no silent re-pricing)
- Provider booking via `ProviderAdapterExecutor.createBooking` only — no direct provider HTTP in booking code
- `UNKNOWN` outcomes do **not** trigger automatic create-order retry

### Driver, OTP, tracking, cancellation (Phase 7)

Customer endpoints:

```text
GET  /api/v1/deliveries/:deliveryId/driver
GET  /api/v1/deliveries/:deliveryId/tracking
GET  /api/v1/deliveries/:deliveryId/tracking/history
POST /api/v1/deliveries/:deliveryId/pickup-otp
POST /api/v1/deliveries/:deliveryId/pickup/verify-otp
POST /api/v1/deliveries/:deliveryId/delivery-otp
POST /api/v1/deliveries/:deliveryId/delivery/verify-otp
POST /api/v1/deliveries/:deliveryId/cancel
GET  /api/v1/deliveries/:deliveryId/cancellation
```

Admin endpoints:

```text
POST /api/v1/admin/deliveries/:deliveryId/driver/refresh
POST /api/v1/admin/deliveries/:deliveryId/tracking/refresh
GET  /api/v1/admin/deliveries/:deliveryId/driver
GET  /api/v1/admin/deliveries/:deliveryId/tracking
GET  /api/v1/admin/deliveries/:deliveryId/tracking/history
```

Operational lifecycle:

```text
BOOKED → DRIVER_ASSIGNED → PICKUP_OTP_PENDING → PICKED_UP → IN_TRANSIT → DELIVERY_OTP_PENDING → DELIVERED
```

- Driver snapshots are nullable — `known: false` when provider data is unavailable; no fabricated driver details
- Pickup and delivery OTPs are Dutt-owned (bcrypt-hashed, 6-digit); pickup OTP is emailed to the delivery owner; delivery completion is authoritative via delivery OTP verification
- Tracking stores coordinates only when valid; webhook events deduplicated by `providerEventId`
- Cancellation mirrors booking idempotency; pre-booking statuses cancel locally; post-booking uses `ProviderAdapterExecutor.cancelBooking`
- Provider webhooks link deliveries via `ProviderBooking.providerOrderId` and update driver/tracking operationally
- Terminal statuses ignore stale webhook/tracking transitions

### Experience survey, historical delivery (Phase 8)

Customer endpoints:

```text
POST /api/v1/deliveries/:deliveryId/experience
GET  /api/v1/deliveries/:deliveryId/history
GET  /api/v1/deliveries?page&limit&status&from&to&reference
```

Admin endpoints:

```text
GET /api/v1/admin/deliveries/:deliveryId/history
```

- Customer experience (multi-dimension ratings + optional comment) is immutable, one per delivery
- Experience submit allowed only when `Delivery.status = DELIVERED`
- Historical detail composes existing domain records (no duplicate delivery table)
- OTP metadata exposed without plaintext/hash; provider credentials never returned
- **Payment (Phase 1):** provider-neutral domain — see [docs/payment-domain-phase-1.md](./docs/payment-domain-phase-1.md). Cashfree gateway integration is **next phase**. No customer wallet.

Environment:

```text
BOOKING_QUOTE_MAX_AGE_SECONDS=300
BOOKING_PRICE_TOLERANCE_PERCENT=0
OTP_EXPIRY_SECONDS=600
OTP_MAX_ATTEMPTS=5
OTP_GENERATION_COOLDOWN_SECONDS=60
```

## API docs

Swagger UI is available at:

```text
http://localhost:5000/api-docs
```

Default development port is `5000` (configurable via `PORT`).
