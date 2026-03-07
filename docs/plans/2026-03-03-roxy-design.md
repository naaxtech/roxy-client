# Roxy — Build Design Document
**Date:** 2026-03-03
**Approach:** Vertical User Journey Slices (Approach B)
**Platform:** iOS + Android simultaneously (Expo Go dev, EAS builds)
**Backend:** Real Supabase + Anthropic API from day one

---

## Architecture

| Layer | Choice |
|---|---|
| Frontend | React Native + Expo SDK 51 + Expo Router v3 |
| Backend | Supabase (Postgres + Auth + Realtime + Storage + Edge Functions) |
| AI | `claude-haiku-4-5-20251001` (cheapest, server-side only) |
| Video | Daily.co (speed dating + Sister Button) |
| State | Zustand |
| Lists | FlashList |
| Push | Expo Notifications + OneSignal |

### Non-negotiable architecture rules
1. Claude API always called server-side via Supabase Edge Functions (Deno). Never from client.
2. RLS on every table from migration 1. Policies written alongside each migration.
3. Speed dating prompts batch-generated weekly by cron → stored in DB → zero AI calls during gameplay.
4. Auth: passwordless only — magic link, Apple Sign In, Google Sign In.
5. Monorepo: `roxy-client/apps/mobile/` + `roxy-client/supabase/`.

---

## Session Breakdown

### Session 1 — Foundation
**Delivers:** App opens → auth → onboarding → Grow tab (greeting card live)

- Monorepo scaffold with all configs, deps, `.env.example`, `.gitignore`
- **Migration 001:** `profiles`, `roxy_greetings`, `dev_config` tables + RLS + indexes + triggers
- **Edge Functions:** `roxy-greeting` (1/day cache), `dev-control`, `_shared/` utilities
- Auth screens: welcome, magic link flow, Apple/Google sign-in
- Onboarding: 4 steps (identity, interests, photo → Supabase Storage, status)
- Auth guard in `app/_layout.tsx`
- Grow tab zone 1: Roxy greeting card (real AI, cached)
- Grow tab zones 2–4: placeholder (wired in Session 3)
- Zustand: `authStore`, `profileStore`
- Dev cost guardrails (see below)

### Session 2 — Connect Tab + Speed Dating Game
**Delivers:** DMs end-to-end. Speed dating fully playable with Daily.co + Roxy overlay.

- **Migration 002:** `communities`, `community_members`, `friendships`
- **Migration 003:** `conversations`, `messages`, `speed_date_sessions`, `matches`
- **Edge Functions:** `roxy-icebreaker`, `roxy-wingwoman`
- Connect tab: conversation list (real data, sorted by `last_message_at`)
- Chat `[id].tsx`: FlashList, wingwoman wand button, Roxy suggestion bubbles, read receipts
- Icebreaker banner on new conversations
- Realtime: message subscription, unread badge on tab icon
- Speed Dating: lobby screen, in-session screen (Daily.co video + Roxy prompt overlay), post-session screen
- Dating mode toggle in Connect header
- `useRealtime` hook

### Session 3 — Discover Tab + Build Tab
**Delivers:** Feed browsable, events RSVPable, business directory live.

- **Migration 004:** `posts`, `events`
- **Migration 005:** `businesses`, `impact_projects`
- **Edge Function:** `roxy-onboarding`
- Discover tab: Feed (FlashList, reactions, comments) + Events (list + calendar, RSVP)
- Dating cards interspersed in feed every 8 posts (when dating mode active)
- Community discovery section at bottom of feed
- Build tab: Business Directory (grid, search, filter) + Impact Projects + submission forms
- Grow tab zones 2–4 wired with real data (communities, people, progress)

### Session 4 — Roxy AI Complete + Gamification + Safety
**Delivers:** All AI features live. Badges award on actions. Block/report/moderation working.

- **Migration 006:** `badges`, `user_badge_progress`, `reports`, `blocked_users`
- **Edge Functions:** `roxy-nudge`, `roxy-sister`, `content-moderation`, `send-notification`
- Sister Button: lavender UI, turn counter 1–10, professional directory at turn 10, emergency button
- Roxy nudge: 48h silence detection, 3-lifetime limit per conversation
- Badge granting: PL/pgSQL `grant_badge_if_earned()` + triggers
- Content moderation on post CREATE and bio save
- Block: silent, bidirectional RLS filter
- Report: reason picker, auto-offer to block, confirmation
- Ghost mode
- Safe messaging: 24h new-user DM restriction, message requests inbox
- Push notifications via OneSignal

### Session 5 — Profile, Settings, GDPR & Deploy
**Delivers:** Fully shippable app. EAS builds configured. Production Supabase ready.

- Profile screen: own + others, edit form, avatar, badge grid, stats
- Settings: account, privacy, notifications, safety, about, sign out
- GDPR: soft delete → 30-day grace → hard delete cascade, data export JSON
- `eas.json`: preview + production profiles
- CI: `.github/workflows/ci.yml` (lint → unit → edge fn test → expo export)
- Full pre-launch checklist verification

---

## Speed Dating Game — Detail

### Data flow
```
Weekly cron job (Supabase scheduled function)
  → calls claude-haiku-4-5-20251001 once per upcoming session
  → generates 10 prompts
  → stores in speed_date_sessions.prompts[]
  → zero AI calls during gameplay
```

### AI prompt for batch generation
```
You are Roxy, WLW AI wingwoman. Generate 10 conversation starter prompts
for a 5-minute speed date between two WLW users. Prompts should be:
- Light, fun, and emotionally interesting (not small talk)
- Queer-affirming and inclusive
- Varied: one nostalgic, one future-focused, one playful, one values-based
Return a JSON array of 10 strings. No markdown.
```

### In-session screen layout
```
┌─────────────────────────────────┐
│  TIMER BAR  [2:47 remaining]    │  ← orange progress bar, green→yellow→red
├─────────────────────────────────┤
│                                 │
│     Daily.co DailyVideo         │  ← full-width remote video
│                                 │
│  ┌─────────────────────────┐    │
│  │ 💬 Roxy prompt overlay  │    │  ← semi-transparent rgba(0,0,0,0.65)
│  │  "What's a place that   │    │     draggable via Reanimated pan gesture
│  │   changed how you see   │    │     minimisable to small Roxy icon
│  │   yourself?"            │    │
│  │           [Next →]      │    │
│  └─────────────────────────┘    │
│                                 │
├─────────────────────────────────┤
│  [your camera — small pip]  [❤️]│
└─────────────────────────────────┘
```

### Post-session
- Mutual like → match created + conversation + `roxy-icebreaker` fires + push notification
- One/neither liked → "Keep exploring" → back to lobby

---

## Dev Cost Guardrails

### Two-layer kill switch

**Layer 1 — `dev_config` table (dev Supabase only)**
```sql
CREATE TABLE dev_config (
  key   text PRIMARY KEY,
  value text NOT NULL
);
-- Seeded in dev only:
INSERT INTO dev_config VALUES ('ai_enabled', 'false');
```
All AI edge functions: `SELECT value FROM dev_config WHERE key = 'ai_enabled'`. If `'false'` → return mock. Prod DB has no row → AI runs normally.

Toggle: `supabase secrets set ROXY_AI_ENABLED=false` or via dev panel toggle → `dev-control` edge function.

**Layer 2 — Client-side dev panel (`__DEV__` only)**

Floating `DEV` button (bottom-left, hot pink, only in Expo Go / dev builds). Opens panel:

```
┌─────────────────────────────┐
│  🛠  ROXY DEV PANEL          │
│  AI Calls   [PAUSED ⏸]      │  ← toggle → calls dev-control edge fn
│  greeting   0 calls today   │
│  icebreaker 0 calls today   │
│  wingwoman  0 calls today   │
│  nudge      0 calls today   │
│  sister     0 calls today   │
│  onboarding 0 calls total   │
│  [Reset all counters]       │
│  [Clear greeting cache]     │
│  [Seed test session]        │
└─────────────────────────────┘
```

"Seed test session" inserts a `speed_date_sessions` row with static prompts + `scheduled_at = now() + 2min` for full speed dating flow testing without real AI.

**Mock responses when paused:**

| Function | Mock |
|---|---|
| `roxy-greeting` | `"Hey {name} — Roxy here. (dev: AI paused)"` |
| `roxy-icebreaker` | `"What's a skill you've been wanting to learn?"` |
| `roxy-wingwoman` | `"That sounds really interesting — tell me more!"` |
| `roxy-nudge` | `"Hey, how's your week going?"` |
| `roxy-sister` | `"I hear you. (dev: AI paused)"` |
| Speed date prompts | 10 static hardcoded strings from a const array |

---

## AI Cost Controls (Production)

| Call | Limit | Enforcement |
|---|---|---|
| Greeting card | 1/user/day | `roxy_greetings` UNIQUE(user_id, generated_date) |
| Icebreaker | 1/conversation lifetime | DB check before calling Claude |
| Nudge | 3/conversation lifetime | `conversations.roxy_nudge_count` |
| Wingwoman | 5/conversation/day | `conversations.roxy_wingwoman_count_today` |
| Sister Button | 10 turns then directory | `turn_count` check in edge fn, no Claude call at ≥10 |
| Speed date prompts | Batch weekly via cron | Stored in DB, zero calls per session |

---

## File Structure (Target)

```
roxy-client/
├── apps/
│   └── mobile/
│       ├── app/
│       │   ├── (auth)/
│       │   │   ├── welcome.tsx
│       │   │   ├── login.tsx
│       │   │   └── onboarding/
│       │   │       ├── step1-identity.tsx
│       │   │       ├── step2-interests.tsx
│       │   │       ├── step3-photo.tsx
│       │   │       └── step4-status.tsx
│       │   ├── (tabs)/
│       │   │   ├── _layout.tsx
│       │   │   ├── grow/index.tsx
│       │   │   ├── discover/index.tsx
│       │   │   ├── connect/
│       │   │   │   ├── index.tsx
│       │   │   │   ├── chat/[id].tsx
│       │   │   │   ├── speed-dating/
│       │   │   │   │   ├── index.tsx     (lobby)
│       │   │   │   │   ├── session.tsx   (in-game)
│       │   │   │   │   └── result.tsx    (post-game)
│       │   │   │   └── sister-button/index.tsx
│       │   │   └── build/index.tsx
│       │   └── _layout.tsx
│       ├── components/
│       │   ├── ui/
│       │   │   ├── Button.tsx
│       │   │   ├── Card.tsx
│       │   │   ├── Avatar.tsx
│       │   │   ├── Badge.tsx
│       │   │   └── RoxyChat.tsx
│       │   └── dev/
│       │       └── DevPanel.tsx          (DEV only)
│       ├── hooks/
│       │   ├── useAuth.ts
│       │   ├── useRoxy.ts
│       │   ├── useRealtime.ts
│       │   └── useProfile.ts
│       ├── lib/
│       │   ├── supabase.ts
│       │   ├── daily.ts
│       │   └── constants.ts
│       ├── store/
│       │   ├── authStore.ts
│       │   ├── profileStore.ts
│       │   └── roxyChatStore.ts
│       └── types/index.ts
├── supabase/
│   ├── migrations/
│   │   ├── 001_core_identity.sql
│   │   ├── 002_communities_social.sql
│   │   ├── 003_connect_dating.sql
│   │   ├── 004_content_feed.sql
│   │   ├── 005_build_tab.sql
│   │   └── 006_gamification_safety.sql
│   ├── functions/
│   │   ├── _shared/
│   │   │   ├── cors.ts
│   │   │   ├── auth.ts
│   │   │   ├── claude.ts
│   │   │   ├── rateLimit.ts
│   │   │   └── errorHandler.ts
│   │   ├── dev-control/index.ts
│   │   ├── roxy-greeting/index.ts
│   │   ├── roxy-icebreaker/index.ts
│   │   ├── roxy-nudge/index.ts
│   │   ├── roxy-wingwoman/index.ts
│   │   ├── roxy-sister/index.ts
│   │   ├── roxy-onboarding/index.ts
│   │   ├── content-moderation/index.ts
│   │   ├── send-notification/index.ts
│   │   └── speed-date-prompts/index.ts  (weekly cron)
│   └── seed.sql
├── docs/
│   └── plans/
│       └── 2026-03-03-roxy-design.md
├── .env.example
├── .gitignore
└── README.md
```
