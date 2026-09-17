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

| Script | Description |
| --- | --- |
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start` | Run compiled server |
| `npm run typecheck` | TypeScript check without emit |
| `npm run lint` | ESLint |
| `npm test` | Run tests once |
| `npm run test:watch` | Vitest watch mode |
| `npm run prisma:generate` | Generate Prisma Client |
| `npm run prisma:validate` | Validate Prisma schema |

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

Authenticated customers create, list, and retrieve **their own** deliveries. `POST` requires an `Idempotency-Key` header and the `CUSTOMER` role. New deliveries start at `CREATED` with a server-generated `DOTT-{n}` reference. Pickup/drop may include optional WGS84 coordinates; providers, orchestration, booking, OTP, tracking, and pricing follow in later lifecycle steps.

### Roles and authorization

Platform roles (exactly two):

| Role | Meaning |
|------|---------|
| `CUSTOMER` | Default for public signup and Google-created users |
| `ADMIN` | Privileged platform role |

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

Phase 3 adds the adapter abstraction layer only — no real Borzo/Shadowfax/Shiprocket/Innofulfill HTTP integrations yet.

- **Contracts:** normalized serviceability, availability, quote, booking, tracking, cancellation, and webhook types under `src/modules/provider/contracts/`
- **Registry:** `ProviderAdapterRegistry` maps stable provider codes to adapter implementations
- **Resolver:** loads admin configuration + decrypted credentials via `ProviderConfigResolver` (adapters never touch Prisma)
- **Executor:** enforces admin-configured capabilities and adapter-supported operations before invocation
- **HTTP boundary:** `ProviderHttpClient` centralizes fetch, timeouts, safe logging, and error mapping (used by future real adapters)
- **Mock adapter:** `MOCK` test adapter registered in `NODE_ENV=test` or when `ENABLE_MOCK_PROVIDER_ADAPTER=true`

`integrationStatus` remains `CONFIGURED` until an adapter is registered, credentials/capabilities exist, and health is `HEALTHY`. Real providers are not marked `READY` automatically.

### Adding a real provider adapter (Phase 4)

1. Add trusted sandbox/live base URLs in `provider.adapter-urls.ts`
2. Implement `ProviderAdapter` for the provider (e.g. `BorzoAdapter`) using `ProviderHttpClient`
3. Map provider JSON to normalized contracts inside the adapter — keep provider-specific logic out of core services
4. Register the adapter in `adapters/bootstrap.ts`
5. Configure the provider via admin APIs (credentials, capabilities, services)
6. Verify sandbox health/booking before setting `healthStatus: HEALTHY` and `integrationStatus: READY`

### Borzo inbound webhooks (Phase 4B)

Public endpoint (no JWT):

```text
POST /api/v1/providers/borzo/webhooks
```

- **Signature:** `X-DV-Signature` = HMAC-SHA256 hex digest of the **raw JSON body** using `BORZO_CALLBACK_SECRET`
- **Events:** `order_created`, `order_changed`, `delivery_created`, `delivery_changed`
- **Persistence:** idempotent `ProviderWebhookEvent` rows keyed by provider event key
- **Processing:** normalized to `NormalizedProviderWebhookEvent`; delivery linking is stubbed in 4B (events marked `IGNORED` until booking exists)

Environment:

```env
BORZO_CALLBACK_SECRET=your-shared-secret-min-16-chars
BORZO_WEBHOOKS_ENABLED=true   # optional; enforces secret at startup outside test
```

Local smoke test (server must be running on port 5000):

```bash
BORZO_CALLBACK_SECRET=... npx tsx scripts/borzo-webhook-smoke.ts
```

Fixtures live under `tests/fixtures/borzo/`. Swagger documents the endpoint at `/api-docs`.

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
- Stable provider correlation reference: `{reference}-BOOKING-{attempt}` (e.g. `DOTT-1000-BOOKING-1`)
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
### Rating, feedback, historical delivery (Phase 8)

Customer endpoints:

```text
POST /api/v1/deliveries/:deliveryId/rating
GET  /api/v1/deliveries/:deliveryId/rating
POST /api/v1/deliveries/:deliveryId/feedback
GET  /api/v1/deliveries/:deliveryId/feedback
GET  /api/v1/deliveries/:deliveryId/history
GET  /api/v1/deliveries?page&limit&status&from&to&reference
```

Admin endpoints:

```text
GET /api/v1/admin/deliveries/:deliveryId/history
```

- Customer ratings (driver + delivery, 1–5) and feedback are immutable, one per delivery
- Rating/feedback allowed only when `Delivery.status = DELIVERED`
- Historical detail composes existing domain records (no duplicate delivery table)
- OTP metadata exposed without plaintext/hash; provider credentials never returned
- **Not implemented in Phase 8:** payment, wallet, billing, refunds

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
