# Roxy feature inventory (Cartographer, Phase 1)

Crawled 2026-10-20 (23:00–23:35 CST). Code: `main` @ 2d9904e. Live: https://roxy.expo.app, signed in as the seed account `e2e-playwright@seed.roxy.app` (approved, `access_tier=beta`, not staff, not core, no community ownership, no shop, no DMs) at 390×844 @2x, touch. Studio: read from code only (no staff login).

## Summary

**227 rows: 172 mobile (M001–M172), 55 Studio (S001–S055).**

| By status | works | partial | stub | missing | total |
|---|---|---|---|---|---|
| Mobile | 142 | 20 | 6 | 4 | 172 |
| Studio | 51 | 3 | 1 | 0 | 55 |
| **All** | **193** | **23** | **7** | **4** | **227** |

How each mobile row was checked: 77 seen working live (L✓, plus one L✗ broken live: M020), 44 rendered live but their write action not pressed (L◐), 50 code only (C). Every Studio row is code only.

By role (a row counts once per role it names). Mobile: beta 122 · member (public tier) 13 · applicant 10 · visitor 8 · new member 6 · all 6 · approved member 4 · community member 4 · seller 2 · owner / official community account 2 · core 1 · developer 1. Studio: staff 23 · host 11 · any / any signed-in 9 · visitor 5 · seller 4 · developer 3 · core 3.

Worst problems found (details in the rows):
- **M020**: an approved beta member is intermittently shown the *pending* gate on cold loads.
- **M130 / M147**: on web the Stripe module is stubbed to "success", so a purchase could look paid without being charged.
- **M060**: Create › Product is a dead button for approved sellers.
- **M113**: Sell on Roxy opens `/support`, which has no seller application.
- **M048 / M056 / M057**: content warnings, poll composer and Roxy-link composer are missing.
- **M172**: no report/block on events, shops, products, games or community profiles.
- **M015**: onboarding says "AI wingwoman".
- **M044 / M068**: 10 stale "LIVE" rooms with 0 people.
- **S042**: the archive-report resolver calls an edge function that does not exist.
- **S002**: Studio sign-up has no invite gate on `main`.

**How to read a row**
- Status: `works` = complete and behaves; `partial` = part of it is broken, dead, web-only-broken or inconsistent; `stub` = UI with no working path behind it; `missing` = the product needs it (brief, prototype, invariants) and nothing implements it.
- Verification tag, first thing in Notes: **L✓** seen working on the live build (read-only), **L◐** live, rendered, but its action was not pressed because it writes, **C** code only (not reachable for the seed account, native-only, or not live), **LO** live-only: on roxy.expo.app but not on `main`.
- Evidence: `ev/` = `polish/evidence/cartographer/`. Extra shots carry a suffix (`M049-2.png`). Scratch crawl data: `D:/Temp/roxy-polish/cartographer/` (`crawl-results.json`, `crawl2-results.json`, `check-state.log`).

## Read this first: live is not `main`

1. **roxy.expo.app is built from `launch/integration`, not `main`.** The live JS bundle (`entry-1c9aa36e…js`) contains all 121 testIDs that `launch/integration` adds over `main`, and `launch/integration` is 90 commits ahead of `main` (179 files under `apps/*/app|components|lib`, +14.5k lines). `main` = `hardening/launch-readiness` = e98bc1a + polish scaffolding. Features marked **LO** below exist only there. Merge `launch/integration` into `main` before any polish slice ships, or the slice would deploy a regression.
2. **The production database is ahead of `main` too.** Prod serves the `my_profile` view (created by `launch/integration` migration 130, `supabase/migrations/130_gate_airtight.sql`; `main` stops at 129). Migration 130 replaces the table grant on `profiles` with a column grant. `main`'s `apps/mobile/app/_layout.tsx:133,190` still runs `from('profiles').select('*')`, which that grant refuses with 42501. Inferred from code, not run: a web export of `main` would fail every post-sign-in profile load.
3. **One crawl click wrote, and it was undone.** Tapping the "Who can message me" row (`settings-dm-permission`) saves immediately. It moved the seed from "Everyone — requests first" to "Friends only". I put it back through the same control and confirmed after a reload (`D:/Temp/roxy-polish/cartographer/undo-dm.log`). Left over: `profiles.dm_permission` for the seed is now explicitly `everyone` (it may have been NULL before, which also reads as everyone), and its `updated_at` changed. Viewing also caused the usual own-account writes: `seen_posts` upserts, `record_daily_checkin`, `mark_channel_read` and `sync_my_badges`.

## Mobile app (apps/mobile)

### Auth, application, onboarding

| ID | Feature | Route(s) | Primary action | Role | Status | Notes |
|---|---|---|---|---|---|---|
| M001 | Invite-code gate | `/code` (`app/(auth)/code.tsx`) | Enter code → Continue | visitor | works | L◐ renders as the first screen; no code was submitted (redeeming writes). In `AUTH_ALLOWED`. ev/M001.png |
| M002 | No-code help ("request an introduction at roxyhq.com/request") | `/code` | read / link | visitor | works | L✓ LO: testID `no-code-copy` comes from 848c7c7 (G-17), which is not on `main`. ev/M002.png |
| M003 | Sign in with email + password | `/code` › I already have an account › `/welcome` | Sign In | visitor | works | L✓ the seed signed in. On live the email form shows at once (no "Use email instead" step). One sign-in did nothing visible for 90 s (no error, no alert) while the backend was degraded. ev/M003.png |
| M004 | Sign up with a validated code | `/welcome` › New here? Sign Up | Create account | visitor (holds code) | works | C: not run, it would create an account. The sign-up mode requires `gateStore.validatedCode`. ev/M004.png |
| M005 | Continue with Apple / Google | `/welcome` | OAuth | visitor | partial | C + L: `main` draws both buttons plus "Use email instead". The live web build shows no OAuth buttons (G-03 on `launch/integration`). On native the code must be held before the provider opens. ev/M005.png |
| M006 | Forgot password (email a reset link) | `/welcome` › Forgot password? | Send link | visitor | works | C: not run (sends email). `lib/passwordReset.ts`. |
| M007 | Reset password from the email link | `/reset-password` | Save new password | visitor (email link) | works | L✓ the no-token state ("That link is no longer good · Send me a new link"). The token form needs a real email. In `AUTH_ALLOWED`; hash-stripping fix in `features.ts`. ev/M007.png |
| M008 | Membership application (answers, legal name, ID check, score, send for review) | `/application` | Send for review | applicant | works | C: the seed is approved. Signed out, live shows only "Not signed in. Try again". KYC through `kyc-create-session`. ev/M008.png |
| M009 | Pending wait screen + rejected appeal | `/pending` | Refresh status · Ask us to look again · Sign out | applicant | works | C: signed-out live shows "Not signed in". The core preview has `exit-pending-preview`. Appeals reach Studio only on `launch/integration` (S052). ev/M009.png |
| M010 | Pending status chip + sheet inside the tabs | (tabs) `PendingStatusHost`, `AccountStatusTag` | Open application | applicant | works | C: not visible to an approved account. |
| M011 | "You're in" celebration + first steps | `/welcome-in` | Show me around | newly approved member | works | L✓ LO (`app/(auth)/welcome-in.tsx` is not on `main`). It also renders for a signed-out visitor (no guard). ev/M011.png |
| M012 | Onboarding 1: username, display name, identity, pronouns | `/onboarding/step1-identity` | Next | new member | works | L◐ renders even signed out (onboarding routes have no auth guard). ev/M012.png |
| M013 | Onboarding 2: interests (up to 8) | `/onboarding/step2-interests` | Next | new member | works | L◐ ev/M013.png |
| M014 | Onboarding 3: photo (optional) | `/onboarding/step3-photo` | Choose photo / Skip | new member | works | L◐ ev/M014.png |
| M015 | Onboarding 4: what she's here for + "Meet Roxy" | `/onboarding/step4-status` | Meet Roxy → | new member | partial | L✓ the copy reads "Roxy is your AI wingwoman" (`step4-status.tsx:97`), which breaks the persona invariant (never "AI"). ev/M015.png |
| M016 | Auth routing cascade (signed out → `/code`; pending → `/pending`; no profile → onboarding; done → `/feed`) | `app/_layout.tsx` | — | all | works | L✓ signed-out `/archive` and an unknown route both land on `/code` (the deep link is dropped). See "Read this first" #2 for `main`. ev/M016.png |
| M017 | Sign out | `/you/settings` › Sign out | Sign out | member | works | C: not pressed. |

### App shell and global chrome

| ID | Feature | Route(s) | Primary action | Role | Status | Notes |
|---|---|---|---|---|---|---|
| M018 | Bottom bar, beta: Feed · Discover · ＋ · Messages · You | `(tabs)` `FloatingTabBar`, `navSlots3.ts` | switch tab | beta | works | L✓ The Messages badge read 20 / 10 while DIRECT was empty (it counts community chats). ev/M018.png |
| M019 | Bottom bar, public: Archive · Chat · You | `(tabs)` `NAV_SLOTS_PUBLIC` | switch tab | member | works | C: the seed is beta. |
| M020 | Launch gate / Coming soon overlay | root `LaunchGate`, `FeatureGate`, `CommunityGate` | Back to Archive | member, applicant | partial | C: gating per `lib/features.ts` matches the brief. **L✗** the approved beta seed intermittently got the pending gate: "Waiting for approval" on `/event/<id>` and the pending Archive home on `/feed` after cold loads/deep links (seen in all 3 sessions that checked; it cleared again on a later reload). `my_profile` said `approved`/`beta` at the same moment (`check-state.log`). It coincided with the degraded backend. A slow or failed profile load probably fails closed to "pending"; root cause not proven. ev/M020.png, ev/M020-2.png |
| M021 | Core "View as" preview + banner | `/you/settings` `ViewAsPicker`, `ViewAsBanner` | pick an account kind | core | works | C: the seed is not core. Local store only. |
| M022 | Roxy companion button (Chat with Roxy · Search Roxy · Filter this view) | Feed, Discover, You | open the menu | beta | works | L✓ "Filter this view" is greyed outside Feed › Communities. ev/M022.png |
| M023 | Theme dark / light | `/you/settings` | toggle | member | works | L◐ control present, not toggled. ev/M023.png |
| M024 | Badge celebration overlay | root `BadgeCelebrationHost` | Next / dismiss | member | works | C: not triggered. |
| M025 | Crash screen | root `ErrorBoundary` | Try again | all | works | C |
| M026 | Unknown route | any unmatched URL | Go back | all | partial | L✓ signed in: Expo's default "Unmatched Route … Sitemap" (no `app/+not-found.tsx`; it links the sitemap). Signed out it redirects to `/code`. ev/M026.png, ev/M026-2.png |
| M027 | Desktop phone frame | `components/ui/WebAppFrame.tsx` | — | web visitor | works | C: 1440 px not crawled. |

### Feed (segments, cells, overlays)

| ID | Feature | Route(s) | Primary action | Role | Status | Notes |
|---|---|---|---|---|---|---|
| M028 | Feed › For You | `/feed` | swipe | beta | works | L✓ cells seen: text, video, photo, resource, daily prompt, interest card. Prod post mix: standard 27, video 8, photo 5, roxy_link 2, poll 0. ev/M028.png |
| M029 | Feed › Following | `/feed` (segment) | swipe | beta | works | L✓ shows the seed's own posts. ev/M029.png |
| M030 | Feed › Communities + community switcher | `/feed` (segment) | pick a community | beta | works | L✓ switcher lists joined communities + search. ev/M030.png, ev/M030-2.png |
| M031 | Video cell (autoplay, mute, transport) | feed `ReelCell` | play / mute | beta | works | L✓ ev/M031.png |
| M032 | Photo / gallery cell | feed `PhotoCell` | swipe photos | beta | works | L✓ ev/M032.png |
| M033 | Text card cell | feed `TextCell` | read more | beta | works | L✓ ev/M033.png |
| M034 | Poll cell (vote, share an option) | feed `PollCell` | vote | beta | partial | C: no poll post exists in prod, and no composer can make one (M056). It renders only for data seeded by hand. |
| M035 | Resource / Roxy-link cell | feed `ResourceCell` | Open | beta | works | L✓ `roxy_link` posts render here. `RoxyLinkCard` is unused. ev/M035.png |
| M036 | Interest card (More of this / Not for me) | feed `FeedInterestCard` | answer | beta | works | L◐ present, not answered. ev/M036.png |
| M037 | Daily prompt cell (question of the day → "Answer it") | feed `DailyPromptCell` | Answer it | beta | works | L◐ LO. The answer posts to her profile as a text card. ev/M037.png |
| M038 | First steps card ("4 small steps to feel at home") | feed `FirstStepsCard` | step row / Hide | new member | partial | L✓ LO. While shown it covers most of the first cell and the right rail. Hide is AsyncStorage only. ev/M038.png |
| M039 | Cell rail: avatar → profile, follow, ✿ like, comment, save, share, more | feed `FeedCellChrome` | like / save / follow | beta | works | L◐ every rail testID present. Like, save and follow not pressed. Share uses the Web Share API. ev/M039.png |
| M040 | Double-tap like + burst | feed `DoubleTapLike`, `LikeBurst` | double tap | beta | works | L◐ LO, not pressed. |
| M041 | Comment sheet (thread, replies, comment likes, composer) | feed › comment, post detail | Send | beta | works | L◐ opened; loading state and then composer seen; nothing sent. ev/M041.png |
| M042 | Comment actions (report / delete a comment) | comment sheet `CommentActionsSheet` | Report | beta | partial | C LO: live has it. `main` has no comment-level report: a safety gap if `main` ships. |
| M043 | Post safety sheet: Report · Block · Mute · Hide | feed › more / long-press `FeedSafetySheet` | Report | beta | works | L◐ sheet and the 5 report reasons opened; not submitted. Mute is live-only (`main`'s sheet has Report/Block/Hide). ev/M043.png, ev/M043-2.png |
| M044 | Now rail ("N live") | `/feed` › Now | open a room / game | beta | partial | L✓ opens, but lists 10 rooms as LIVE, every one "0 in" (stale live rooms), plus speed-dating games marked "Playing now". ev/M044.png |
| M045 | Streak chip + Mini Wins daily sheet | `/feed` | open / close | beta | works | L✓ auto-opens once a day (AsyncStorage `roxy_mini_wins_last_shown`). ev/M045.png |
| M046 | Feed search button | `/feed` | → `/search` | beta | works | L✓ |
| M047 | "New posts" banner | feed `NewPostsBanner` | tap to refresh | beta | stub | C: the component is mounted nowhere (`main` or live bundle). |
| M048 | Content warnings (blur + reveal) | feed `PrivacyGateSheet` | reveal | beta | missing | C: the component exists, is never mounted, and no cell reads a CW field. The prototype requires CW blur. |
| M049 | Post detail | `/discover/post/[postId]`, `/community/post/[postId]` | comment | beta | works | L✓ text, photo, video and roxy_link posts. The Roxy button sits over the right end of the comment bar (send/share) at 390 px. ev/M049.png … M049-4.png |
| M050 | Full-screen video player | `/discover/video/[postId]`, `/community/video/[postId]` | play | beta | works | L✓ ev/M050.png |

### Create (＋ sheet and composers)

| ID | Feature | Route(s) | Primary action | Role | Status | Notes |
|---|---|---|---|---|---|---|
| M051 | Create sheet | nav ＋ `CreateSheet` | pick a kind | beta | works | L✓ Post is open. Event, Room, Product and Game are locked with a reason. ev/M051.png |
| M052 | Composer › Text card | `/community/create-post` | Publish | beta | works | L◐ type picker opened; nothing published. ev/M052.png |
| M053 | Composer › Photo (take or upload, up to 10) | `/community/create-post` | Take photo / Upload | beta | works | L◐ ev/M053.png |
| M054 | Composer › Video (up to 3 min, Cloudflare upload) | `/community/create-post` | Upload | beta | works | L◐ type listed; `get-video-upload-url` not called. |
| M055 | Composer › Tag a shop item | `/community/create-post` `ShopItemPicker` | tag | owner, seller | works | C: the seed may not tag (`shopPostBlockedReason`). |
| M056 | Composer › Poll | — | — | beta | missing | C: the composer offers text, photo and video only. Poll cells (M034) can never be created in the app. |
| M057 | Composer › Resource / Roxy link | — `RoxyLinkPicker` | — | beta | missing | C: the picker exists, mounted nowhere. The prod roxy_link posts came from elsewhere. |
| M058 | Event composer (in person / online) | `/community/create-event` | Publish | official community account | works | L◐ a deep link opens the form for anyone; Publish refuses non-official accounts with an alert (`create-event.tsx:80`). ev/M058.png |
| M059 | Create › Room | Create sheet | — | beta | stub | L✓ always locked: "Community admins open rooms in Roxy Studio" (S020). |
| M060 | Create › Product | Create sheet | — | seller | stub | L✓ locked for the seed. For an approved seller the row unlocks, but `CreateSheet.onKind` handles only post/event: a dead button. |
| M061 | Create › Game | Create sheet | — | beta | stub | L✓ always locked: "Game submissions go through Roxy Studio" (S023). |

### Discover (each rail)

| ID | Feature | Route(s) | Primary action | Role | Status | Notes |
|---|---|---|---|---|---|---|
| M062 | Discover header, search bar, chips (All · Archive · Events · Shops · Live · Communities · Games) | `/discover` | filter | beta | works | L✓ each chip opened. ev/M062.png |
| M063 | Notifications bell + unread dot | `/discover` | → `/notifications` | beta | works | L✓ dot shown. ev/M063.png |
| M064 | Question of the day card (answer sheet) | `/discover` (top of All) | Answer | beta | partial | C: `main` leads Discover with `QuestionOfTheDayCard`; live Discover shows no visible QOTD card, and the feed carries it as the daily prompt (M037). Two homes on `main`, one on live. ev/M064.png |
| M065 | Hero event card | `/discover` | Get a ticket / RSVP | beta | works | C: hidden live because there are no upcoming events. |
| M066 | Archive rail ("Browse all 45 →") | `/discover` | open entry | beta | works | L✓ ev/M066.png |
| M067 | Top 10 members rail (points + staff tags) | `/discover` | open profile | beta | works | L✓ 10 cards. ev/M067.png |
| M068 | Live now rail | `/discover` | open room | beta | partial | L✓ 10 rooms flagged LIVE, all "0 in" (stale state). Opening one on web gives the fallback (M135). ev/M068.png |
| M069 | Events rail + All / Online / In person | `/discover` | open event | beta | works | L✓ empty state "Nothing on the calendar yet." ev/M069.png |
| M070 | WLW economy rail (All · Saved · ✿ WLW only · Impact · Support) | `/discover` | open shop / support | beta | works | L✓ 2 shops. ev/M070.png |
| M071 | Communities rail + See all | `/discover` | open community | beta | works | L✓ ev/M071.png |
| M072 | Games rail | `/discover` | play | beta | partial | L✓ 4 games listed. Opening one on web says "This game isn't available to play yet" (M141). ev/M072.png |

### Search

| ID | Feature | Route(s) | Primary action | Role | Status | Notes |
|---|---|---|---|---|---|---|
| M073 | Global search (All · Posts · People · Communities · Events · Shops · Archive; trending) | `/search` | type a query | beta | works | L✓ "the" returned posts and archive titles. ev/M073.png, ev/M073-2.png |

### Communities and channels

| ID | Feature | Route(s) | Primary action | Role | Status | Notes |
|---|---|---|---|---|---|---|
| M074 | Communities browser | `/communities` | open | beta | works | L✓ shows "Joined ✓". ev/M074.png |
| M075 | Community profile (Posts · Thoughts · Rooms · Events · Games · About, LIVE pill, stats) | `/community/[id]`, `/discover/community/[id]` | Join | beta | works | L✓ Roxy Official and Queer Gamers. ev/M075.png, ev/M075-2.png |
| M076 | Join / leave a community | community profile | Join | beta | partial | L◐ not pressed. The membership display disagrees: `/communities` and Discover say Roxy Official is "joined", while its profile offers "Join … Join to get into the community chat", even though its channel already lets her post (composer shown). ev/M076.png |
| M077 | Community reels ("Watch reels") | community profile | open | beta | works | L◐ entry present. |
| M078 | Community members (+ Add Friend) | `/community/members/[communityId]` | Add Friend | beta | works | L◐ list renders; Add Friend not pressed. ev/M078.png |
| M079 | Community channels (#general, #announcements…) | `/community/channels/[communityId]` | read / switch channel | community member | works | L✓ channel bar and history. ev/M079.png |
| M080 | Channel composer | channels | Send | community member | works | L◐ composer present in Queer Gamers; nothing sent. ev/M080.png |
| M081 | Channel message actions (reply, delete own, report, block) | channels › long-press `ChannelMessageActions` | Report | community member | works | C |
| M082 | Channel notifications bell | channels header | toggle | community member | works | L◐ present, not toggled (`set_channel_notifications`). |
| M083 | Community Rooms / Events / Games / About tabs | community profile | open tab | beta | works | L✓ tabs present. |

### Messages and companions

| ID | Feature | Route(s) | Primary action | Role | Status | Notes |
|---|---|---|---|---|---|---|
| M084 | Messages inbox (DIRECT + COMMUNITY CHATS) | `/messages` | open a chat | beta | works | L✓ DIRECT empty ("No private messages · Start a chat"); 8 community chats. ev/M084.png |
| M085 | Pinned Roxy (wingwoman) and Sister rows | `/messages` | open | beta | works | L✓ ev/M085.png |
| M086 | Requests sheet (Messages · Friends tabs; accept / decline) | `/messages` › Requests | Accept / Decline | beta | works | L◐ opened, empty. The Friends tab is LO. ev/M086.png |
| M087 | New message (friend picker) | `/messages/new` | Chat | beta | works | L✓ empty state "Add friends in your communities first". ev/M087.png |
| M088 | DM conversation | `/chat/[id]` | Send | beta | works | C: the seed has no conversations, and opening one marks it read. L✓ an unknown id shows "This chat isn't available", but fires 2× POST 500 `rpc/mark_conversation_read` (P0002). ev/M088.png |
| M089 | DM extras: GIFs, reactions, typing, read status, nudge, Roxy wingwoman assist, search in chat | `/chat/[id]` | — | beta | works | C (`chat/[id].tsx` handlers). |
| M090 | DM safety: report · block · mute | `/chat/[id]` | Report | beta | works | C |
| M091 | Group chat info / private groups | `/chat/info/[id]` | — | beta | works | LO (`chat/info/[id].tsx`, migration 132). L✓ an unknown id shows "This group isn't available". ev/M091.png |
| M092 | Official-chat inbox (public tier) | `/messages` `OfficialChatInbox` | open Roxy Official | member | works | C: the seed is beta. |
| M093 | Who can message me (Everyone / Friends only / Friends of friends) | `/you/settings` | tap to cycle | beta | works | L✓ cycled by accident and restored (see "Read this first" #3). It saves on every tap with no confirm. One rapid double tap kept the earlier value after reload (seen once). ev/M093.png, ev/M093-2.png |
| M094 | Read receipts + who can add me to groups | `/you/settings` › Chats | toggle | beta | works | L◐ LO, not toggled. ev/M094.png |
| M095 | Roxy chat (wingwoman) | `/roxy-chat` | Send / topic chip | beta | works | L◐ greeting plus 4 chips (Dating Advice, Her Texts, Confidence Tips, Queer Events); nothing sent. ev/M095.png |
| M096 | Sister (private vent space) | `/sister-button` | pick a prompt / type | beta | works | L◐ prompts shown; nothing sent. `main`'s screen also lists Support Resources / Professional Directory. ev/M096.png |

### You, profile, settings

| ID | Feature | Route(s) | Primary action | Role | Status | Notes |
|---|---|---|---|---|---|---|
| M097 | You (own profile: header, XP, level, badge chip; tabs Posts · Thoughts · Saved) | `/you` | Edit | beta | works | L✓ ev/M097.png |
| M098 | Profile-complete nudge | `/you` `ProfileNudge` | Add a photo / dismiss | beta | works | L✓ LO. ev/M098.png |
| M099 | Thoughts tab (reply, like, react, share; GIF replies) | `/you` › Thoughts | Reply | beta | works | L◐ ev/M099.png |
| M100 | Saved tab (saved posts, watchlist, saved shops) | `/you` › Saved | open | beta | works | L✓ empty state. ev/M100.png |
| M101 | You › More (My people, Tickets & orders, Saved, Badges, Sell on Roxy, Settings & safety) | `/you` › More `YouMoreMenu` | open a row | beta | works | L✓ ev/M101.png |
| M102 | Edit profile (photo, bio, prompts, photos, favourites, display name, pronouns, identity) | `/you/edit` | Save | beta | works | L◐ nothing saved. Prompts are LO. ev/M102.png |
| M103 | Avatar studio | `/you/edit` › Avatar studio `AvatarPickerSheet` | pick | beta | partial | L✓ the section label reads "VOXEL · CUTE MODE LATER": placeholder copy on a member screen. ev/M103.png |
| M104 | Settings & safety hub | `/you/settings` | open a row | beta | works | L✓ ev/M104.png |
| M105 | Dating mode | `/you/settings` | toggle | beta | works | L◐ not toggled. Beta-only. |
| M106 | Ghost mode | `/you/settings` | toggle | beta | works | L◐ not toggled. Beta-only. |
| M107 | Notification settings (master push, per type, previews, quiet hours) | `/you/notification-settings` | toggle | beta | works | L✓ 8 switches, quiet-hour options; nothing toggled. Took 21 s to settle (degraded backend). ev/M107.png |
| M108 | Blocked & muted (unblock / unmute) | `/you/blocked`, `/blocked` | Unblock | beta | works | L✓ empty states. `main` has Blocked only (its doc says "no mute"); live adds Muted. ev/M108.png, ev/M108-2.png |
| M109 | Delete account (type DELETE) | `/you/delete-account` | Delete my account | beta | works | L◐ steps and export button; not submitted (`gdpr-delete`). ev/M109.png |
| M110 | Export my data | `/you/settings`, delete screen | Download | beta | works | C: not pressed (`gdpr-export`). |
| M111 | Feedback & ideas (report a problem with rating, Ideas & Roadmap, your reports) | `/you/feedback` | Send | beta | works | L◐ ev/M111.png |
| M112 | Support Roxy (donate, Roxy Picks / Community / Impact votes, pitch an idea) | `/support` | Donate / vote / pitch | beta | works | L◐ nothing sent. Donations use `create-donation-checkout`. ev/M112.png |
| M113 | Sell on Roxy entry | You › More › Sell on Roxy ("Apply") | Apply | beta | partial | L✓ goes to `/support` (donations and votes), which has no seller application (`YouMoreMenu.tsx:125`). The real application is Studio `/stripe-onboarding` (S026). ev/M113.png |
| M114 | My people (Friends · Requests · Sent) | `/people` | Accept / Message | beta | works | L✓ empty. ev/M114.png |
| M115 | Badges | `/badges` | — | beta | works | L✓ 1 earned, 3 to go. ev/M115.png |
| M116 | Tickets & orders | `/tickets` | open a ticket (QR) | beta | works | L✓ empty "No tickets yet". The screen title says "My Tickets" while the menu says "Tickets & orders". ev/M116.png |
| M117 | Member profile (Posts · Thoughts · Shop; Follow, Add friend, seller chip, stats) | `/user/[userId]`, `/you/[userId]` | Follow / Add friend / Message | beta | works | L✓ nothing pressed. ev/M117.png, ev/M117-2.png |
| M118 | Profile safety sheet (Report · Mute · Share profile · Block) | member profile › More | Report | beta | works | L◐ opened. `main` has Report/Block only. ev/M118.png |
| M119 | Profile not found | `/user/<unknown id>` | — | beta | works | L✓ "Profile not found" (one 406 PGRST116 logged). ev/M119.png |
| M120 | Levels / XP (Seedling · Bloom · Radiant) | profile header | — | beta | works | L✓ "15 XP · ⚡1". |

### Notifications and push

| ID | Feature | Route(s) | Primary action | Role | Status | Notes |
|---|---|---|---|---|---|---|
| M121 | Notifications list (open, mark all read, gated rows say "Coming soon") | `/notifications` | open | beta | works | L◐ list renders; Mark all read not pressed. ev/M121.png |
| M122 | Push notifications (register the device, tap → screen) | native only (`lib/push.ts`, `pushRegistration.ts`) | — | beta | works | C: the web build never registers (`pushRegistration.ts:56`), so it can't be checked on roxy.expo.app. |
| M123 | Lock-screen previews (off by default) | `/you/notification-settings` › Privacy | toggle | beta | works | L✓ `notif-switch-show_previews` present. ev/M123.png |
| M124 | Quiet hours | `/you/notification-settings` | pick a window | beta | works | L✓ off / 22–07 / 23–08 / 00–09. |

### Streaks, mini wins, QOTD

| ID | Feature | Route(s) | Primary action | Role | Status | Notes |
|---|---|---|---|---|---|---|
| M125 | Daily streak check-in | feed chip, settings | — | beta | works | L✓ streak 1 (`record_daily_checkin`). ev/M125.png |
| M126 | Mini Wins (sheet, settings row) | `/feed`, `/you/settings` | complete a win | beta | works | L✓ ev/M126.png |
| M127 | Question of the day answers | `/qotd/[id]` | + Add yours | beta | works | L◐ "0 answers". ev/M127.png |

### Events, rooms, speed dating, games

| ID | Feature | Route(s) | Primary action | Role | Status | Notes |
|---|---|---|---|---|---|---|
| M128 | Event detail (hero, mode badge, save, meta, safety line, ended state) | `/event/[id]` | RSVP / Save | beta | works | L✓ ended in-person event. ev/M128.png |
| M129 | Free RSVP / cancel RSVP | event detail | RSVP | beta | works | C: inserts `event_attendees`; not pressed. |
| M130 | Paid ticket (Stripe payment sheet) | event detail | Get a ticket | beta | partial | C: on web, `metro.config.js` swaps `@stripe/stripe-react-native` for `web-stubs/stripe-native.js`, whose `initPaymentSheet`/`presentPaymentSheet` return `{}` with no error, so web can report a purchase that was never paid. Not run. |
| M131 | Join an online event ("Join now") | event detail | Join | beta | works | C |
| M132 | Ticket QR wallet | `/tickets` `TicketCard` | show QR | beta | works | C: no tickets. |
| M133 | Events list / calendar view | profile Events tab `EventsCalendar` | toggle | beta | works | C |
| M134 | Event not found | `/event/<unknown id>` | — | beta | partial | L✗ blank screen, 3× GET 406 PGRST116, no not-found copy. ev/M134.png |
| M135 | Live room (audio / video, Daily) | `/community-room-session?room_id=` | join / leave | beta | partial | L✓ web shows "Video rooms work in the Roxy app … Go back". Native joins through `join-community-room`. ev/M135.png |
| M136 | Room controls: raise hand, consent strip, report host, leave quietly | room session | Raise hand | beta | works | C: native only. |
| M137 | Speed dating lobby | `/speed-dating` | Join Speed Dating | beta | works | L◐ Join not pressed (it queues). ev/M137.png |
| M138 | Waiting room (queue heartbeat, leave) | `/speed-dating/waiting-room` | Leave queue | beta | works | C |
| M139 | Date session (5:00 timer, ✿ or pass, consent strip) | `/speed-dating/session` | ✿ / Pass | beta | partial | C: native only; web shows "Video isn't available here". |
| M140 | Result (match → chat, icebreaker) | `/speed-dating/result` | Message | beta | works | C |
| M141 | Game player | `/discover/games/[gameId]` | Play | beta | stub | L✓ "This game isn't available to play yet". Web has no WebView; native loads the game in a WebView. ev/M141.png |
| M142 | Games tab on a community / profile | profile Games tab | Play | beta | works | L✓ tab present on communities. |

### Marketplace

| ID | Feature | Route(s) | Primary action | Role | Status | Notes |
|---|---|---|---|---|---|---|
| M143 | Shop profile (Shop · About · Policies; bookmark, share, website) | `/business/[id]` | open a product | beta | works | L✓ NaaxTech. ev/M143.png |
| M144 | Bookmark a shop (shows in Saved) | shop profile | bookmark | beta | works | L◐ not pressed. |
| M145 | Product detail (photos, variants, quantity, Buy Now) | `/product/[id]` | Buy Now | beta | works | L◐ the seed product's description is lorem ipsum (data, not code). ev/M145.png |
| M146 | Cart drawer | shop / product `CartDrawer` | Checkout | beta | works | C |
| M147 | Checkout (3 steps, Stripe) | product › Buy Now `CheckoutSheet` | Pay | beta | partial | C: same web Stripe stub risk as M130; not run. |
| M148 | Order confirmation | after checkout `OrderConfirmationSheet` | View order | beta | works | C |
| M149 | Order detail with status timeline | `OrderDetailSheet` | — | beta | stub | C: mounted nowhere. |
| M150 | Shoppable post (tagged product on a post) | feed `ShoppableProductCard` | open product | beta | works | C: no tagged post seen. |
| M151 | Product not found | `/product/<unknown id>` | Go back | beta | works | L✓ "This product isn't available". ev/M151.png |

### WLW Archive

| ID | Feature | Route(s) | Primary action | Role | Status | Notes |
|---|---|---|---|---|---|---|
| M152 | Archive browse (search, type chips, sort chips) | `/archive` | search / filter | member, applicant | works | L✓ 45 entries. ev/M152.png |
| M153 | Archive entry (score ring, verdict, content notes, reviews, share) | `/archive/[slug]` | rate | member, applicant | works | L✓ ev/M153.png |
| M154 | Vote 1–5 | entry `VoteCard` | rate | member, applicant | works | L◐ not voted. |
| M155 | Watchlist | entry | keep | member, applicant | works | L◐ not pressed. |
| M156 | Add a content note | `/archive/[slug]/note` | Add note | approved member | works | L◐ ev/M156.png |
| M157 | Write a review (no-spoilers check) | `/archive/[slug]/review` | Publish review | approved member | works | L◐ ev/M157.png |
| M158 | Suggest an edit | `/archive/[slug]/edit` | Send to mods | approved member | works | L◐ pre-filled. ev/M158.png |
| M159 | Suggest a new entry | `/archive/new` | Send to mods | approved member | works | L◐ ev/M159.png |
| M160 | Report an entry / review ("Something wrong or a spoiler here? Report it") | entry › more `ArchiveActionsSheet` | Report | member | partial | L◐ LO. Studio's resolver `staff-resolve-archive-report` does not exist, and on `main` `reports.reason` rejects the archive reasons (S042). ev/M160.png |
| M161 | Pending banner + locked sheet | `/archive` | Got it | applicant | works | C: seen live only through the M020 misclassification. ev/M161.png |
| M162 | Archive as the public home (Feed tab → Archive) | `/feed` (public) | — | member | works | C (`feed/index.tsx` `FeedRoute`). |
| M163 | Entry not found | `/archive/<unknown>` | — | all | works | L✓ ev/M163.png |

### Gated screens and deep links

| ID | Feature | Route(s) | Primary action | Role | Status | Notes |
|---|---|---|---|---|---|---|
| M164 | Coming soon screens (feed, discover, create, DMs, Roxy, Sister, rooms, events, shop, speed dating, communities; pending variants) | any gated route | Back to Archive | member, applicant | works | C: copy in `features.ts` `COPY` / `PENDING_COPY`. Seen live only through M020. ev/M164.png |
| M165 | `/` → `/feed` (signed in) or `/code` | `/` (`app/index.tsx`) | — | all | works | L✓ |
| M166 | `/user/<id>` deep link (including her own id) | `/user/[userId]` | — | beta | works | L✓ ev/M166.png |
| M167 | `/community/*` root aliases (profile, channels, members, post, video, create-post) | `/community/...` | — | beta | works | L✓ ev/M167.png, ev/M167-2.png |
| M168 | `/archive/<slug>` share links | `/archive/[slug]` | — | all | works | L✓ signed in. A signed-out visitor goes to `/code` and the link is lost. |
| M169 | Push tap → screen | `(tabs)/_layout` `pushResponsePath` | — | beta | works | C: native only. |
| M170 | Notification row → its `link_path` | `/notifications` | open | beta | works | C: not tapped. |
| M171 | Dev panel | `components/dev/DevPanel.tsx` | — | developer | works | C: `__DEV__` builds only, absent from production. |

### Safety coverage (block / mute / report per surface)

| Surface | Report | Block | Mute | Live check | Rows |
|---|---|---|---|---|---|
| Feed post | yes | yes | live only | sheet opened, reasons listed | M043 |
| Comment | live only | — | — | not opened | M042 |
| Member profile | yes | yes | live only | sheet opened | M118 |
| DM | yes | yes | yes | code only (no DMs) | M090 |
| Community channel message | yes | yes | — | code only | M081 |
| Audio/video room | host only (`roomSafety.ts`) | host | — | native only | M136 |
| Speed date | consent strip | yes | — | native only | M139 |
| Archive entry / review | live only, no resolver | — | — | not opened | M160 |
| Event, shop, product, game, community profile | **none** | **none** | **none** | — | M172 |

| ID | Feature | Route(s) | Primary action | Role | Status | Notes |
|---|---|---|---|---|---|---|
| M172 | Report / block / mute on events, shops, products, games and community profiles | `/event/[id]`, `/business/[id]`, `/product/[id]`, `/discover/games/[gameId]`, `/community/[id]` | Report | beta | missing | C + L✓ (none of these screens has a report or block control). The invariant says block/mute/report on every surface. |

## Studio (apps/studio): static read only

There was no staff login, so every Studio row is **C** (status from code), except the ones marked LO-S: they exist only on `launch/integration`. Which branch the live `roxy-studio` Vercel project was built from was not checked. Guards: `(dashboard)/layout.tsx` sends signed-out users to `/auth/login`; staff pages call `requireStaffPage()` / an `is_staff` check and `notFound()` otherwise; `navGroupsFor` hides staff groups from non-staff and `coreOnly` items from non-core.

| ID | Feature | Route(s) | Primary action | Role | Status | Notes |
|---|---|---|---|---|---|---|
| S001 | Studio sign in | `/auth/login` | Sign in | any | works | C: `signInWithPassword` → `/dashboard`. |
| S002 | Host sign-up | `/auth/sign-up` | Create account | visitor | partial | C: anyone can create a Roxy auth account here with no invite code (`components/sign-up-form.tsx:43`). On `main`'s schema a profile with no code defaults to `unvetted` = full access; `launch/integration` migration 130 removes `unvetted`. |
| S003 | Sign-up success | `/auth/sign-up-success` | — | visitor | works | C |
| S004 | Forgot password | `/auth/forgot-password` | Send link | visitor | works | C |
| S005 | Update password | `/auth/update-password` | Save | any | works | C |
| S006 | Email confirm callback | `/auth/confirm` (route handler) | — | visitor | works | C |
| S007 | Auth error page | `/auth/error` | — | visitor | works | C |
| S008 | Root redirect | `/` → `/dashboard` | — | any | works | C |
| S009 | Shell: role-filtered sidebar, breadcrumb header, page search | `(dashboard)/layout.tsx`, `AppSidebar`, `Header`, `StudioSearch` | jump to page | any signed-in | works | C |
| S010 | Sign out | `/settings`, `auth/signout-action.ts` | Sign out | any | works | C |
| S011 | Error pages + loading skeletons | `app/error.tsx`, `global-error.tsx`, `*/loading.tsx` | Try again | any | works | C |
| S012 | Starter "protected" page | `/protected` | — | any signed-in | stub | C: Supabase starter leftover; prints the user's JWT claims and tutorial steps. |
| S013 | Host dashboard (communities, upcoming events, orders, Stripe) | `/dashboard` | — | host | works | C |
| S014 | Community list + create community | `/community` | Create (`create_community`) | host, core | works | C |
| S015 | Members & roles | `/community/members` | Set role (`set_community_role`) | host | works | C: becomes read-only when migration 078's audit table is missing. |
| S016 | Invite codes (mint, revoke, who redeemed) | `/invites` | Mint / Revoke | host, core | works | C: `invite_codes` + `invite_code_redeemers`. `ReviewCodeMint` is LO-S. |
| S017 | Applications review queue (reviewer agreement, approve / reject / flag, reveal legal name) | `/applications` | Approve / Reject | host, staff | works | C: `decide_application`, `reveal_applicant_legal_name`. |
| S018 | Events list + create (incl. paid) | `/events` | Create event | host | works | C: `events.insert`. |
| S019 | Event detail (attendees, check-in, cancel) | `/events/[id]`, `/api/events/[id]/checkin`, `/api/events/[id]/cancel` | Check in / Cancel | host | works | C: `checkin_attendee`. |
| S020 | Rooms (create / edit, go live / end) | `/rooms` | Go live | host | works | C: errors name the cause (e.g. unset `DAILY_API_KEY`). |
| S021 | Room console (Daily: mute all, remove, leave) | `/rooms/[id]` | Mute / Remove | host | works | C |
| S022 | Community games (enable / disable) | `/games` | Toggle game | host | works | C: `community_games`. |
| S023 | Pitch a game | `/games/submit` | Submit | developer | works | C |
| S024 | My game submissions | `/games/submissions` | open | developer | works | C |
| S025 | Submission detail + build upload | `/games/submissions/[id]` | Submit build | developer | works | C |
| S026 | Sell on Roxy (business + Stripe Connect onboarding) | `/stripe-onboarding`, `/api/stripe/onboard` | Connect Stripe | seller | works | C: `connect-business-stripe`, `stripe-connect-onboard`. |
| S027 | Products (create, edit, archive, photos, variants) | `/products` | Save product | seller | works | C |
| S028 | Orders (mark shipped, refund, cancel) | `/orders` | Mark shipped | seller | works | C: `get-orders-business`, `update-order-shipped`, `refund-order`. |
| S029 | Seller payouts | `/seller-payouts` | — | seller | works | C: read-only list. |
| S030 | Event payouts + Stripe dashboard link | `/payouts`, `/api/stripe/dashboard-link` | Open Stripe | host | works | C |
| S031 | Settings (business profile, Stripe banner, product Stripe, notification prefs, delete account) | `/settings` | Save / Delete account | any | works | C |
| S032 | Staff overview (audit log, payments, release / block payout) | `/staff`, `/api/staff/release-payout`, `/api/staff/block-payout`, `/api/staff/cancel-event` | Release / Block | staff | works | C: `LaunchFunnelCard` / `PendingApplicationsCard` are LO-S. |
| S033 | Launch access (beta tier per member) | `/staff/launch` | Set tier (`set_access_tier`) | staff | works | C |
| S034 | Roxy team (make / remove staff, community owners) | `/staff/team` | Make staff | core | works | C: `set_staff_role`, `set_community_owner`; nav item `coreOnly`. |
| S035 | Member tags (Top 10 editorial tags) | `/staff/member-tags` | Set tag | staff | works | C |
| S036 | Archive dashboard | `/staff/archive` | — | staff | works | C |
| S037 | Archive entries list + filters | `/staff/archive/entries` | Add entry | staff | works | C |
| S038 | New archive entry | `/staff/archive/entries/new` | Save | staff | works | C: `staff_save_archive_entry`. |
| S039 | Edit archive entry (photos, cover, delete) | `/staff/archive/entries/[id]` | Save / Delete | staff | works | C |
| S040 | Member queue (every pending application) | `/staff/archive/members` | Approve / Reject | staff | works | C: same `decide_application` path as S017. |
| S041 | Revision queue (member-suggested edits) | `/staff/archive/revisions` | Approve / Reject | staff | works | C: `staff-review-archive-revision`. A mod can't review her own; there is no revert path. |
| S042 | Archive reports queue | `/staff/archive/reports` | Resolve | staff | partial | C: Resolve calls `staff-resolve-archive-report`, which does not exist in `supabase/functions`. On `main` nothing can file an archive report (reason CHECK), so the queue stays empty. |
| S043 | Business approvals | `/staff/businesses` | Approve / Reject | staff | works | C: `staff-approve-business`. |
| S044 | Product approvals | `/staff/products` | Approve / Reject | staff | works | C: `staff-approve-product`. |
| S045 | Game review queue + review form | `/staff/games`, `/staff/games/[id]` | Approve / Request changes | staff | works | C |
| S046 | Feature requests (set status) | `/staff/feature-requests` | Set status | staff | works | C |
| S047 | Feedback inbox (status, contacts) | `/staff/feedback` | Update | staff | works | C: `staff_feedback_contacts`. |
| S048 | Email queue (retry) | `/staff/email-queue` | Retry | staff | works | C |
| S049 | Reconciliation alerts | `/staff/reconciliation` | Resolve | staff | works | C |
| S050 | Disputes | `/staff/disputes` | — | staff | partial | C: read-only list of disputed orders; no action. |
| S051 | Appeals queue | `/staff/appeals` | Decide appeal | staff | works | C LO-S (`launch/integration` only). |
| S052 | Members directory + member detail / suspension | `/staff/members`, `/staff/members/[id]` | Suspend | staff | works | C LO-S. |
| S053 | Reports queue (all content types) | `/staff/reports` | Resolve | staff | works | C LO-S. `main` has no general reports queue at all: reports filed from the app (M043, M090, M118…) have no Studio screen on `main`. |
| S054 | Invite waves | `/staff/launch/waves` | Send wave | staff | works | C LO-S. |
| S055 | Dashboard error boundary | `(dashboard)/error.tsx` | Try again | any | works | C LO-S. |

## Gated / not reachable on the live build

**Hidden by account kind or tier** (`lib/features.ts`, `hooks/useAccess.ts`):
- **Public member** (`access_tier` ≠ beta, approved): only Archive (M152–M163) and Roxy Official chat. Every other route draws Coming soon (M164): Feed (Archive replaces it, M162), Discover, Create, DMs, Roxy, Sister, rooms, events, shop/tickets, speed dating, other communities. The bar becomes Archive · Chat · You (M019) and Messages becomes `OfficialChatInbox` (M092).
- **Pending / rejected applicant:** Archive only, with the pending banner and locked sheet (M161), plus the pending chip (M010). Official chat and DMs use the pending copy. Notes, reviews and edits open the locked sheet.
- **Community owner:** public set plus community chat.
- **Beta-only inside Settings:** Dating mode (M105), Ghost mode (M106).
- **Core only:** View-as preview (M021); Studio Roxy team (S034).
- **Staff / core:** every Studio staff page (S032–S055).
- **Official community accounts only:** Create › Event and publishing from M058.
- **Approved sellers / community accounts only:** shop tagging (M055) and Create › Product (M060, dead even when unlocked).
- **Always locked on mobile:** Create › Room (M059), Create › Game (M061).

**Not reachable on the web build (native only):** push (M122, M169), live rooms (M135–M136), speed-dating video (M139), the game WebView (M141), the Stripe payment sheet (M130, M147: stubbed to "success" on web).

**Mounted nowhere (dead code):** `NewPostsBanner` (M047), `PrivacyGateSheet` (M048), `RoxyLinkPicker` (M057), `OrderDetailSheet` (M149); also `ProfileCard`, `FeedCard`, `SelfControls`, `RoxyLinkCard`, `PostActionRow`, `StaticPostCard`, `VideoPostCard`, which have no route.

**Not checked live with this account** (approved beta, no DMs, no tickets, no shop, not staff): M004, M006, M008–M010, M017, M019, M021, M024–M025, M027, M034, M055, M081, M088–M090, M092, M110, M122, M129–M133, M136, M138–M140, M146–M150, M161–M162, M164 (deliberately), M169–M170, and all of Studio.

**Live-only (on roxy.expo.app via `launch/integration`, absent from `main`):** M002, M011, M037, M038, M040, M042, M043 (Mute), M086 (Friends tab), M091, M094, M098, M102 (prompts), M108 (Muted), M118 (Mute), M160; Studio S016 (ReviewCodeMint), S032 (funnel cards), S051–S055.

## Console errors seen (live)

| Route | Message |
|---|---|
| `/user/00000000-…` | `Failed to load resource: 406`, GET `/rest/v1/profiles?select=…` PGRST116 "Cannot coerce the result to a single JSON object" (handled: "Profile not found") |
| `/chat/00000000-…` | 2× `Failed to load resource: 500`, POST `/rest/v1/rpc/mark_conversation_read` P0002 "conversation not found" (it runs before the screen knows the chat is missing) |
| `/event/00000000-…` | 3× `Failed to load resource: 406`, GET `/rest/v1/events?select=*,price_cents,communities(id,name)` PGRST116; the screen stays blank (M134) |
| `/product/00000000-…` | 2× `Failed to load resource: 406`, GET `/rest/v1/products?select=*,product_variants(*),product_photos(*)` PGRST116 (handled) |
| `/feed` (paging) | `Access to fetch at …/rest/v1/seen_posts?on_conflict=user_id,post_id … blocked by CORS policy: No 'Access-Control-Allow-Origin'` + `net::ERR_FAILED`, probably the degraded gateway answering without CORS headers |

No `pageerror` (uncaught exception) on any route. Every other route logged no console error.

## Backend degradation during the crawl (prod Supabase, free tier)

Times are CST. One browser context per run, sequential pages, 8 sign-ins in total (2 got no response). No more sign-ins were made after the orchestrator's heads-up. Timeouts and slow loads:
- 23:15 and 23:17: password sign-in got no response (form stayed, no error) for 60 s and then 90 s. It worked after a 90 s pause.
- 23:11: `/feed` drew no cell within 45 s (one run).
- 23:23 and about 23:30: `/event/818f64cf-…` came back blank once each; it rendered on other loads.
- 23:08: `/you/notification-settings` took 21 s to settle. `/community-room-session` took 21 s.
- 23:25: a `seen_posts` upsert failed CORS / `ERR_FAILED`.
- M020 (pending gate shown to an approved member) happened in this window too and may be the client's fail-closed reaction to slow profile loads.

No row was left unverified because of the outage: every **C** row is code-only for an account, write or platform reason given in its Notes.
