# Session 25 — Subagent Batch: Dialog Sweep · Group Calls · Donations

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. One implementer subagent per task, task review after each, whole-branch review at the end.

**Goal:** Finish the remaining Roxy queue: app-wide web-safe dialogs, complete/polish audio-video group rooms on client and Studio, and ship Roxy donations (recurring-first, never "subscribe").

**Architecture:** Mobile is Expo Router + React Native + Zustand + Supabase (apps/mobile). Studio is Next.js 16 + shadcn (apps/studio). Edge functions in supabase/functions (Deno). Migrations in supabase/migrations (next free number: 060).

**Tech Stack:** TypeScript strict everywhere. Mobile theme via `useThemeColors()` hook (never hardcoded colors except the brand gradient). Brand gradient: `['#FF6A2E', '#FF2F71', '#E81C8E']`.

## Global Constraints

- Work happens on branch `session-25-subagent-batch`. Commit per task; end commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **react-native-web stubs ALL `Alert.alert`** — dialogs must use `apps/mobile/lib/confirm.ts` (`confirmAction(title, message, confirmLabel?)` → Promise<boolean>; `showAlert(title, message)`).
- **supabase-js returns errors, it does NOT throw** — every mutation checks `error` explicitly.
- Screen-level Realtime channels must be created via `apps/mobile/lib/realtimeChannel.ts` `freshChannel(topic)` (remount-safety) and filtered (never table-wide).
- Daily.co is native-only: never module-level import; go through `apps/mobile/lib/video` / `isDailyAvailable()` guards that already exist.
- Modal presentation: `animationType="fade"` + spring pop via `apps/mobile/components/ui/popIn.ts` `usePopIn(visible)` on the content container. Never slide-from-bottom.
- Icon-only buttons need `accessibilityLabel`. Vector Ionicons in chrome; emoji allowed only in content/brand copy (🌸 💜).
- Never remove or rename existing `testID`s.
- Donations wording: **the words "subscribe"/"subscription" must never appear in user-facing strings** — always "donation"/"donate"/"monthly donation"/"yearly donation".
- QA loop before reporting DONE (from `apps/mobile`): `npx eslint . --ext .ts,.tsx --max-warnings 0` · `npx tsc --noEmit` (exit 0) · `npx jest --ci --passWithNoTests` (all pass; currently 333). For Studio changes additionally run `npx tsc --noEmit` from `apps/studio`.
- Do NOT deploy anything (no `eas`, no `supabase db push`, no `functions deploy`) — the controller deploys after review.
- Do NOT edit files outside your task's listed scope.

---

### Task 1: Web-safe dialog sweep (mechanical)

**Files:**
- Modify: every file under `apps/mobile/app/` and `apps/mobile/components/` that still calls `Alert.alert` (find them with grep), EXCEPT `lib/confirm.ts` itself.
- Test: existing suites must stay green; no new tests required (helper already tested in `__tests__/confirm.test.ts`).

**Interfaces:**
- Consumes: `confirmAction(title, message, confirmLabel?, destructive?)` and `showAlert(title, message)` from `apps/mobile/lib/confirm.ts`.

**Steps:**
- [ ] Grep `Alert.alert` under `apps/mobile/app` and `apps/mobile/components`.
- [ ] For each two-button confirm (`[{cancel},{action}]`): rewrite as `const ok = await confirmAction(title, message, actionLabel); if (!ok) return;` followed by the action body. Make the enclosing handler async if needed.
- [ ] For each single-button info/error alert: replace with `showAlert(title, message)`.
- [ ] Remove now-unused `Alert` imports (keep where still used).
- [ ] Import path is relative to each file (e.g. `../../../lib/confirm`).
- [ ] Run the QA loop. Commit: `fix(dialogs): web-safe confirmAction/showAlert app-wide`.

### Task 2: Mobile group room session — completeness + polish

**Files:**
- Modify: `apps/mobile/app/(tabs)/connect/community-room-session.tsx` (primary), plus `apps/mobile/hooks/useVideoCall.ts` / `apps/mobile/lib/video.ts` ONLY if a found defect requires it.

**Requirements:**
- [ ] Audit the whole screen first; list every interaction and its state handling in your report.
- [ ] All dialogs web-safe (confirmAction/showAlert — Task 1 may have converted some; verify).
- [ ] Leave-room flow: confirm, disconnect provider, navigate back — no dangling call state.
- [ ] Mute/camera toggles: reflect real provider state, have accessibilityLabels, minimum 44px targets.
- [ ] Participant grid: empty state ("Waiting for others to join 🌸"), speaker/participant name labels, host badge if host data available.
- [ ] Error states: join failure (room full 409 / ended 410 / network) each show a clear message + a way back — never a stuck spinner.
- [ ] Web behavior: Daily may be unavailable on web — the screen must degrade to a friendly "Video rooms work in the Roxy app 💜 — audio-video isn't available in the browser yet" state with a back action IF `isDailyAvailable()` is false; never a crash or blank screen.
- [ ] Visual polish to design language: dark stage background `#0d0520`-family, roxy accents, pill badges (reuse patterns from the redesigned `CommunityRoomCard`).
- [ ] QA loop. Commit: `feat(rooms): complete + polish mobile room session`.

### Task 3: Studio room host view — completeness

**Files:**
- Modify: `apps/studio/app/(dashboard)/rooms/[id]/page.tsx` and its client components; `apps/studio/app/(dashboard)/rooms/RoomsClient.tsx` only if a found defect requires it.

**Requirements:**
- [ ] Audit and list every host interaction in your report (join, leave, mute participant, kick, end room).
- [ ] Verify kick/mute call the `kick-participant` / `manage-room` edge functions with error handling that surfaces failures (toast or inline — follow existing Studio patterns).
- [ ] End-room action exists, confirms first, and updates room status via `manage-room` (`action: 'update'`/close per the function's contract — read `supabase/functions/manage-room/index.ts` to match its API exactly).
- [ ] Loading/empty/error states for the room page (room not found, Daily iframe failure).
- [ ] Run `npx tsc --noEmit` in `apps/studio` (must exit 0). Commit: `feat(studio): complete room host controls`.

### Task 4: Donations backend (migration 060 + edge function)

**Files:**
- Create: `supabase/migrations/060_donations.sql`
- Create: `supabase/functions/create-donation-checkout/index.ts`
- Test: `apps/mobile/__tests__/donations.test.ts` for the client lib in Task 5 is NOT this task; this task has no jest surface — correctness is via careful SQL/function review. Still run the mobile QA loop to prove nothing broke.

**Migration 060 (retry-safe like 057/059):**
- [ ] Table `public.donations`: `id uuid pk default gen_random_uuid()`, `user_id uuid not null references profiles(id) on delete cascade`, `amount_cents int not null check (amount_cents >= 500)`, `currency text not null default 'usd'`, `cadence text not null check (cadence in ('one_time','monthly','yearly'))`, `status text not null default 'pending' check (status in ('pending','active','completed','canceled','failed'))`, `stripe_checkout_session_id text`, `stripe_subscription_id text`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`.
- [ ] RLS: users SELECT their own rows only; NO client INSERT/UPDATE/DELETE policies (writes via service role in functions).
- [ ] Index on `(user_id, created_at desc)` and on `stripe_checkout_session_id`.

**Edge function `create-donation-checkout` (follow repo conventions — copy the import/order pattern from `supabase/functions/connect-business-stripe/index.ts`, use `npm:stripe@17`):**
- [ ] Standard order: handleCors → verifyJWT (401) → parse body → DEV_MOCK decl → getSupabaseClient → logic. Wrap ALL Stripe calls in try/catch returning errorResponse with detail.
- [ ] Body: `{ amount_cents: number, cadence: 'one_time'|'monthly'|'yearly' }`. Validate: integer, `>= 500`, `<= 100000`; cadence in set; else 400.
- [ ] One-time: `stripe.checkout.sessions.create({ mode: 'payment', line_items: [{ price_data: { currency: 'usd', unit_amount, product_data: { name: 'Donation to Roxy 💜' } }, quantity: 1 }], success_url, cancel_url })`.
- [ ] Monthly/yearly: `mode: 'subscription'` with `price_data.recurring.interval: 'month'|'year'` and `product_data.name: 'Monthly donation to Roxy 💜'` / `'Yearly donation to Roxy 💜'` (this is Stripe API plumbing — the words never surface in Roxy UI).
- [ ] `success_url: 'https://roxy.expo.app/grow?donation=thanks'`, `cancel_url: 'https://roxy.expo.app/grow'`.
- [ ] `client_reference_id: userId`; also `metadata: { user_id, cadence }`.
- [ ] Insert a `donations` row (status 'pending', checkout session id) via service client; check the error.
- [ ] Return `successResponse({ url: session.url })`.
- [ ] Commit: `feat(donations): migration 060 + create-donation-checkout function`.

### Task 5: Donations UI (mobile)

**Files:**
- Create: `apps/mobile/components/donations/DonateModal.tsx`
- Create: `apps/mobile/lib/donations.ts`
- Create: `apps/mobile/__tests__/donations.test.ts`
- Modify: `apps/mobile/app/(tabs)/grow/index.tsx` (Support Roxy card between Sister card and My Journey), `apps/mobile/app/(tabs)/build/index.tsx` (a "Keep Roxy alive 💜" banner at top of the ✦ Support segment opening the same modal).

**lib/donations.ts:**
- [ ] `clampDonationAmount(cents: number): number` — clamps to [500, 100000], rounds to a whole dollar (multiple of 100).
- [ ] `startDonationCheckout(amountCents: number, cadence: 'one_time'|'monthly'|'yearly'): Promise<string | null>` — calls `callEdgeFunction('create-donation-checkout', { amount_cents, cadence })` (import from `../lib/supabase` pattern used elsewhere), returns `data?.url ?? null` (remember `callEdgeFunction` unwraps once — check its signature in `apps/mobile/lib/supabase.ts` and match how other callers read `data`); null on error.

**__tests__/donations.test.ts (write FIRST, TDD):**
- [ ] clamp: 2000 → 2000; 100 → 500; 999999 → 100000; 2050 → 2100 or 2000 (pick round-half-up and assert it).
- [ ] startDonationCheckout: mocks `callEdgeFunction`; returns url on success; null on error.

**DonateModal.tsx:**
- [ ] Fade Modal + `usePopIn` content card (see the Speed Dating options modal in `apps/mobile/app/(tabs)/discover/index.tsx` for the exact pop-card pattern to follow).
- [ ] Copy: title "Support Roxy 💜", sub "Roxy is built and owned by WLW. Donations keep it that way."
- [ ] Cadence segmented control: **Monthly (default, listed first) · Yearly · One-time** — pill style like Build's segment control.
- [ ] Amount stepper: default **$20**, − / + buttons stepping $5, floor **$5**, ceiling $1000, amount shown big (`$20 / month`, `$20 / year`, `$20` for one-time). Uses `clampDonationAmount`.
- [ ] CTA gradient button "Donate 💜" → `startDonationCheckout` → on url: open with `Linking.openURL(url)` (works on web + native); on null: `showAlert('Could not start your donation', 'Please try again in a moment.')`. Loading spinner state on the CTA.
- [ ] Subtle footer line under CTA: "Monthly donations help the most 🌸 · Cancel anytime".
- [ ] NO occurrence of "subscribe"/"subscription" anywhere in strings.
- [ ] Grow card: section-style card, heart icon, title "Support Roxy", sub "Help keep this space ours — from $5/month", opens the modal.
- [ ] QA loop (jest must include the new tests). Commit: `feat(donations): DonateModal + Support Roxy surfaces`.

### Task 6: Grow hero differentiation per roxy-home-v1 peg

**Files:**
- Modify: `apps/mobile/app/(tabs)/grow/index.tsx` (Roxy hero section only)
- Modify: `apps/mobile/components/grow/HappeningTonightCard.tsx` (slide layout only)
- Reference (MUST view first): `docs/brand/roxy-home-v1-light.jpeg` — it is an image; read it with the Read tool.

**Problem:** the Ask Roxy hero and the Happening Tonight card are both full-gradient slabs — they read as the same component. Per the peg they are visually distinct.

**Ask Roxy (de-card it, per peg):**
- [ ] Replace the full-gradient LinearGradient hero with a flat section on the screen background: left = 56px Roxy avatar circle (keep the existing gradient ring + sparkles icon), right = Roxy''s greeting message in a `surface`-colored speech-bubble card (radius 18, subtle border `roxy + 22`); below the row: a compact self-sizing gradient pill button "✦ Ask Roxy" (brand gradient, white text, minHeight 44, paddingHorizontal 22, NOT full width) next to the round mic ghost button (surface bg, roxy icon). Keep existing routes/handlers/loading state exactly.
- [ ] Remove now-unused hero styles.

**Happening Tonight slides (peg-exact, shorter):**
- [ ] Slide layout: left = white circle icon plate (44px); middle column (flex 1) = pill label, title (1 line, fontSize 16.5), one meta line ("7:00 PM · Community" / "Community · 6 here now"); right column (alignItems flex-end, justifyContent space-between) = compact countdown (digit boxes 14px font) or LIVE pill on top, white "Join now" pill (minHeight 36, paddingHorizontal 16) at the bottom.
- [ ] Slide minHeight drops to ~104 (from 148); paddings tighten (12-14). Dots row stays.
- [ ] Do not change data loading, auto-advance, or navigation — layout only.
- [ ] QA loop. Commit: `style(grow): peg-exact hero split — Roxy bubble vs compact happening card`.

### Task 7: Profile header — Bumble-style centered avatar + Discord-style badges

**Files:**
- Modify: `apps/mobile/components/profile/ProfileCard.tsx` only.
- Reference peg (view with Read tool): `docs/brand/roxy-home-v1-dark.jpeg` (profile peg) for chip/badge feel.

**Requirements (Nicole, verbatim intent):** "When you open someone's profile, their profile picture should be in the middle on top, similar to how Bumble does it, then badges below the profile picture, small badges similar to Discord. The profile picture was already correct before" (i.e., the avatar itself renders fine — this is a LAYOUT change).
- [ ] Avatar: centered horizontally at the top of the card, large (~110px, borderRadius 55 — circular per Bumble), overlapping the bottom edge of the gradient cover by ~50% (cover stays). Keep existing avatar rendering logic (preset emoji / image / initial) untouched.
- [ ] Display name + @username centered under the avatar.
- [ ] Badges row: directly below name — small Discord-like flat chips (~22px tall, borderRadius 6, surface bg, 14px badge emoji + no text, 4px gap, centered row, max ~6 with a "+N" chip). Use the user's EARNED badges (the component already receives `badges`; earned = `earned_at !== null`).
- [ ] Pronoun/identity chips row stays but centered, below the badges.
- [ ] Everything below (stats, Edit Profile / Say hi actions, tabs) unchanged except centering adjustments needed to look coherent.
- [ ] Keep every existing testID and prop; `ProfileCard.test.tsx` must still pass (update layout-based queries only if strictly necessary).
- [ ] QA loop. Commit: `style(profile): centered Bumble-style avatar + Discord-style badge chips`.

**Task 7 addendum (Nicole 2026-07-19):** tags must make pronouns + sexual orientation readable at a glance: pronoun chips get a distinct tint (roxy) vs orientation chip (secondary tint), both prominently under the name. Additionally create `supabase/migrations/061_gov_verification.sql`: `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS gov_verified boolean NOT NULL DEFAULT false;` (set by staff tooling later — no client write path, no RLS change needed since profiles select policies already exist). ProfileCard: when `profile.gov_verified` is true show a special verified badge — small shield/checkmark chip (Ionicons shield-checkmark, roxy gradient background, white icon) directly beside the display name with accessibilityLabel "Government verified". Add `gov_verified?: boolean` to the Profile type in apps/mobile/types/index.ts.
