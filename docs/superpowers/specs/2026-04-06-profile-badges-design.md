# Profile & Badges Design

**Approved:** 2026-04-06

## Goal

Replace the broken profile edit-form-as-tab with a proper profile view card (own + others), add Discord-style earned badge icons beneath the avatar, and add an avatar picker (upload photo OR choose a cute preset emoji avatar).

## Screens

| Screen | Route | Purpose |
|---|---|---|
| Own profile view | `/(tabs)/profile/` | View your profile card as others see it |
| Profile edit | `/(tabs)/profile/edit` | Edit bio, pronouns, identity, avatar |
| Other user profile | `/(tabs)/profile/[userId]` | Read-only profile card for any user |
| Settings | `/(tabs)/profile/settings` | Unchanged |
| Delete account | `/(tabs)/profile/delete-account` | Unchanged |

## Profile Card Layout (top → bottom)

```
← back  (or ⚙ settings for own profile)

       [Avatar circle — 90px]
     🏅 💜 ⚡ 💬          ← earned badge row (max 5, tap for tooltip)

     Display Name
     @username
     she/her · lesbian      ← pronouns + identity chips (read-only)

     Bio text here

     🌸 Bloom · 125 pts

  [Edit Profile]  (own only)
```

## Avatar System

Two types of avatar stored in `profiles.avatar_url`:
- **Uploaded photo:** full HTTPS URL (existing behaviour)
- **Preset avatar:** `avatar://🐱` — rendered as a colored circle + large emoji

12 preset avatars: 🐱 🦊 🐸 🌸 🦋 🌙 🌈 💫 🐧 🍓 🌻 🐝
Each has a paired background color in `lib/avatars.ts`.

Picker opens as a bottom sheet with two tabs: "Upload Photo" | "Pick Avatar".

## Badge Display

- Source: `user_badge_progress JOIN badges` where `earned_at IS NOT NULL`
- Shown as emoji icons in a row below the avatar
- Max 5 visible; overflow shows `+N`
- Tapping a badge shows a small inline tooltip: badge name + description
- Shown on both own profile and other users' profiles

## Edit Screen

- Avatar picker (photo upload or preset)
- Display name (read-only — set during onboarding)
- Bio (editable)
- Pronouns (chip toggles)
- Identity labels (chip toggles)
- "My Badges" section at bottom: all badges with progress bar for unearned ones

## Navigation Changes

- `people.tsx` friend row: tapping name/avatar navigates to `/(tabs)/profile/[userId]`; a separate "Message" button opens DM (existing behaviour)

## Shared Component

`ProfileCard` accepts `{ profile, badges, isOwn, onEdit?, onSettings?, onBack? }` — renders identically for own and others, controlled by `isOwn` flag.

## Data Flow

- Own profile: `profileStore` (already loaded) + badges fetched once on mount
- Other user profile: fetch profile + badges from Supabase on mount by `userId` param
