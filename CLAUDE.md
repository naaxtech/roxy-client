# Roxy — CLAUDE.md
### The single file Claude Code reads at every session start
### Three apps: roxy-client · roxy-studio · roxy-staff
### Maintained by Nicole Claire Marie A. Azachee · Thinqer

---

## WORKSPACE INTEGRATION (added 2026-07-25 by bootstrap)

Roxy sits under the **JoNicole** workspace (`Thinqer/roxy/roxy-client/`). Thinqer is the product **brand**;
as of 2026-07-28, Roxy is registered/billed under **Naaxtech Corp** (PH-registered) — Play Console/App Store
Connect developer account, RevenueCat merchant, tax/revenue. That's a billing/legal-entity change only:
infra, codebase, secrets, and the Supabase project stay separate from Naaxtech's own apps. Shared build
doctrine (ship gate, research protocol, 13-layers, cloud-stages) lives in `../../../_kernel/`; this file
stays the Roxy source of truth.

**Open bootstrap-flagged items (tracked in `_kernel/INBOX.md`):**
- **Model id:** `supabase/functions/_shared/claude.ts:43` hardcodes `claude-sonnet-4-6`, which is **not a
  current Anthropic id** (and §4/§6 below claim haiku). Route haiku-4-5 → sonnet-5 → opus-4-8; verify with `/model`.
- **Prompts in DB:** the 8 edge-function system prompts are hardcoded; doctrine requires a versioned
  `agent_versions` table (active/staging/archived) so rollback is a row update.
- **Secret hygiene:** rotate the service-role key + PAT sitting in the untracked local `.env`.
- This file is ~370 lines (over the 150-line context cap). Recommend a slimming slice: move the migration
  table, session table, and anti-patterns into `docs/` and keep the rules here. **Not auto-trimmed** —
  it's your master brain; slim it deliberately, don't let a bootstrap gut it.

---

## 0. WHAT THIS FILE IS

This is the persistent brain for Claude Code across all Roxy development.
Claude Code reads CLAUDE.md automatically at the start of every session.
You never need to paste context again. This file IS the context.

When a session crashes and restarts: read this file, read `.claude/log.md`, state what you know, continue.

---

## 1. WHO YOU ARE WORKING WITH

**Nicole Claire Marie A. Azachee** — Co-Founder & Technical Lead, Thinqer.
CTO. AI systems architect. Prompt engineer. Samsung R&D background. Patent holder (PH + KR).

Operating rules when working with Nicole:
- First output is the right output. No drafts.
- No preamble. Start with the answer, code, or decision.
- CTO-level thinking by default.
- Business context is always in the room.
- Opinions are required. Give a clear recommendation with tradeoffs.
- Never ask if you should proceed. Proceed.
- Never open with "Certainly!", "Great!", "Of course!", or any affirmation.
- Make the most useful assumption, state it in one sentence, proceed.

**Co-founder Jo** — Founder & CEO. Vision and community concepts. Non-technical.
Nicole translates Jo's vision into systems. When Jo wants a feature: assess architecture fit → buildable version → emotional AI data value → flag delta → build.

---

## 2. THE PRODUCT ARC (HOLD THIS ALWAYS)

**Roxy** → **Emotional AI** trained on Roxy data → **Thinqer incubator** of new products.

This arc is not future planning. It shapes every schema, every feature, every logging decision today.
Every feature that generates behavioural/emotional/relational data is doubly valuable.
Never design a schema or feature without asking: **what does this generate that the emotional AI can learn from?**

---

## 3. WHAT ROXY IS

A WLW (Women who Love Women) social community + dating platform.

**Zero-churn architecture:** Dating is an opt-in mode, not the primary tab. Community is the foundation. Every life stage of a WLW user has a home on Roxy — questioning, partnered, building. No life stage = no churn reason.

**The AI wingwoman:** The in-app AI persona is named **Roxy**. She is a wingwoman. Never "the AI", never "the assistant", never "the chatbot". Every user-facing AI string reflects this. Generic output is a quality failure, not a draft.

**Three apps:**
- `apps/mobile/` — End-user WLW social + dating app (roxy-client)
- `apps/studio/` — Community/influencer host dashboard at roxy-studio.vercel.app (roxy-studio)
- Future: `apps/staff/` — Internal operations (roxy-staff, not yet started)

---

## 4. LOCKED TECH STACK

Do not suggest alternatives. These are final.

| Layer | Technology |
|---|---|
| Mobile | Expo 51, Expo Router v3, React Native 0.74, TypeScript strict |
| State | Zustand: `authStore`, `profileStore`, `roxyChatStore`, `connectStore`, `feedStore`, `buildStore` |
| Backend | Supabase (Postgres + Auth + Realtime + Edge Functions + Storage) |
| AI model | `claude-haiku-4-5-20251001` (edge functions) · `claude-sonnet-4-6` (complex tasks) |
| Orchestration | n8n (self-hosted) |
| Video | `@daily-co/react-native-daily-js` (guarded import — see anti-patterns) |
| Lists | `@shopify/flash-list` |
| Dates | `date-fns` |
| Web | Vercel · Next.js 16 (Turbopack) · shadcn/ui |
| Push | Expo Push Notifications (`expo-notifications`) — replaced OneSignal 2026-07-28: OneSignal was never actually installed (no SDK, no plugin, no registration code), and Expo's own push service is free, already a dependency, and needs no separate vendor account/native module — lowest-hassle option that's also lowest cost. |
| Builds | EAS Build |
| Payments | Stripe Connect Express |
| Analytics | PostHog |
| Error tracking | Sentry |
| Version control | Git · branch: `session-N-<slug>` → PR to `main` |

**AI cost target:** Under $0.50/user/month blended. Every AI feature decision is evaluated against this.

---

## 5. CURRENT PROJECT STATE

### Migrations completed (next = 058 — always verify with `ls supabase/migrations` first)
| File | Contents |
|---|---|
| 001 | profiles, roxy_greetings, dev_config, ai_call_log |
| 002 | avatars storage bucket + RLS |
| 003 | communities, community_members, friendships |
| 004 | conversations, messages, speed_date_sessions, matches |
| 005 | posts, events, event_attendees + RLS + seed |
| 006 | businesses, impact_projects + RLS + seed |
| 007 | badges, user_badges, gamification points |
| 008 | reports, blocks, content moderation |
| 009 | RLS — authenticated users can insert speed_date_sessions |
| 010 | increment_reaction SQL function |
| 021 | fee_tiers, host_stripe_accounts, platform_settings, payment_logs, events price_cents/currency |
| 045 | posts/comments feed v2: post_likes, post_saves, comment_likes, seen_posts, compute_feed_score (VOLATILE), post-media bucket, behavioural_consent |
| 046–055 | games platform, feed seeds/fixes, theme QOTD, profile photos + favorites (see files) |
| 056 | login streaks: profiles.streak_count/streak_last_day + record_daily_checkin() RPC |
| 057 | notifications: table + RLS + Realtime + triggers (friend request/accept, community event fan-out) |

### Sessions completed
| Session | Branch | Status |
|---|---|---|
| 1 — Foundation | session-1-foundation | Merged |
| 2 — Connect + Speed Dating | session-2-connect | Merged |
| 3 — Discover + Build + Grow | session-3-discover-build | Merged |
| 4 — AI Safety + Gamification | session-4-ai-safety | Merged |
| 5 — Profile, Settings, GDPR, EAS, CI | session-5-deploy | Merged |
| 6 — Polish: Roxy Chat, host flow, tab layouts, dev seed | session-6-polish | Merged |
| 7 — UX Fixes: FAB, keyboard, Grow screen, badges, delete account | session-6-polish | Merged |
| 8 — Community feed: post cards, post detail, flat comments | session-8-community | Merged |
| 9 — Friends system: friendStore, People screen, Grow badge | session-9-friends | Open |
| 10 — Presence + tap-to-chat: online dots, sortByPresence, DM | session-9-friends | Open |
| 11 — Firebase Analytics + Crashlytics → migrating to Sentry + PostHog | session-11-firebase | Open |
| 12 — Community Studio + Stripe: apps/studio, Stripe Connect | session-12-stripe-studio | Open |
| 13 — Content feed v2: FeedStore, FeedCards, VideoPlayer, PostDetail, CreatePost, Cloudflare Stream | session-13-content-feed | Open (PR #19) |
| 14–18 — Marketplace, chat overhaul, rooms v2, business approval, Support voting, product photos | various | Merged (see .claude/log.md) |
| 19 — UX coherence revamp per Claude Design handoff + streaks + notifications | session-19-ux-coherence | Open (PR #1 on naaxtech/roxy-client) |

### Key commands
```bash
# Tests (from apps/mobile/)
cd apps/mobile && npx jest --ci --passWithNoTests   # 288 tests expected

# Web preview
preview_start "Expo Web"   # via Claude preview tool

# Database
npx supabase db push
npx supabase status

# Secrets (remote edge functions)
npx supabase secrets set KEY=value --project-ref ptymtdlysqbpxzlgsshp
# Local dev secrets: supabase/functions/.env (gitignored, auto-loaded by supabase functions serve)

# PR
gh pr create --base main --title "..." --body "..."

# EAS (from apps/mobile/ — where eas.json lives)
cd apps/mobile && eas init                                          # link to Expo project (one-time)
cd apps/mobile && eas build --profile development --platform ios    # dev build (simulator)
cd apps/mobile && eas build --profile development --platform android # dev build (APK)
cd apps/mobile && eas build --profile production                    # production build
```

---

## 6. ARCHITECTURE DECISIONS — FINAL, DO NOT RELITIGATE

1. **Zero-churn architecture** — dating is opt-in, community is primary. This is the product.
2. **Supabase Realtime** — Broadcast for ephemeral events (typing, presence). Filtered Postgres Changes for persistent state. Never table-wide listeners.
3. **AI rate limits** — server-side only. Never trust client-side logic.
4. **Roxy is a wingwoman** — never "AI", "assistant", or "chatbot" in any user-facing string.
5. **Dating mode off by default** — users opt in explicitly.
6. **pgBouncer Transaction mode** — required before public launch.
7. **EAS Build** — no Expo Go in production.
8. **All secrets in environment variables** — never hardcoded.
9. **Daily.co guarded import** — never module-level import. Use `isDailyAvailable()`. See anti-patterns.
10. **claude-haiku-4-5-20251001** for edge function AI calls. claude-sonnet-4-6 for complex tasks only.
11. **Observability** — Sentry + PostHog via shared `@roxy/observability` package. Never raw Sentry/PostHog calls from components.
12. **PII masking** — non-negotiable. Strip before any log call. See observability rules.

---

## 7. EDGE FUNCTION CONVENTIONS

All edge functions in `supabase/functions/<name>/index.ts`:

```ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';  // NOT getAuthUser
import { checkRateLimit, logAiCall } from '../_shared/rateLimit.ts';
import { callClaude } from '../_shared/claude.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

// Standard execution order:
// 1. handleCors → 2. verifyJWT (401) → 3. parse body → 4. DEV_MOCK declaration
// 5. checkRateLimit → 6. if (DEV_MOCK) return mock → 7. getSupabaseClient() → 8. logic
const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;
// DEV_MOCK must be declared BEFORE any DB calls
// if (DEV_MOCK) return goes AFTER checkRateLimit (rate limiting runs in dev too)
```

- **AI model:** `claude-haiku-4-5-20251001`
- **Rate limit windowTypes:** `'daily'` | `'lifetime'` | `'conversation'`
- **All mobile calls:** via `callEdgeFunction()` in `apps/mobile/lib/supabase.ts`

---

## 8. AI TOUCHPOINTS & RATE LIMITS

| Touchpoint | Input / Output tokens | Rate limit rule |
|---|---|---|
| Daily Greeting Card | 1,000 / 80 | Cache 24h — never regenerate same day |
| Icebreaker | 1,400 / 100 | Once per match lifetime |
| Conversation Nudge | 1,900 / 120 | Hard limit: 3 per chat lifetime |
| Wingwoman Suggestion | 2,300 / 200 | HARD LIMIT: 5 per conversation per day |
| Ghosting Exit | 1,900 / 100 | One-time at conversation end |
| Speed Date Prompt | 60 / 25 | Generate once, share all participants |
| Sister Button (per turn) | 1,650 / 200 | Cap 10 turns; surface pro directory after |
| Onboarding Recs | 900 / 300 | Once per user lifetime |

**Critic gate:** Every AI output scored 1-10. Block < 7. Regenerate max 2x. Discard + log on third failure.

---

## 9. FOUR-TAB NAVIGATION

| Tab | Name | What lives here |
|---|---|---|
| 1 | GROW | Roxy Greeting Card (Zone 1), Communities (Zone 2), People (Zone 3), Progress/badges (Zone 4), Roxy Chat Bar persistent (Zone 5) |
| 2 | DISCOVER | TikTok-style FYP feed, events, games, New to the City mode |
| 3 | CONNECT | Active chats + wingwoman, Speed Dating, matched connections, Sister Button |
| 4 | BUILD | WLW business directory, impact projects, brand partners, community organiser tools |

Dating is a **mode** that activates contextually in Discover and Connect when `is_dating_mode = true`.

---

## 10. OBSERVABILITY RULES

All apps use `@roxy/observability` package. Raw Sentry/PostHog calls from components are banned.

**PII tiers:**

NEVER LOG (strip completely):
- email, phone, display_name, username, bio
- identity_labels, pronouns, dating_looking_for
- location city/country, avatar_url, message content, post content

LOG ANONYMISED (hash to 8-char hex before logging):
- user_id → `hashUserId(userId)` before any log call

SAFE TO LOG:
- Screen names, navigation events, action types
- Error codes (not messages if they contain user data)
- Media state (camera_on, mic_failed) — no user IDs attached
- Counts, feature flags, A/B variants, performance timings

**Always/never rules for observability:**
```
ALWAYS:
  Use ObservabilityService.log() — never console.log in production code
  Use ObservabilityService.trackMediaState() for all Daily.co events (debounced 2s)
  Wrap every screen rendering user content in <RoxyErrorBoundary>
  Call ObservabilityService.initialize() inside root App() useEffect, never at module scope
  Run PostHog session replay audit after every new screen

NEVER:
  Call Sentry or PostHog directly from a component
  Log a raw user object, email, or any PII tier-1 field
  Log message content or post content
```

---

## 11. BRAINSTORMING STANDARDS CHECKLIST

Every spec produced during brainstorming must explicitly address these before implementation:

**Industry & Enterprise Standards:**
- Loading states on all async operations (disabled buttons, spinners, skeletons)
- Error boundaries / fallback UI for unexpected server errors
- Optimistic UI with rollback for write operations
- Accessibility: all inputs labeled, icon buttons have `aria-label`, keyboard-navigable
- No PII or internal IDs in client-visible error messages

**OWASP Security:**
- A01 Broken Access Control: RLS on all new tables; user identity from JWT, never client input
- A03 Injection: all DB access via parameterized queries — no raw SQL interpolation
- A05 Misconfiguration: RLS explicitly enabled; no table publicly writable by default
- A07 Auth Failures: server-side session guard before any data fetch; logout clears session
- Input validation: length limits + format rules at both client AND DB (CHECK constraints in migration)

**Testing (every feature must list):**
- Unit tests: per component/function — happy path, error path, edge cases
- Integration tests: end-to-end flows (auth redirect, data save/load, RLS enforcement)
- Migration tests: verify RLS policies allow/deny correct roles; CHECK constraints reject bad data

---

## 12. ANTI-PATTERNS — READ BEFORE EVERY SESSION

### 1. Bash subagents cannot write files
`cat >`, `printf >`, heredoc redirects silently fail in subagent context.
**Fix:** Use `Write` and `Edit` tools directly in main conversation. Always.

### 2. Jest `jest.mock()` hoisting
Variables declared before `jest.mock()` are undefined inside the factory.
```ts
// WRONG
const mockChannel = jest.fn();
jest.mock('../../lib/supabase', () => ({ supabase: { channel: mockChannel } })); // undefined!

// CORRECT — inline factory, use jest.requireMock() for assertions
jest.mock('../../lib/supabase', () => ({
  supabase: { channel: jest.fn(() => ({ on: jest.fn(() => ({ subscribe: jest.fn() })) })) }
}));
const { supabase } = jest.requireMock('../../lib/supabase');
```

### 3. Daily.co guarded import
Never import `@daily-co/react-native-daily-js` at module level — crashes Expo Go.
```ts
// CORRECT — in lib/daily.ts
let DailyIframe: any = null;
try {
  const mod = require('@daily-co/react-native-daily-js');
  DailyIframe = mod.default ?? mod.DailyIframe ?? null;
} catch {}
export const isDailyAvailable = () => DailyIframe !== null;
// Always check isDailyAvailable() before rendering any video component.
```

### 4. Expo web peer deps
Web bundling requires: `npm install expo-status-bar@~1.12.1 expo-linking expo-constants expo-font expo-asset --legacy-peer-deps`
If bundling fails with `"unable to resolve expo-*"` — run this.

### 5. Component/type name collision
```ts
// CRASH — SpeedDateSession used as both type and component name
import { SpeedDateSession } from '../../../../types';
export default function SpeedDateSession() { ... }

// CORRECT — alias the type
import type { SpeedDateSession as SpeedDateSessionData } from '../../../../types';
export default function SpeedDateSession() { ... }
```

### 6. Supabase Realtime mock chain
The mock must return a complete chain:
```ts
supabase: {
  channel: jest.fn(() => ({
    on: jest.fn(() => ({
      subscribe: jest.fn((cb) => { cb('SUBSCRIBED'); return {}; })
    }))
  })),
  removeChannel: jest.fn(),
}
```

### 7. Daily.co Metro web bundling
`@daily-co/react-native-daily-js` can't resolve on web. Already fixed in `metro.config.js`.
Adding new native-only packages that crash web: add to the `platform === 'web'` block in metro.config.js.

### 8. ObservabilityService module scope init
Never call `ObservabilityService.initialize()` at module scope.
**Fix:** Always call inside `App()` useEffect or root component body.

### 9. Daily.co event flooding
`participantUpdated` fires ~10x/second. Never raw-capture these events.
**Fix:** Always use `ObservabilityService.trackMediaState()` which debounces at 2s.

### 10. tsc not run before task completion
TypeScript errors caught at build, not development.
**Fix:** Always run `tsc --noEmit` as the last step before declaring any task done.

### 11. DEV_MOCK declared after DB calls in edge function
`checkRateLimit` is a DB call. DEV_MOCK must be declared before it, not after.
**Fix:** Declare DEV_MOCK immediately after body parse, before any DB operations. See section 7 for correct order.

### 12. Shared observability package tsconfig paths
New monorepo packages won't resolve without tsconfig path aliases in each app.
**Fix:** Add `paths: { "@roxy/observability": ["../../packages/observability/src"] }` to each app's tsconfig.json after adding a new package.

---

## 13. SESSION OPERATING RULES

### On session start (every time):
1. Read this file (CLAUDE.md) — done automatically by Claude Code
2. Read `.claude/log.md` — last 5 entries show where you were
3. Read `.claude/mistakes.md` — do not repeat anything listed there
4. Read `.claude/decisions.md` — do not relitigate anything listed there
5. State: "Session restored. Last state: [summary from log]. Ready."

### On session end / after every meaningful action:
Append to `.claude/log.md`:
```
[TIMESTAMP] [APP: client|studio|staff] [ACTION] [OUTCOME] [FILES_CHANGED]
```

### On encountering and resolving an error:
Append to `.claude/mistakes.md`:
```
[MISTAKE] What went wrong
[ROOT CAUSE] Why it happened
[FIX] What resolved it
[PREVENTION] What to check first next time
```

### On making an architectural decision:
Append to `.claude/decisions.md`:
```
[DECISION] What was decided
[REASON] Why
[ALTERNATIVES REJECTED] What else was considered
[REVISIT CONDITION] Only if [X]
```

### On session crash / unexpected close:
Next session: read log.md, state last known state, continue from there.
Never ask "where were we?" — read the log and state it.

---

## 14. TOKEN CONSERVATION RULES

Tokens are money. These rules are enforced every session:

**Before writing any code:**
- Check if the file already exists before creating it
- Check `package.json` before installing any package
- Never re-read a file already read this session unless it changed

**When writing code:**
- Write complete implementations — never `// TODO` or `// implement this`
- Never write the same utility twice across apps — put it in `packages/`
- If a pattern repeats 2+ times, extract it. Do not copy-paste.
- Maximum one clarifying question per task. Make reasonable assumptions and state them.

**When making changes:**
- Show a diff summary before applying on large changes
- Never rewrite a file that only needs a 3-line change
- Batch related changes into one operation

---

## 15. THE QA LOOP — MANDATORY BEFORE ANY PR

Every feature is not done until this loop completes with zero failures:

```
WRITE → LINT → TSC → TEST → REVIEW → DONE
  │        │      │       │       │
  │        └──────┴───────┘       │
  │         if any fail: fix      │
  └───────────────────────────────┘
         loop until all pass
```

**Step by step:**
```bash
# Step 1: Lint (from apps/mobile/ or apps/studio/)
npx eslint . --ext .ts,.tsx --max-warnings 0

# Step 2: TypeScript (zero errors required)
npx tsc --noEmit

# Step 3: Tests
cd apps/mobile && npx jest --ci --passWithNoTests
# Expected: 54+ tests passing, 0 failing

# Step 4: Build check (catches bundler errors)
expo export --platform web --output-dir /tmp/build-check

# Step 5: Review checklist
# [ ] RLS enabled on all new tables
# [ ] Secrets in env vars, none hardcoded
# [ ] No PII logged
# [ ] All async operations have loading states
# [ ] All new screens wrapped in <RoxyErrorBoundary>
# [ ] tsc --noEmit passes
# [ ] jest passes
# [ ] No console.log in production code
# [ ] Daily.co imports guarded
# [ ] Migration file created if schema changed (next: 022)
```

**Claude Code self-enforces this loop.** If lint fails: fix, re-lint. If tsc fails: fix, re-run tsc. If tests fail: fix, re-run tests. Do not proceed to PR until all pass. State "QA loop complete: lint ✓ tsc ✓ jest ✓ build ✓" before creating PR.

---

## 16. SUBSCRIPTION TIERS — FOR FEATURE GATING

| Tier | Monthly | Key features |
|---|---|---|
| Free | $0 | Community access · Roxy AI limited 3 calls/day |
| Plus | $4.99 | Full Roxy wingwoman AI |
| Pro | $9.99 | Full Roxy + priority speed dating + analytics |
| Super | $14.99 | All features + Sister Button pro |

Free tier AI hard limit: 3 calls/day, server-side enforced.

---

## 17. DATA PIPELINE — EMOTIONAL AI TRAINING DATA

Log and preserve (required for Thinqer's second product):
- Message sentiment, reaction types, ghosting patterns, response latency, re-engagement triggers
- Match outcomes, community participation, friend formation, event attendance
- Feature usage sequences, session patterns, content preferences, game outcomes
- Emotional incongruence signals from conversation patterns

Schema rules for training-relevant tables:
- Flat schema, typed columns — no deeply nested JSON blobs
- All interaction events evaluated for training data value before treating as ephemeral
- Consent architecture (ToS + privacy policy) covers AI training use from day one

---

## 18. REALTIME RULES

```ts
// CORRECT — filtered subscription
supabase
  .channel('user-messages')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'messages',
    filter: `conversation_id=eq.${conversationId}`
  }, handleNewMessage)
  .subscribe()

// WRONG — never do this
supabase
  .channel('all-messages')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, handler)
  .subscribe()
```

- Broadcast for ephemeral events (typing indicators, presence)
- Filtered Postgres Changes for persistent state (messages, match status)
- Every subscription filtered by `user_id` — no table-wide listeners
- `useRealtime` hook owns Supabase Realtime channel lifecycle + deduplication
- `connectStore` (Zustand) owns conversation list + unread counts

---

*CLAUDE.md v3.0 · Roxy by Thinqer · Three-app monorepo · Maintained by Nicole Claire Marie A. Azachee*
*This file is read automatically by Claude Code at every session start.*
*Last updated: Session 19 (UX coherence revamp + streaks + notifications). Pending: human-approved `npx supabase db push` for migrations 056–057; deferred backlog in docs/superpowers/specs/2026-07-18-ux-coherence-revamp-design.md (game creation flow, discover/→play/ folder rename).*
