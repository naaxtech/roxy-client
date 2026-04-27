# Claude Code Process Flows — Roxy Project
## Comprehensive operating manual for any Claude Code instance on this codebase

---

## 0. READ THIS FIRST

This document is the operating contract for every Claude Code session on this project. It describes **how to think, not just what to do**. Every flow here exists because something went wrong without it. Follow them exactly.

Source of truth hierarchy:
1. User's explicit instructions (in-session, CLAUDE.md, this file)
2. Superpowers skills (invoked via the `Skill` tool)
3. Default Claude Code behavior

When in conflict: earlier items win.

---

## 1. SESSION START PROTOCOL

Every session, before doing anything else:

```
1. Read CLAUDE.md — auto-loaded, but internalize it
2. Read .claude/log.md — last 5 entries tell you where we left off
3. Read .claude/mistakes.md — do not repeat listed errors
4. Read .claude/decisions.md — do not relitigate listed decisions
5. State: "Session restored. Last state: [1-sentence summary from log]. Ready."
```

**Never ask "where were we?" — the log answers that.** If the log is empty or missing, say so and ask.

---

## 2. SKILL INVOCATION RULES

### The rule
**Invoke relevant skills BEFORE any response, including clarifying questions.**

If there is a 1% chance a skill applies, invoke it first.

### Available skills and when to use them

| Skill | Invoke when |
|---|---|
| `superpowers:brainstorming` | Any feature request, new functionality, component building, behavior modification |
| `superpowers:writing-plans` | After brainstorming produces an approved design — before touching code |
| `superpowers:executing-plans` | When a written plan exists and user says to implement it |
| `superpowers:subagent-driven-development` | Executing plans with independent parallel tasks |
| `superpowers:systematic-debugging` | Any bug, test failure, or unexpected behavior |
| `superpowers:test-driven-development` | Before writing implementation code for any feature |
| `superpowers:verification-before-completion` | Before claiming work is done, before PRs |
| `superpowers:finishing-a-development-branch` | After all tasks complete, before merge/PR |
| `superpowers:requesting-code-review` | After major feature completion |
| `superpowers:receiving-code-review` | When receiving review feedback |
| `superpowers:writing-plans` | After design approved, before implementation |
| `superpowers:using-git-worktrees` | Before isolated feature work |
| `supabase` | Any Supabase task (DB, Auth, Edge Functions, Storage, RLS) |
| `vercel:nextjs` | Any Next.js App Router work |
| `frontend-design` | Building web UI components |

### Red flags — you're rationalizing:
- "This is just a simple question" → Check for skills anyway
- "I need more context first" → Skill check comes BEFORE clarifying questions
- "I know what that skill says" → Skills evolve. Always invoke to read current version
- "This feels productive" → Undisciplined action wastes time. Skills first.

### Skill priority order
1. **Process skills first** (brainstorming, debugging) — they determine HOW to approach
2. **Implementation skills second** (supabase, nextjs) — they guide execution

---

## 3. BRAINSTORMING FLOW

**Invoke `superpowers:brainstorming` before any creative/feature work.**

### Steps (in order, never skip)
1. **Explore project context** — read relevant files, recent git log, check what exists
2. **Offer visual companion** if the topic involves layout/UI — this is its own message
3. **Ask clarifying questions** — one at a time, multiple choice preferred
4. **Propose 2-3 approaches** with tradeoffs and a clear recommendation
5. **Present design** in sections, get approval after each section
6. **Write design doc** to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
7. **Spec self-review** — scan for: placeholders, contradictions, ambiguity, scope
8. **User reviews spec** — ask explicitly, wait for confirmation
9. **Invoke `superpowers:writing-plans`** — the only skill invoked after brainstorming

### Hard gates
- Do NOT write any code until design is approved
- Do NOT invoke implementation skills — only `writing-plans` comes after brainstorming
- Do NOT combine the visual companion offer with any other content — it's its own message

### Design document format
```markdown
# Feature Name — Design Spec
**Date:** YYYY-MM-DD
**Apps:** which apps are affected
**Status:** Approved

## 1. Overview
One paragraph. What this builds and why.

## 2. [Major Section]
...

## N. Out of Scope (future)
List explicitly. Prevents scope creep.
```

### Spec self-review checklist
After writing the spec, check:
- [ ] Any "TBD", "TODO", or vague requirements? Fix them.
- [ ] Do sections contradict each other?
- [ ] Is this focused enough for a single implementation plan?
- [ ] Could any requirement be interpreted two ways? Pick one.

---

## 4. WRITING PLANS FLOW

**Invoke `superpowers:writing-plans` after design is approved.**

### Plan document header (mandatory)
```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One sentence.
**Architecture:** 2-3 sentences.
**Tech Stack:** Key technologies.
```

### File map (before tasks)
List every file that will be created or modified and what it does. This locks in decomposition decisions before a single line of code is written.

### Task structure
Each task follows this exact pattern:
```markdown
### Task N: Component Name

**Files:**
- Create: `exact/path/to/new-file.ts`
- Modify: `exact/path/to/existing.ts`
- Test: `__tests__/exact/path/test.ts`

- [ ] **Step 1: Write the failing test**
[actual test code]

- [ ] **Step 2: Run test to verify it fails**
Run: `command`
Expected: FAIL with "specific error message"

- [ ] **Step 3: Write minimal implementation**
[actual implementation code]

- [ ] **Step 4: Run test to verify it passes**
Run: `command`
Expected: PASS

- [ ] **Step 5: Commit**
[git commands]
```

### Granularity rules
- Each step = 2-5 minutes of work
- Every step that changes code shows the complete code
- Every verification step shows the exact command AND expected output
- Commits happen after every task, not at the end

### No placeholders — ever
These are plan failures:
- "TBD", "TODO", "implement later"
- "Add appropriate error handling"
- "Write tests for the above" (without actual test code)
- "Similar to Task N" (repeat the code)
- Steps that describe what to do without showing how

### Plan self-review (after writing)
1. **Spec coverage** — every spec requirement maps to a task
2. **Placeholder scan** — zero TBDs
3. **Type consistency** — method signatures in Task 3 match what Task 7 calls
4. **Save to** `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`
5. **Commit the plan file**

### Execution handoff
After saving the plan, offer:
- **Subagent-Driven** (recommended) — fresh subagent per task, review between
- **Inline Execution** — execute in this session with checkpoints

---

## 5. EXECUTING PLANS FLOW

**Invoke `superpowers:executing-plans` when implementing a written plan.**

### Steps
1. **Read the plan file** — don't rely on memory
2. **Review critically** — raise concerns before starting, not mid-execution
3. **Create TodoWrite tasks** — one per plan task, track in_progress/completed
4. **Execute each task exactly** — follow the steps as written
5. **Run every verification** — never skip a test run or tsc check
6. **Stop and ask when blocked** — do not brute-force through failures

### When to stop
- Missing dependency not in the plan
- Test fails in unexpected way after 2 fix attempts
- Plan step is ambiguous
- Verification fails repeatedly

**Never guess. Stop and ask.**

---

## 6. TDD PROTOCOL

**Every feature and bugfix follows TDD. No exceptions.**

### The loop
```
Write failing test → Run (confirm FAIL) → Write minimal implementation →
Run (confirm PASS) → Refactor if needed → Commit → Next task
```

### Test design rules
- **Happy path** — does it work normally?
- **Error path** — what happens when it fails?
- **Edge cases** — empty arrays, null values, boundary conditions

### Jest-specific rules for this codebase
```ts
// WRONG — variable declared before mock is undefined inside factory
const mockFn = jest.fn();
jest.mock('../../lib/supabase', () => ({ fn: mockFn })); // undefined!

// CORRECT — inline factory, use jest.requireMock() for assertions
jest.mock('../../lib/supabase', () => ({
  supabase: { channel: jest.fn() }
}));
const { supabase } = jest.requireMock('../../lib/supabase');
```

### Supabase Realtime mock — must be complete chain
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

---

## 7. QA LOOP — MANDATORY BEFORE ANY PR

**No PR is created until this loop passes with zero failures.**

```
WRITE → LINT → TSC → TEST → REVIEW → DONE
  └─ if any fail: fix and re-run that step ──┘
```

### Commands
```bash
# Step 1: Lint
npx eslint . --ext .ts,.tsx --max-warnings 0

# Step 2: TypeScript
npx tsc --noEmit

# Step 3: Tests (from apps/mobile/)
npx jest --ci --passWithNoTests
# Expected: all tests pass, 0 failing

# Step 4: Review checklist (mental/written)
# [ ] RLS enabled on all new tables
# [ ] Secrets in env vars, none hardcoded
# [ ] No PII logged
# [ ] All async operations have loading states
# [ ] New screens wrapped in <RoxyErrorBoundary>
# [ ] tsc passes
# [ ] jest passes
# [ ] No console.log in production code
# [ ] Daily.co imports guarded
# [ ] Migration file created if schema changed
```

### Declare completion only after
State explicitly: **"QA loop complete: lint ✓ tsc ✓ jest ✓"**

---

## 8. SYSTEMATIC DEBUGGING FLOW

**Invoke `superpowers:systematic-debugging` before proposing any fix.**

### The process
1. **Reproduce** — confirm the bug exists, get exact error message
2. **Isolate** — which layer? (DB/RLS, edge function, store, component, type?)
3. **Hypothesize** — state the most likely root cause in one sentence
4. **Verify hypothesis** — add a log, check DB directly, read the error trace
5. **Fix the root cause** — not the symptom
6. **Verify fix** — run the test that would have caught this
7. **Log to `.claude/mistakes.md`** — format below

### mistakes.md entry format
```
[MISTAKE] What went wrong
[ROOT CAUSE] Why it happened
[FIX] What resolved it
[PREVENTION] What to check first next time
```

### Never
- Retry the same failing call in a loop
- Add a try/catch to hide an error without fixing the root cause
- Assume the fix worked without running verification

---

## 9. GIT AND COMMIT CONVENTIONS

### Branch naming
```
session-N-<slug>   →   PR to main
```
All recent sessions have committed directly to `main` after merging PRs.

### Commit message format
```
type(scope): description

feat(mobile): add product photo gallery
feat(studio): photo upload UI
feat(db): product-photos storage bucket + RLS
fix(studio): dropdown text white on white background
fix(rooms): video join failure — Daily.co module import
chore: add naaxtech mirror workflow
docs: product photos design spec
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`

### Commit timing
- After each plan task (not at the end of everything)
- After QA loop passes for a feature
- Never commit broken code to main

### Pre-commit hooks
The project has pre-commit hooks (tsc + eslint + jest). If they fail:
- Fix the root cause
- Re-stage
- Create a NEW commit — never use `--amend` on a failed hook (the previous commit still exists)
- Never use `--no-verify`

---

## 10. SESSION LOGGING

**Append to `.claude/log.md` after every meaningful action.**

### Format
```
[TIMESTAMP] [APP: client|studio|staff] [ACTION/FEATURE/FIX] Description.
QA: lint ✓ tsc ✓ jest N/N ✓. [FILES: list of changed files]
```

### When to log
- After completing a feature or task
- After fixing a bug
- After making an architectural decision
- After a QA loop passes

---

## 11. DECISIONS LOG

**Before relitigating any architectural choice, read `.claude/decisions.md`.**

### When to add an entry
When making a non-obvious architectural decision that another developer might question.

### Format
```
[DECISION] What was decided
[REASON] Why
[ALTERNATIVES REJECTED] What else was considered
[REVISIT CONDITION] Only if [X]
```

### Locked decisions (never relitigate)
- Zero-churn architecture — dating opt-in, community primary
- Supabase Realtime — filtered subscriptions only, never table-wide
- AI rate limits — server-side only
- Roxy = wingwoman — never "AI/assistant/chatbot" in user-facing strings
- Daily.co = guarded import via `isDailyAvailable()`
- EAS Build for production — no Expo Go
- All secrets in environment variables

---

## 12. DATABASE AND MIGRATION RULES

### Migration naming
Files are numbered sequentially: `NNN_description.sql`
**Current next migration: 045** (as of session logging 044)

### Every migration must include
```sql
-- Description comment at top
-- Table creation
-- RLS: ALTER TABLE x ENABLE ROW LEVEL SECURITY;
-- Policies (SELECT, INSERT, UPDATE, DELETE as needed)
-- Indexes
-- Triggers if needed
-- Seed data if needed
```

### RLS policy rules (OWASP A01)
- RLS enabled on ALL new tables — no exceptions
- User identity always from `auth.uid()` — never from client input
- Staff access requires `EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_staff = true)`
- Owner access via JOIN chain: `auth.uid() = businesses.owner_id` etc.

### Storage bucket RLS pattern
```sql
-- Avoid column name ambiguity by qualifying with table name
CREATE POLICY "bucket_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'my-bucket' AND
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.owner_id = auth.uid()
        AND b.id::text = (storage.foldername(objects.name))[1]
        -- Use objects.name, not just name — avoids ambiguity with businesses.name
    )
  );
```

### Push migrations
```bash
npx supabase db push
```

---

## 13. EDGE FUNCTION CONVENTIONS

### Standard structure (every function)
```ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { checkRateLimit, logAiCall } from '../_shared/rateLimit.ts';
import { callClaude } from '../_shared/claude.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

// Execution order — never deviate:
// 1. handleCors → 2. verifyJWT (401) → 3. parse body
// 4. DEV_MOCK declaration → 5. checkRateLimit → 6. if (DEV_MOCK) return mock
// 7. getSupabaseClient() → 8. logic
const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;
```

### Critical: DEV_MOCK before DB calls
`checkRateLimit` is a DB call. `DEV_MOCK` must be declared before it.

### JWT verification
Use `verifyJWT` from `_shared/auth.ts` (base64 decode, not `getClaims()`).
The Supabase gateway rejects ES256 JWTs — deploy all functions with `--no-verify-jwt`.

### Response structure
`successResponse` wraps payload: `{ success: true, data: { ... } }`
On the client: read `data?.data?.url`, not `data?.url`.

### Deploy
```bash
npx supabase functions deploy <name> --no-verify-jwt
```

---

## 14. STUDIO (NEXT.JS) CONVENTIONS

### Auth in server components
```ts
const supabase = await createClient(); // from lib/supabase/server.ts
const { data: claimsData } = await supabase.auth.getClaims();
const userId = claimsData?.claims?.sub;
if (!userId) notFound();
```

### Auth in server actions
```ts
'use server';
import { createClient } from '@/lib/supabase/server';
import { getOwnedBusiness } from '@/lib/business';
// Always verify ownership — never trust client-passed IDs
const business = await getOwnedBusiness();
if (!business) throw new Error('No business found');
```

### Client-side Supabase (browser uploads etc.)
```ts
import { createClient } from '@/lib/supabase/client'; // createBrowserClient
const supabase = createClient();
// Browser client has user session from cookies — works for storage uploads with RLS
```

### Storage upload pattern (Studio)
```ts
// 1. Upload file from browser using browser client
const { error } = await supabase.storage.from('bucket').upload(path, file, { ... });
// 2. Get public URL
const { data: { publicUrl } } = supabase.storage.from('bucket').getPublicUrl(path);
// 3. Save URL to DB via server action
await saveRecord(productId, publicUrl, position);
// 4. On DB failure — rollback storage
await supabase.storage.from('bucket').remove([path]);
```

### Server actions that call edge functions
```ts
// Return { url?, error? } — never throw or redirect from server actions
// called by client components
const { data, error } = await supabase.functions.invoke('fn-name', { body: {...} });
if (error) return { error: error.message };
return { url: data?.data?.url }; // note: data.data wrapping
```

### Dropdown/select component
The native `<select>` must use `bg-background text-foreground` — not `bg-transparent`.
Otherwise dropdown options inherit white text on white background (unreadable).

---

## 15. MOBILE (REACT NATIVE / EXPO) CONVENTIONS

### State management
Zustand stores, one per domain:
- `authStore` — session, user
- `profileStore` — profile data
- `marketplaceStore` — products, cart, orders, buyNow
- `connectStore` — conversations, unread counts
- `feedStore` — discover feed
- `buildStore` — businesses, bookmarks
- `roxyChatStore` — wingwoman chat

### Store action pattern
```ts
actionName: async (params) => {
  set({ loadingState: true });
  try {
    const { data, error } = await supabase.functions.invoke('fn', { body: params });
    if (error || !data?.expected_field) return null;
    set({ relevantState: data.value });
    return data;
  } finally {
    set({ loadingState: false });
  }
},
```

### Realtime subscriptions
```ts
// CORRECT — always filtered
supabase
  .channel('user-messages')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'messages',
    filter: `conversation_id=eq.${conversationId}`
  }, handleNewMessage)
  .subscribe();

// WRONG — never table-wide
supabase.channel('all').on('postgres_changes', { event: '*', table: 'messages' }, h).subscribe();
```

### Photo/gallery pattern (mobile)
```tsx
// Swipeable gallery
<ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}
  onMomentumScrollEnd={handleScroll}>
  {photos.map(photo => <Image key={photo.id} source={{ uri: photo.url }} style={styles.img} />)}
</ScrollView>
{/* Dots — only when 2+ photos */}
{photos.length > 1 && (
  <View style={styles.dots}>
    {photos.map((_, i) => (
      <View key={i} testID="photo-dot" style={[styles.dot, i === idx && styles.dotActive]} />
    ))}
  </View>
)}
```

### Modal stacking
React Native supports stacked Modals. The project uses up to 3 levels:
`BusinessDetailSheet Modal → ProductDetailSheet Modal → CheckoutSheet Modal`
This is fine — RN handles portal-like rendering regardless of tree position.

---

## 16. OBSERVABILITY RULES

### Always use ObservabilityService — never raw Sentry/PostHog
```ts
// WRONG
import * as Sentry from '@sentry/react-native';
Sentry.captureException(error);

// CORRECT
import { ObservabilityService } from '@roxy/observability';
ObservabilityService.log({ level: 'error', event: 'payment_failed', ... });
```

### PII tiers

**NEVER LOG (strip completely):**
- email, phone, display_name, username, bio
- identity_labels, pronouns, dating_looking_for
- location, avatar_url, message content, post content

**LOG ANONYMISED:**
```ts
hashUserId(userId) // → 8-char hex, never raw user_id
```

**SAFE TO LOG:**
- Screen names, navigation events, action types
- Error codes (not messages if they contain user data)
- Counts, feature flags, performance timings

### Init rule
```ts
// CORRECT
useEffect(() => { ObservabilityService.initialize(); }, []); // inside App()

// WRONG
ObservabilityService.initialize(); // module scope — crashes on init
```

---

## 17. ANTI-PATTERNS — READ BEFORE EVERY SESSION

### 1. Storage policy column ambiguity
When the bucket path check JOINs tables that have a `name` column (like `businesses`), use `objects.name` not bare `name`.
```sql
-- WRONG: ambiguous
AND b.id::text = (storage.foldername(name))[1]

-- CORRECT
AND b.id::text = (storage.foldername(objects.name))[1]
```

### 2. jest.mock() hoisting
Variables before `jest.mock()` are undefined inside factory. Use inline factories.

### 3. Daily.co module-level import
Never `import DailyIframe from '@daily-co/react-native-daily-js'` at module scope.
Always use guarded require in `lib/daily.ts` and check `isDailyAvailable()`.

### 4. DEV_MOCK after DB calls in edge functions
`DEV_MOCK` must be declared before `checkRateLimit` (which hits the DB).

### 5. Server action throw/redirect from Client Components
Server Actions called by Client Components must `return { url?, error? }` — never throw or use `redirect()`.

### 6. data.data.url nesting
`successResponse` wraps payload: `supabase.functions.invoke` returns `data = { success, data: { url } }`.
Read `data?.data?.url` not `data?.url`.

### 7. tsc not run before declaring done
Always run `npx tsc --noEmit` as the last step before any commit that touches TypeScript.

### 8. Bash subagents cannot write files
`cat >`, `printf >`, heredoc redirects silently fail or are denied in subagent context.
Use `Write` and `Edit` tools directly in the main conversation.

### 9. Component name matches imported type name
```ts
// CRASH
import { SpeedDateSession } from '../../../../types';
export default function SpeedDateSession() { ... }

// CORRECT
import type { SpeedDateSession as SpeedDateSessionData } from '../../../../types';
export default function SpeedDateSession() { ... }
```

### 10. Studio dropdown text invisible
Native `<select>` with `bg-transparent` inherits white text — visible in the input, invisible in the dropdown.
Always use `bg-background text-foreground` on `<select>` elements.

---

## 18. MEMORY SYSTEM

The project uses a file-based memory system at:
`C:\Users\edwar\.claude\projects\D--Nicole-Dev-roxy-roxy-client\memory\`

### Memory types
- **user** — Nicole's role, preferences, operating style
- **feedback** — corrections Nicole has given; apply proactively
- **project** — current branch, PR status, what's in progress
- **reference** — where to find things in external systems

### MEMORY.md
`MEMORY.md` is the index. Every memory file has a pointer there.
Memory files use frontmatter:
```markdown
---
name: memory_name
description: one-line description for relevance matching
type: user|feedback|project|reference
---

Content here. For feedback/project: lead with the rule/fact, then **Why:** and **How to apply:** lines.
```

### When to read memory
- When user seems to be referencing prior work
- When user asks you to "remember" or "recall" something
- At session start for context

### When NOT to save to memory
- Code patterns (read the code)
- Git history (use git log/blame)
- Debugging solutions (the fix is in the code)
- Ephemeral task details (use TodoWrite tasks instead)

---

## 19. PRODUCT CONTEXT (HOLD ALWAYS)

**The arc:** Roxy → Emotional AI trained on Roxy data → Thinqer incubator

Every feature decision asks: **what does this generate that the emotional AI can learn from?**

**What Roxy is:** WLW social community + dating platform. Dating is opt-in. Community is the foundation.

**The AI persona:** Roxy is a **wingwoman** — never "AI", "assistant", "chatbot" in user-facing strings.

**Three apps:**
- `apps/mobile/` — end-user app
- `apps/studio/` — community host dashboard (roxycommunity.netlify.app)
- `apps/staff/` — internal operations (not yet built)

**Cost target:** Under $0.50/user/month blended AI cost. Every AI feature decision evaluated against this.

---

## 20. QUICK REFERENCE — KEY COMMANDS

```bash
# Mobile tests
cd apps/mobile && npx jest --ci --passWithNoTests

# TypeScript check
npx tsc --noEmit

# Lint
npx eslint . --ext .ts,.tsx --max-warnings 0

# DB push
npx supabase db push

# Edge function deploy (always --no-verify-jwt)
npx supabase functions deploy <name> --no-verify-jwt

# Set edge function secret
npx supabase secrets set KEY=value --project-ref ptymtdlysqbpxzlgsshp

# EAS builds (from apps/mobile/)
cd apps/mobile && eas build --profile development --platform android
cd apps/mobile && eas build --profile production

# Create PR
gh pr create --base main --title "..." --body "..."
```

---

*This document synthesizes CLAUDE.md v3.0, the Superpowers skill system, and session-accumulated knowledge.*
*Last updated: 2026-04-23 — Session covering product photos, staff RLS fix, Studio dropdown fix.*
*Maintained by: Claude Code instances on this project. Update after every session that introduces new patterns.*
