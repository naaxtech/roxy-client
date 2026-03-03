# Roxy

WLW community + dating + AI wingwoman app.

**Stack:** React Native + Expo SDK 51 · Supabase · Anthropic Claude (claude-haiku-4-5-20251001) · Daily.co

## Local Dev Setup

1. Copy `.env.example` to `.env` and fill in your keys
2. `cd apps/mobile && npm install`
3. `npx expo start --go` — scan QR with Expo Go app

## Environment Variables

| Variable | Where to get it |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase dashboard → Project Settings → API |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase dashboard → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Project Settings → API (keep secret) |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `DAILY_API_KEY` | dashboard.daily.co |
| `ONESIGNAL_APP_ID` | app.onesignal.com |

## Supabase CLI

```bash
npm install -g supabase
supabase login
supabase db push --project-ref YOUR_REF
supabase functions deploy --project-ref YOUR_REF
```

## Project Structure

```
roxy-client/
├── apps/mobile/          # Expo React Native app
├── supabase/
│   ├── migrations/       # SQL migrations (run in order)
│   └── functions/        # Edge Functions (Deno)
└── docs/plans/           # Architecture & implementation docs
```
