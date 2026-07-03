# Proven Open-Source Social Apps to Learn From

Reference list of production social apps with public codebases — apps with real users, shipped to app stores, actively maintained. Grouped by relevance to Roxy's stack.

---

## Tier 1 — Production, Millions of Users, Open Source

### 1. Bluesky Social
**Repo:** https://github.com/bluesky-social/social-app  
**Live app:** bsky.app — iOS, Android, Web  
**Users:** 25M+ registered accounts  
**Stack:** Expo + React Native + TypeScript + EAS Build + EAS Update (self-hosted OTA)  
**What it has:** Feed (algorithmic + chronological), likes, reposts, replies, follows, DMs, notifications, image/video posts, moderation, i18n, accessibility  
**Why study it:**
- Closest real-world match to Roxy's mobile stack (Expo + EAS + TypeScript)
- Shows how a Twitter-scale social app structures its feed, infinite scroll, and Realtime
- Their EAS Update setup is battle-tested — self-hosted OTA updates without app store review
- Navigation architecture (Expo Router v3 equivalent patterns)
- Moderation system design (content warnings, mutes, blocks) — directly applicable to Roxy's safety layer

**Key files to read:**
- `src/screens/HomeScreen.tsx` — feed implementation
- `src/components/Post` — post card architecture
- `src/state/` — global state (uses Jotai, Roxy uses Zustand — same concept)

---

### 2. Expensify (New Expensify)
**Repo:** https://github.com/Expensify/App  
**Live app:** new.expensify.com — iOS, Android, Web, Desktop  
**Users:** 15M+ (enterprise, active daily)  
**Stack:** React Native + TypeScript + React Native Web (cross-platform from one repo)  
**What it has:** Real-time group chat, direct messages, threads, reactions, read receipts, push notifications, file/image attachments, deep links, offline support  
**Why study it:**
- Largest open-source React Native codebase — 200k+ lines of TypeScript
- Their chat architecture is the best public reference for: typing indicators, read receipts, message reactions, optimistic UI with rollback
- Realtime subscription patterns without Supabase — shows the abstraction layer cleanly
- Storybook + Jest + Reassure (performance regression) — their test discipline is exceptional
- CLAUDE.md in their repo — they also use Claude Code at scale

**Key files to read:**
- `src/libs/ReportUtils.ts` — chat threading logic
- `src/components/ReportActionItem/` — message bubble components
- `src/pages/home/report/` — chat screen

---

## Tier 2 — Production, Real Users, Open Source (Smaller Scale)

### 3. Showtime (showtime.xyz)
**Repo:** https://github.com/showtime-xyz/showtime-frontend  
**Live app:** showtime.xyz — iOS, Android, Web (same codebase)  
**Stack:** Expo + Next.js + Solito (universal) + TypeScript + custom design system  
**What it has:** Social feed, posts, follows, comments, likes, notifications, creator profiles, NFT minting (ignore this part)  
**Why study it:**
- Best public example of a universal Expo + Next.js monorepo (same code on web and mobile)
- Their `packages/design-system` is a production-quality RN component library
- `showtime-xyz/showtime-tab-view` — their open-sourced collapsible tab header component, directly applicable to Roxy's profile screen with photos/about/posts tabs
- Their `useContentFocus` + `useScrollToTop` patterns are gold for feed screens

**Key files to read:**
- `packages/app/components/feed/` — feed card architecture
- `packages/design-system/` — button, avatar, text components
- `packages/app/hooks/use-platform-bottom-height.ts` — keyboard avoidance pattern

---

### 4. Graysky (Bluesky third-party client)
**Repo:** https://github.com/mozzius/graysky  
**Live app:** App Store / Play Store  
**Stack:** Expo + Expo Router + TypeScript + React Query  
**What it has:** Full Bluesky feed, thread view, notifications, DMs, image viewer, video player  
**Why study it:**
- Smaller codebase than official Bluesky — easier to read fully in one sitting
- Built by one developer as a side project, now production on both stores
- Excellent Expo Router v3 navigation patterns
- Their media carousel and lightbox implementation is clean

---

## Tier 3 — Educational / Reference (Not Production at Scale, but Architecturally Sound)

### 5. notJust.dev Instagram Clone
**Repo:** https://github.com/notJust-dev/Instagram  
**Stack:** Expo + Supabase + TypeScript + Expo Router  
**What it has:** Auth, feed, posts (photo + video), likes, comments, profiles, Cloudinary media upload  
**Why study it:**
- **Closest stack match to Roxy** — Supabase + Expo + TypeScript + Expo Router
- Not a production app but the architecture decisions mirror ours exactly
- Supabase RLS patterns, storage bucket setup, edge function calls — all transferable

---

### 6. ElSierra Social App (Twitter-like)
**Repo:** https://github.com/ElSierra/Social-app-React-Native  
**Backend:** https://github.com/ElSierra/SocialApp-NodeJS  
**Stack:** React Native + Expo + TypeScript + Node.js/Express  
**What it has:** Posts, likes, follows, discover, DMs, auth  
**Why study it:**
- Strong UI patterns for a Twitter-style social feed
- Good reference for the Discover tab design (explore/search UX)
- Not Supabase-backed but the component architecture is transferable

---

### 7. Humbble (Open-source Bumble alternative)
**Repo:** https://github.com/Prakashchandra-007/humbble  
**Stack:** React Native + Expo  
**What it has:** Swipe/match flow, chat, user profiles, privacy controls  
**Why study it:**
- Dating app architecture — directly applicable to Roxy's opt-in dating mode
- Swipe card UX patterns
- Match → chat flow

---

### 8. LuckyBelieve Social App
**Repo:** https://github.com/LuckyBelieve/social-app  
**Stack:** React Native + Expo + Supabase  
**What it has:** Posts, profiles, follows, Supabase backend  
**Why study it:**
- Supabase + React Native patterns, simpler codebase — good for quick pattern lookups

---

## What to Actually Pull From Each for Roxy

| What we need | Best reference |
|---|---|
| Feed infinite scroll + performance | Bluesky `social-app` |
| Chat: read receipts, reactions, typing | Expensify `App` |
| Profile tab view with collapsible header | Showtime `showtime-tab-view` |
| Expo Router v3 navigation at scale | Graysky |
| Supabase + Expo patterns (our exact backend) | notJust-dev Instagram |
| Dating swipe / match flow | Humbble |
| Discover/explore tab UX | ElSierra Social App |
| EAS Build + OTA CI/CD | Bluesky docs |

---

## Stack Comparison vs Roxy

| App | Expo | Supabase | TypeScript | Expo Router | Realtime | EAS |
|---|---|---|---|---|---|---|
| Bluesky | ✓ | ✗ (atproto) | ✓ | ✓ | ✓ | ✓ |
| Expensify | ✗ (bare RN) | ✗ (Onyx) | ✓ | ✗ | ✓ | ✗ |
| Showtime | ✓ | ✗ (custom) | ✓ | ✗ (Solito) | ✓ | ✓ |
| Graysky | ✓ | ✗ (atproto) | ✓ | ✓ | ✓ | ✓ |
| notJust Instagram | ✓ | **✓** | ✓ | ✓ | ✗ | ✓ |
| **Roxy** | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** |

---

*Last updated: 2026-07-03*
