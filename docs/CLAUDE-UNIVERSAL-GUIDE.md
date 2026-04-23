# Claude Code Universal Operating Guide
## Stack-aware operating manual for any project, any stack

---

## 0. PURPOSE

This guide teaches Claude Code how to operate on any project — not just Roxy. It begins with a stack detection protocol that loads the right playbook, then provides universal rules that apply regardless of technology. Every rule here was earned from a real mistake or hard-won lesson. Nothing is theoretical.

**Companion documents:**
- `docs/CLAUDE-PROCESS-FLOWS.md` — Roxy-specific flows (use this for Roxy sessions)
- This file — universal reasoning, stack detection, generalised rules

---

## 1. STACK DETECTION PROTOCOL

**Run this at every session start, before reading any other context.**

### Step 1 — Collect signals

Read these files in parallel (they may not all exist):

| File | What it tells you |
|---|---|
| `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` | Owner-declared stack, locked decisions, operating rules |
| `package.json` (root) | JavaScript/TypeScript framework, runtime, tooling |
| `apps/*/package.json` | Monorepo — identify each app's stack separately |
| `pyproject.toml` / `requirements.txt` | Python project |
| `Cargo.toml` | Rust project |
| `go.mod` | Go project |
| `pubspec.yaml` | Flutter/Dart |
| `composer.json` | PHP |
| `supabase/config.toml` | Supabase backend present |
| `netlify.toml` / `vercel.json` | Deployment platform |
| `.env.example` | Service dependencies (DB, auth, payments, AI providers) |

### Step 2 — Identify the stack

From the signals above, answer these questions:

```
FRONTEND:    React / Next.js / Vue / Nuxt / SvelteKit / Remix / Expo / Flutter / plain HTML
BACKEND:     Supabase / Firebase / Node/Express / Django / FastAPI / Rails / Laravel / Go / Rust
RUNTIME:     Node.js / Deno / Bun / Python / JVM / WASM
DEPLOYMENT:  Vercel / Netlify / AWS / GCP / Fly.io / Railway / self-hosted
PAYMENTS:    Stripe / LemonSqueezy / Paddle / none
AI PROVIDER: Anthropic / OpenAI / Gemini / Ollama / none
MONOREPO:    Turborepo / Nx / pnpm workspaces / yarn workspaces / single-repo
```

### Step 3 — Load the matching playbook

| Detected stack | Playbook section to activate |
|---|---|
| Next.js + Supabase | Section 3A (default web stack) |
| Next.js + other backend | Section 3A minus Supabase-specific rules |
| Expo + Supabase | Roxy CLAUDE.md + CLAUDE-PROCESS-FLOWS.md |
| Pure Node.js API | Section 3B |
| Python (FastAPI / Django) | Section 3C |
| Any stack | Section 4 (universal rules — always active) |

### Step 4 — State what you found

Output one sentence before doing anything:

```
Stack detected: Next.js 14 App Router + Supabase + Vercel. Loading Next.js/Supabase playbook.
```

If CLAUDE.md is present and contradicts what `package.json` says, **CLAUDE.md wins**. Owner-declared stack is authoritative.

---

## 2. SESSION START — UNIVERSAL

After stack detection, always:

```
1. Read CLAUDE.md / project instruction file if present
2. Read .claude/log.md — last 5 entries show where you left off
3. Read .claude/mistakes.md — do not repeat listed errors
4. Read .claude/decisions.md — do not relitigate listed decisions
5. State: "Session restored. Last state: [1-sentence summary]. Ready."
```

If none of those `.claude/` files exist: start fresh, do not create them unless you have something to write.

**Never ask "where were we?" — the log answers that.** If it doesn't exist, say so and ask.

---

## 3A. PLAYBOOK — NEXT.JS + SUPABASE (DEFAULT WEB STACK)

Nicole has standardised all web apps on this stack. When you detect Next.js + Supabase, these rules are active.

### App Router fundamentals

```
Server Component   → can be async, can call DB/server directly, no hooks, no event handlers
Client Component   → "use client" at top, hooks allowed, event handlers allowed, no direct DB
Server Action      → "use server" exported function, called from Client Components for mutations
Route Handler      → app/api/route.ts, for webhooks and third-party callbacks
Middleware         → middleware.ts at root, runs on Edge before every request
```

**Decision rule:** Default to Server Component. Add `"use client"` only when you need hooks, event handlers, or browser APIs. Never add it preemptively.

### Data fetching pattern

```ts
// Server Component — fetch directly
async function Page() {
  const supabase = createServerClient(cookies());
  const { data } = await supabase.from('table').select('*');
  return <Component data={data} />;
}

// Client Component — use Server Action for mutations
'use client';
async function handleSubmit(formData: FormData) {
  const result = await serverAction(formData); // Server Action, not fetch()
}
```

### Supabase client rules

| Context | Client to use |
|---|---|
| Server Component | `createServerClient` from `@supabase/ssr` with `cookies()` |
| Server Action | `createServerClient` from `@supabase/ssr` with `cookies()` |
| Route Handler | `createServerClient` from `@supabase/ssr` with `cookies()` |
| Client Component (read) | `createBrowserClient` from `@supabase/ssr` |
| Client Component (storage upload) | `createBrowserClient` — storage uploads must be browser-direct |
| Middleware | `createServerClient` from `@supabase/ssr` with request/response cookies |

**Never use `@supabase/supabase-js` `createClient()` directly in an App Router project.** Use `@supabase/ssr` wrappers.

### Authentication pattern

```ts
// Get user — always server-side, never trust client input
const { data: { user } } = await supabase.auth.getUser(); // NOT getSession()
if (!user) redirect('/login');

// Middleware — protect routes before they render
// middleware.ts
const { data: { user } } = await supabase.auth.getUser();
if (!user && request.nextUrl.pathname.startsWith('/dashboard')) {
  return NextResponse.redirect(new URL('/login', request.url));
}
```

**`getUser()` over `getSession()`.** `getSession()` can return a stale cached session; `getUser()` always validates with the server.

### RLS — non-negotiable rules

Every table that stores user data gets RLS. No exceptions.

```sql
-- Template for any user-owned table
ALTER TABLE public.your_table ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own" ON public.your_table
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "insert_own" ON public.your_table
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "update_own" ON public.your_table
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

CREATE POLICY "delete_own" ON public.your_table
  FOR DELETE TO authenticated USING (user_id = auth.uid());
```

**Staff/admin exception pattern** — separate policy, never modify the user policy:
```sql
CREATE POLICY "select_staff" ON public.your_table
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_staff = true
  ));
```

### Storage RLS — the ambiguity trap

When writing Storage RLS policies that JOIN other tables, **always table-qualify `objects.name`**. Bare `name` is ambiguous if any joined table has a `name` column.

```sql
-- WRONG — fails if joined table has a 'name' column
USING (storage.foldername(name)[1] = auth.uid()::text)

-- CORRECT
USING (storage.foldername(objects.name)[1] = auth.uid()::text)
```

### Server Action response contract

When a Server Action calls Supabase `successResponse()`:
```ts
// successResponse wraps: { success: true, data: { url, ... } }
// The caller receives the outer wrapper as `data`
// So reading the inner field is: data?.data?.url — NOT data?.url

const { data, error } = await supabase.functions.invoke('my-function', { body });
const url = data?.data?.url; // correct
const url = data?.url;       // WRONG — one nesting level missing
```

### Server Actions called from Client Components

Server Actions must return `{ result, error }` — never throw, never redirect inside:

```ts
// WRONG — throws in a Server Action called from Client Component
export async function myAction() {
  if (!user) throw new Error('Unauthorized'); // breaks Client Component flow
  redirect('/somewhere');                      // breaks Client Component flow
}

// CORRECT
export async function myAction(): Promise<{ result?: Data; error?: string }> {
  try {
    if (!user) return { error: 'Unauthorized' };
    const data = await doWork();
    return { result: data };
  } catch (e) {
    return { error: 'Something went wrong' };
  }
}
```

### Edge Functions (Supabase)

```ts
// Correct import order and execution order:
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT } from '../_shared/auth.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';

// Execution order — never deviate:
// 1. handleCors  → 2. verifyJWT (401)  → 3. parse body
// 4. DEV_MOCK declaration  → 5. checkRateLimit  → 6. if DEV_MOCK return mock
// 7. getSupabaseClient()  → 8. logic

const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;
// DEV_MOCK must be declared BEFORE any DB call — checkRateLimit IS a DB call
```

**Deploy with `--no-verify-jwt`** — ES256 algorithm causes JWT verification to fail at the gateway layer. Verify JWT inside the function using the shared `verifyJWT` helper.

### Migration naming

```
supabase/migrations/NNN_description.sql
```

- Increment from the last migration number in the project
- Check what exists before picking a number — never guess
- Read the existing migrations to understand the schema before adding to it
- RLS enabled in the same migration as the table creation — never deferred

### Dropdown / select element theming

Native `<select>` elements with `bg-transparent` render as white text on white in OS-native dropdowns. Always set explicit background and text color:

```tsx
// WRONG — unreadable in some OS themes
<select className="bg-transparent text-white" />

// CORRECT
<select className="bg-background text-foreground [&>option]:bg-background [&>option]:text-foreground" />
```

---

## 3B. PLAYBOOK — NODE.JS API

*(Activate when: Express / Fastify / Hono / plain Node.js detected, no Next.js)*

- Use `zod` for all request body validation — never trust `req.body` directly
- Authentication middleware runs before every protected route handler
- Error handler at the bottom of the middleware stack catches everything
- Never `console.log` in production — use a structured logger (pino, winston)
- Database queries always parameterized — never string concatenation

---

## 3C. PLAYBOOK — PYTHON (FASTAPI / DJANGO)

*(Activate when: `pyproject.toml` or `requirements.txt` present)*

- Pydantic models for all request/response schemas
- `async def` for all FastAPI endpoints — sync route handlers block the event loop
- Alembic for migrations (FastAPI) or Django migrations — never raw SQL ALTER
- Secrets via `python-dotenv` or environment — never hardcoded
- Type annotations on every function signature — `mypy` is the equivalent of `tsc`

---

## 4. UNIVERSAL RULES — ALWAYS ACTIVE

These rules apply regardless of stack. They were all learned from real failures.

---

### 4.1 BEFORE WRITING ANY CODE

```
1. Check if the file already exists — never create a duplicate
2. Read the file before editing it — never edit blind
3. Check package.json before npm install — the package may already be there
4. Read existing migrations before writing a new one — understand the schema first
5. Check existing tests before writing new ones — don't duplicate coverage
```

---

### 4.2 PROCESS — THE MANDATORY FLOW

For any feature work:

```
brainstorm → spec → plan → implement → QA loop → PR
```

Never skip. For a bug fix, the minimum is:

```
reproduce → understand root cause → fix → verify fix → QA loop
```

**Never implement before you understand.** If you cannot state the root cause in one sentence, you do not understand it yet.

---

### 4.3 QA LOOP — MANDATORY BEFORE EVERY PR

```bash
# Exact sequence — fix failures before advancing to next step
1. Lint:   npx eslint . --ext .ts,.tsx --max-warnings 0
2. Types:  npx tsc --noEmit
3. Tests:  npx jest --ci --passWithNoTests
4. Build:  (stack-specific build check)
```

**Do not declare "done" until all four pass.** State "QA loop complete: lint ✓ tsc ✓ jest ✓ build ✓" before creating a PR.

If any step fails: fix it, re-run that step, then continue the sequence. Never skip a failure and continue.

---

### 4.4 TDD — TEST BEFORE IMPLEMENT

For every new function, component, or behaviour:

```
1. Write the failing test first
2. Run it — confirm it FAILS with the expected message
3. Write the minimal implementation that makes it pass
4. Run it — confirm it PASSES
5. Refactor if needed
6. Commit
```

**"Minimal implementation"** means exactly what it says. Do not gold-plate at step 3.

---

### 4.5 COMMITS

```bash
# One logical unit per commit
git add <specific files>   # Never git add -A or git add .
git commit -m "type(scope): what and why"

# Types: feat | fix | chore | refactor | test | docs | style | perf
# Scope: component or module name
# Example: feat(checkout): add buy-now single-item flow
```

**Never use `--no-verify`.** If a pre-commit hook fails, fix the underlying issue. The hook is protecting you.

**Specific file staging only.** `git add -A` can accidentally commit `.env`, large binaries, or generated files.

---

### 4.6 SECRETS — ABSOLUTE RULES

```
NEVER hardcode: API keys, service URLs with credentials, tokens, passwords
ALWAYS use: environment variables, .env files (gitignored), secret managers
ALWAYS check: .gitignore includes .env* before adding a .env file
NEVER commit: .env, .env.local, .env.production, credentials.json, service-account.json
```

If you accidentally read a file and see a hardcoded secret: flag it to the user immediately. Do not proceed.

---

### 4.7 BASH SUBAGENTS — FILE WRITING

Bash subagents (Agent tool with bash) cannot write files reliably. `cat >`, `printf >`, heredoc redirects silently fail or produce empty files.

**Fix:** Always use the `Write` and `Edit` tools directly. Never delegate file creation to a bash command.

---

### 4.8 JEST — MOCK HOISTING

`jest.mock()` is hoisted to the top of the file. Variables declared before it are `undefined` inside the factory.

```ts
// WRONG — mockFn is undefined inside the factory
const mockFn = jest.fn();
jest.mock('../module', () => ({ fn: mockFn })); // undefined!

// CORRECT — inline factory, retrieve with jest.requireMock()
jest.mock('../module', () => ({ fn: jest.fn() }));
const { fn } = jest.requireMock('../module');
```

---

### 4.9 REACT NATIVE — NATIVE MODULE GUARDS

Any package that uses native modules (Daily.co, camera, NFC, etc.) crashes Expo Go and web bundling if imported at module level.

```ts
// CORRECT — runtime guard
let NativeModule: any = null;
try {
  NativeModule = require('native-only-package').default;
} catch {}
export const isAvailable = () => NativeModule !== null;
```

If a new native package crashes the Metro web bundler, add it to the platform exclusion block in `metro.config.js`.

---

### 4.10 TYPESCRIPT — ZERO ERRORS REQUIRED

`tsc --noEmit` must pass before any commit. TypeScript errors caught at build time are a quality failure, not a CI detail.

Common trap: a component or type name collision.

```ts
// CRASH — same name used for both a type import and a component export
import { Session } from '../types';
export default function Session() { ... } // collision!

// CORRECT — alias the type import
import type { Session as SessionData } from '../types';
export default function Session() { ... }
```

---

### 4.11 SUPABASE REALTIME MOCK CHAIN

Mocking Supabase Realtime in Jest requires a complete chain. Any missing link returns `undefined` and breaks the test.

```ts
// COMPLETE chain — every method returns something chainable
supabase: {
  channel: jest.fn(() => ({
    on: jest.fn(() => ({
      subscribe: jest.fn((cb) => { cb?.('SUBSCRIBED'); return {}; }),
    })),
  })),
  removeChannel: jest.fn(),
}
```

---

### 4.12 OBSERVABILITY AND LOGGING

**PII in logs is an incident.** Before logging anything:

- Never log: email, phone, name, username, bio, message content, post content, location, avatar URL
- Always anonymise: user IDs (hash to 8-char hex before logging)
- Safe to log: screen names, action types, error codes, counts, feature flags, performance timings

**No `console.log` in production code.** Use the project's structured logger. In Roxy: `ObservabilityService.log()`. In other projects: establish the logger before the first feature and use it everywhere.

---

### 4.13 MODULE SCOPE INITIALIZATION

Never call initialisation functions at module scope. They run during import, before the runtime is ready, and cause unpredictable side effects.

```ts
// WRONG — runs at import time
ObservabilityService.initialize(); // crash if called before app mounts

// CORRECT — runs after the runtime is ready
useEffect(() => {
  ObservabilityService.initialize();
}, []);
```

This applies to: analytics SDKs, error tracking SDKs, WebSocket connections, database connections in Lambda/Edge.

---

### 4.14 EVENT FLOODING

High-frequency events (WebSocket messages, device sensor updates, resize events, scroll events) must be debounced before any state update or log call.

```ts
// WRONG — fires hundreds of times per second
socket.on('update', (data) => setState(data));

// CORRECT — debounced
const debouncedUpdate = useMemo(() => debounce((data) => setState(data), 200), []);
socket.on('update', debouncedUpdate);
```

---

### 4.15 ASYNC OPERATIONS — LOADING STATES REQUIRED

Every async operation that the user initiates must have:

1. A disabled/loading state on the trigger button
2. A visual indicator (spinner, skeleton, or text)
3. An error state with a message
4. Rollback or retry on failure

If you write an async handler without these, it is incomplete — not "good enough for now".

---

### 4.16 ROLLBACK ON PARTIAL FAILURE

When an operation has multiple steps (e.g. upload file → save DB record), failure in a later step must clean up earlier steps.

```ts
// Pattern: attempt, then clean up on failure
const storageResult = await uploadToStorage(file);
if (storageResult.error) return { error: storageResult.error };

const dbResult = await saveToDb(storageResult.url);
if (dbResult.error) {
  // Clean up the orphaned storage object
  await storage.remove([storageResult.path]);
  return { error: dbResult.error };
}
```

---

### 4.17 SECURITY — OWASP TOP 10 MINIMUM

Before any PR, verify:

| Check | Rule |
|---|---|
| A01 Broken Access Control | RLS on every new table; identity from server JWT, never client-supplied |
| A03 Injection | All DB queries parameterised — no string interpolation |
| A05 Misconfiguration | RLS enabled; no table publicly writable by default; secrets in env vars |
| A07 Auth Failures | Session validated server-side before any data fetch; logout clears session |
| Input validation | Length limits + format rules at both client AND DB (CHECK constraints) |

---

### 4.18 OVER-ENGINEERING — DO NOT

```
DO NOT add: features not requested, configurability for one-off operations,
            error handling for scenarios that cannot happen,
            backwards-compat shims for code you just wrote,
            docstrings to code you did not change,
            abstractions for fewer than 3 uses

DO:         the minimum that satisfies the requirement
            extract when the third use appears, not before
            delete unused code completely — no _old, no // removed
```

---

### 4.19 MONOREPO — SHARED CODE GOES IN PACKAGES

If a utility is used in 2+ apps, it belongs in `packages/`, not copy-pasted.

After adding a new package:
- Add `paths` alias to every app's `tsconfig.json`
- Add the package to each app's `package.json` dependencies
- Verify the build tool (Turbopack, Metro, Vite) resolves the alias

---

### 4.20 DOCUMENTATION

**Never create documentation files unless explicitly asked.** The code is the documentation. Comments exist only where the logic is not self-evident.

When you do write docs:
- Write for the reader who has zero context on this codebase
- State what, why, and any non-obvious constraints
- Do not state what the code obviously does (`// increment counter` above `counter++`)

---

## 5. DECISION LOGGING — UNIVERSAL

When you make an architectural decision that is not obvious from the requirements:

```
Append to .claude/decisions.md:
[DECISION] What was decided
[REASON] Why
[ALTERNATIVES REJECTED] What else was considered
[REVISIT CONDITION] Only if [X]
```

When you encounter and resolve an error:

```
Append to .claude/mistakes.md:
[MISTAKE] What went wrong
[ROOT CAUSE] Why it happened
[FIX] What resolved it
[PREVENTION] What to check first next time
```

These files prevent the same conversations from happening twice.

---

## 6. QUICK REFERENCE — UNIVERSAL COMMANDS

```bash
# TypeScript check (any Node project)
npx tsc --noEmit

# Lint (any ESLint project)
npx eslint . --ext .ts,.tsx --max-warnings 0

# Jest
npx jest --ci --passWithNoTests

# Git — safe staging
git add <specific-files>     # never git add -A
git status                   # verify what's staged before committing
git diff --staged            # read what you're about to commit

# Supabase
npx supabase db push         # apply migrations
npx supabase status          # check local instance
npx supabase functions serve # local edge function dev
npx supabase functions deploy <name> --no-verify-jwt

# Next.js
next build                   # production build check
next lint                    # Next.js lint
```

---

## 7. COMMON FAILURE PATTERNS — BY SYMPTOM

| Symptom | Check first |
|---|---|
| Migration fails with "column reference is ambiguous" | You have a JOIN where two tables share a column name. Table-qualify the reference. |
| Server Action data reads as undefined | Extra nesting from `successResponse` wrapper. Read `data?.data?.field` not `data?.field`. |
| Pre-commit hook fails with unused var | An import was added by the plan but not used in final implementation. Remove it. |
| Jest mock returns undefined | Mock factory references a variable declared before `jest.mock()`. Move to inline factory. |
| Dropdown text invisible | `bg-transparent` on `<select>` + light OS theme. Set explicit `bg-background text-foreground`. |
| Native module crashes web build | Module imported at module level. Wrap in try/catch require guard. |
| RLS allows staff to see nothing | Staff exception policy missing. Add separate policy for `is_staff = true`. |
| Storage upload succeeds but DB save fails | No rollback. Clean up the storage object after DB error. |
| Edge function returns 401 despite valid token | Deployed without `--no-verify-jwt`. Redeploy with flag. |
| `ObservabilityService` crashes on import | Called `.initialize()` at module scope. Move to `useEffect`. |

---

*CLAUDE-UNIVERSAL-GUIDE.md v1.0*
*Generalised from Roxy project sessions 1–12.*
*Stack-detection protocol + Next.js/Supabase playbook (Nicole's standardised web stack) + universal rules.*
*Add new entries to Section 4 and Section 7 as new lessons are earned.*
