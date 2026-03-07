# Roxy — Claude Code Context

## Project

Queer women / WLW social + dating app. Monorepo:
- `apps/mobile/` — Expo 51, Expo Router v3, React Native 0.74, TypeScript strict
- `supabase/` — Postgres migrations + Deno edge functions

**Branch convention:** `session-N-<slug>` → PR to `main`

---

## Stack

| Layer | Technology |
|---|---|
| Mobile | Expo 51, Expo Router v3, React Native 0.74 |
| State | Zustand (`authStore`, `profileStore`, `roxyChatStore`, `connectStore`) |
| Backend | Supabase (Postgres + Auth + Realtime + Edge Functions) |
| AI | Claude Haiku (`claude-haiku-4-5-20251001`) via Deno edge functions |
| Video | `@daily-co/react-native-daily-js` (guarded import — see anti-patterns) |
| Lists | `@shopify/flash-list` |
| Dates | `date-fns` |

---

## Commands

```bash
# Tests (run from apps/mobile/)
cd apps/mobile && npx jest --ci --passWithNoTests        # 34 tests expected

# Web preview
preview_start "Expo Web"                                  # via Claude preview tool

# Database
npx supabase db push                                      # push migrations to remote
npx supabase status                                       # check local status

# PR
gh pr create --base main --title "..." --body "..."
```

---

## Edge Function Conventions

All edge functions in `supabase/functions/<name>/index.ts`:

```ts
// Shared utilities — always use these, never re-implement
import { getAuthUser } from '../_shared/auth.ts';
import { checkRateLimit, logAiCall } from '../_shared/rateLimit.ts';
import { callClaude } from '../_shared/claude.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { errorResponse } from '../_shared/errorHandler.ts';

// Dev guard — always check before calling Claude
const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;
```

- **AI model:** `claude-haiku-4-5-20251001`
- **Rate limit windowTypes:** `'daily'` | `'lifetime'` | `'conversation'`
- **All mobile calls:** through `callEdgeFunction()` in `apps/mobile/lib/supabase.ts`

---

## Architecture Decisions

- Rate limiting: `_shared/rateLimit.ts` — `checkRateLimit` + `logAiCall`. Extended with `conversation` windowType for per-conversation lifetime limits (requires `conversationId` param).
- `connectStore` (Zustand) owns conversation list + unread counts
- `useRealtime` hook owns Supabase Realtime channel lifecycle + deduplication
- Daily.co video guarded behind `isDailyAvailable()` — see `apps/mobile/lib/daily.ts`
- DevPanel (shake gesture in dev) for seeding test data

---

## Anti-Patterns — Read Before Every Session

### 1. Bash subagents cannot write files
`cat >`, `printf >`, heredoc redirects — all silently fail or get denied in subagent context.

**Fix:** Use `Write` and `Edit` tools directly in the main conversation. Always.

---

### 2. Jest `jest.mock()` hoisting

Variables declared **before** `jest.mock()` are `undefined` inside the factory — Babel hoists the `jest.mock()` call above all variable declarations.

```ts
// ❌ WRONG — mockChannel is undefined inside the factory
const mockChannel = jest.fn();
jest.mock('../../lib/supabase', () => ({
  supabase: { channel: mockChannel }  // undefined!
}));

// ✅ CORRECT — inline factory, use jest.requireMock() for assertions
jest.mock('../../lib/supabase', () => ({
  supabase: {
    channel: jest.fn(() => ({
      on: jest.fn(() => ({ subscribe: jest.fn() }))
    }))
  }
}));
// Inside the test:
const { supabase } = jest.requireMock('../../lib/supabase');
```

---

### 3. Daily.co guarded import

**Never** `import` from `@daily-co/react-native-daily-js` at module level — crashes Expo Go.

```ts
// ✅ CORRECT — guarded require in lib/daily.ts
let DailyIframe: any = null;
try {
  const mod = require('@daily-co/react-native-daily-js');
  DailyIframe = mod.default ?? mod.DailyIframe ?? null;
} catch {}

export const isDailyAvailable = () => DailyIframe !== null;
```

Always check `isDailyAvailable()` before rendering any video component.

---

### 4. Expo web peer deps

Web bundling (`expo start --web`) requires these packages — they're not installed by default:

```bash
npm install expo-status-bar@~1.12.1 expo-linking expo-constants expo-font expo-asset --legacy-peer-deps
```

If bundling fails with `"unable to resolve expo-*"` — run the above.

---

### 5. Component/type name collision

If a component function name matches an imported type name, Babel throws `"Duplicate declaration"`.

```ts
// ❌ CRASH — SpeedDateSession used as both type and component name
import { SpeedDateSession } from '../../../../types';
export default function SpeedDateSession() { ... }

// ✅ CORRECT — alias the type
import type { SpeedDateSession as SpeedDateSessionData } from '../../../../types';
export default function SpeedDateSession() { ... }
```

---

### 6. Supabase Realtime mock chain

The mock must return a complete chain. Missing any level causes `"X is not a function"`:

```ts
// ✅ Full chain: channel() → on() → subscribe()
supabase: {
  channel: jest.fn(() => ({
    on: jest.fn(() => ({
      subscribe: jest.fn((cb) => { cb('SUBSCRIBED'); return {}; })
    }))
  })),
  removeChannel: jest.fn(),
}
```

---

## Migrations Completed

| File | Contents |
|---|---|
| `001_core_identity.sql` | profiles, roxy_greetings, dev_config, ai_call_log |
| `002_storage_buckets.sql` | avatars storage bucket + RLS |
| `003_communities_social.sql` | communities, community_members, friendships |
| `004_connect_dating.sql` | conversations, messages, speed_date_sessions, matches |

**Next migration number: 005**

## Sessions Completed

| Session | Branch | PR | Status |
|---|---|---|---|
| 1 — Foundation | `session-1-foundation` | #1 | Merged |
| 2 — Connect + Speed Dating | `session-2-connect` | #2 | Open |
