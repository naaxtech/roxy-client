# Roxy Supporter — design

Owner, 2026-10-26: "Add Roxy supporter subscription which unlocks several features like: Join a community
from anywhere, incognito, selling profile banners, skins, the chance to sign up as a merchant and be
approved, and they also get a special sticker badge that they are a supporter (similar to Discord Nitro
concept)."
Line it moves: **new revenue**. It is Roxy's first recurring consumer revenue line.
Branch `slice/roxy/supporter` (worktree `roxy-client-worktrees/w3-a`).

## Owner decisions (2026-10-26, asked and answered)

| Question | Answer |
|---|---|
| "Join from anywhere" | **City chapters are local-only for free members.** Location / in-person communities can be joined by free members within ~100 km. Supporters join any city's chapter. Online communities stay open to everyone. |
| Incognito | **New Incognito; Ghost stays free.** Her profile is seen only by members she follows, has chatted with, or shares a community with. |
| Banners & skins | **Included with Supporter.** One product, one paywall. |
| Price | **$4.99 / month or $39.99 / year.** Billing through RevenueCat, Google Play Billing on Android, and Stripe through RevenueCat Web Billing on roxy.expo.app. |

These supersede the Plus / Pro / Super tier table in `CLAUDE.md` §16. That table was never built, and
nothing gates on it. Payments for the marketplace (orders, tickets, payouts) stay on Stripe Connect;
subscriptions go through RevenueCat (2026-07-28 decision: Naaxtech Corp is the RevenueCat merchant).

## Assumptions (reversible; stated, not asked)

- **Nothing a member has today is taken away:**
  - Members already in a city chapter stay in it.
  - Existing sellers, and seller applications already pending, are grandfathered: the Supporter
    requirement applies to new merchant applications only.
  - Ghost mode stays free.
- **When a subscription lapses, perks stop but nothing is deleted:**
  - The banner and skin hide; they come back if she resubscribes.
  - Incognito switches off, and she is told so in a notification.
  - Chapters she joined from afar stay joined; she just can't join new far ones.
- **A moderator's invite overrides the distance rule.** A chapter can always invite someone in.
- **The sticker badge shows everywhere her name does:** the feed identity block, profile, comments, chat
  and member lists. Each place gets one small mark with an accessible label "Roxy Supporter". It is also
  a badge in the existing badge system (`badges` + `_sync_badges_for`).

## What exists (map, 2026-10-26)

- No RevenueCat, no Play Billing, no entitlement table, no paywall. Premium (M176) and Discreet mode
  (M175) were held for Nicole (`polish/decisions.md`, 2026-10-21); this spec answers M176.
- Only `@stripe/stripe-react-native` is installed. Donations create Stripe subscriptions, but no webhook
  ever updates their status. That is a known gap, out of scope here.
- Joining: `request_to_join_community` (132:1563) and `cm_insert_own` (132:864). No location rule exists.
- Ghost = `profiles.is_ghost`. There are no profile banners or skins. A seller is a `businesses` row
  (verified + can_sell + Stripe account), applied for in Studio and approved by staff.
- Badges: server-awarded (`_sync_badges_for`, 087).

## Design

**1. Entitlement backbone (slice S1, the money path):**
- Migration 140:
  - **`supporter_entitlements`**: `user_id` PK, `status` (active | grace | expired | refunded),
    `period_ends_at`, `store` (play_store | stripe | app_store), `product_id`,
    `original_transaction_ref`, `updated_at`.
    - RLS on: the owner can SELECT her own row. **No client writes.**
    - It is written only by the RevenueCat webhook edge function (service role), with an
      `ON CONFLICT DO UPDATE` keyed on `user_id` and an event-time guard, so an out-of-order webhook
      cannot resurrect an expired entitlement.
  - **`supporter_events`**: an append-only log of every webhook event (`id` = RevenueCat event id, so
    replays are idempotent). Kept for support, refunds and the money-path analytics.
  - **`is_supporter(uid)`**: a STABLE SECURITY DEFINER function with `search_path` set. It is true when
    the status is active or grace and `period_ends_at > now()`. Every perk gate below calls it server-side.
- Edge function `revenuecat-webhook`:
  - verifies the RevenueCat authorization header (shared secret from env, constant-time compare);
  - maps `app_user_id`, the Supabase user id set at SDK configure, to the user;
  - handles INITIAL_PURCHASE, RENEWAL, CANCELLATION (stays active to period end), EXPIRATION,
    BILLING_ISSUE (grace), REFUND / revocation, and PRODUCT_CHANGE;
  - follows the repo's edge-function conventions (CORS, error handler, no PII logged).
- Client:
  - `react-native-purchases` (native, Android) and RevenueCat Web Billing (`@revenuecat/purchases-js`,
    web) behind one `lib/supporter.ts`, so roxy.expo.app and the APK behave the same.
  - The SDK is configured with the Supabase user id after sign-in, and logged out on sign-out.
  - The entitlement is read from the server (`supporter_entitlements`), not trusted from the SDK cache,
    for anything the server enforces. The SDK's answer only decides what the paywall shows.
- **Paywall screen** `/supporter`:
  - the perks in plain words;
  - monthly and yearly options, with yearly marked "Save 33%";
  - Restore purchases, Manage subscription (store deep link), Terms and Privacy links;
  - deliberate loading, error and success states;
  - success shows the badge being applied and the perks list, then returns her to where she came from.
- **Entry points:** You › "Roxy Supporter" row, plus each gated action, which opens the paywall with
  the reason ("Join chapters in any city").
- **Kill switch:** server-side `platform_settings.supporter_enabled`. While it is off, the paywall shows
  "Coming soon" and the gates use their free behaviour.
- **Analytics on the money path** (PostHog via `@roxy/observability`, no PII): `supporter_paywall_viewed`
  {source}, `supporter_purchase_started` {plan}, `supporter_purchase_completed` {plan},
  `supporter_purchase_failed` {code}, `supporter_restored`.

**2. Perks (slice S2), each enforced on the server:**
- **Sticker badge:**
  - `is_supporter` is exposed as a public boolean on profile reads (a computed column in the public
    profile view), so other members see the mark.
  - A `SupporterMark` component goes next to the name, and a "Roxy Supporter" badge is synced by
    `_sync_badges_for`.
- **City chapters from anywhere:**
  - Depends on Nearby (migration 139: `communities.city_id/lat/lng/meets`). Adds a private
    `profiles.home_city_id`, readable only by the owner (like `location_city` today) and never logged.
  - She sets her home city from Nearby: GPS gives the nearest city, or she chooses one. She can change it
    once every 30 days, so it can't be hopped.
  - `request_to_join_community` and `cm_insert_own` refuse a free member when the community has
    `meets <> 'online'` and a `city_id`, and that city is more than 100 km from her home city (or she has
    none). They allow it when `is_supporter(auth.uid())` or she has a moderator invite.
  - The refusal is a typed error that the client turns into the paywall with the reason.
- **Incognito:**
  - `profiles.is_incognito` can be set only through `set_incognito(bool)`, which requires `is_supporter`.
  - The public profile read policy (130:210/255, where ghost is already excluded) adds: incognito
    profiles are visible only to members she follows, has a conversation with, or shares an approved
    community membership with, and always to herself and staff.
  - Feed and discovery surfaces that list people (top members, member lists, search) apply the same
    rule through the same SQL helper `can_see_profile(viewer, owner)`.
  - Her posts in communities stay visible to that community's members.
- **Profile banners & skins:**
  - A `profile-banners` storage bucket (owner write, 3:1, ≤ 2 MB, image types only, path
    `<uid>/banner.<ext>`), plus a set of preset banners.
  - `profiles.banner_path` and `profiles.skin_id`, set through RPCs that require `is_supporter`.
  - Skins are a small fixed catalogue: a profile colour theme plus a name style, built from
    `lib/theme.ts` tokens and checked for contrast in both themes.
  - The renderer shows them only while `is_supporter(owner)` is true. Lapsed members' choices are kept
    and hidden.
  - Uploaded banners are reportable through the existing report flow.
- **Merchant applications:** Studio's business application (`settings/business-actions.ts`) and its
  insert policy (131:369) require `is_supporter` for **new** `businesses` rows. Existing rows are
  untouched. The mobile "Sell on Roxy" row opens the paywall when she isn't a Supporter.

## Emotional-AI value

The analytics events above, recorded per member: which perk led a member to subscribe, and when she
leaves (churn signals). Consent is already covered by ToS; the subscription terms need a line about it.

## Commercial gate (must be green before this merges)

- A real purchase through a Play Console license tester, and a Stripe test-mode web purchase, each
  reaching `supporter_entitlements` through the webhook.
- Restore works.
- Expiry and refund each revoke the perks.
- The kill switch has been tested in both positions.
- Support: a "Help with Supporter" row going to the existing support channel, plus a refund note in FAQ.
- Rollback: the kill switch, then a down migration.

## Owner-gated (cannot be done from here)

- **RevenueCat:** create the project and attach the Android app (`com.roxy.app`) and Stripe for Web
  Billing; supply the public SDK keys and the webhook secret. Keys go to env/EAS secrets, never into code.
- **Play Console:** create the subscriptions `roxy_supporter_monthly` ($4.99) and
  `roxy_supporter_yearly` ($39.99) with regional prices, and add license testers.
- Approve the ToS / subscription terms text.
- A **new APK build**: `react-native-purchases` is a native module.
- Apply migration 140 to prod, deploy the edge function, `host:deploy`.

## Research before build (research-protocol)

Pin the `react-native-purchases` version that supports Expo SDK 51 / RN 0.74, and the
`@revenuecat/purchases-js` Web Billing API. Read the docs for those exact versions, and cite them with
`// src:` lines. Do not write against remembered APIs.

## Tests

- SQL checks:
  - no client can write `supporter_entitlements`;
  - `is_supporter` handles grace, expiry and refund;
  - out-of-order webhook events do not resurrect an entitlement;
  - the city-chapter refusal and its invite override;
  - incognito visibility for the follow, chat and community cases, plus refusals for strangers;
  - the banner and skin RPCs are refused for non-supporters;
  - the merchant insert is refused for non-supporters, and existing rows still work.
- Deno: webhook signature rejection, idempotent replay, and event mapping.
- Jest:
  - paywall states, restore, purchase failure;
  - the gated actions open the paywall with their reason;
  - the `SupporterMark` everywhere a name renders.
- e2e, read-only: the paywall renders on web with the kill switch on and off.
