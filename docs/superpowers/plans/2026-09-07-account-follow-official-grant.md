# Account Follow Official Grant Implementation Plan

> **For agentic workers:** Execute in this session. Phase 1 overlay only.

**Goal:** Ship follows, official community grant, and Claude Design Follow vs Join / Discover placement without a hard cut of `posts.community_id`.

**Architecture:** Thin overlay. Posts already home on `author_id` when `community_id` is null. Add `follows` and `profiles.official_community_id`. UI reads those two facts.

**Tech Stack:** Postgres / RLS, Expo React Native, Zustand, Jest

**Spec:** `docs/superpowers/specs/2026-09-07-account-follow-official-grant-design.md`

## Global Constraints

- Theme via `useThemeColors` / `lib/theme.ts`. Touch ≥ `MIN_TOUCH_TARGET`.
- Feature parity: do not orphan `/people`, `/badges`, `/tickets`, Settings, `/community/[id]`.
- Clients never UPDATE `official_community_id` or `is_community_owner`.
- Do not dual-write posts. Do not implement Phase 2.
- Look from Claude Design `Roxy App.dc.html`.
- Do not commit unless asked.

---

### Task 1: Schema

- Create: `supabase/migrations/116_follows_and_official_community.sql`
- Create: `supabase/downs/116_follows_and_official_community_down.sql`
- Test: contract assertions in `apps/mobile/__tests__/lib/features.test.ts`

### Task 2: Client libs

- Create: `apps/mobile/lib/follows.ts`, `officialGrant.ts`, `profileSocialActions.ts`
- Create matching tests
- Modify: `apps/mobile/types/index.ts` (`official_community_id`, `Follow`, nullable `Post.community_id`)

### Task 3: Profile UI

- Modify: `ProfileShell` (official chip, square frame, tertiary action)
- Modify: `you/[userId].tsx` Follow / Join
- Tests: ProfileShell + UserProfileShell

### Task 4: Feed + Discover

- Modify: Feed Following uses follow ids
- Modify: Discover official-first sort
- Modify: ReelsFeed empty copy + follow graph comment
