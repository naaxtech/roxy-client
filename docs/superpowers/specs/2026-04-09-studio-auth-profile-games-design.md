# Roxy Studio — Auth, Profile & Games Design

**Date:** 2026-04-09
**Branch:** session-13-studio-auth-profile-games (new)
**Scope:** Header shell, branding, profile page, community events+games, games catalog, migration 023

---

## 1. Layout Shell

The dashboard layout (`app/(dashboard)/layout.tsx`) changes structure:

**Before:**
```
<div className="flex min-h-screen">
  <Sidebar />
  <main>{children}</main>
</div>
```

**After:**
```
<div className="flex min-h-screen flex-col">
  <Header user={user} profile={profile} />
  <div className="flex flex-1">
    <Sidebar />
    <main>{children}</main>
  </div>
</div>
```

`DashboardLayout` (server component) fetches session + profile row once, passes as props to `Header`. No client-side fetch waterfall.

---

## 2. Branding

| Location | Before | After |
|---|---|---|
| Sidebar top block | "🌸 Studio" / "Host dashboard" | Removed entirely (Header owns branding) |
| Header left | *(new)* | "🌸 Roxy Studio" + "by Thinqer" muted subtitle |
| Login page heading | "🌸 Roxy Studio" / "Host dashboard" | "🌸 Roxy Studio" + "For WLW by WLW · Thinqer" |
| Root `<title>` | "Roxy Studio" | unchanged |

The Sidebar logo block is removed. The sidebar becomes nav-only.

---

## 3. Header Component

**`components/Header.tsx`** — server component

Props: `{ displayName: string | null, avatarUrl: string | null, email: string }`

Layout:
- `h-14`, `sticky top-0 z-40`, `border-b border-border bg-card`
- Left: "🌸 Roxy Studio" bold + "by Thinqer" muted text (`text-xs text-muted-foreground`)
- Right: `<UserMenu>` client component

**`components/UserMenu.tsx`** — `'use client'`

Props: `{ displayName: string | null, avatarUrl: string | null, email: string }`

Renders:
- Avatar circle: `avatar_url` if set, else initials from `display_name`, else first char of email
- On click: shadcn `DropdownMenu` with:
  - User name + email header (non-interactive, muted)
  - Separator
  - "Profile" → `router.push('/profile')`
  - "Logout" → `supabase.auth.signOut()` + `router.push('/auth/login')`

Uses existing `components/ui/dropdown-menu.tsx`.

---

## 4. Profile Page

**`app/(dashboard)/profile/page.tsx`** — server component

Fetches:
```ts
const { data: profile } = await supabase
  .from('profiles')
  .select('display_name, username, avatar_url, bio')
  .eq('id', userId)
  .single();
```

Renders:
- Avatar display (circle, initials fallback) — read only, no upload this session
- `<ProfileForm>` client component with the editable fields

**`components/ProfileForm.tsx`** — `'use client'`

Props: `{ userId: string, profile: { display_name, username, bio, avatar_url }, email: string }`

Fields:
| Field | Editable | Notes |
|---|---|---|
| Display name | Yes | `profiles.display_name` |
| Username | Yes | `profiles.username`, shown with @ prefix |
| Bio | Yes | `profiles.bio`, textarea |
| Email | No | Read-only, from auth session |
| Avatar | No | Displayed, upload deferred to future session |

On save: `supabase.from('profiles').update({ display_name, username, bio }).eq('id', userId)`
Success: inline "Profile saved ✓" green message
Error: inline red error message
No page navigation on save.

**Sidebar nav:** Add `{ href: '/profile', label: 'Profile' }` between "Dashboard" and "Events".

---

## 5. Community Page — Events & Games

**`app/(dashboard)/community/page.tsx`** extended.

Each community card gets two sub-sections below the existing name/description/member count:

### Events sub-section
Query: `events` where `community_id = community.id`, `starts_at >= now()`, ordered by `starts_at` asc, limit 5.

Columns shown: title, date (formatted), attendee count (from `event_attendees` count).
Empty state: "No upcoming events."

### Activated Games sub-section
Query: `community_games` joined with `games` where `community_id = community.id`.

Columns shown: game title, `is_official` badge ("Official" pill).
Empty state: "No games activated. Visit Games to add some."

---

## 6. Games Page

**`app/(dashboard)/games/page.tsx`** — server component (replaces placeholder)

Fetches:
1. All games from `games` table
2. All `community_games` rows for communities this user admins — to know which are activated per community

Renders a list of game cards. Each card shows:
- Game title + description
- "Official" badge if `is_official = true`
- Per-community toggles: for each community the host admins, a toggle (checkbox or button) to activate/deactivate that game for that community

Toggle action handled by `GamesToggleClient` client component — calls:
- Activate: `supabase.from('community_games').insert({ community_id, game_id })`
- Deactivate: `supabase.from('community_games').delete().eq('community_id', x).eq('game_id', y)`

Optimistic UI update on toggle with error rollback.

---

## 7. Migration 023

**`supabase/migrations/023_games_catalog.sql`**

```sql
-- games catalog
CREATE TABLE games (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  description   text,
  is_official   boolean NOT NULL DEFAULT false,
  submitted_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz DEFAULT now()
);

-- community <-> games junction
CREATE TABLE community_games (
  community_id  uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  game_id       uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  activated_at  timestamptz DEFAULT now(),
  PRIMARY KEY (community_id, game_id)
);

-- RLS
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_games ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read games
CREATE POLICY "games_read" ON games
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Community admins can manage their community_games
CREATE POLICY "community_games_manage" ON community_games
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM community_members
      WHERE community_members.community_id = community_games.community_id
        AND community_members.user_id = auth.uid()
        AND community_members.role = 'admin'
    )
  );

-- Seed: Roxy's official Speed Dating game
INSERT INTO games (title, description, is_official)
VALUES (
  'Speed Dating',
  'Roxy''s official speed dating game — timed 1:1 video rounds with matches at the end.',
  true
);
```

---

## 8. Files Changed / Created

| File | Action |
|---|---|
| `app/(dashboard)/layout.tsx` | Update — add Header, restructure shell |
| `components/Header.tsx` | New |
| `components/UserMenu.tsx` | New |
| `components/ProfileForm.tsx` | New |
| `components/GamesToggleClient.tsx` | New |
| `components/Sidebar.tsx` | Update — remove logo block, add Profile nav item |
| `app/(dashboard)/profile/page.tsx` | New |
| `app/(dashboard)/community/page.tsx` | Update — add events + games sub-sections |
| `app/(dashboard)/games/page.tsx` | Update — replace placeholder with full catalog |
| `app/auth/login/page.tsx` | Update — branding tagline |
| `supabase/migrations/023_games_catalog.sql` | New |

---

## 9. Out of Scope (this session)

- Avatar upload
- Game submission form (future marketplace)
- Password change on profile page
- Event creation from community page (already handled in `/events`)
