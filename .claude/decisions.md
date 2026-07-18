# Locked Architectural Decisions — Do Not Revisit
## Append new entries as decisions are made. Do not relitigate existing entries.

[DECISION] Zero-churn architecture — dating is opt-in, community is primary
[REASON] Core product philosophy; every WLW life stage has a home on Roxy; no life stage = no churn reason
[ALTERNATIVES REJECTED] Dating-first tab structure (contradicts product philosophy)
[REVISIT CONDITION] Never

[DECISION] Supabase Realtime — Broadcast for ephemeral, filtered Postgres Changes for persistent
[REASON] Unfiltered Postgres Changes subscriptions will kill the backend at scale; table-wide listeners are O(n)
[ALTERNATIVES REJECTED] Table-wide listeners
[REVISIT CONDITION] Never unless Supabase changes Realtime architecture

[DECISION] AI rate limits enforced server-side only
[REASON] Client-side rate limiting is trivially bypassable; cost controls must be structural
[ALTERNATIVES REJECTED] Client-side rate limiting (security failure)
[REVISIT CONDITION] Never

[DECISION] Roxy is a wingwoman — never "AI", "assistant", "chatbot" in user-facing strings
[REASON] Core product differentiator; voice fidelity is a quality gate
[REVISIT CONDITION] Never

[DECISION] Dating mode off by default; users opt in explicitly
[REASON] Retention + safety decision; avoids unwanted dating pressure on community users
[REVISIT CONDITION] Never

[DECISION] claude-haiku-4-5-20251001 for edge function AI calls
[REASON] Cost control; haiku is sufficient for all 8 Roxy AI touchpoints; target <$0.50/user/month
[ALTERNATIVES REJECTED] Sonnet for all calls (cost prohibitive)
[REVISIT CONDITION] Only if quality scores consistently fail critic gate at haiku

[DECISION] All secrets in environment variables — never hardcoded
[REASON] Security fundamental; hardcoded secrets end up in git history
[ALTERNATIVES REJECTED] .env files committed to repo (exposes secrets in git history)
[REVISIT CONDITION] Never

[DECISION] Daily.co guarded import via lib/daily.ts isDailyAvailable()
[REASON] @daily-co/react-native-daily-js is native-only; module-level import crashes Expo Go
[REVISIT CONDITION] Only if Daily.co releases a web-compatible Expo package

[DECISION] EAS Build for mobile — no Expo Go in production
[REASON] Expo Go cannot run all native modules; production requires compiled binary
[ALTERNATIVES REJECTED] Expo Go for production (can't run Daily.co and other native deps)
[REVISIT CONDITION] Never

[DECISION] Single shared ObservabilityService across all Roxy apps via packages/observability
[REASON] Single point of PII control, consistent error tracking, no drift between apps
[ALTERNATIVES REJECTED] Per-app Sentry/PostHog setup — creates PII leak surface
[REVISIT CONDITION] Only if apps require completely different Sentry orgs

[DECISION] PII masking in ObservabilityService.beforeSend, not at call sites
[REASON] Defense in depth — even if a call site leaks PII, Sentry strips it at the boundary
[ALTERNATIVES REJECTED] Trusting call sites to self-strip
[REVISIT CONDITION] Never

[DECISION] PostHog autocapture: false
[REASON] WLW privacy — manual events only; autocapture risks PII capture
[ALTERNATIVES REJECTED] autocapture: true with blocklist — too fragile
[REVISIT CONDITION] Never

[DECISION] Media events debounced at 2000ms in shouldEmitMediaEvent()
[REASON] Daily.co participantUpdated fires ~10x/second during active calls
[ALTERNATIVES REJECTED] Throttle at call site — inconsistent
[REVISIT CONDITION] Unless Daily.co changes its event model

[DECISION] User IDs hashed to 8-char hex before any logging
[REASON] User IDs correlate all data across the app — treat as PII Tier 1
[ALTERNATIVES REJECTED] Logging raw user IDs
[REVISIT CONDITION] Never

[DECISION] ObservabilityService.initialize() called inside root component useEffect, never at module scope
[REASON] Module-scope init runs before Expo is ready — crashes builds
[ALTERNATIVES REJECTED] Module-scope init (crashes Expo before component tree is mounted)
[REVISIT CONDITION] Never

[DECISION] pgBouncer Transaction mode before launch
[REASON] High-concurrency protection for Supabase connections; direct connections don't scale at social app traffic
[ALTERNATIVES REJECTED] Direct Postgres connections at scale (connection exhaustion risk)
[REVISIT CONDITION] Never before launch; review after if traffic pattern changes

[DECISION] Session data pipeline — every schema decision evaluated for emotional AI training value
[REASON] Roxy is the training ground for Thinqer's second product; data architecture is day-one concern
[REVISIT CONDITION] Never — this shapes every feature decision

[DECISION] apps/client in the doc = apps/mobile in this repo
[REASON] Nicole's monorepo uses apps/mobile as the client app name; architecture PDFs say "apps/client"
[ALTERNATIVES REJECTED] Renaming the folder (breaking change across all import paths)
[REVISIT CONDITION] Unless repo is restructured

[DECISION] Notification link_path stores client route strings in the DB (migration 057)
[REASON] Ship the MVP fast; notification rows are short-lived and the two routes used are stable shims
[ALTERNATIVES REJECTED] Storing (type, entity_id) and resolving routes client-side — better seam, more work now
[REVISIT CONDITION] Before any route-group rename, or when a third notification type is added

[DECISION] Community-event notification fan-out runs synchronously inside the events INSERT trigger
[REASON] Simple and correct at current community sizes; trigger swallows its own errors so event creation can never fail because of it
[ALTERNATIVES REJECTED] Queued/async fan-out via pg_cron or edge function — infra not warranted pre-launch
[REVISIT CONDITION] When any community approaches ~5k members, move fan-out to a queue

[DECISION] No live-DB RLS isolation test harness yet; RLS verified by policy review only
[REASON] Repo has zero RLS test infrastructure; building it mid-branch would balloon session 19
[ALTERNATIVES REJECTED] Skipping the parent-CLAUDE isolation-test rule silently
[REVISIT CONDITION] Before public launch — add a supabase-test harness exercising notifications/conversations policies as two different users
