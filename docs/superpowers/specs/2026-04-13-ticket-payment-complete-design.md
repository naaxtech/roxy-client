# Ticket Payment — Complete Implementation Design
**Roxy client + Roxy Studio · End-to-end · Enterprise-grade**
*Spec date: 2026-04-13*

---

## 1. Scope

This spec covers making ticket payments fully usable across both apps:

- **Roxy client (mobile):** Fix type gaps, My Tickets screen, real-time cancellation detection, sold-out UX, Stripe SDK verification
- **Roxy Studio (web):** Event detail + edit + attendee list + check-in, full payouts reconciliation, staff dashboard
- **Edge functions:** Platform-holds Stripe model, cancel-event, process-refunds, release-payout, dispute handling
- **Database:** Migration 023 — audit_log, is_staff, event status/payout columns, check-in columns, refund tracking

Out of scope: mobile dating features, Roxy AI touchpoints, staff app (roxy-staff).

---

## 2. Architecture Overview

### Stripe Model: Separate Charges + Transfers (platform-holds)

All payments land on **Roxy's platform Stripe account**. Transfers to hosts are created explicitly after the payout window elapses. This means:

- Refunds on cancellation hit the platform charge directly — no connected account transfer to reverse
- Roxy holds full ticket revenue until the event is verified complete
- Hosts see pending payout amounts but cannot access funds until release

### System Boundaries

```
Mobile (Roxy client)
  ├── event/[id].tsx          — buy ticket, sold-out state, cancellation banner, Realtime on event row
  ├── tickets/index.tsx       — My Tickets screen (new)
  ├── lib/stripe.ts           — purchaseTicket(), no hard timeout, Realtime cleanup fixed
  └── components/TicketCard   — collapsed + full variants, status-aware

Studio (Roxy Studio)
  ├── events/[id]/page.tsx    — event detail, edit, cancel, attendee list + check-in
  ├── payouts/page.tsx        — full payment_logs reconciliation, Stripe dashboard link
  └── staff/page.tsx          — staff-only: payout queue, dispute queue, refund queue

Edge Functions (Supabase)
  ├── create-payment-intent   — modified: platform-holds (no on_behalf_of/transfer_data)
  ├── cancel-event            — new: mark cancelled, flag needs_refund, OneSignal push
  ├── process-refunds         — new: cron-driven batch Stripe Refunds with per-row retry
  ├── release-payout          — new: service-role only, Stripe Transfers with idempotency
  └── stripe-webhooks         — extended: payment_failed + charge.dispute.created handlers

Database (migration 023)
  ├── events                  — status, payout_delay_days, payout_blocked, payout_released_at, cancelled_at, cancelled_by
  ├── event_attendees         — is_checked_in, checked_in_at
  ├── payment_logs            — needs_refund, refund_error, stripe_refund_id (extended status)
  ├── profiles                — is_staff
  └── audit_log               — all staff financial actions

Automation (supabase/config.toml)
  ├── complete-events         — pg_cron every 15 min: auto-set status=completed after ends_at
  ├── process-refunds         — scheduled edge function every 15 min
  └── release-payout          — scheduled edge function daily at 02:00 UTC
```

### Payout Lifecycle

```
ticket sold → payment_logs: pending
    ↓
webhook: payment_intent.succeeded → payment_logs: succeeded, ticket_code written
    ↓
ends_at passes → pg_cron sets events.status='completed'
    ↓
ends_at + payout_delay_days → release-payout edge function
    ↓ (payout_blocked=false)        ↓ (payout_blocked=true)
Stripe Transfer created             staff must unblock first
payment_logs: paid_out              audit_log entry
payout_released_at stamped

Event cancelled at any point before payout_released_at:
    → cancel-event sets status='cancelled', payout_blocked=true
    → process-refunds: Stripe Refund per payment_log, stripe_refund_id stored
    → payment_logs: refunded
    → OneSignal push to each buyer (deduplicated by buyer_id)
```

---

## 3. Database — Migration 023

### `events` table additions

| Column | Type | Default | Constraint | Purpose |
|---|---|---|---|---|
| `status` | text | `'active'` | CHECK IN ('active','cancelled','completed') | Event lifecycle state |
| `payout_delay_days` | integer | null | — | null = use platform_settings.default_payout_delay_days |
| `payout_blocked` | boolean | false | — | Staff sets true to prevent auto-release |
| `payout_released_at` | timestamptz | null | — | Stamped when Transfer is created |
| `cancelled_at` | timestamptz | null | — | Stamped on cancellation |
| `cancelled_by` | uuid | null | REFERENCES profiles(id) | Host or staff who cancelled |

**Constraint:** `ends_at NOT NULL` when `is_paid=true` — enforced via CHECK constraint and application validation.

### `event_attendees` table additions

| Column | Type | Default | Purpose |
|---|---|---|---|
| `is_checked_in` | boolean | false | Host marks attendee checked in via Studio |
| `checked_in_at` | timestamptz | null | Stamped when checked in |

### `payment_logs` table additions

| Column | Type | Default | Purpose |
|---|---|---|---|
| `needs_refund` | boolean | false | Set by cancel-event; consumed by process-refunds |
| `refund_error` | text | null | Stripe error code if refund failed; staff can retry |
| `stripe_refund_id` | text | null | UNIQUE — prevents duplicate refunds |

**Status extended:** `'pending'` → `'succeeded'` → `'paid_out'` | `'refunded'` | `'failed'`

### `profiles` table addition

| Column | Type | Default | Purpose |
|---|---|---|---|
| `is_staff` | boolean | false | Unlocks staff dashboard in Studio |

### `audit_log` table (new)

| Column | Type | Default | Purpose |
|---|---|---|---|
| `id` | uuid PK | gen_random_uuid() | — |
| `staff_id` | uuid | REFERENCES profiles(id) | Staff member who acted |
| `action` | text | — | 'release_payout' \| 'block_payout' \| 'unblock_payout' \| 'cancel_event' |
| `target_type` | text | — | 'event' \| 'payment_log' |
| `target_id` | uuid | — | ID of affected row |
| `metadata` | jsonb | '{}' | Amounts, error codes, context |
| `created_at` | timestamptz | now() | — |

RLS: service-role write only. Staff can SELECT own rows (staff_id = auth.uid()).

### New RLS Policies

```sql
-- Hosts can read all attendees for their own events
CREATE POLICY "host_read_attendees" ON event_attendees
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_attendees.event_id
      AND events.host_id = auth.uid()
    )
  );

-- Hosts can update is_checked_in on their own event attendees
CREATE POLICY "host_checkin_attendees" ON event_attendees
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_attendees.event_id
      AND events.host_id = auth.uid()
    )
  ) WITH CHECK (true);

-- Hosts can cancel their own events (status → 'cancelled' only)
CREATE POLICY "host_cancel_event" ON events
  FOR UPDATE USING (host_id = auth.uid())
  WITH CHECK (status = 'cancelled');
```

### pg_cron Jobs

```sql
-- Auto-complete paid events after ends_at (every 15 min)
SELECT cron.schedule('complete-events', '*/15 * * * *', $$
  UPDATE events
  SET status = 'completed'
  WHERE status = 'active'
    AND is_paid = true
    AND ends_at IS NOT NULL
    AND ends_at < now()
$$);
```

Scheduled Edge Functions (in `supabase/config.toml`):
```toml
[functions.process-refunds]
schedule = "*/15 * * * *"

[functions.release-payout]
schedule = "0 2 * * *"
```

---

## 4. Edge Functions

### `create-payment-intent` (modified)

Remove `on_behalf_of` and `transfer_data`. PaymentIntent is created on Roxy's platform Stripe account only. Store `event_id` and `user_id` in Stripe metadata for webhook lookup. All other existing logic unchanged.

### `cancel-event` (new)

```
POST { event_id }
Auth: JWT — caller must be events.host_id OR profiles.is_staff = true
Rate limit: 5/day per user
```

Execution order:
1. `handleCors` → `verifyJWT`
2. Parse body, validate `event_id` UUID
3. `SELECT ... FOR UPDATE` on events row
4. Verify `status = 'active'` — return 400 if already cancelled/completed
5. Verify caller is `host_id = auth.uid()` OR `is_staff = true` — return 403 otherwise
6. UPDATE events: `status='cancelled'`, `cancelled_at=now()`, `cancelled_by=auth.uid()`, `payout_blocked=true`
7. UPDATE payment_logs: `needs_refund=true` WHERE `event_id=X AND status='succeeded'`
8. Deduplicate buyer_ids from those payment_logs rows
9. Send OneSignal push to each unique buyer_id: "Event cancelled — your refund for [title] will appear in 5–10 business days"
10. Write to `audit_log` if caller is staff
11. Return `{ cancelled: true, refunds_queued: N }`

### `process-refunds` (new)

```
Auth: Supabase scheduled invocation (service-role) OR service-role key header
No JWT — service-role only
```

Execution order:
1. Reject if Authorization header is not service-role key
2. Fetch up to 50 `payment_logs` WHERE `needs_refund=true AND stripe_refund_id IS NULL`
3. For each row in batches of 10:
   - Skip if `stripe_refund_id` already set (idempotency)
   - `stripe.refunds.create({ payment_intent: payment_intent_id, idempotency_key: 'refund:{payment_intent_id}' })`
   - On success: set `stripe_refund_id`, `status='refunded'`, `needs_refund=false`
   - On failure: set `refund_error` (Stripe error code), leave `needs_refund=true` for retry
4. Return `{ processed, failed, skipped }`

### `release-payout` (new)

```
Auth: Supabase scheduled invocation (service-role) OR service-role key header
Optional body: { event_id } — if provided, processes that event only (staff manual release)
```

Execution order:
1. Reject if Authorization header is not service-role key
2. Query events: `status='completed' AND payout_blocked=false AND payout_released_at IS NULL AND ends_at + COALESCE(payout_delay_days, (SELECT default_payout_delay_days FROM platform_settings WHERE id=1)) * INTERVAL '1 day' <= now()`
3. For each event:
   - `SELECT ... FOR UPDATE` on events row (atomic block check)
   - Re-verify `payout_blocked=false` after lock
   - Load `host_stripe_accounts.stripe_account_id` — skip if missing or `onboarding_complete=false`
   - Sum `payment_logs.host_payout_cents` WHERE `event_id=X AND status='succeeded'` — skip if 0
   - `stripe.transfers.create({ amount, currency, destination: stripe_account_id, idempotency_key: 'payout:{event_id}', metadata: { event_id } })`
   - On Stripe insufficient funds error: set `payout_blocked=true`, log for staff — do NOT set `payout_released_at`
   - On success: set `payout_released_at=now()`, UPDATE `payment_logs.status='paid_out'`
   - Write to `audit_log`
4. Return `{ released, skipped, failed }` with event-level detail

### `stripe-webhooks` (extended)

**Existing handlers:** `account.updated`, `payment_intent.succeeded` — unchanged.

**New: `payment_intent.payment_failed`**
- Find `payment_logs` row by `payment_intent_id`
- Set `status='failed'`

**New: `charge.dispute.created`**
- Find `payment_logs` row by `payment_intent_id` from charge metadata
- Find `event_id` from that row
- Set `events.payout_blocked=true`
- Write to `audit_log` with dispute metadata
- Staff dispute queue will surface this row

### `stripe-dashboard-link` — wire into Studio payouts page

No changes to the edge function itself. Studio payouts page calls `/api/stripe/dashboard-link` (new Studio API route proxying this function).

---

## 5. Mobile — Roxy Client

### Pre-flight: verify `@stripe/stripe-react-native` is installed

Check `apps/mobile/package.json`. If missing: install and wrap `app/_layout.tsx` with `<StripeProvider publishableKey={...}>`.

### `types/index.ts` additions

```ts
// Add to Event interface:
is_paid: boolean;
price_cents: number | null;
currency: string;
status: 'active' | 'cancelled' | 'completed';

// New type:
export interface EventAttendee {
  event_id: string;
  user_id: string;
  status: 'going' | 'interested' | 'maybe';
  ticket_code: string;
  rsvp_at: string;
  is_checked_in: boolean;
  checked_in_at: string | null;
}
```

### `lib/stripe.ts` (modified)

- Remove 30-second hard timeout from `purchaseTicket()`
- Fix Realtime subscription cleanup: return unsubscribe function, clean up in `useEffect` return
- Add sold-out error detection: if edge function returns `{ error: 'sold_out' }`, return `{ success: false, soldOut: true }`
- No other changes

### `app/event/[id].tsx` (modified)

**Sold-out state:** If `attendee_count >= max_attendees && is_paid`, render "Sold Out" badge instead of Buy button. If `purchaseTicket()` returns `soldOut: true`, show inline "Sorry, this event just sold out."

**Cancelled state:** If `event.status === 'cancelled'`, render a red banner at top: "This event was cancelled." If user has a ticket: "Your refund will appear in 5–10 business days."

**Completed state:** Ticket visible, no action buttons.

**Realtime on event row:** Subscribe to `postgres_changes` on `events` filtered `id=eq.{eventId}`. On status change, update local state immediately.

**Payment confirmed UX:** On PaymentSheet close (before webhook fires), show inline: "Payment confirmed — your ticket is on its way." Remove all hard timeouts. When Realtime fires the `event_attendees` INSERT, animate the TicketCard in. If ticket hasn't arrived after 2 minutes, show: "Ticket processing — check My Tickets or contact support."

### `components/TicketCard.tsx` (replaced)

Two variants:

**`variant='full'`** (existing behavior):
- 160px QR code encoding `ticket_code` as plain string
- Event title, date, location, community
- Monospace ticket code
- `status='cancelled'`: greyed out, strikethrough style, "Refunded" badge
- `status='checked_in'`: green "Checked In" stamp overlay on QR

**`variant='collapsed'`** (new):
- No QR code
- Event title (bold), date (secondary), status badge
- Tap to expand to full variant (controlled by parent)

### `components/TicketConfirmation.tsx` (modified)

Accept `ticketCode?: string` as optional prop. If present: show full QR immediately. If absent: show "Payment confirmed — your ticket is on its way" with a "View My Tickets" link.

### `app/(tabs)/grow/tickets.tsx` (new)

Route: nested under GROW tab stack. Accessible from TicketConfirmation "View in My Tickets" button.

```
Layout:
  Header: "My Tickets"
  FlashList — paginated (20/page, onEndReached loads next page)
    ↓ upcoming events (starts_at > now)
    Divider: "Past"
    ↓ past events
  Each row: TicketCard variant='collapsed'
  Tap row: expands to variant='full' inline (accordion)
  Pull to refresh

Empty state: "No tickets yet — find events in the Discover tab"

Realtime: subscribes to postgres_changes on event_attendees
  filter: user_id=eq.{userId}
  On UPDATE (is_checked_in changes): update row in list
  On event status change: re-query affected event
```

---

## 6. Studio — Roxy Studio

### Authorization pattern (all staff routes)

Every `/api/staff/*` route:
1. `createServerClient()` — verify session server-side
2. Fetch `profiles.is_staff` for `auth.uid()`
3. Return 403 if false
4. Execute action
5. Write to `audit_log`

Staff dashboard page (`/staff/page.tsx`): Server Component. Fetch `is_staff` server-side. Redirect to `/` if false. No client-side-only guard.

### `events/page.tsx` (modified)

- Add `status` badge per row: Active (green) / Cancelled (red) / Completed (grey)
- Add attendee count column — links to `/events/[id]`
- Disable Edit for cancelled/completed events

### `events/[id]/page.tsx` (new)

Server Component. Loads event + host's `host_stripe_accounts` row.

**Sections:**
1. **Event metadata** (editable while `status='active'`): title, description, location, ends_at
   - `price_cents` and `is_paid` locked (read-only) if any `payment_logs` row exists for this event — show "Price locked — tickets have been sold"
   - `ends_at` validation: must be in the future on edit
   - Save via server action → UPDATE events
2. **Revenue summary** (paid events only): Gross revenue, Platform fee, Your payout, Tickets sold / max_attendees
   - Status breakdown: Pending (within payout window) / Processing / Blocked / Released
3. **Attendee list** (`AttendeeList.tsx` client component):
   - Search by display_name or ticket_code
   - Table: name, ticket_code, payment status, checked-in toggle, rsvp_at
   - Check-in toggle calls `/api/events/[id]/checkin` → sets `is_checked_in`, `checked_in_at`
   - Paginated: 50/page
4. **Cancel event** button (visible while `status='active'`):
   - Confirmation modal: "This will refund X attendees totalling $Y.YY. This cannot be undone."
   - On confirm: calls `/api/staff/cancel-event` or `/api/events/[id]/cancel` (host path) → `cancel-event` edge function
   - Shows refund summary after

### `payouts/page.tsx` (expanded)

Summary cards:
- Total earned (all time, `payment_logs.host_payout_cents` sum where `status IN ('succeeded','paid_out')`)
- Pending payout (completed events, not released, not blocked)
- Released (paid_out)

Event table:
| Event | Date | Tickets sold | Gross | Fee | Your payout | Status |
| — | — | — | — | — | — | — |

Status labels (precise):
- `Waiting for event` — event still active
- `Processing` — completed, within payout delay window
- `Blocked` — `payout_blocked=true` — "Contact support"
- `Dispute hold` — disputed charge blocking release
- `Released` — `payout_released_at` set, shows date

"Open Stripe Dashboard" button: calls `/api/stripe/dashboard-link` → `stripe-dashboard-link` edge function → redirects.

### `staff/page.tsx` (new)

Three panels, each as a server-fetched table refreshed on action:

**Payout Queue**
- Query: `events` WHERE `status='completed' AND payout_released_at IS NULL` ordered by `ends_at ASC`
- Columns: Event, Host, Ends at, Total payout amount, Blocked?
- Actions: Release Now (→ `/api/staff/release-payout`), Block (→ `/api/staff/block-payout`), Unblock
- "Release Now" disabled if `payout_blocked=true`

**Dispute Queue**
- Query: `payment_logs` joined to events WHERE flagged by dispute webhook (`payout_blocked=true` + dispute metadata in `audit_log`)
- Columns: Event, Buyer, Amount, Dispute created at
- Actions: Issue Refund (→ `/api/staff/refund`), Release Payout Anyway

**Refund Queue**
- Query: `payment_logs` WHERE `needs_refund=true AND refund_error IS NOT NULL`
- Columns: Event, Buyer, Amount, Error code
- Actions: Retry (re-queues row), Mark Resolved (manual override — sets `needs_refund=false`, logs reason)

Empty states for each panel: "No items — you're all clear."

### New API Routes (Studio)

| Route | Method | Auth | Action |
|---|---|---|---|
| `/api/staff/release-payout` | POST | is_staff | Calls release-payout edge fn with service-role key |
| `/api/staff/block-payout` | POST | is_staff | Sets `payout_blocked=true/false`, writes audit_log |
| `/api/staff/cancel-event` | POST | is_staff | Calls cancel-event edge fn |
| `/api/events/[id]/cancel` | POST | host_id | Calls cancel-event edge fn |
| `/api/events/[id]/checkin` | POST | host_id | Toggles `is_checked_in` on event_attendees row |
| `/api/stripe/dashboard-link` | GET | authenticated | Proxies stripe-dashboard-link edge fn |

---

## 7. Security Rules

1. Stripe secret key and webhook signing secret: Supabase edge function env vars only
2. `price_cents` always read from DB server-side — never trusted from client
3. Platform fee calculated server-side from `fee_tiers` joined with `host_stripe_accounts`
4. Webhook HMAC signature verified on every incoming Stripe webhook
5. `release-payout` and `process-refunds` reject all non-service-role requests
6. `is_staff` check for all staff API routes is server-side (Server Component + API route), never client-side only
7. `cancel-event` ownership: `host_id = auth.uid()` OR `is_staff = true` — checked in edge function, not application layer
8. Transfer idempotency key: `payout:{event_id}` — Stripe deduplicates if cron fires twice
9. Refund idempotency key: `refund:{payment_intent_id}` — prevents double-refunds
10. `SELECT ... FOR UPDATE` before every Transfer and cancellation — prevents race conditions
11. `audit_log` is service-role write only — tamper-evident staff action trail
12. `stripe_refund_id` UNIQUE constraint — DB-level duplicate refund prevention

---

## 8. Error Handling

| Scenario | Behaviour |
|---|---|
| Sold out at checkout | `claim_ticket()` raises exception → edge fn returns `{ error: 'sold_out' }` → mobile shows "Just sold out" |
| Payment confirmed, webhook slow | Mobile shows "on its way" immediately; ticket arrives via Realtime when webhook fires; after 2 min shows "Check My Tickets" |
| `payment_intent.payment_failed` | payment_logs set to 'failed'; no ticket issued; mobile can retry |
| Stripe dispute filed | `payout_blocked=true` on event; staff dispute queue surfaces it |
| Refund fails | `refund_error` written; process-refunds retries on next 15-min cron; staff can manually retry |
| Transfer insufficient funds | `payout_blocked=true`; staff notified via audit_log; manual unblock + release |
| cancel-event called twice | Second call hits `status ≠ 'active'` check, returns 400 |
| release-payout cron double-fires | Stripe idempotency key deduplicates; `payout_released_at` check prevents double-update |
| Host edits event after tickets sold | price_cents/is_paid locked in UI and validated server-side |
| Host sets ends_at to past on edit | Rejected with 400: "End time must be in the future" |
| Stripe account restricted post-onboarding | `release-payout` checks `payouts_enabled` before Transfer; blocked with staff notification |

---

## 9. Testing Plan

### Unit tests (Jest — apps/mobile)

- `lib/stripe.ts`: sold-out error path returns `{ soldOut: true }`, Realtime subscription cleaned up on unmount, `sanitizePaymentError` redacts client_secret
- `types/index.ts`: compile-time coverage via tsc (no runtime test)

### Unit tests (Jest — edge functions)

- `cancel-event`: non-owner gets 403, already-cancelled returns 400, is_staff bypasses ownership check
- `release-payout`: skips blocked events, skips already-released, idempotency key is `payout:{event_id}`, insufficient-funds sets payout_blocked
- `process-refunds`: batches of 10, partial failure writes refund_error, does not re-process rows with stripe_refund_id set
- Fee calculation: `fee_cents + host_payout_cents = amount_cents` exactly for standard (15%), verified (10%), premium (8%) tiers

### Integration tests (Stripe CLI)

```bash
stripe listen --forward-to localhost:54321/functions/v1/stripe-webhooks
```

- `payment_intent.succeeded` → ticket claimed, payment_log succeeded, ticket_code written
- `payment_intent.payment_failed` → payment_log failed, no ticket
- `charge.dispute.created` → payout_blocked=true on event, audit_log entry
- `account.updated` (charges_enabled + payouts_enabled) → onboarding_complete flips

### E2E tests (Playwright — apps/studio)

- Full Stripe Connect onboarding (test mode) → paid event creation unlocks
- Create paid event → price locked after first mock ticket sold
- Cancel event: modal shows correct refund count and total → confirms → refunds queued
- Staff: block payout → release-payout skips → unblock → release succeeds
- Staff: refund queue shows failed rows → retry → success
- Attendee check-in toggle → row updates in table

### Manual smoke tests

- Full ticket purchase on device: PaymentSheet → "on its way" → ticket appears via Realtime in My Tickets
- Cancel event as host → attendee sees cancelled banner on event detail + push notification
- Sold out: buy last ticket on device A; device B sees Sold Out badge
- Staff dashboard: Release Now → Transfer appears in Stripe test dashboard
- QR code: scan ticket_code in Studio AttendeeList matches event_attendees row

---

## 10. File Map

### New files

| File | Purpose |
|---|---|
| `supabase/migrations/023_tickets_phase3.sql` | All schema additions: audit_log, is_staff, event columns, attendee columns, payment_log columns, RLS, pg_cron |
| `supabase/functions/cancel-event/index.ts` | Cancel event + flag needs_refund + OneSignal push |
| `supabase/functions/process-refunds/index.ts` | Cron-driven batch Stripe Refunds |
| `supabase/functions/release-payout/index.ts` | Stripe Transfers with idempotency, audit_log |
| `apps/mobile/app/(tabs)/grow/tickets.tsx` | My Tickets screen |
| `apps/studio/app/(dashboard)/events/[id]/page.tsx` | Event detail: edit, revenue, attendees, cancel |
| `apps/studio/app/(dashboard)/events/[id]/AttendeeList.tsx` | Paginated attendee table with search + check-in |
| `apps/studio/app/(dashboard)/staff/page.tsx` | Staff dashboard: 3 queues |
| `apps/studio/app/api/staff/release-payout/route.ts` | Server proxy: is_staff → release-payout edge fn |
| `apps/studio/app/api/staff/block-payout/route.ts` | Sets payout_blocked, writes audit_log |
| `apps/studio/app/api/staff/cancel-event/route.ts` | Staff cancel path |
| `apps/studio/app/api/events/[id]/cancel/route.ts` | Host cancel path |
| `apps/studio/app/api/events/[id]/checkin/route.ts` | Toggle is_checked_in |
| `apps/studio/app/api/stripe/dashboard-link/route.ts` | Proxies stripe-dashboard-link edge fn |

### Modified files

| File | Change |
|---|---|
| `supabase/functions/create-payment-intent/index.ts` | Remove on_behalf_of and transfer_data |
| `supabase/functions/stripe-webhooks/index.ts` | Add payment_intent.payment_failed + charge.dispute.created handlers |
| `supabase/config.toml` | Add schedule for process-refunds + release-payout |
| `apps/mobile/types/index.ts` | Add is_paid, price_cents, currency, status to Event; add EventAttendee type |
| `apps/mobile/lib/stripe.ts` | Remove hard timeout, fix Realtime cleanup, add sold-out error path |
| `apps/mobile/app/event/[id].tsx` | Sold-out/cancelled/completed states, Realtime on events row, decouple payment UX from Realtime wait |
| `apps/mobile/components/TicketCard.tsx` | Add collapsed variant, status-aware rendering, checked-in overlay |
| `apps/mobile/components/TicketConfirmation.tsx` | Accept optional ticketCode, decouple from Realtime wait |
| `apps/mobile/app/_layout.tsx` | Add StripeProvider if not present |
| `apps/studio/app/(dashboard)/events/page.tsx` | Status badge, attendee count link |
| `apps/studio/app/(dashboard)/events/CreateEventForm.tsx` | Require ends_at, validate > now(), lock price after first ticket |
| `apps/studio/app/(dashboard)/payouts/page.tsx` | Full reconciliation, precise status labels, Stripe dashboard link |

---

*Spec complete. All sections reviewed for enterprise-grade correctness.*
*Next: implementation plan.*
