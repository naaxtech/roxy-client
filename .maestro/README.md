# Maestro E2E Tests

Native end-to-end flows. The web equivalents live in `apps/mobile/tests/e2e/`
(Playwright) — the two suites are not interchangeable: Maestro drives a real
build on a device, Playwright drives the Expo web bundle in Chromium.

## Setup

### 1. Install Java 17+
Download from https://adoptium.net and install. Restart terminal after.

### 2. Install Maestro
```bash
curl -Ls "https://get.maestro.mobile.dev" | bash
# Restart terminal, then verify:
maestro --version
```

### 3. Build and run the dev app
```bash
cd apps/mobile
eas build --profile development --platform android  # first time only
npx expo start --dev-client
```

## Running flows

Run a single flow:
```bash
maestro test .maestro/flows/community_join_leave.yaml
```

Run all flows:
```bash
maestro test .maestro/flows/
```

`.maestro/subflows/` holds fragments that other flows `runFlow` into. Do not
point `maestro test` at that directory — those files are not flows on their own.

## Selectors

Prefer `id:` (the `testID` prop) over `text:`. Copy moves; a testID is a
contract. `text:` is reserved for content that comes from the database (a
community name, a member's action label) where there is no stable id to hold.

The tab bar emits `nav-slot-<route>` per slot, so navigation reads:

```yaml
- tapOn:
    id: "nav-slot-discover"
```

## The 3.0 information architecture

Four destinations plus one action. `Grow`, `Connect` and `Build` no longer
exist — every flow that selected them by label was failing before this rewrite.

| Slot | testID | What moved here |
|---|---|---|
| Feed | `nav-slot-feed` | the pager, the streak chip, Mini Wins, the live-rooms "Now" rail |
| Discover | `nav-slot-discover` | communities, events, shops, games, the notifications bell, search |
| ＋ | `nav-slot-create` | an action, not a destination — opens `create-sheet`, never changes route |
| Messages | `nav-slot-messages` | DMs, both pinned personas, the request-first inbox |
| You | `nav-slot-you` | profile, safety modes, My people, badges, saved, tickets |

Where the old screens went:

| Was | Now |
|---|---|
| Connect › Communities browser | Discover › Communities rail → **See all** (`rail-communities-link`) |
| Grow › My People | You → **My people** (`you-people`) — the only link to `/people` |
| Grow › Requests tab | Messages → `messages-requests-entry` → `requests-sheet` |
| Grow › Badges | You → **Badges** (`you-badges`) — the only link to `/badges` |
| Play/Discover › community detail | root route `/community/<id>`, opened from any tab |

## Flows

| File | What it tests |
|---|---|
| `onboarding_signup_flow.yaml` | Invite code → signup → 4-step onboarding → Feed; validates no redirect loop |
| `community_join_leave.yaml` | Join/leave community, RLS insert/delete, local state |
| `community_post_comments.yaml` | Open post detail, submit comment, comment appears |
| `community_detail_tabs.yaml` | Horizontal sub-tab pager (Posts/Reels/Rooms/Games/Events) |
| `friends_request_accept.yaml` | Send a request from community members, then find it under Sent |
| `friends_request_decline.yaml` | Decline from the request-first inbox on Messages |
| `community_members_screen.yaml` | Community members list |

## The first-run sheet

Feed is the initial tab and opens the Mini Wins sheet once per calendar day per
device. It is a `Modal`, so its scrim swallows taps meant for the tab bar — a
flow that navigates before dismissing it fails on an intercepted tap that has
nothing to do with what it was testing. Every flow that navigates therefore
starts with:

```yaml
- runFlow: ../subflows/dismiss_first_run.yaml
```

It is conditional on the sheet being visible, so it is a no-op on a device that
has already seen it today.

## When to run

Run the relevant flow **before pushing** any change that touches:
- `app/_layout.tsx` → `onboarding_signup_flow.yaml`
- `app/(auth)/**` (code gate, welcome, onboarding) → `onboarding_signup_flow.yaml`
- `app/(tabs)/_layout.tsx`, `components/nav/**` → all flows (every one navigates)
- `store/communityStore.ts` → `community_join_leave.yaml`
- `app/(tabs)/discover/community/[id].tsx` → all community flows
- `app/(tabs)/discover/community/post/[postId].tsx` → `community_post_comments.yaml`
- `components/messages/RequestsSheet.tsx` → `friends_request_decline.yaml`
- Any Supabase migration touching `community_members`, `posts`, `comments`,
  or `friendships` → the matching flows

## Running the onboarding flow

The onboarding flow needs a test account that hasn't completed onboarding, and
an invite code the gate will accept. Options:

**Option A — fresh email each run** (recommended for CI):
Set `MAESTRO_TEST_EMAIL` to a unique address per run and `MAESTRO_INVITE_CODE`
to a code with remaining uses.

**Option B — reset the existing test account** in Supabase:
```sql
UPDATE profiles SET onboarding_completed = false WHERE id = '<test-user-id>';
```
