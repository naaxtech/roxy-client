# Community Studio + Stripe Host Onboarding — Design Spec (Sub-project 1)

## Goal

Build `studio.roxy.app` — a Next.js web app for community admins and individual event hosts to manage their communities, create paid events, and connect a Stripe account to receive payouts. This is the host-side counterpart to the Roxy mobile app.

## Scope

This spec covers sub-project 1 only:
- Community Studio web app (Next.js, Vercel)
- Stripe Connect Express host onboarding
- Data layer for payments (host accounts, fee tiers, platform settings, payment logs)
- Events table additions (price_cents, currency)

Paid event checkout (mobile), and the Roxy Admin Panel are separate specs (sub-projects 2 and 3).

---

## Architecture

**Approach:** New Next.js app in `apps/studio/` within the existing monorepo. Deployed to Vercel at `studio.roxy.app`. Uses the same Supabase project (same Auth, same DB, same edge functions) as the mobile app. Stripe Connect Express handles host identity verification and bank account setup — Roxy never touches sensitive financial data directly.

**Monorepo structure after this sub-project:**
```
apps/
  mobile/       ← existing Roxy mobile app
  studio/       ← new Community Studio (Next.js)
supabase/       ← shared backend (migrations, edge functions)
```

---

## Pages

| Page | Path | Purpose |
|---|---|---|
| Login | `/login` | Supabase Auth sign-in (email + password, same credentials as mobile) |
| Dashboard | `/` | Summary: communities, upcoming events, recent sales, Stripe status banner |
| Events | `/events` | List, create, edit events. Paid events locked until Stripe connected. |
| Rooms | `/rooms` | Create and manage Daily.co video/audio rooms. Link to events. |
| Games | `/games` | Create and manage speed dating sessions and future game formats |
| Community | `/community` | Community details, member list, settings |
| Payouts | `/payouts` | Stripe balance, recent payouts, link to Stripe Express dashboard |
| Settings | `/settings` | Profile, notifications, Stripe Connect button |

---

## Authentication

Same Supabase Auth as the mobile app. The Studio uses `@supabase/ssr` for Next.js server-side session handling. A host who is a community admin sees only their own communities and events — enforced by RLS, not by application logic. No new user table or separate login system.

Protected routes: all pages except `/login` require an authenticated session. Unauthenticated requests redirect to `/login`.

---

## Stripe Host Onboarding Flow

### Happy path

1. Host navigates to Settings → taps "Connect Stripe Account"
2. Studio calls Supabase edge function `stripe-connect-onboard`
3. Edge function calls `stripe.accountLinks.create` with `type: 'account_onboarding'` and `return_url: studio.roxy.app/settings?stripe=success`, `refresh_url: studio.roxy.app/settings?stripe=refresh`
4. Edge function creates a row in `host_stripe_accounts` with `onboarding_complete: false` if one doesn't exist
5. Studio redirects browser to the Stripe-hosted onboarding URL
6. Host completes identity verification and bank account setup on Stripe's pages
7. Stripe redirects back to `studio.roxy.app/settings?stripe=success`
8. Stripe sends `account.updated` webhook to edge function `stripe-webhooks`
9. Edge function sets `onboarding_complete: true` in `host_stripe_accounts`
10. Paid event creation unlocks automatically

### Incomplete onboarding

If the host closes the browser mid-flow, `onboarding_complete` stays false. The Studio shows a "Resume Stripe Setup" banner on the Dashboard. Clicking it calls `stripe-connect-onboard` again — Stripe returns a fresh link resuming from where they left off.

### Stripe account restricted

If Stripe restricts a host's account (e.g. failed verification), the Studio shows a "Action required" banner with a link to the Stripe Express dashboard to resolve it. Paid event creation is blocked until the restriction is lifted.

---

## Data Layer — New Migrations

### `host_stripe_accounts` table

| Column | Type | Default | Purpose |
|---|---|---|---|
| `user_id` | uuid PK | — | References `profiles(id)` |
| `stripe_account_id` | text UNIQUE | — | Stripe's opaque account identifier |
| `onboarding_complete` | boolean | false | Unlocks paid event creation when true |
| `payout_delay_days` | integer | null | Per-host override; null = use platform default |
| `fee_tier` | text | 'standard' | References `fee_tiers(tier_name)` |
| `created_at` | timestamptz | now() | — |
| `updated_at` | timestamptz | now() | — |

RLS: host can read/update their own row only. Service role can read all.

### `platform_settings` table

Single-row table. Only writable via service role (Admin Panel).

| Column | Type | Default | Purpose |
|---|---|---|---|
| `id` | integer PK | 1 | Always 1 — enforced by CHECK |
| `max_ticket_price_cents` | integer | 5000 | Global price cap ($50.00). Edge function rejects events priced above this. |
| `default_payout_delay_days` | integer | 0 | Days after event before payout releases to host |
| `default_fee_percent` | numeric(5,2) | 10.00 | Platform fee applied when host has no tier override |
| `updated_by` | uuid | — | user_id of last admin who changed settings |
| `updated_at` | timestamptz | now() | Audit trail |

RLS: no direct client access. Service role only.

### `fee_tiers` table

| Column | Type | Default | Purpose |
|---|---|---|---|
| `tier_name` | text PK | — | e.g. 'standard', 'verified', 'premium' |
| `fee_percent` | numeric(5,2) | — | e.g. 15.00, 10.00, 8.00 |
| `created_at` | timestamptz | now() | — |

Seed data:
- `standard` → 15.00%
- `verified` → 10.00%
- `premium` → 8.00%

RLS: authenticated users can read (needed to display fee to host). Service role can write.

### `payment_logs` table

| Column | Type | Default | Purpose |
|---|---|---|---|
| `id` | uuid PK | gen_random_uuid() | — |
| `payment_intent_id` | text UNIQUE | — | Stripe PaymentIntent ID. Used for idempotency. |
| `event_id` | uuid | — | References `events(id)` |
| `buyer_id` | uuid | — | References `profiles(id)` |
| `host_id` | uuid | — | References `profiles(id)` |
| `amount_cents` | integer | — | Total charged to buyer |
| `fee_cents` | integer | — | Roxy's platform fee |
| `host_payout_cents` | integer | — | Amount transferred to host |
| `currency` | text | — | e.g. 'usd', 'eur' |
| `status` | text | 'pending' | 'pending' → 'succeeded' → 'failed' |
| `ticket_code` | text | — | Generated ticket code |
| `created_at` | timestamptz | now() | — |
| `updated_at` | timestamptz | now() | — |

RLS: no direct client access. Service role only.

### `events` table additions

| Column | Type | Default | Purpose |
|---|---|---|---|
| `price_cents` | integer | null | null = free. Integer cents, never decimal. |
| `currency` | text | 'usd' | Stripe-supported currency code |

---

## Edge Functions

### `stripe-connect-onboard`
- Verifies JWT
- Checks if `host_stripe_accounts` row already has a `stripe_account_id` — if yes, reuses it; if no, calls `stripe.accounts.create` first
- Calls `stripe.accountLinks.create` with the account ID
- Returns onboarding URL to Studio

### `stripe-webhooks`
- No JWT verification (Stripe calls this directly)
- Verifies Stripe webhook signature using `stripe.webhooks.constructEvent`
- Handles:
  - `account.updated` → sets `onboarding_complete: true` when `details_submitted: true`
  - `payment_intent.succeeded` → creates `event_attendees` row, updates `payment_logs` status to 'succeeded'
  - `payment_intent.payment_failed` → updates `payment_logs` status to 'failed'
- Idempotent: checks `payment_intent_id` in `payment_logs` before processing

---

## Security Rules

1. Stripe secret key and webhook signing secret live only in Supabase edge function environment variables — never in any client app
2. `price_cents` for a payment is always read from the database server-side — never trusted from the client request
3. Platform fee percentage is always calculated server-side from `fee_tiers` joined with `host_stripe_accounts`
4. Webhook signature is verified on every incoming Stripe webhook before any processing
5. All new tables have RLS enabled — hosts can only access their own data
6. `platform_settings` and `payment_logs` are service-role-only

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Onboarding abandoned mid-flow | `onboarding_complete` stays false; "Resume Setup" banner shown on Dashboard |
| Stripe account restricted | "Action required" banner with link to Stripe Express dashboard; paid events blocked |
| Duplicate webhook delivery | Idempotency check on `payment_intent_id` — second delivery is a no-op |
| Host creates event above price cap | Edge function rejects with 400; Studio shows "Exceeds platform maximum" error |
| Stripe onboarding edge function fails | Studio shows generic error; host can retry from Settings |

---

## Testing

### Unit tests (Jest)
- Fee calculation: given price_cents, fee_percent → correct fee_cents and host_payout_cents
- Price cap validation: price above max_ticket_price_cents returns error
- Idempotency: duplicate payment_intent_id in payment_logs returns early without side effects

### Integration tests (Stripe CLI)
- Run `stripe listen --forward-to localhost:54321/functions/v1/stripe-webhooks`
- Test `account.updated` → onboarding_complete flips to true
- Test `payment_intent.succeeded` → ticket created, payment_log updated

### Manual smoke tests
- Complete full Stripe Connect onboarding with test account
- Confirm paid event creation unlocks after onboarding
- Confirm paid event creation is blocked when onboarding incomplete
- Confirm price above cap is rejected

---

## Out of Scope (future sub-projects)

- Paid event checkout on mobile — sub-project 2
- Roxy Admin Panel (fee tiers, price caps, payout schedules UI) — sub-project 3
- Ticket email — sub-project 4
- Rooms and Games full functionality — separate specs
