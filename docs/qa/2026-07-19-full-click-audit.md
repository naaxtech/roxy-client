# Roxy client — full click audit (2026-07-19)

Playwright click-through of every interactive surface, web build (local export served
at :8090, account alex@roxy.dev). ✅ = works as intended · 🐛 = defect (fix noted) ·
⏭ = cannot exercise on web/dev (reason noted).

## A. Navigation shell
- [ ] Tab bar: Grow / Connect / Play / Messages / Build switch + active state
- [ ] Tab badges (Grow pending, Messages unread) render at corner
- [ ] R companion FAB: tap → 3 actions (Chat / Search / Filter), long-press → Roxy chat
- [ ] Desktop frame at >500px, full-bleed at phone width

## B. Grow
- [ ] Notifications bell → notifications screen, mark read, back
- [ ] Header avatar → own profile
- [ ] Roxy speech bubble + "✦ Ask Roxy" → roxy-chat, suggestion chips, send, back
- [ ] Happening Now carousel: auto-advance, Join now → room session, back
- [ ] Question of the day → answer sheet opens, submit, close
- [ ] Mini Wins rows tappable
- [ ] My Communities card → community view, back returns to Grow
- [ ] See all → communities browser
- [ ] My People → people screen, back
- [ ] Need to talk? → Sister flow, back
- [ ] Support Roxy → DonateModal (monthly default $20, ±$5, never "subscribe"), close
- [ ] My Journey card

## C. Connect
- [ ] Feed: post card → post detail, comments, like, save, share, author → profile
- [ ] Community chip on post → community view, back returns to Connect
- [ ] Per-subtab search fields filter
- [ ] Events: list ↔ calendar toggle, event card → event detail, RSVP, back
- [ ] Rooms: Dating Mode toggle, Speed Dating banner → lobby, back
- [ ] Rooms: room card → session (web shows graceful native-only screen), back
- [ ] Communities: search, join/leave button, card → community view, back
- [ ] Browse pill + All ▾ community filter

## D. Community view (root route /community/[id])
- [ ] Back button returns to origin tab (regression: used to hijack into Play)
- [ ] Cold deep link: back falls back to Connect › Communities
- [ ] Subtabs Posts / Rooms / Games / Events + swipe pager
- [ ] Post: like, comment → detail, share, save
- [ ] Members row → members screen, back
- [ ] Live chip, Joined/Join toggle
- [ ] Games: Speed Dating → community-scoped lobby
- [ ] Events: list/calendar, event → detail
- [ ] Create-post FAB → create post screen, back

## E. Play
- [ ] Search filters games
- [ ] Hero Play → Speed Dating options (Feeling wild / per-community), each routes
- [ ] Live now rail → room session, back
- [ ] From your communities card → options modal
- [ ] Browse → communities
- [ ] People icon (header) → communities browser

## F. Messages
- [ ] Roxy pinned row → roxy-chat
- [ ] DM row → chat: send text, gif picker, report modal, back
- [ ] New-DM (✎) → friend picker → opens chat
- [ ] Search messages field

## G. Build
- [ ] Businesses: card → pop detail (back btn), save heart, photos, products
- [ ] Product → detail sheet → Add to cart → cart drawer → checkout sheet steps
- [ ] WLW-only filter, Saved segment, search
- [ ] Register your business link
- [ ] Impact: card → detail modal, Support button
- [ ] Pitch modal (Community Pitches → pitch an idea)
- [ ] Support subtab: vote hearts, Keep Roxy alive → DonateModal
- [ ] All ▾ scope selector

## H. Profile & settings
- [ ] Profile tabs Photos / About / Badges
- [ ] Edit profile → save → values persist
- [ ] Settings: theme toggle, sign out (works on web)

## I. Global search (/search)
- [ ] Debounced results in groups; each result type navigates

## Defects found → all fixed & verified same day

1. 🐛 **Community view hijacked the Play tab** (the reported bug). Connect/Grow/Search/Browse
   pushed `/(tabs)/discover/community/…`, silently switching tabs; back landed on Play's games
   screen. → All entry points now push the root `/community/[id]` route; back returns to the
   origin tab; cold deep links fall back to Connect › Communities. (e2e: navigation-smoke)
2. 🐛 **Likes, post-saves & comment-likes silently broken app-wide.** `post_likes` /
   `post_saves` / `comment_likes` had `user_id NOT NULL` with no default while clients insert
   only the content id → RLS 403 on every insert; optimistic UI reverted, hiding it.
   → Migration 062 `DEFAULT auth.uid()` (applied to prod). Verified: like + save + comment-like
   persist across refetch.
3. 🐛 **Profile photo grid always empty.** ProfileCard queried `posts.user_id` — column is
   `author_id` → 400 on every profile. → Fixed; query clean.
4. 🐛 **Web room join alerted "Connection error".** Metro's web stub for daily-js is an empty
   module (`{}` is truthy), so `isAvailable` lied and join called a missing function.
   → DailyProvider validates module shape; web now renders the friendly native-only screen.
   (e2e: navigation-smoke)
5. 🐛 **DonateModal impossible to close via X** (web) — sibling text intercepted the pointer;
   absolute close button lacked zIndex. Same latent bug in CheckoutSheet + OrderDetailSheet.
   → zIndex added to all three; verified clickable.
6. 🐛 **Enter didn't send chat messages on web.** → DM chat + Roxy chat: Enter sends,
   Shift+Enter newlines. Verified.
7. 🐛 **Stale call screen stuck on the Connect tab.** Room session lived in the Connect stack;
   cross-tab joins left it as Connect's top route after leaving. → Root `/community-room-session`
   route; all four entry points updated. (e2e: navigation-smoke)

Minor (logged, not blocking): event "0 going" count doesn't refresh right after RSVP;
FlashList size warning on some screens; Grow badge counts friend-requests while the bell
shows notifications (two sources, potentially confusing).

## E2E
`tests/e2e/navigation-smoke.spec.ts` (3 tests, all passing) locks in defects 1, 4, 7.
Run: `PLAYWRIGHT_WEB_PORT=<port> E2E_EMAIL=… E2E_PASSWORD=… npx playwright test navigation-smoke`.
Auth helper updated for the 5-tab IA (Play, not Discover).

## Walk results
Everything else on the matrix above verified working: tab nav + badges, FAB actions,
join/leave community, feed like/save/comment/author-nav/post detail, events list + detail +
RSVP ticket, speed-dating lobby, notifications screen, DM send/report/options/back,
business pop card + bookmark, impact vote toggle, donate modal copy ($20 monthly default,
±$5, never "subscribe"), profile tabs, desktop frame + phone full-bleed.
