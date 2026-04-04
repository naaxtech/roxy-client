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
| `community_join_leave.yaml` | Join/leave community, RLS insert/delete, local state |
| `community_post_comments.yaml` | Open post detail, submit comment, comment appears |
| `community_detail_tabs.yaml` | Horizontal tab pager, Events, Games tabs |

## When to run

Run the relevant flow **before pushing** any change that touches:
- `store/communityStore.ts` → `community_join_leave.yaml`
- `app/(tabs)/discover/community/[id].tsx` → all three
- `app/(tabs)/discover/community/post/[postId].tsx` → `community_post_comments.yaml`
- Any Supabase migration touching `community_members`, `posts`, `comments` → all three
