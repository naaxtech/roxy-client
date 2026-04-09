# Roxy Studio — Stripe Payments, Events Production & Brand Theme Design

**Date:** 2026-04-09
**Session:** 13
**Status:** Approved for implementation

---

## Goal

Production-ready ticket purchasing flow (Stripe Connect Express), OWASP-compliant payment pipeline, production Events management in Studio, and Roxy brand theme applied to Studio.

---

## Architecture

Edge functions own all Stripe API calls — Stripe secrets never enter the Next.js app. The mobile PaymentSheet handles card/Apple Pay/Google Pay natively (PCI SAQ A). Ticket creation is webhook-driven and idempotent — decoupled from the mobile payment session. Studio reads `payment_logs` directly via a new RLS policy.

---

## Brand Theme

Roxy mobile uses a dark purple/pink palette defined in `apps/mobile/lib/constants.ts`:

| Token | Hex | HSL |
|---|---|---|
| background | `#1a0a2e` | `268 64% 11%` |
| surface | `#2d1b4e` | `264 49% 21%` |
| surfaceLight | `#3d2b5e` | `263 37% 27%` |
| primary (deep rose) | `#C4476A` | `343 47% 52%` |
| roxy (hot pink) | `#E879A6` | `330 73% 70%` |
| secondary (violet) | `#8B5CF6` | `258 89% 66%` |
| accent (light pink) | `#F472B6` | `323 86% 70%` |
| textPrimary | `#FFFFFF` | `0 0% 100%` |
| textSecondary | `#C4B5D4` | `270 21% 77%` |
| textMuted | `#8B7AA8` | `267 19% 57%` |

Studio `globals.css` replaces the generic black/white shadcn defaults with these values as CSS HSL variables. The sidebar active state uses the roxy pink accent. Buttons use the rose primary.

---

## Data Model

No new tables. Migration 022 adds:

1. `claim_ticket(p_event_id, p_buyer_id)` — atomic Postgres function (SECURITY INVOKER). Checks capacity, inserts `event_attendees`, returns `ticket_code`. Handles duplicate gracefully.
2. `event_attendees.ticket_code` default upgraded to 16-char (64-bit entropy).
3. `payment_logs` RLS: hosts can read their own rows (`host_id = auth.uid()`).
4. `events.cover_image_url` CHECK constraint: `https://` only.

---

## End-to-End Payment Flow

```
1.  Host creates paid event in Studio (price, capacity, description, cover_image_url, is_private)
2.  Event appears in mobile feed (public to all, or community-members only)
3.  User taps event → event detail screen
4.  User taps "Buy Ticket — $X.XX"
5.  Mobile calls create-payment-intent edge fn (JWT auth, rate limited 10/day)
       → private event: membership check enforced
       → pending payment_logs row inserted (buyer_id from JWT, never from Stripe metadata)
       → Stripe PaymentIntent created (on_behalf_of host, idempotency key: event_id:buyer_id)
       → returns { client_secret, publishable_key }
6.  Mobile presents PaymentSheet (card / Apple Pay / Google Pay)
7.  User pays → Stripe fires payment_intent.succeeded webhook
8.  stripe-webhooks verifies Stripe-Signature header (HMAC-SHA256)
       → looks up buyer_id from our payment_logs (not Stripe metadata)
       → calls claim_ticket(event_id, buyer_id) atomically
       → upgrades payment_logs status → 'succeeded', sets ticket_code
9.  Mobile Realtime subscription fires → TicketConfirmation shown (QR + code)
10. Host sees earnings in Studio Payouts page (payment_logs, host_id RLS)
11. Host clicks "Open Stripe Dashboard" → stripe-dashboard-link fn → one-time login URL
```

---

## OWASP Controls

| OWASP | Control |
|---|---|
| A01 Access Control | Private event membership check; attendee panel JOIN enforces host_id; payment_logs RLS scoped to host_id |
| A02 Cryptographic Failures | HMAC-SHA256 webhook verification; 64-bit ticket code entropy |
| A03 Injection | Parameterized queries; UUID validation; https-only cover_image_url at DB level |
| A04 Insecure Design | SECURITY INVOKER on claim_ticket; atomic capacity check; no oversell |
| A06 Vulnerable Components | Official Stripe React Native SDK; official stripe npm package |
| A07 Auth Failures | JWT on all edge functions; Stripe-Signature on webhook |
| A08 Data Integrity | buyer_id from our DB not Stripe metadata; idempotent via UNIQUE payment_intent_id |
| A09 Logging | pending→succeeded audit trail; no silent NULLs; sanitizePaymentError before crash logs |
| M1 Credential Exposure | Publishable key public by design; client_secret never stored/logged |
| M6 Privacy | client_secret redacted before Crashlytics |
| M10 Cryptography | 16-char ticket code (64-bit) |

---

## Files Changed

### New files
| File | Purpose |
|---|---|
| `supabase/migrations/022_payments_phase2.sql` | claim_ticket fn, ticket entropy, payment_logs RLS, https constraint |
| `supabase/functions/create-payment-intent/index.ts` | Creates PaymentIntent, pending log, membership check |
| `supabase/functions/stripe-dashboard-link/index.ts` | Stripe Express login link |
| `apps/mobile/lib/stripe.ts` | purchaseTicket(), sanitizePaymentError() |
| `apps/mobile/components/TicketConfirmation.tsx` | Post-purchase QR + ticket reveal |
| `apps/mobile/__tests__/lib/stripe.test.ts` | Unit tests for stripe.ts |
| `apps/mobile/__tests__/components/TicketConfirmation.test.tsx` | Component tests |
| `apps/studio/app/(dashboard)/loading.tsx` | Shared dashboard loading skeleton |
| `apps/studio/app/(dashboard)/events/loading.tsx` | Events loading skeleton |
| `apps/studio/app/(dashboard)/payouts/loading.tsx` | Payouts loading skeleton |

### Modified files
| File | Change |
|---|---|
| `supabase/functions/stripe-webhooks/index.ts` | Add signature verification + payment_intent.succeeded handler |
| `apps/mobile/app/_layout.tsx` | Add StripeProvider wrapper |
| `apps/mobile/app/event/[id].tsx` | Buy Ticket button, Realtime ticket listener |
| `apps/studio/app/globals.css` | Roxy brand theme CSS variables |
| `apps/studio/tailwind.config.ts` | Extend with roxy color tokens |
| `apps/studio/components/Sidebar.tsx` | Roxy brand sidebar styling |
| `apps/studio/app/(dashboard)/payouts/page.tsx` | Earnings from payment_logs + Stripe link |
| `apps/studio/app/(dashboard)/events/page.tsx` | Ticket sales count, attendees panel |
| `apps/studio/app/(dashboard)/events/CreateEventForm.tsx` | description, cover_image_url, max_attendees, is_private |

### Deleted files
| File | Reason |
|---|---|
| `apps/studio/app/protected/page.tsx` | Template remnant |
| `apps/studio/app/protected/layout.tsx` | Template remnant |

---

## Secrets Required

```bash
# Supabase edge function secrets
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STUDIO_URL=https://roxy-studio.vercel.app

# Vercel env vars (Studio)
# none — Stripe secrets stay in Supabase only

# Mobile
EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
```
