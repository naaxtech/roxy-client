# Supporter S1 — entitlement backbone (server)

Spec: `docs/superpowers/specs/2026-10-26-roxy-supporter-design.md` §1. Branch `slice/roxy/supporter`.
Line it moves: **new revenue**. This slice is the money path's server end: a RevenueCat webhook lands in
`supporter_entitlements`, and every later perk gate asks `is_supporter(uid)`.

Scope: migration 140 (+ down + check) and the `revenuecat-webhook` edge function. Out of scope: the mobile
client, `react-native-purchases`, the paywall, perks (S2), GDPR-export section.

## What RevenueCat actually sends (research, 2026-10-26)

| Fact | Source |
|---|---|
| Body is `{ api_version, event: {...} }`; `event.id` is reused on retries; `event_timestamp_ms` is the generation time | webhooks/event-types-and-fields |
| `app_user_id` = most recently seen id; `original_app_user_id` = first; `aliases` = every id used | event-types-and-fields |
| `entitlement_ids` always present, can be `null`; `expiration_at_ms` can be `null` (non-subscription / lifetime) | event-types-and-fields |
| `environment` is `SANDBOX` or `PRODUCTION`; one customer can hold both | event-types-and-fields; webhooks |
| `store` ∈ AMAZON, APP_STORE, MAC_APP_STORE, PADDLE, PLAY_STORE, PROMOTIONAL, RC_BILLING, ROKU, STRIPE, TEST_STORE ("sometimes") | event-types-and-fields |
| A refund is a `CANCELLATION` with `cancel_reason = CUSTOMER_SUPPORT` (no own type); `REFUND_REVERSED` undoes it | event-types-and-fields; sample-events |
| `BILLING_ISSUE` always carries `grace_period_expiration_at_ms` (nullable) | event-types-and-fields |
| `TRANSFER` carries `transferred_from` / `transferred_to` (string arrays), is sent for the destination only, and moves the entitlements from one user to the other | event-types-and-fields; event-flows |
| `PRODUCT_CHANGE`: an immediate change is dispatched *alongside* a `RENEWAL` (App Store) or `INITIAL_PURCHASE` (Play); a deferred one keeps the old entitlement until the next `RENEWAL` | event-flows |
| `SUBSCRIPTION_PAUSED`: do not revoke access; `TEMPORARY_ENTITLEMENT_GRANT`: ≤ 24 h, store not validated | event-types-and-fields |
| Billing-issue events are dispatched together and can arrive out of order | event-flows |
| Authorization header: optional, configured by us, sent verbatim on every request; verify it every time | webhooks |
| Any non-200 is a failure; 5 retries (≈2.5→40 min); 60 s timeout; delivery is at-least-once → idempotent on `event.id` | webhooks |

URLs: `https://www.revenuecat.com/docs/integrations/webhooks`, `…/webhooks/event-types-and-fields`,
`…/webhooks/sample-events`, `…/webhooks/event-flows`.

## Design decisions

0. **One row per subscription, not per member** (changed after review, 2026-10-26). A member can hold
   two Supporter subscriptions at once: a cancelled monthly still running beside a new yearly, or Play
   and web. With one row per member, the monthly's EXPIRATION wiped out the paid yearly.
   - `supporter_subscriptions` (key `txn:<original_transaction_id>`, else `user:<uid>:product:<id>`) is
     the truth. Each row has its own event clock. `store` is not in the key because RC sends it only
     "sometimes".
   - `supporter_entitlements` (user_id PK, the brief's contract) is her best subscription, derived by
     `_supporter_refresh()`. The app reads it for display.
   - `is_supporter` reads the subscriptions.
   - Sandbox purchases are separate subscriptions, so the earlier "shadowed" rule is gone.
   - Rejected alternative, kept as a follow-up: RC's own recommendation (webhooks, "Syncing Subscription
     Status") is to call `GET /subscribers` after any webhook. It needs a RevenueCat secret API key
     (owner-gated) and cannot be exercised from here.
1. **Split of responsibility.** `_shared/revenuecat.ts` (pure, tested) knows RevenueCat: it validates the
   payload, resolves the member, filters on the `supporter` entitlement and reduces each event to one
   *effect*. `apply_supporter_event` (SQL, service role only) knows nothing about RevenueCat: it applies
   an effect to one subscription under an event-time guard. The provider-specific rules live in one
   place with their citations; the state machine lives next to the data.

   | RevenueCat type | effect | subscription row |
   |---|---|---|
   | INITIAL_PURCHASE, RENEWAL, UNCANCELLATION, NON_RENEWING_PURCHASE, SUBSCRIPTION_EXTENDED, REFUND_REVERSED | `activate` | active, period = expiration (`infinity` when RC sends null = lifetime) |
   | BILLING_ISSUE | `grace` | grace, period = grace end, else expiration |
   | EXPIRATION | `expire` | expired |
   | CANCELLATION + CUSTOMER_SUPPORT, expiration null or ≤ event time | `refund` | refunded |
   | CANCELLATION + CUSTOMER_SUPPORT, period still running | `cancel` | untouched — RC: "refunds can be given without canceling a subscription" |
   | CANCELLATION (other reasons) | `cancel` | untouched — she keeps it to period end |
   | PRODUCT_CHANGE | `change` | untouched — the accompanying RENEWAL / INITIAL_PURCHASE carries the period |
   | TRANSFER | `transfer` | the sources' subscriptions (of the event's store, if named) → destination; to a non-member they expire |
   | TEST, every other type, any event without the `supporter` entitlement | `log` | untouched |

   PRODUCT_CHANGE deviates from "→ active" in the brief on purpose: per event-flows it is informational,
   and if it advanced the clock it would make the INITIAL_PURCHASE dispatched alongside it look
   stale and drop the new period.
2. **Event-time guard, per subscription.** A state effect applies only when `event_at > last_event_at` of
   that subscription; otherwise it is logged as `stale`. Informational effects (`cancel`, `change`, `log`)
   never create a row and never move a clock. A newer event naming another member moves the subscription
   to her (its TRANSFER is still in flight). A transfer moves or expires rows, never deletes them, so a
   delayed pre-transfer RENEWAL meets a newer clock and is stale.
3. **Idempotency.** `supporter_events` is inserted first with `ON CONFLICT (id) DO NOTHING`; zero rows ⇒
   `duplicate`, nothing else runs. Locks: the subscription key, then members in uuid order.
4. **Sandbox rule.** Sandbox subscriptions count only while `platform_settings.supporter_sandbox_counts`
   is true (default false). Play license testers and RC Web Billing test purchases are sandbox; on
   production the owner flips it on for a test window and off again.
5. **Kill switch.** `platform_settings.supporter_enabled` (default false) is part of `is_supporter`, so every
   S2 gate falls back to free behaviour from one place. The webhook still records every event while it is
   off — real money must not be dropped. `platform_settings` stays sealed (131 revoked it from clients; it
   also holds fee settings), so the switch is read through `supporter_enabled()` (definer, authenticated).
6. **Who is she.** `app_user_id` is the Supabase uuid set at SDK configure. Prefer it when it is a uuid;
   otherwise accept exactly one distinct uuid among `original_app_user_id` + `aliases`; otherwise log as
   `unknown_user`. An id with no `profiles` row is also `unknown_user` (logged with `user_id` null).
7. **PII.** The stored payload is an allowlist of RC fields: no `subscriber_attributes` (`$email` etc.),
   no `country_code`, no Web Billing `metadata`. Nothing about the member is logged by the function: only
   type, effect, result, error code (`console.info` / `console.error`).
8. **Auth.** `Authorization` must equal `REVENUECAT_WEBHOOK_SECRET` exactly, or be `Bearer <secret>`;
   constant-time compare. Unset / short (< 16 chars) secret ⇒ 503 for every caller (fail closed).
   `verify_jwt = false` in `config.toml` (RC cannot hold a Supabase JWT). No CORS: server-to-server.
   HMAC signing (`X-RevenueCat-Webhook-Signature`) is optional in RC and deferred — trigger: owner enables it.

Results returned to RC (all 200): `applied`, `duplicate`, `stale`, `logged`, `unknown_user`.
400 for a malformed envelope (RC retries 5× and the dashboard shows it), 500 for a DB error (retry wanted).

## Emotional-AI value

`supporter_events` is a flat, typed churn/retention timeline per member (type, effect, environment,
event_at, result): purchase → cancel → billing issue → expire / renew. Joined later with the S1-client
paywall events, it answers which perk converts and what precedes a lapse.

## Tasks (TDD)

1. `supabase/tests/140_supporter_entitlements_check.sql` first; run → RED (relations missing).
2. `_shared/revenuecat.test.ts` first; run → RED (module missing).
3. Migration 140 + down; GREEN; `--cycle public.supporter_entitlements,public.supporter_subscriptions,public.supporter_events`;
   `--mutate` per rule (event-time guard, subscription key, summary order, gate source, transfer store
   filter, transfer to a non-member, storeless event keeps its store) — each must fail its own assertion.
4. `_shared/revenuecat.ts` + `revenuecat-webhook/index.ts` + `config.toml` entry; `deno test`, `deno check`.
5. `node scripts/check-migrations.mjs`.

## Owner steps (not doable here)

- RevenueCat: entitlement identifier **`supporter`** (both products attached); webhook URL
  `https://<project>.functions.supabase.co/revenuecat-webhook`; Authorization header value = the secret.
- `npx supabase secrets set REVENUECAT_WEBHOOK_SECRET=…` (≥ 16 chars), apply 140, deploy the function.
- Flip `supporter_enabled` (and `supporter_sandbox_counts` only for a test window) with the service role.

## Not in this slice (tracked)

- GDPR export section for `supporter_entitlements` / `supporter_events` (`_shared/gdprExport.ts`).
- Account deletion should tell her to cancel in the store; RC keeps billing a deleted account.
- `TEMPORARY_ENTITLEMENT_GRANT` is logged, not honoured: the store purchase that follows will apply.
- Reconcile with RC `GET /subscribers` after each webhook (RC's recommendation). Trigger: before the kill
  switch goes on in production, or the first support case where our row disagrees with RC.
- `unknown_user` events and 400-rejected deliveries are not replayed automatically; recovery is RC's
  dashboard "Retry" once the cause is fixed.
- `supabase/tests/*_check.sql` (this one included) is not run by CI; it is proven locally only.
