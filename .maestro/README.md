# Maestro E2E Tests

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

## Flows

| File | What it tests |
|---|---|
| `onboarding_signup_flow.yaml` | Full signup → 4-step onboarding → Grow dashboard; validates no redirect loop |
| `community_join_leave.yaml` | Join/leave community, RLS insert/delete, local state |
| `community_post_comments.yaml` | Open post detail, submit comment, comment appears |
| `community_detail_tabs.yaml` | Horizontal tab pager, Events, Games tabs |
| `friends_request_accept.yaml` | Send friend request from community members, Requests tab UI |
| `friends_request_decline.yaml` | Decline friend request flow |
| `community_members_screen.yaml` | Community members list |

## When to run

Run the relevant flow **before pushing** any change that touches:
- `app/_layout.tsx` → `onboarding_signup_flow.yaml`
- `app/(auth)/onboarding/**` → `onboarding_signup_flow.yaml`
- `store/communityStore.ts` → `community_join_leave.yaml`
- `app/(tabs)/discover/community/[id].tsx` → all community flows
- `app/(tabs)/discover/community/post/[postId].tsx` → `community_post_comments.yaml`
- Any Supabase migration touching `community_members`, `posts`, `comments` → all community flows

## Running the onboarding flow

The onboarding flow needs a test account that hasn't completed onboarding. Options:

**Option A — fresh email each run** (recommended for CI):
```bash
MAESTRO_TEST_EMAIL="test+$(date +%s)@yourdomain.com" \
MAESTRO_TEST_PASSWORD="TestPass123!" \
maestro test .maestro/flows/onboarding_signup_flow.yaml
```

**Option B — reset a fixed test account** (faster for local dev):
```sql
-- In Supabase SQL editor:
DELETE FROM profiles WHERE id = '<your-test-user-id>';
```
Then run:
```bash
MAESTRO_TEST_EMAIL="e2e@yourtestemail.com" \
MAESTRO_TEST_PASSWORD="TestPass123!" \
maestro test .maestro/flows/onboarding_signup_flow.yaml
```
