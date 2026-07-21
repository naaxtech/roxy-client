# Roxy — Architecture

Roxy is a community-first WLW social + dating platform. This document describes
how the system is put together: the apps, the backend, the request lifecycle,
the data model, navigation, the load-bearing domain flows, and the security
model. Diagrams are [Mermaid](https://mermaid.js.org/) and render on GitHub.

> Scope: `apps/mobile` (the end-user client) is the focus; `apps/studio` (the
> seller/staff dashboard) and the shared Supabase backend are included where
> they interact with the client. Finer-grained history lives in `CHANGELOG.md`
> and `.claude/log.md`.

---

## 1. System context

```mermaid
flowchart TB
  subgraph Clients
    M["apps/mobile<br/>Expo 51 · React Native · Expo Router v3<br/>(iOS · Android · Web @ roxy.expo.app)"]
    S["apps/studio<br/>Next.js 16 · shadcn/ui<br/>(seller + staff dashboard)"]
  end

  subgraph Supabase["Supabase (project ptymtdlysqbpxzlgsshp)"]
    AUTH["Auth (JWT)"]
    DB[("Postgres<br/>61 tables · RLS on every table")]
    RT["Realtime<br/>filtered postgres_changes + broadcast"]
    ST["Storage<br/>avatars · profile-photos · post-media ·<br/>product-photos · business-logos · room-banners"]
    EF["Edge Functions (Deno) ×42"]
  end

  subgraph External
    STRIPE["Stripe<br/>Connect · Checkout · Payment Sheet"]
    DAILY["Daily.co<br/>video/audio rooms"]
    RESEND["Resend<br/>transactional email"]
    CLAUDE["Anthropic<br/>Roxy AI (Haiku/Sonnet)"]
    OBS["PostHog · Sentry<br/>analytics + errors"]
  end

  M -->|"supabase-js + callEdgeFunction()"| AUTH
  M --> DB
  M --> RT
  M --> ST
  M -->|invoke| EF
  S --> AUTH
  S --> DB
  S -->|invoke| EF

  EF --> DB
  EF --> STRIPE
  EF --> DAILY
  EF --> RESEND
  EF --> CLAUDE
  M --> DAILY
  M --> OBS
```

**Cloud stage:** Stage 1 (edge) — Supabase + EAS Hosting (Vercel/Cloudflare
edge for web). Native-only capabilities (Daily.co video) degrade gracefully to
a "works in the app" screen on web via a guarded `require`.

---

## 2. Request lifecycle

Every privileged action goes through an edge function; direct table access from
the client is always mediated by Row-Level Security.

```mermaid
sequenceDiagram
  participant U as User (mobile)
  participant Store as Zustand store
  participant SDK as supabase-js
  participant EF as Edge Function
  participant DB as Postgres (RLS)

  U->>Store: action (e.g. add to cart, join room)
  alt direct data read/write (RLS-guarded)
    Store->>SDK: from('table').select/insert/update
    SDK->>DB: PostgREST + JWT
    DB-->>SDK: rows allowed by RLS policy
    SDK-->>Store: { data, error }  (never throws)
  else privileged / cross-cutting op
    Store->>SDK: callEdgeFunction(name, body)
    SDK->>EF: POST /functions/v1/name  (Bearer JWT)
    EF->>EF: handleCors → verifyJWT (401) → checkRateLimit
    EF->>DB: service-role logic (still RLS-aware)
    EF-->>Store: { data, error, status }  (real error body parsed)
  end
  Store-->>U: optimistic UI + reconcile on result
```

Key conventions:
- **`supabase-js` returns errors, it never throws** — every call checks
  `error`. Optimistic updates roll back on `error`.
- **`callEdgeFunction`** (`lib/supabase.ts`) returns `{ data, error, status }`
  and parses `FunctionsHttpError.context.json()` for the real server error body.
- **Web-safe dialogs:** `react-native-web` stubs `Alert.alert`, so all confirms
  route through `lib/confirm.ts` (`confirmAction`/`showAlert`).

---

## 3. Data model (core)

61 tables total; the core social + commerce entities and their relationships:

```mermaid
erDiagram
  profiles ||--o{ community_members : joins
  communities ||--o{ community_members : has
  communities ||--o{ posts : contains
  communities ||--o{ events : hosts
  communities ||--o{ community_rooms : hosts
  profiles ||--o{ posts : authors
  posts ||--o{ post_likes : liked
  posts ||--o{ post_saves : saved
  posts ||--o{ comments : has
  profiles ||--o{ friendships : requester
  profiles ||--o{ conversations : participates
  conversations ||--o{ messages : contains
  messages ||--o{ message_reactions : reacts
  businesses ||--o{ products : sells
  products ||--o{ product_variants : has
  products ||--o{ product_photos : has
  profiles ||--o{ orders : places
  businesses ||--o{ orders : fulfils
  orders ||--o{ order_items : contains
  profiles ||--o{ donations : gives
  profiles ||--o{ user_business_bookmarks : bookmarks
```

- **Tenancy** is community-scoped: `profiles → community_members → communities`.
  Every content table (`posts`, `events`, `community_rooms`, `messages`) carries
  the scoping foreign key and an RLS policy enforcing it.
- **Commerce** is `businesses → products → product_variants/product_photos`, with
  `orders → order_items` and `order.currency` for international display.
- Engagement tables (`post_likes`, `post_saves`, `comment_likes`, `seen_posts`)
  use `user_id DEFAULT auth.uid()` so the client inserts only the content id and
  the row is stamped server-side (migration 062).

---

## 4. Navigation & state

Expo Router v3. Five tabs plus **root-level routes** that overlay the tab bar so
back-navigation always returns to the origin tab (community/product/room/etc.).

```mermaid
flowchart LR
  subgraph Tabs["(tabs)"]
    G["grow<br/>home · Roxy · streak · QOTD · happening"]
    C["connect<br/>feed · events · rooms · communities"]
    P["discover = Play<br/>games · speed dating · live rooms"]
    MSG["messages<br/>DMs + Roxy"]
    B["build<br/>businesses · impact · support"]
  end
  subgraph Root["root routes (overlay tabs)"]
    BIZ["/business/[id] — storefront"]
    PROD["/product/[id] — product detail"]
    COM["/community/[id]"]
    ROOM["/community-room-session"]
    EVT["/event/[id]"]
    USR["/user/[id]"]
    CHAT["/chat/[id]"]
    SD["/speed-dating/*"]
    SIS["/sister-button"]
    SRCH["/search"]
  end
  B --> BIZ --> PROD
  MSG --> CHAT
  C --> COM
  P --> ROOM
```

**State** is Zustand, one store per domain (13 total):

| Store | Owns |
|---|---|
| `authStore` / `profileStore` | session, current user profile |
| `connectStore` | conversation list + unread counts |
| `feedStore` | posts, likes/saves, video queue |
| `buildStore` | businesses, bookmarks, impact support |
| `marketplaceStore` | cart, products, orders, checkout |
| `communityStore` / `communityFilterStore` | joined communities, active filter |
| `friendStore` / `safetyStore` | friendships/presence, blocks/reports |
| `roxyChatStore` / `gamesStore` / `themeStore` | Roxy chat, games, theme |

Two performance rules learned in practice: **filtered realtime only** (never
table-wide listeners; `lib/realtimeChannel.freshChannel` avoids remount
crashes), and **memoize derived arrays** before passing them to child effects
(an unstable `communityIds` caused a per-render refetch storm on Grow — fixed by
memoizing on a stable key).

---

## 5. Domain flow — marketplace purchase

```mermaid
sequenceDiagram
  participant U as Buyer
  participant SF as /business/[id]
  participant PD as /product/[id]
  participant CO as CheckoutSheet
  participant EF as create-product-order
  participant STR as Stripe
  participant WH as stripe-product-webhook

  U->>SF: open storefront (route, not modal)
  U->>PD: tap product → variant + qty
  U->>CO: Buy Now / cart → review → shipping → payment
  CO->>EF: createOrder(businessId, shipping)
  EF->>STR: PaymentIntent (Connect, platform fee)
  EF-->>CO: { clientSecret, orderId }  (order = 'pending')
  CO->>STR: Payment Sheet (initPaymentSheet + present)
  STR-->>WH: payment_intent.succeeded
  WH->>WH: mark order paid · decrement stock · queue email
  U->>U: OrderConfirmationSheet → "View My Orders" (?orders=1)
```

Prices render through `lib/currency.formatMoney(cents, currency)` everywhere;
order surfaces use the order's own `currency`, pre-order surfaces default USD.

---

## 6. Domain flow — community room join

```mermaid
sequenceDiagram
  participant U as User
  participant RS as community-room-session
  participant EF as join-community-room
  participant DAILY as Daily.co
  participant PROV as DailyProvider

  U->>RS: Join now
  RS->>EF: callEdgeFunction(room_id)
  EF->>EF: membership guard (403) · status gate (409/410)
  EF->>DAILY: get/create room + meeting token (owner role)
  EF-->>RS: { room_url, token, room_type }
  alt native (Daily available)
    RS->>PROV: provider.join(roomUrl, token)
    PROV-->>U: video/audio grid + host controls
  else web (guarded require → stub)
    RS-->>U: "Video rooms work in the Roxy app" screen
  end
```

`DailyProvider` validates the module shape (metro's web stub is a truthy empty
object) so web never attempts a join it can't complete.

---

## 7. Security model

- **A01 Access Control:** RLS enabled on **all 61 tables**; every policy scopes
  rows by `auth.uid()` or community membership. Storage buckets enforce
  `auth.uid() = foldername(name)[1]` (uploads must live under the user's folder).
- **Edge function guards:** user-facing functions call `verifyJWT` (401);
  webhooks (`stripe-*`, `daily-webhook`, `cloudflare-video-webhook`) verify the
  provider signature; money-movement/cron functions (`release-payout`,
  `process-refunds`, `reconcile-orders`) require the service-role key.
- **A03 Injection:** all DB access is parameterized via PostgREST; search input
  is sanitized before `.or()` filters.
- **PII:** never logged (see the observability rules in `CLAUDE.md`); user ids
  are hashed before analytics.
- **Payments:** Stripe holds card data; Roxy stores only order/amount metadata.

---

## 8. Build, deploy, verify

```mermaid
flowchart LR
  DEV["feature branch<br/>session-N-slug"] -->|"tsc · eslint --max-warnings 0 · jest · expo export"| QA{green?}
  QA -->|no| DEV
  QA -->|yes| REV["code review<br/>(per-task + whole-branch)"]
  REV --> MERGE["merge → main"]
  MERGE -->|"expo export --platform web<br/>eas deploy --prod"| PROD["roxy.expo.app"]
  PROD --> E2E["Playwright nav-smoke<br/>+ visual checks (390 / 1280)"]
```

- **QA loop** is mandatory before merge: `tsc --noEmit`, `eslint --max-warnings 0`,
  `jest --ci`, `expo export`. Web is verified with Playwright at phone (390) and
  desktop (1280) widths.
- **Web deploy:** `expo export --platform web` then `eas-cli deploy --prod` from
  `apps/mobile`. Prod bundle is cache-busted — always hard-refresh after deploy.
- **Native:** EAS Build; not deployed from unattended runs.

---

## 9. Known constraints / follow-ups

- **Seed data has no marketplace products** — storefront routes and states are
  verified, but end-to-end checkout is code-reviewed, not live-exercised.
- **`EXPO_PUBLIC_GIPHY_API_KEY`** is unset — chat GIF search shows a graceful
  fallback until the key is added to the app + EAS env.
- **Scale:** the Grow refetch storm is fixed; the same "memoize derived arrays
  passed to child effects" audit should extend to Connect's community-scoped
  fetches. RLS isolation-test harness is still recommended before public launch.
```
