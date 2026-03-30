# Session 7 — Fix What's Broken: Design Spec

## Goal

Polish 5 broken or missing UX flows before adding new features. No new screens beyond what's listed here.

## Fixes Overview

| # | Fix | Files changed |
|---|-----|---------------|
| 1 | FAB → Roxy Chat directly | `RoxyCompanionButton.tsx`, `_layout.tsx` |
| 2 | Roxy Chat UX | `grow/roxy-chat.tsx` |
| 3 | Grow screen navigation + avatar | `grow/index.tsx`, new `grow/badges.tsx` |
| 4 | Account deletion flow | `profile/settings.tsx`, new `profile/delete-account.tsx`, `gdpr-delete/index.ts`, migration 007 |
| 5 | Support org — detail sheet | `build/index.tsx` |

---

## Fix 1: FAB → Roxy Chat Directly

### Current behaviour
`RoxyCompanionButton` shows an `Alert.alert` with two options: "Chat with Roxy" and "I need support". This is clunky and adds an unnecessary tap.

### Target behaviour
- ✨ button → navigates directly to `/(tabs)/grow/roxy-chat`, no Alert
- Sister (💜 I need support) stays where it is: accessible from the Connect tab (its own banner/button there)
- FAB is hidden when the user is already on the roxy-chat screen (avoid double entry point and visual clutter)

### Changes

**`apps/mobile/components/ui/RoxyCompanionButton.tsx`**
- Add `visible` prop (default `true`)
- Remove Alert; `handlePress` → `router.push('/(tabs)/grow/roxy-chat')`
- Return `null` when `visible === false`

**`apps/mobile/app/(tabs)/_layout.tsx`**
- Import `usePathname` from `expo-router`
- Compute `fabVisible = !pathname.includes('/grow/roxy-chat')`
- Pass `visible={fabVisible}` to `<RoxyCompanionButton />`

---

## Fix 2: Roxy Chat UX

### Current issues
1. FAB still renders on top of the chat screen (fixed by Fix 1)
2. Keyboard on Android: `behavior={undefined}` → input stays behind keyboard
3. The back chevron `‹` is functional but small; user doesn't know they can back out

### Target behaviour
- Input always visible above keyboard on both platforms
- Back button clearly labelled "Back" alongside the chevron
- No other changes needed — message history in session-state is already correct

### Changes

**`apps/mobile/app/(tabs)/grow/roxy-chat.tsx`**
- `KeyboardAvoidingView` behavior: change `undefined` (Android) → `'height'`
- Back button label: add `<Text style={styles.backLabel}>Back</Text>` beside the `‹` icon

---

## Fix 3: Grow Screen Navigation + Avatar

### Current issues
- Communities chips are static `<View>` — tapping does nothing
- Journey section is non-interactive
- Badges section is non-interactive
- No user avatar in the header — the Grow screen has no header at all

### Target behaviour

**Header:**
- Add a sticky mini-header at the top of the ScrollView (inside SafeAreaView, not a native header)
- Left: user avatar (first letter of `display_name` on a coloured circle, or `avatar_url` if set in a later session)
- Centre: "Grow" title
- Right: empty spacer (or settings icon linking to profile — defer to Session 8)

**Communities:**
- Whole section card becomes `TouchableOpacity` → navigates to `/(tabs)/discover`
- Chips remain visual-only (tapping a chip also navigates to Discover for now)
- Add `+ Join more` chip at end of chip row, styled with roxy colour

**Journey:**
- Wrap in `TouchableOpacity` with no navigation for now — adds visual feedback (ripple/opacity)
- Show progress hint: `"X pts to next level"` → already implemented; no change needed

**Badges:**
- Wrap section in `TouchableOpacity` → navigates to `/(tabs)/grow/badges`
- Show first 4 badge emojis as a preview row (earned bright, unearned dim)
- Show `"N earned · M in progress"` summary below

**New screen `apps/mobile/app/(tabs)/grow/badges.tsx`:**
- Full-screen list of all badges with progress bars
- Reuses the existing `BadgeProgressRow` type and data from `user_badge_progress` + `badges`
- Back button → `router.back()`

### Changes

**`apps/mobile/app/(tabs)/grow/index.tsx`**
- Import `TouchableOpacity`, `useRouter`
- Add `HeaderRow` component (inline) with avatar + title
- Wrap Communities section in `TouchableOpacity` → `router.push('/(tabs)/discover')`
- Wrap Journey section in `TouchableOpacity` (no navigation, just `activeOpacity={0.75}`)
- Replace Badges section: show 4-emoji preview + summary → `TouchableOpacity` → `router.push('/(tabs)/grow/badges')`

**New `apps/mobile/app/(tabs)/grow/badges.tsx`**
- Full badges list; data fetched the same way as current inline fetch in `index.tsx` (separate `useEffect`)

---

## Fix 4: Account Deletion Flow

### Current behaviour
Settings → "Delete my account" → nested Alert → immediate hard delete (`deleteUser` called)

### Problems
- Two nested Alerts with no text confirmation — easy to misclick
- No grace period — GDPR best practice is 30-day soft delete
- No email confirmation (future)

### Target behaviour
Settings → "Delete my account" → navigates to dedicated screen `profile/delete-account.tsx`:
1. Screen shows: warning text, "Your account will be deactivated immediately. All data deleted after 30 days."
2. `TextInput` prompts user to type `DELETE` (all-caps)
3. Red "Delete my account" button enabled only when input === `'DELETE'`
4. On confirm → calls `gdpr-delete` edge function → clears PII + sets `deleted_at` → signs out → navigates to `/(auth)/login`
5. A confirmation message is shown before sign-out: "Account scheduled for deletion. You'll receive an email confirmation."

### Data

**New migration `supabase/migrations/007_soft_delete.sql`:**
```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
```

### Edge function changes

**`supabase/functions/gdpr-delete/index.ts`:**
- Add `deleted_at: new Date().toISOString()` to the profile update
- Remove `supabase.auth.admin.deleteUser` call — soft delete only; hard delete happens via a scheduled job in a future session
- Return `{ ok: true, scheduled_deletion: '30 days' }` in success response

### Mobile changes

**`apps/mobile/app/(tabs)/profile/settings.tsx`:**
- Change `handleDeleteAccount` from nested Alerts to `router.push('/(tabs)/profile/delete-account')`

**New `apps/mobile/app/(tabs)/profile/delete-account.tsx`:**
- `TextInput` for DELETE confirmation
- Confirm button disabled until `input === 'DELETE'`
- Calls `callEdgeFunction('gdpr-delete', {})`
- On success: `await supabase.auth.signOut()` + `useAuthStore.getState().signOut()` + `router.replace('/(auth)/login')`
- Loading state during the call

---

## Fix 5: Support Org — Real Action

### Current behaviour
Build tab → Impact section → "Support" button optimistically increments `supporter_count` with no feedback beyond button changing to "✓ Supported". User learns nothing about the org.

### Target behaviour
"Support" button → opens a `Modal` (React Native built-in, no new deps) showing:
- Org name + emoji
- Full description (not truncated)
- Website link ("Visit website →") using `Linking.openURL`
- Share button using `Share.share({ message: 'Check out ${name} on Roxy!', url: website_url })`
- "I'll support this project 💜" button → calls existing `handleSupport` + closes modal
- Close ✕ button top-right
- Payment deferred to Session 10

### Changes

**`apps/mobile/app/(tabs)/build/index.tsx`:**
- Add `selectedProject` state: `ImpactProject | null`
- `ImpactCard`: `onSupport` prop renamed to `onPress` (opens detail modal, not directly supporting)
- New `ImpactDetailModal` component (inline in same file) using `<Modal visible={!!selectedProject} animationType="slide" transparent>`
- Modal content: org details + website + share + support button
- After support: modal stays open with button showing "✓ Supported"; user closes manually

---

## Scope Boundaries

- **No new navigation tabs** — all fixes use existing routes or simple push navigation
- **No payment** — Support org payment is Session 10
- **No real email sending** — deletion email is a future task (Resend integration)
- **No avatar upload** — avatar is initials-only in this session; full image picker in Session 8
- **No gamification triggers** — point-earning logic is Session 4+ already handled; this session doesn't change criteria

---

## Migration Summary

| File | Contents |
|------|----------|
| `supabase/migrations/007_soft_delete.sql` | `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;` |

---

## Files Created / Modified

| File | Action |
|------|--------|
| `apps/mobile/components/ui/RoxyCompanionButton.tsx` | Modify — remove Alert, add `visible` prop |
| `apps/mobile/app/(tabs)/_layout.tsx` | Modify — pass `visible` to FAB based on `usePathname` |
| `apps/mobile/app/(tabs)/grow/roxy-chat.tsx` | Modify — keyboard fix + back label |
| `apps/mobile/app/(tabs)/grow/index.tsx` | Modify — tappable sections, header with avatar |
| `apps/mobile/app/(tabs)/grow/badges.tsx` | Create — full badges list screen |
| `apps/mobile/app/(tabs)/profile/settings.tsx` | Modify — navigate to delete screen instead of Alert |
| `apps/mobile/app/(tabs)/profile/delete-account.tsx` | Create — DELETE confirmation screen |
| `supabase/functions/gdpr-delete/index.ts` | Modify — soft delete, no hard delete |
| `supabase/migrations/007_soft_delete.sql` | Create |
| `apps/mobile/app/(tabs)/build/index.tsx` | Modify — ImpactDetailModal |
