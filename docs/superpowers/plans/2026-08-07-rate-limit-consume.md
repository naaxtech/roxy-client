# A rate limiter that counts what it writes

**Branch:** `version2` · **Migration:** `091_consume_rate_limit.sql` (090 is the marketplace FK, in flight)
**Line it moves:** reduced cost — six uncapped functions include two Stripe paths and two GDPR paths.

## The defect

`_shared/rateLimit.ts` splits one decision across two functions:

- `checkRateLimit()` counts rows in `ai_call_log` filtered by `function_name`.
- `logAiCall()` writes those rows.

Nothing makes a caller do both. **Six of the twelve callers never call `logAiCall`:**

| Function | Cap it believes it has | Rows it has ever written | Cap actually enforced |
|---|---|---|---|
| `create-payment-intent` | 10/day | 0 | none |
| `stripe-dashboard-link` | 50/day | 0 | none |
| `submit-report` | 10/day | 0 | none |
| `gdpr-export` | 5/day | 0 | none |
| `gdpr-delete` | 3/day | 0 | none |
| `cancel-event` | 5/day | 0 | none |

`checkRateLimit` filters `.eq('function_name', params.fnName)`, so rows written by the *other* six do not
help: each of these six queries a set that is empty by construction. `count` is `0`, `0 < maxCount` holds,
`allowed` is `true`. **Every one of these caps has returned `allowed: true` on every request since it was
written.** The 429 branch below each of them is unreachable code.

This is the same shape as the two safety defects of 2026-08-07: the question is never "does it write to
the right table", it is **"does anything read what it writes"** — and here, inverted, "does anything write
what it reads".

## Two defects, not one

**D-1 — the fail-open.** Above.

**D-2 — a TOCTOU race in the surviving six.** Even where `logAiCall` *is* called, the check and the write
are separate round trips with the work in between. Two concurrent requests both read `count = 9` against a
cap of 10, both proceed, both insert. The cap is exceeded by however many requests are in flight. For
`roxy-wingwoman` (5/conversation/day) that is a real AI-spend leak; for `create-payment-intent` it would be
a real payment-attempt leak once D-1 is fixed.

Fixing D-1 without D-2 would ship a cap that is honest about the limit and still wrong under load.

## The fix: make recording the check

Replace the pair with one `SECURITY DEFINER` SQL function that decides and records in the same
transaction, so **the recording is not a step a caller can omit — it is how the answer is computed.**

```sql
consume_rate_limit(p_user_id uuid, p_fn_name text, p_max_count int,
                   p_window_type text, p_conversation_id uuid, p_was_mock bool)
  RETURNS TABLE (allowed boolean, current_count int)
```

Serialised per `(user, function)` with a transaction-scoped advisory lock so D-2 closes too. A lock keyed
on the pair means two different users, or one user hitting two functions, never wait on each other.

Adding a row to `ai_call_log` per *attempt* rather than per *success* is deliberate and is the safe
direction: an attempt that fails downstream has still consumed a slot, and a caller that forgets the
refund path over-counts. **Forgetting must cost the user a slot, never the platform a cap.** That is the
whole reason this defect existed — the old design's forgetful path was the fail-open one.

`refundRateLimit()` deletes the row by id for the failure path. Callers use it where an attempt that never
reached the expensive resource should not be charged — notably `roxy-onboarding`, whose cap is *lifetime,
max 1*: without a refund, one transient Anthropic 500 locks a woman out of her onboarding recommendations
permanently.

## What happens when the limiter itself fails — decided per function, not by accident

Making the write the check couples them: if `consume_rate_limit` errors (a DB blip, a pool timeout), the
caller has no count and must choose. Today's code has this choice too and makes it invisibly — `roxy-chat`
logs `logErr` and serves the reply anyway, with a comment that says why:

> *A silent logging failure is what let the rate limit read zero forever. The reply still goes out —
> refusing a woman her answer because we could not write an audit row would be the wrong trade.*

That reasoning is right for `roxy-chat` and **wrong for `create-payment-intent`**. One trade is a woman's
answer; the other is unbounded payment attempts. So the helper takes an explicit policy and there is no
default:

```ts
onLimiterFailure: 'deny' | 'allow'
```

| Policy | Functions | Why |
|---|---|---|
| `'allow'` | `submit-report` | **A woman reporting abuse must never be blocked by our database having a bad second.** A duplicate report costs a moderator ten seconds. A refused one costs her the report. This is the single most important row in this table. |
| `'allow'` | `roxy-chat`, `roxy-greeting`, `roxy-nudge`, `roxy-sister`, `roxy-icebreaker`, `roxy-wingwoman` | Preserves today's deliberate behaviour. Bounded blast radius: a limiter outage costs AI spend, and spend is recoverable. |
| `'deny'` | `create-payment-intent`, `create-product-order`, `stripe-dashboard-link` | Money. An uncapped payment path during an outage is the scenario the cap exists for. |
| `'deny'` | `gdpr-delete`, `gdpr-export`, `cancel-event` | Destructive or expensive and always retryable by the member a moment later. |
| `'deny'` | `roxy-onboarding` | Lifetime cap of 1. Allowing on failure means allowing a *second* lifetime call. |

Every `'allow'` site must `console.error` the failure — an allow-on-failure that is silent is
indistinguishable from the fail-open we are fixing.

## Naming

`ai_call_log` keeps its name. Six of its writers are not AI, which makes the name wrong, but renaming a
table with an RLS policy, two indexes and a FK is a migration whose only product is a better noun, and it
would collide with the in-flight 090. The column `function_name` already carries the real meaning. A
comment on the table records the discrepancy. **Flagged, not fixed** — worth its own slice.

## Scope boundary — do not touch

`supabase/functions/create-product-order/**` is **out of scope for every agent in this plan**. It holds an
uncommitted C-1/C-2 diff under review. Its rate-limit call site is converted last, by the coordinator,
after that diff is committed.

## Slices

| # | Scope | Files | Depends on |
|---|---|---|---|
| A | Migration + check script | `supabase/migrations/091_*.sql`, `supabase/tests/091_*_check.sql` | research |
| B | Helper rewrite + unit tests | `supabase/functions/_shared/rateLimit.ts`, `_shared/rateLimit.test.ts` | A's signature |
| C | The six fail-open call sites | `cancel-event`, `create-payment-intent`, `gdpr-delete`, `gdpr-export`, `stripe-dashboard-link`, `submit-report` | B |
| D | The six AI call sites (remove the now-double `logAiCall`) | `roxy-chat`, `roxy-sister`, `roxy-nudge`, `roxy-onboarding`, `roxy-icebreaker`, `roxy-wingwoman`, `roxy-greeting`, `join-speed-date-session` | B |
| E | `create-product-order` | coordinator only, last | C-1 commit |

**D is the dangerous one.** Every function in it already calls `logAiCall`. If the consume-write lands and
the old `logAiCall` stays, each call writes **two** rows and every AI cap silently halves. Slice D's whole
job is that both sides move together.

## Test that must fail first

Per slice, one test that fails without the change, watched failing:

- **C**: for each of the six — issue `maxCount` successful requests, assert the next returns 429. Today
  this fails at request `maxCount + 1`, which returns 200. This test is the executable form of the rule.
- **D**: assert exactly ONE `ai_call_log` row per successful call. Fails with a double-write.
- **B**: assert a refund removes the row and restores the slot; assert a consume with no refund keeps it.

## Gate

`npx tsc --noEmit` · `npx eslint . --ext .ts,.tsx --max-warnings 0` · `npx jest --ci` ·
`deno test --no-check --allow-net --allow-env .` · then `091_*_check.sql` against production after push.
