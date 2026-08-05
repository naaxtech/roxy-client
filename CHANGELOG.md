# Changelog

All notable changes to the Roxy client (`apps/mobile`) are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the
project uses [Semantic Versioning](https://semver.org/).

**Versioning policy:** the app version lives in `apps/mobile/package.json` and
`apps/mobile/app.json` (kept in sync). Bump **MINOR** for user-facing features,
**PATCH** for fixes, **MAJOR** for breaking changes to data contracts or the
module contract. Every release adds a dated section below. A running,
finer-grained engineering log lives in `.claude/log.md`.

## [Unreleased]

### Changed
- **Two feeds, two scopes: Connect is the public square, communities hold their
  own.** Connect's Feed and Reels tabs now show community *announcements* only —
  the once-a-day post published under a community's own name (migration 073) —
  and they reach **every** community, joined or not, through the previously
  unwired `announcement_feed` RPC. That RPC ranks by interest overlap × 8 +
  feed_score + recency decay with membership as a +2 tiebreak, so an account
  that has joined nothing gets a populated, relevant first screen instead of the
  empty list the old `in('community_id', joinedIds)` query guaranteed. The
  `adminPairs` heuristic (guessing "is this an announcement?" from who was an
  admin) is deleted along with its `community_members` query;
  `posted_as_community` is explicit now. Tapping a video announcement card still
  opens Reels positioned on that post.
- **Communities gained a Reels tab, and non-members are told the truth.** A
  community's own video now has a home beside its Posts tab, reusing `ReelsFeed`
  with a new `scope` prop (`announcements` · `community` ·
  `community-announcements`). A member sees every post and every video; a
  non-member sees the community's public announcements plus a warm "you're
  seeing the public side" prompt with the Join button in it — not a blank tab
  and not an error. `posts_select` (073) already enforced this server-side; the
  client now asks for exactly what it is entitled to and says why the tab is
  short. Joining refetches the screen, so content appears immediately instead of
  after a navigate-away-and-back. Posts also gained real loading, error, and
  membership-aware empty states.

### Fixed
- **The GDPR data export delivered nothing.** `gdpr-export` has always assembled a complete
  Art. 15(3) copy — profile, message and post counts, and the entire invite-gate record
  (legal name, answers, verification outcomes, appeals, processors), with the reviewer audit
  log withheld under Art. 15(4) and *named* as withheld. `settings.tsx` then destructured
  that payload into `_data`, discarded it, and told her *"Download will be available
  shortly."* Nothing was ever scheduled to arrive. It now writes
  `roxy-data-export-YYYY-MM-DD.json` and hands it to the OS share sheet. `expo-sharing`
  resolves through a shape-checked guarded `require`, because `expo-sharing@12.0.1` calls
  `requireNativeModule` at import time and would otherwise take down the whole Settings
  screen on any binary built before the dependency existed; on an older build it degrades
  to writing the file and saying where it is. Written to the cache directory, not documents
  — a file carrying her legal name should not persist after she has saved a copy.
- **An abandoned checkout held stock hostage, and a declined card oversold it.**
  `create-product-order` decremented stock before the PaymentIntent existed, and only
  `payment_intent.payment_failed` ever gave it back. Two failures, not one. A shopper who
  walked away held inventory until the intent expired — and worse, a *decline* leaves the
  intent retryable, so stock was returned, the buyer retried the same intent with another
  card, and the unit shipped having never left stock. Reservation now lives on the
  PaymentIntent itself (`metadata.stock_held`: `held → sold | released`), which is the one
  object with exactly one row per checkout attempt and the authority on whether payment can
  still happen — Stripe refuses to cancel a succeeded intent, so a successful cancel is the
  processor's own proof the units can never be paid for. All four paths close: success,
  cancellation, client-reported abandonment, and a 30-minute sweep. The decrement moved
  after intent creation, and idempotent replays no longer double-decrement.
- **Prices showed in dollars for sellers who do not price in dollars.** `businesses.currency`
  has existed since migration 031 (`NOT NULL DEFAULT 'usd'`); two route files carried a
  comment asserting the column did not exist and hardcoded `DEFAULT_CURRENCY = 'usd'` on the
  strength of it. Storefront, product, cart and checkout now all read the seller's real
  currency. The product route additionally warms the currency cache itself, since it loads a
  single product directly and never calls `fetchProducts` — on a cold deep link nothing else
  would populate it and every price would have fallen back to the placeholder.
- **The feed never released a video decoder.** `FeedVideoPlayer` set `source={undefined}` for
  out-of-window cells under a comment claiming that unloads the clip. It does not, and the
  cited file does not say it does — verified three levels down: `Video.tsx` has no
  `componentDidUpdate` so the only JS unload is `componentWillUnmount`; Android's `source`
  prop is a non-nullable `ReadableMap`; and `VideoView#setSource` early-returns on a null uri
  *without* calling `mPlayerData.release()`. Live ExoPlayer instances therefore equalled
  mounted cells, not the five `DECODER_WINDOW = 2` implied. Out-of-window cells now unmount
  `<Video>` and render the poster instead, which takes the JS *and* native release paths at
  once; the window is 1. Concurrent-decoder limits are device-specific via
  `getMaxSupportedInstances()`, so the old "commonly 4–8" comment was replaced with what the
  javadoc and the Android CDD actually say.
- **Video lifecycle was keyed on a bare list index**, which carries no type information and
  would have told a non-video cell to play the moment the feed became mixed-media. It now
  derives the active *item id* and requires the cell to be a video. The play/pause control
  and paused glyph are gated on the same thing — that label over a still image was a
  screen-reader lie.
- **One recycling pool for every cell** (`getItemType={() => 'reel'}`) meant FlashList would
  recycle one post type's view into another as soon as the feed stopped being all-video. Now
  keyed on `post_type`.
- **Viewability used the fragile threshold.** `itemVisiblePercentThreshold` divides by the
  *item*, so a cell taller than the viewport can never become viewable — verified in both
  RN 0.74.5's and flash-list 1.6.4's own `ViewabilityHelper`. Switched to
  `viewAreaCoveragePercentThreshold`, which is viewport-denominated. Recycled `expo-image`
  instances gained the `recyclingKey` that stops the previous cell's photo flashing on the
  next one.
- **Dead documentation citations.** `docs.expo.dev/versions/v51.0.0/**` and
  `reactnative.dev/docs/0.74/**` both 404 now — Expo dropped SDK 51 from the live site and
  RN 0.74 was archived. Citations in the touched files were repointed at tagged source.

### Added
- **`components/feed/FeedPager.tsx`** — slice 1 of the redesign. The paging machinery
  (FlashList setup, snap paging, viewport measurement, viewability, active-item derivation,
  decoder-window arithmetic, scroll-position fallback) is now a reusable component;
  `ReelsFeed` keeps its data fetching and scopes and became a thin caller, 499 → 388 lines.
  No user-visible change — the acceptance bar was that `ReelsFeed.test.tsx`,
  `ReelCell.test.tsx` and `FeedVideoPlayer.test.tsx` all pass **unmodified**, and they do.
  `renderCell` is a callback rather than a type→component map so each cell can take the
  domain callbacks it actually needs instead of a uniform props bag; `getItemType` is
  required and supplied by the caller, which is how the pager gets a domain value without
  knowing the domain — and makes it impossible to reintroduce the single-recycling-pool
  defect by omission. `keyExtractor` defines identity, so the pager never touches `.id`.
  Two behaviours needed care: `initialIndex` is applied during render rather than in an
  effect, because an effect lets one render escape with the wrong slot active and a video
  cell acts immediately on that; and the pager re-seeds its active slot when the list is
  rebuilt behind a placeholder, which is a live path — `discover/community/[id].tsx` flips
  scope when a viewer joins, and the error state's "Try again" reloads.
- **`docs/superpowers/plans/2026-08-05-tiktok-redesign.md`** — the UX plan and sketches for
  the single-feed TikTok-formula redesign on `version2`: five-slot navigation, one pager
  carrying every content type, community tags with private communities hidden from
  non-members, the TikTok profile grid, events and games as in-feed cells, and gamification
  retained. Records what could not be verified about TikTok's current interface rather than
  guessing it.
- **`supabase/migrations/086_public_earned_badges.sql`** — earned badges readable by approved
  members, in-progress rows still private, and the three `ubp_owner_*` policies pinned to
  `TO authenticated` (they had been implicitly `TO PUBLIC`, i.e. reachable by `anon`, since
  007). **Not applied**: nothing in this product has ever awarded a badge, and members can
  currently write their own rows, so publishing earned badges would publish forgeries. It
  ships with the award RPC and `REVOKE`, not before.

- **Favourites collapsed and stretched on the Edit Profile screen.**
  `profile/edit.tsx` lays its `ScrollView` content out with
  `alignItems: 'center'`, which replaces flexbox's default `stretch` and makes
  every direct child hug its own content width instead of filling the row. Every
  block written for that screen already defended against it —
  `styles.section` carries an explicit `width: '100%'` — but the two *shared*
  components mounted there, `ProfileFavorites` and `ProfilePhotoGrid`, did not.
  `ProfileFavorites` renders a **horizontal** `ScrollView`, which has no
  intrinsic width at all, so it collapsed and stretched unpredictably; the
  photo grid's fixed-108px wrapping slots likewise could not work out how many
  fit per row. Both now declare `width: '100%'`, which is a no-op on
  `profile/index.tsx` (whose container still stretches them) and makes them safe
  to drop into any parent. The giveaway all along: `ProfileFavorites`' *empty*
  state already had `width: '100%'`, which is why only the populated row broke.

### Changed
- **Edit Profile now reads picture → bio → photos → the rest.** Photos sat below
  the avatar but behind the read-only Display Name and Bio blocks, so the two
  most expressive fields were separated by admin chores. Bio moves directly under
  the avatar and the photo grid follows it; display name, favourites, pronouns,
  identity and badges keep their previous relative order below.

### Fixed
- **The marketplace could not take a single payment.** The client posted
  `{business_id, items, shipping_address}` to `create-product-order`, which has
  always required `{cart_id, shipping_address, idempotency_key}` — every checkout
  died on a 400 before Stripe was ever reached, which is why `orders`, `carts` and
  `cart_items` all still held zero rows. There was no server-side cart at all: no
  `.from('carts')` call existed anywhere in `apps/mobile`. The cart is now mirrored
  into the `carts` / `cart_items` rows the deployed function reads (one row per
  buyer+business per the UNIQUE constraint, expired carts replaced so the DB keeps
  owning the TTL), and the client sends a real idempotency key. The edge function is
  deliberately untouched: it re-derives prices, stock and product approval from the
  cart server-side, so the buyer never names a price — moving that contract to a
  client-supplied item list would have weakened it *and* needed a deploy, after which
  the live function would still have rejected every request until that deploy landed.
  Cart writes run as the buyer under the existing `carts_owner` / `cart_items_owner`
  policies (migration 033); a `FOR ALL` policy with only `USING` applies that same
  expression as `WITH CHECK` on insert
  (src: https://www.postgresql.org/docs/16/sql-createpolicy.html · 2026-08-03).
- **Checkout errors were a shrug, and a retry could take stock twice.** A failed
  order showed "Failed to create order" no matter what the server said; the real
  4xx reasons ("… is out of stock", "Business is not approved to sell", "Cart has
  expired") are now shown to the buyer, while 5xx text — which can name server
  config — stays behind a generic message. Dismissing the Stripe sheet and tapping
  Pay again now reuses the PaymentIntent already opened for that basket and address
  instead of asking for a second one, because `create-product-order` decrements
  stock before creating the intent. The sheet also gained explicit
  preparing/paying/confirming states and resets when closed.
- **"My Orders" was permanently empty, and opening an order would have crashed.**
  `fetchOrders` read `data.orders` off the `{success, data, error}` envelope every
  edge function returns, so it was always `undefined` — a silent empty list. Fixing
  only that would have swapped a blank state for a white screen: `OrderDetailSheet`
  read `total_price_cents`, `event_type` and `description`, none of which exist —
  the columns are `line_total_cents`, `event` and `note` (migration 032, re-verified
  against the live schema, where the wrong three return `42703 column does not
  exist`). `types/marketplace.ts` declared the wrong names, which is exactly why
  `tsc` blessed the bug. Envelope, column names and the type file are corrected
  together; the buyer's rows are now read straight from `orders` under RLS with an
  explicit `buyer_id` filter (the policy also grants sellers read access to orders
  placed *with* them, which would have put sold orders in a buyer's list), and the
  list gained a real error state with retry. Post-payment the order row is written
  by the Stripe webhook, so the confirmation polls for it and says "payment
  received, still finalising" rather than implying failure when it lags.
- **Every community game dead-ended.** `router.push(game.url)` handed expo-router an
  `https://` address, which it treats as an in-app path — so no hosted game could
  ever open, in the Play tab or on a community page. Games now open in the WebView
  launch route that already existed and injects the Roxy SDK, addressed by game id.
  That route could never have worked either: it read `useGamesStore.games`, and
  nothing in the app called `fetchGames`, so it always rendered "not available" — it
  now resolves the game by id itself, which also makes a shared link work cold. Only
  absolute `https` URLs are accepted (`lib/gameUrl.ts`); the WebView runs the page
  next to a bridge that knows the viewer's user id, so `http`, `javascript:`, `file:`
  and `data:` are refused.
- **The Play tab invented four games that do not exist.** When the `games` query came
  back empty the grid fell back to four hardcoded tiles — Two Truths & a Lie, Would
  You Rather, This or That, Speed Dating — none of which are rows in `games` (the
  table holds exactly one row, Speed Dating), and because all four carried
  `url: null`, three of them opened the Speed Dating flow. The fallback is deleted:
  the section now shows real rows only, filters to games that can actually open, and
  otherwise renders an honest empty state, plus a real error state with retry.
- **The GIF picker was dead in every build and hid it behind friendly copy.**
  `EXPO_PUBLIC_GIPHY_API_KEY` is absent from `apps/mobile/.env` and from all three
  `eas.json` profiles, so every request went out with an empty key and came back 403
  — and the picker rendered "GIF search is warming up — check back soon 🌸", which
  reads as a temporary blip rather than an unconfigured integration. With no key it
  now makes no request at all and says GIFs aren't set up; a genuinely failed call is
  distinguished from a genuinely empty result. The key must be added in **all four**
  places (`.env` plus `build.development.env`, `build.preview.env`,
  `build.production.env` in `eas.json`) — `EXPO_PUBLIC_*` is inlined at bundle time,
  so a value present only at runtime never reaches the app.
- **Checkout promised a shipping step that does not exist.** The review step said
  "Shipping calculated at next step" while `create-product-order` defaults
  `shipping_cost_cents` to 0 and the payment step charges the plain subtotal.
- **Blocking a member did nothing at all.** `safetyStore.blockUser` has always
  called `supabase.rpc('block_user', …)`, and no migration ever created that
  function — every block returned PGRST202 and surfaced in the chat menu as
  "Could not block user." `008_safety.sql:2` records the intended mechanism
  ("blocks use existing `friendships.status='blocked'`"), so the storage was
  designed and never given an entry point. Migration `085` adds `block_user()`
  (drops any reverse friendship row so the block holds in both directions,
  rejects self-blocks, idempotent) plus `blocked_user_ids()`. The store's
  `blockedUserIds` also started empty on every launch with nothing refilling it,
  so it is now hydrated once in the tabs layout with its own loading/error
  state — a failed refresh deliberately does not clear the list rather than
  silently un-blocking someone. On a WLW dating app this was the single most
  serious defect found.
- **Read receipts and unread badges were permanently stuck.** The chat screen
  marked a conversation read with a direct `UPDATE messages SET is_read = true`,
  but the only UPDATE policy is `messages_update_own`,
  `USING (auth.uid() = sender_id)` — so the recipient, the one person who can
  know a message has been read, was the one person excluded. RLS filters rows
  instead of erroring, so PostgREST answered `204` and the client believed it
  had worked. Verified against the live database: the UPDATE returns 204 and
  `is_read` stays `false`. Ticks never advanced past one, and the Messages tab
  recomputes unread from the database on every load, so the badge returned
  forever. Migration `085` adds `mark_conversation_read()` — SECURITY DEFINER,
  proves participation itself, and touches only `is_read`. It is an RPC and not
  a policy because `authenticated` holds UPDATE on *every* column of `messages`:
  RLS selects rows, never columns, so any policy permissive enough to let a
  recipient set `is_read` would equally let her rewrite the sender's words.
- **Roxy's daily AI cap could never fire.** `roxy-chat` forwarded the client's
  thread id (`roxy-${user.id}`, not a UUID) into `ai_call_log.conversation_id`,
  which is typed `uuid`. Every insert failed with 22P02, `logAiCall`'s returned
  error was never checked, and the reply rendered regardless — so the table the
  20/day limit counts stayed empty and the limit read zero every time. Confirmed
  live: a successful `roxy-chat` call logged **zero** rows. The daily window
  never used `conversationId`, so it is no longer passed, and a failed log is
  now reported instead of swallowed. This was unbounded Claude spend per user
  against the $0.50/user/month target.
- **Deleting your account reported success when it had failed.**
  `callEdgeFunction` resolves on failure — it catches internally and returns
  `{ data, error }` — so the `try/catch` guarding `gdpr-delete` was unreachable
  and the returned error was never read. A 429 (the function caps at 3/day), a
  500 from `erase_gate_data`, or simply being offline signed the user out and
  sent her to the welcome screen exactly as though the account had been erased.
  The error is now read and surfaced as "Account not deleted — nothing has been
  removed."
- **Every live community room advertised "0 in".** The Connect rooms query
  omitted `participant_count` and `max_participants`, so `CommunityRoomCard`
  fell back to its `participant_count = 0` default no matter how busy the room
  was. Both columns are now selected and passed. The same query discarded its
  error, rendering an outage as "No rooms active right now"; it now has a real
  error state with tap-to-retry. The `(r: any)` cast that hid the missing
  columns from `tsc` is gone, replaced by a typed row that normalises PostgREST
  to-one embeds (generated as arrays, returned as objects).

### Added
- **A theme control in the studio, in dark and light.** One switcher
  (Light / Dark / System) now sits in the `AppSidebar` footer beside Settings
  and sign-out. `ThemeProvider` defaults to `system`, so the studio follows the
  operating system until a host picks a theme explicitly, and remembers that
  choice afterwards; next-themes' blocking script already runs as the first node
  in `<body>`, so there is no flash of the wrong theme. The control is
  keyboard-operable end to end (Radix `menuitemradio`s, focus returns to the
  trigger) and carries a live label — "Change theme (current: Dark)".
  The light palette was measured, not assumed: `--primary` (2.5:1),
  `--destructive` (3.5:1) and white-on-`--secondary` (3.4:1) all failed WCAG AA
  against the near-white light background because they were tuned for the dark
  one. Light-mode overrides now land at 6.7:1, 6.2:1 and 8.4:1 with the brand
  hues unchanged, and low-opacity sidebar/breadcrumb chrome (`/50`, `/60`, `/70`)
  was raised to full `--muted-foreground`. Both themes now pass every checked
  text and icon pair (light min 4.94:1, dark min 4.92:1).
  The dead binary `components/ThemeToggle.tsx` — imported nowhere, and writing a
  `theme_preference` column constrained to `light|dark` so it could never express
  "system" — was deleted in favour of `components/theme-switcher.tsx`.

### Fixed
- **Every dashboard page scrolled hundreds of pixels past its own content into
  an empty void, dragging the sidebar and header off-screen.** Worst on
  `/settings`. The shell is a 100vh flex row with `overflow-hidden`, so the
  document should never have scrolled at all — but `<main>`, the element that
  actually scrolls, was not a *containing block*. An absolutely positioned
  descendant with no positioned ancestor resolves against the initial containing
  block, which means it is clipped by neither `<main>`'s `overflow-y-auto` nor
  the shell's `overflow-hidden`, and its box extends the document instead.
  Radix ships exactly such a node: `<Checkbox>` inside a `<form>` renders a
  hidden bubble input styled
  `position:absolute; opacity:0; transform:translateX(-100%)`
  (`@radix-ui/react-checkbox` 1.3.3). On `/settings` that one invisible 16px
  input sat at document y=1371 against a 900px viewport — 471px of phantom page
  below the shell, measured in-browser. `/invites`, `/applications` and
  `/products` render the same node and had the same void.
  `<main>` and the shell wrapper are now `relative`
  (`apps/studio/app/(dashboard)/layout.tsx`), so such nodes stay clipped to the
  scroll container on every dashboard route. Verified at 1440x900 and 1280x640,
  with staff and non-staff sidebars, across short, long, tall-form and
  wide-table content: page overflow 0 in every case, `<main>` still scrolling
  internally, sidebar and header pinned.
- **Audio and video rooms could not be joined twice, and the studio's room
  controls had never worked.** Rooms failed with a single generic "Failed to
  connect to the room. Please try again." that covered every distinct cause.
  The dominant one: `daily-js` allows exactly **one call object per process**
  and its factory *throws* if a second is constructed while the first is alive.
  `destroy()` is asynchronous, so a screen left mid-teardown — hardware back,
  swipe, error path, or simply re-entering a room — stranded the instance and
  every later join failed until the app was restarted. Mobile now serialises
  this through a module-scoped teardown barrier
  (`apps/mobile/lib/video/DailyProvider.ts`); the studio, which had no guard at
  all and additionally double-mounts under React StrictMode, now shares the same
  discipline via `apps/studio/lib/daily/callObject.ts`.
  Also fixed in the same pass:
  - `manage-room`'s **`open`** was not idempotent — it blind-POSTed a room
    create, and Daily refuses a duplicate name, so a host's second "Go Live"
    on a room that still existed returned a 500. Both functions now resolve
    rooms through one shared `ensureDailyRoom` (GET, create only on a definite
    404) in `supabase/functions/_shared/daily.ts`.
  - The two edge functions **created Daily rooms with conflicting properties**
    (chat on/screenshare off vs. screenshare on/chat off), so a room's features
    silently depended on whether a host or a member reached it first.
  - The studio listened for **`meeting-session-stopped`**, which is not a
    `DailyEvent` in any released daily-js — the listener never fired, so a host
    ending a room left everyone else sitting in a dead call. Now `left-meeting`.
  - **`RoomModal` reported failed edits as successes**: the success check fell
    back to the room id passed in as a prop, which is always truthy, so a
    rejected update closed the modal as if it had saved.
  - **`RoomsClient` discarded every error** from `manage-room` — `goLive` and
    `endRoom` both threw the real reason away, and `endRoom` optimistically
    marked the room closed whether or not the write landed, telling a host the
    room had ended while participants were still in it.
  - **`participant-updated` fires ~10x/second** (anti-pattern 9) and both
    clients drove one `manage-room` sync-count call per event, for a number
    that had not moved. Now gated on actual headcount change.
  - **`daily-webhook` was unreachable**: it authenticates by HMAC and cannot
    carry a Supabase JWT, but it was missing from the `verify_jwt = false` list
    in `config.toml`, so the gateway 401'd every Daily callback before the
    handler ran.
  - Room join/connect failures now surface as distinguishable copy — room full,
    room ended, not a member, provider unreachable, not configured — instead of
    one sentence advising a retry that frequently could not work.

### Removed
- **The phantom second video provider.** `supabase/functions/livekit-token/`,
  `apps/mobile/lib/video/LiveKitProvider.ts` and the entirely unreferenced
  `apps/mobile/lib/daily.ts` are deleted. No `@livekit/*` package was ever
  installed and nothing called any of them; their only effect was to send
  anyone debugging a failed join hunting for a provider switch that did not
  exist. Daily.co is the video provider (CLAUDE.md §4).
- **The duplicate room-session route.** The live call stage existed at both
  `app/community-room-session.tsx` and
  `app/(tabs)/connect/community-room-session.tsx`. One caller
  (`lib/contentNavigation.ts`) still pushed the nested one, which put the call
  screen *inside* the Connect stack and stranded a dead call as that stack's
  top route — tapping Connect re-entered it. There is now one route and one file.

### Security
- **The invite gate scored, keyed and audited itself wrong in ten places**
  (migration `081_gate_hardening.sql`, plus one fix folded into the unpushed
  `075_code_requests.sql`). The two that mattered most: an applicant could
  **award herself the identity checks** — `ans_own` (071:156) let her insert an
  `application_answers` row naming *any* criterion and the
  `sync_answer_criterion` trigger dutifully marked it met, so two REST calls
  naming `gov_id` and `kyc_liveness` scored her as ID-verified with no vendor
  session in existence; and **comments never received 073's tightening** —
  `can_read_post` still asked 069's looser question, so on a public community
  every member-only post was protected while its comment thread stayed readable
  *and writable* by any account. Also fixed: an applicant could PATCH her own
  pending row's `community_id`, `code_id` and `submitted_at` (reassign herself
  to a community that never invited her, or forge her queue position — column
  grants now allow `status` and nothing else); a reviewer could PATCH
  `status='approved'` directly, skipping the audit row, the profile flip, the
  community join and the email, leaving her told she was in while every policy
  still denied her (`ma_update_reviewer` dropped — `decide_application` is the
  only path); a reviewer could erase her own Art. 9 access log by deleting her
  account, and one departing admin's deletion cascaded away every invite code
  she ever issued along with the attribution of everyone they admitted (both now
  `ON DELETE SET NULL`); `member_safety` was keyed on `user_id` alone, so the
  first community to rate a member owned the only row and a second community
  with a genuine concern hit a key violation instead — and nothing required the
  rated woman to be a member of the rating community at all (composite key
  `(user_id, community_id)`, plus a subject-membership test on writes);
  `gate_settings` published the rate-limit thresholds to every account (the
  numbers to stay under while grinding codes, and the number to exceed to lock a
  rival community's code); `has_consent(uuid, text)` answered for any user id
  and — worse than the audit found — was callable with the shipped publishable
  key, since Supabase's default privileges grant `anon` EXECUTE; editing an old
  announcement rewrote its date and burned the community's daily slot, and a
  direct PATCH of `announced_on` skipped the trigger entirely to free the slot
  for a second one. The applicant-facing fix is deliberately *not* "questions
  only" — the shipped screen saves the `social_account` attribute through the
  same path — so criteria now carry `self_attestable`, defaulting to false, and
  a criterion added later from the studio fails closed.
  Regression test: `supabase/tests/081_gate_hardening_check.sql` (catalog and
  privilege parts run fixture-free; live isolation proofs for the self-award and
  the comment leak take user ids on the command line).
- **Any caller could act as any user by writing their uuid into an unsigned
  JWT.** `_shared/auth.ts` `verifyJWT()` base64-decoded the token payload and
  returned its `sub`, trusting the API gateway to have checked the signature —
  while `config.toml` disabled that gateway check (`verify_jwt = false`) for ~22
  functions, on the stated grounds that it "is incompatible with ES256
  asymmetric signing keys". That reason is false: the platform check validates
  legacy HS256 JWTs *and* JWTs signed with asymmetric signing keys
  ([docs](https://supabase.com/docs/guides/functions/auth-headers)). Nothing
  verified anything. `Authorization: Bearer <any-header>.<payload naming a
  victim>.<garbage>` plus the public anon key returned that woman's legal name,
  application answers, appeals and consent history from `gdpr-export`, hard
  deleted her data via `gdpr-delete`, or opened an identity session against her
  application via `kyc-create-session`.
  `verifyJWT()` is now async and verifies the signature with
  `auth.getClaims()` (JWKS, cached) before reading a claim, and fails closed on
  a bad signature, an expired token, a non-`authenticated` role, a non-uuid
  `sub`, or a misconfigured environment. Gateway `verify_jwt` is restored to the
  default `true` for every function that identifies a caller; the exemption list
  is now only the functions that cannot carry a user JWT
  (`validate-invite-code`, `request-invite-code`, `kyc-webhook`, and the three
  service-role cron functions). `request-invite-code` was missing from
  `config.toml` entirely and would have been rejected at the gateway.
  Regression test: `supabase/functions/_shared/auth.test.ts`.
- **Three payment/event functions had never successfully authenticated anyone.**
  `cancel-event`, `create-payment-intent` and `stripe-dashboard-link`
  destructured `{ user, errorResponse }` from `verifyJWT()`, which returns
  `{ userId } | null` — so every call either threw on a null destructure or ran
  on with `user` undefined and threw at `user.id`. `cancel-event` and
  `stripe-dashboard-link` also called `checkRateLimit()` with positional
  arguments against an object signature, making their rate limits inert.
- **Community content was readable by every authenticated account** (migration
  069). `posts_select`, `comments_select`, `pl_select`, `ps_select` and
  `cl_select` all shipped as `USING (true)` — membership was enforced only by a
  client-side `.filter()`, so a session token and one PostgREST call returned
  every private community's posts, comments, and the `user_id` of everyone who
  liked them. On a WLW product that is an outing vector, not a hygiene issue.
  Like/save tables are now own-row only (counts are denormalised, so nothing is
  lost). `events`/`event_attendees` were already covered by 020 and 064.
  Verification script: `supabase/tests/069_community_visibility_check.sql`.
- **The invite gate could be walked straight past with one tap.** On the welcome
  screen the Apple and Google buttons called `signInWithApple` /
  `signInWithGoogle` directly, with no check for a validated invite code — the
  email path had been gated but these two had not. Supabase's `signInWithOAuth`
  both signs in and signs up in a single call and cannot be told to refuse
  account creation, so the new account landed on
  `profiles.vetting_status = 'unvetted'` — the permissive grandfather state
  restored by migration 079 — with no application row, no reviewer and nothing
  downstream to catch it. Invite-only, with a public front door on it. Both
  buttons now require a validated code before the provider is opened and send
  her to `/(auth)/code` when there isn't one, mirroring the email signup path;
  the code is redeemed after the redirect by `gateStore.loadApplication()`,
  which already recovers a held code when it finds no application. The buttons
  also gained the loading and error states they never had — failures were
  discarded silently.

### Compliance
- **Erasure and access now reach the invite-gate data** (migration 074).
  `gdpr-delete` previously touched only `profiles` and `push_tokens`, and
  `gdpr-export` returned counts for `messages`/`posts` — so legal names,
  identity outcomes, application answers and appeals were reachable by neither.
  The most sensitive data in the system was the only data a deletion request
  did not touch. Erasure is now a hard delete via `erase_gate_data()`; export
  returns an actual copy (Art. 15(3)) rather than a tally, with internal safety
  assessments and the reviewer audit log disclosed as withheld under Art. 15(4).
- **Processing is blocked until a DPA exists** (Art. 28(3)).
  `processor_agreements` is seeded with `dpa_signed_at = NULL`, and identity
  verification refuses to run until it is filled in — enforced at the edge
  function *before* the vendor is called, and again by a trigger on
  `identity_verifications` so a future write path cannot bypass it.
- **Explicit, versioned consent for special-category processing** (Art. 9(2)(a),
  Art. 7(1)). `consent_events` is append-only — a withdrawal is a new row, never
  an edit — and records the policy version so the wording she agreed to can be
  reproduced. A DB trigger refuses a verification record without it.

### Added
- **Invite management in roxy-studio** — the gate shipped without an admin
  surface: no screen in either app could create an invite code, so an
  invite-only Roxy could not be invited into. Two pages close it.
  - `/invites` — issue a code for one specific woman (single use, expiring) or a
    shareable one with a use cap, copy it cleanly, and see uses, expiry, locked
    and revoked state at a glance. The code string comes from the column default
    (`generate_invite_code()`), never from the client, and `is_review_code` is
    never sent — RLS refuses it and only staff mint those. Revocation is
    two-step and immediate.
  - `/community/members` — the roster of every community you administer or
    patrol, the role each member holds, and role changes through
    `set_community_role` (member / moderator / border patrol / admin). The rules
    the RPC enforces — a community always keeps one admin, border patrol
    requires the member to have completed her own verification — are surfaced as
    sentences instead of Postgres errors, and the page explains what border
    patrol can read before you grant it. Read-only, with an honest banner, until
    migration 078 is applied; it detects that rather than failing on click.
- **Invite gate, vetting and border patrol** (migrations 070–072, spec
  `docs/superpowers/specs/2026-08-01-invite-gate-vetting-design.md`). Roxy is
  invite-only: codes are issued by communities, a human reviews every applicant,
  and each member stays attributable to the code that admitted her.
  - Applicant flow in the client — code entry with distinct messaging for
    invalid / revoked / expired / exhausted / locked / rate-limited, a scored
    criteria checklist, hosted KYC handoff, and pending/rejected screens with an
    appeal path.
  - Review queue in roxy-studio, gated behind a confidentiality undertaking:
    own-community by default, opt-in overflow for aged applications, mandatory
    reasons on rejections and watchlist flags.
  - **Roxy never holds an identity artifact.** Didit runs the hosted flow and
    keeps the document and face scan; we store a status, a session id, and a
    duplicate signal. Legal names live in one RPC-only table, every read is
    audited, and `pg_cron` purges them 30 days after a decision.
  - Existing accounts are grandfathered as `unvetted` and keep full access —
    the enforcement predicate accepts it deliberately.
- **Two feeds instead of one** (`ReelsFeed`). Text and photo posts stay in the
  card feed; video moves to a full-bleed vertical snap-scroll tab with its own
  cursor. A post appears in exactly one of the two.
- **Community announcements** (migration 073) — communities publish under their
  own name and avatar, capped at one per community per UTC day by a unique
  index rather than a policy. Announcements are public; everything else inside a
  community now requires joining, which is the "join to see inside" boundary
  actually being enforced. Ranked by interest overlap so growth makes the feed
  more relevant rather than noisier.
- **In-app feedback loop** — a "Report a problem" form (`app_feedback` table,
  migration 063) reachable from Settings and from the error boundary's "Report
  this" button, plus wiring the mobile app to the `feature_requests`/
  `feature_votes` backend (migration 041) that existed with zero client UI
  until now: an Ideas & Roadmap tab to pitch and vote on features. Staff
  triage for both lives in Studio (`/staff/feedback`, `/staff/feature-requests`).
- **Self-serve community creation** — hosts previously had no way to start a
  community anywhere (mobile or Studio), even though the RLS already allowed
  it. `create_community()` RPC creates the community and makes the caller its
  admin atomically; Studio's Community page gets a Create Community form.
- **Speed Date Prompt AI is live in production** — `join-speed-date-session`
  hardcoded the same 5 static questions for every session even though a real
  Claude prompt generator already existed; both now share one generator
  (`_shared/speedDatePrompts.ts`).

### Fixed
- **roxy-studio depended on `"latest"`** for `@supabase/ssr` and
  `@supabase/supabase-js` — a production app whose auth and data client could
  change under it on any clean install. Pinned to the versions the lockfile
  already resolved (`0.10.0`, `2.102.1`), in `package.json` and in the lockfile's
  root entry so `npm ci` stays in sync. No reinstall performed.
- **QA audit findings (2026-07-26):** hardcoded `claude-sonnet-4-6` (not a real
  Anthropic model id) replaced with a `claude-haiku-4-5-20251001` default and
  an overridable `model` param in `_shared/claude.ts` — every AI touchpoint was
  silently degrading to mock copy on the API error this caused. `event_attendees`
  SELECT policy was `USING(true)` (any user could scrape any event's ticket_code,
  the sole check-in credential) — narrowed to own-row + host + staff.
  `create-payment-intent`'s rate limit call didn't match the shared helper's
  signature and its result was never checked — was a silent no-op, now enforced.
  `cloudflare-video-webhook` failed OPEN when its secret was unset — now fails
  closed. Raw, unhashed `user_id` and a raw `username` (an explicitly banned
  field) were reaching Crashlytics/PostHog from onboarding and the root layout —
  added `hashUserId()` and applied it at every affected call site. `push_token`
  (a device push credential) was publicly readable on `profiles` — moved to its
  own `push_tokens` table with own-row-only RLS. Ticket check-in
  (`host_checkin_attendees`) allowed any column to change on any attendee of a
  host's own event via a direct SDK call — moved to a column-restricted
  `checkin_attendee()` RPC.
- **Speed dating matches were never actually mutual** — the result screen
  created a match and started a conversation the instant ONE participant
  tapped "like," telling them "You both felt the connection" (false), and
  paired two strangers into a live chat with zero consent from whichever side
  never indicated interest. `submit_speed_date_like()` now requires both
  sides to say yes before a match/conversation exists.
- **The applicant flow was unreachable.** The root layout sent every profile
  with `vetting_status` `pending` or `rejected` to `/(auth)/pending` — a rule
  that also fired on `/(auth)/application`, which only a pending applicant ever
  has reason to open. The "Open application" button on the pending screen
  bounced straight back to the pending screen, so no applicant could add
  anything to her application at all. The redirect is now the tested predicate
  `shouldRedirectToPending()` in `lib/authRouting.ts`, which exempts the
  application route the same way onboarding is already exempted, checking both
  `segments` and `pathname` so a transient mid-transition value cannot let the
  redirect through. Applied to both redirect blocks.
  Tests: `__tests__/lib/authRouting.test.ts`.
- **A legal name was stored and then reported as failed.**
  `gateStore.saveLegalName()` inserted into `applicant_identity` and then
  upserted into `application_criteria_met` — a table whose only two policies
  (migration 071) are both `FOR SELECT`, so the upsert was refused every time
  and the function returned `false` *after* the name was already on file. Since
  `applicant_identity.application_id` is a primary key with an INSERT-only
  policy and no SELECT policy, the name could never be corrected, re-read, or
  successfully re-sent: the applicant was told "Could not save" about her most
  sensitive field, and every retry hit the primary key and said it again.
  `saveLegalName()` now returns a four-state `LegalNameOutcome` instead of a
  boolean, never reports failure once the name is stored, treats a key conflict
  as "already on file" rather than an error, and marks the criterion through a
  `mark_criterion_met` RPC. **That RPC is not deployed yet** — its absence is
  handled as the expected state it currently is (`saved_unscored`), and the
  applicant is told accurately that her name is safe and the point it earns is
  still coming. Tests: `__tests__/store/gateStore.test.ts`.
- **The code screen contradicted its own error message.** `normalise()` folded
  `I`→`1` and `O`→`0` but left `L` and `U` untouched, while the error copy
  promises "codes never contain I, L, O or U" and migration 070 generates from
  the Crockford alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ` — so a woman who
  typed either of those two was told her valid code was invalid. Normalisation
  moved to `lib/inviteCode.ts` and now folds `L`→`1` and `U`→`V` as well, with
  a property test that nothing outside the generator alphabet can escape it.
  Tests: `__tests__/lib/inviteCode.test.ts`.

### Planned
- Architecture documentation with data-flow / tenancy / module-boundary diagrams.
- Feed pagination review, realtime channel budgets for high-concurrency content.
- Subscription monetization (Free/Plus/Pro/Super, CLAUDE.md §16) does not exist
  in code yet — needs a Google Play Billing decision before Android build, per
  Play's payments policy for dating-category apps.
- `EXPO_PUBLIC_GIPHY_API_KEY` in the app + EAS env to enable GIF search in chat.

### Note
- Grow screen's duplicate `questions_of_the_day`/`community_rooms` fetches
  (previously listed here as planned work) were already fixed 2026-07-21
  (`bbaaaeb`) — this file just hadn't caught up. Marketplace seed data
  (migration 038) is conditional on a `profiles` row existing at migration-run
  time and silently no-ops otherwise — confirmed still unseeded on the live
  project as of this audit; seeding needs a non-silent path, not just a retry.

## [1.1.0] - 2026-07-21 — Sellable-state push

The push to get the WLW community platform to a sellable state: coherent 5-tab
IA (Grow · Connect · Play · Messages · Build), a real commerce storefront,
donations, video/audio rooms, a content feed, and a top-to-bottom visual and
responsiveness pass. Delivered across web (EAS Hosting, https://roxy.expo.app).

### Added
- **Marketplace storefront** — full-screen `/business/[id]` shop and
  `/product/[id]` detail routes (replacing the old popups): seller hero with
  verified-WLW badge, Shop/About/Photos/Policies tabs, product grid, cart bar,
  variant picker, stock-aware quantity, add-to-cart / buy-now, and honest
  international-commerce policy rows. International currency formatting
  (`lib/currency.formatMoney`) across every price; order surfaces render in the
  order's own currency.
- **Donations** — monthly / yearly / one-time support via Stripe Checkout
  ($20 default, $5 floor), surfaced on Grow and Build. Never labeled
  "subscribe."
- **Community video & audio rooms** — Daily.co-backed live rooms with host
  controls, participant grid, and a graceful native-only screen on web.
- **Speed dating** — community-scoped 5-minute matchmaking with membership
  guards and per-pool matching.
- **Content feed v2** — photo and video posts, a shared post-card renderer,
  reactions, saves/bookmarks, comments, and a global search.
- **Login streaks** and a **notifications center**.
- **Roxy companion FAB** — R-mark button with quick actions (chat, search,
  filter-this-view) and long-press to chat.
- **Profile** — Bumble-style avatar over cover, badge chips, pronoun/orientation
  tints, government-verified badge, Saved posts and Saved businesses rails.
- **Desktop web frame** — centered phone-width column (Instagram/Bumble
  pattern) with the app fully responsive from 390px to desktop.

### Changed
- **Vector icons replace emoji** as UI chrome across the app (brand rule);
  emoji remain only inside user-typed content.
- **House pop animation** (spring scale + opacity, instant backdrop) on all
  ~18 modal surfaces — no soft fades, no slide-up drawers.
- **Grow** redesigned with gradient icon plates, a brand-gradient Journey
  progress bar, and per-quest Mini-Wins; **Sister** support screen revamped
  into its own calm lavender identity.
- Community, room, and call screens are **root-level routes** so back
  navigation always returns to the origin tab.
- Chat reactions moved from a hidden long-press to a **visible react button**;
  Enter sends messages on web (Shift+Enter for newline).

### Fixed
- **Photo/avatar upload** — was denied by storage RLS (root path vs required
  `${uid}/` folder); photo posts silently dropped their images. Both fixed and
  verified live.
- **Likes / saves / comment-likes** silently failed (engagement tables lacked a
  `user_id` default → RLS rejected inserts) — migration 062 adds
  `DEFAULT auth.uid()`.
- **Web responsiveness** — 7 screens captured window size once at load and never
  adapted; all now track live dimensions.
- Community "back" no longer hijacks the Play tab; stale call screens no longer
  strand on the Connect tab; web room-join no longer errors.
- Modal close buttons unclickable on web (z-index); marketplace prices no
  longer hardcode `$`.

### Security
- Row-Level Security confirmed enabled on **all 61 tables**.
- Every edge function is guarded — user-facing via JWT, webhooks via signature
  verification, money-movement (`release-payout`, `process-refunds`) via
  service-role key.

## [1.0.0] - baseline

Pre-existing foundation prior to the sellable-state push: authentication and
onboarding, tenancy/profiles, communities and friendships, the initial Build
directory and marketplace backend (Stripe Connect, orders, products), Roxy AI
touchpoints, and the Supabase schema (migrations 001–061). See `.claude/log.md`
for the full pre-1.1.0 engineering history.
