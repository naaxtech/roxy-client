# Studio Auth, Profile & Games Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sticky header with user avatar dropdown (profile + logout), a profile edit page, community events/games sub-sections, a games catalog page with per-community toggles, migration 023 (games + community_games), and update all branding to "Roxy Studio / For WLW by WLW · Thinqer".

**Architecture:** Server components fetch data (session + profile) once at the layout level and pass it as props to client components. Client components handle interactivity only. All DB writes go through the Supabase browser client with RLS enforcement. Migration 023 adds the games catalog tables and CHECK constraints on profiles.

**Tech Stack:** Next.js 16 App Router, Supabase SSR, shadcn/ui (DropdownMenu, Button, Input, Label, Badge, Card), Vitest + React Testing Library for unit tests, Tailwind CSS.

---

## Task 1: Branch + Migration 023

**Files:**
- Create: `supabase/migrations/023_games_catalog.sql`

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull
git checkout -b session-13-studio-auth-profile-games
```

- [ ] **Step 2: Create the migration file**

Create `supabase/migrations/023_games_catalog.sql`:

```sql
-- ─── games catalog ────────────────────────────────────────────────────────────
CREATE TABLE games (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  description   text,
  is_official   boolean NOT NULL DEFAULT false,
  submitted_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz DEFAULT now(),
  CONSTRAINT games_title_length     CHECK (char_length(title) <= 100),
  CONSTRAINT games_desc_length      CHECK (char_length(description) <= 500)
);

-- ─── community <-> games junction ────────────────────────────────────────────
CREATE TABLE community_games (
  community_id  uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  game_id       uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  activated_at  timestamptz DEFAULT now(),
  PRIMARY KEY (community_id, game_id)
);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_games ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read games catalog
CREATE POLICY "games_read" ON games
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Community admins can manage their community_games (insert + delete)
CREATE POLICY "community_games_manage" ON community_games
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM community_members
      WHERE community_members.community_id = community_games.community_id
        AND community_members.user_id = auth.uid()
        AND community_members.role = 'admin'
    )
  );

-- ─── Profile input constraints ────────────────────────────────────────────────
-- These enforce server-side validation for profile fields edited in Studio
ALTER TABLE profiles
  ADD CONSTRAINT IF NOT EXISTS profiles_display_name_length
    CHECK (char_length(display_name) <= 100),
  ADD CONSTRAINT IF NOT EXISTS profiles_username_format
    CHECK (username ~ '^[a-zA-Z0-9_]{1,30}$'),
  ADD CONSTRAINT IF NOT EXISTS profiles_bio_length
    CHECK (char_length(bio) <= 500);

-- ─── Seed ─────────────────────────────────────────────────────────────────────
INSERT INTO games (title, description, is_official)
VALUES (
  'Speed Dating',
  'Roxy''s official speed dating game — timed 1:1 video rounds with matches at the end.',
  true
);
```

- [ ] **Step 3: Push the migration to remote**

```bash
npx supabase db push --project-ref ptymtdlysqbpxzlgsshp
```

Expected: `Applied migration 023_games_catalog` with no errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/023_games_catalog.sql
git commit -m "feat: migration 023 — games catalog, community_games, profile CHECK constraints"
```

---

## Task 2: Vitest Test Framework Setup

**Files:**
- Modify: `apps/studio/package.json`
- Create: `apps/studio/vitest.config.ts`
- Create: `apps/studio/vitest.setup.ts`

- [ ] **Step 1: Install test dependencies**

```bash
cd apps/studio
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

- [ ] **Step 2: Create `apps/studio/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
```

- [ ] **Step 3: Create `apps/studio/vitest.setup.ts`**

```ts
import '@testing-library/jest-dom';
```

- [ ] **Step 4: Add test script to `apps/studio/package.json`**

In the `"scripts"` section, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Verify setup runs**

```bash
cd apps/studio && npm test
```

Expected: `No test files found` (not an error — just no tests yet).

- [ ] **Step 6: Commit**

```bash
git add apps/studio/vitest.config.ts apps/studio/vitest.setup.ts apps/studio/package.json apps/studio/package-lock.json
git commit -m "chore: add Vitest + React Testing Library to Studio"
```

---

## Task 3: UserMenu Component + Tests

**Files:**
- Create: `apps/studio/components/UserMenu.tsx`
- Create: `apps/studio/__tests__/components/UserMenu.test.tsx`

- [ ] **Step 1: Create the test file `apps/studio/__tests__/components/UserMenu.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPush = vi.fn();
const mockSignOut = vi.fn().mockResolvedValue({});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { signOut: mockSignOut },
  }),
}));

// Lazy import after mocks are set up
const { UserMenu } = await import('@/components/UserMenu');

describe('UserMenu', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockSignOut.mockClear();
  });

  it('shows initials from displayName when no avatarUrl', () => {
    render(<UserMenu displayName="Nicole Smith" avatarUrl={null} email="nicole@test.com" />);
    expect(screen.getByText('NS')).toBeInTheDocument();
  });

  it('shows first char of email when no displayName', () => {
    render(<UserMenu displayName={null} avatarUrl={null} email="nicole@test.com" />);
    expect(screen.getByText('N')).toBeInTheDocument();
  });

  it('shows avatar img when avatarUrl is provided', () => {
    render(<UserMenu displayName="Nicole" avatarUrl="https://example.com/avatar.png" email="nicole@test.com" />);
    expect(screen.getByRole('img', { name: /avatar/i })).toBeInTheDocument();
  });

  it('calls signOut and redirects to /auth/login on logout', async () => {
    const user = userEvent.setup();
    render(<UserMenu displayName="Nicole" avatarUrl={null} email="nicole@test.com" />);
    await user.click(screen.getByRole('button', { name: /avatar/i }));
    await user.click(await screen.findByText('Logout'));
    expect(mockSignOut).toHaveBeenCalledOnce();
    expect(mockPush).toHaveBeenCalledWith('/auth/login');
  });

  it('navigates to /profile on Profile click', async () => {
    const user = userEvent.setup();
    render(<UserMenu displayName="Nicole" avatarUrl={null} email="nicole@test.com" />);
    await user.click(screen.getByRole('button', { name: /avatar/i }));
    await user.click(await screen.findByText('Profile'));
    expect(mockPush).toHaveBeenCalledWith('/profile');
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
cd apps/studio && npm test -- UserMenu
```

Expected: FAIL — `Cannot find module '@/components/UserMenu'`

- [ ] **Step 3: Create `apps/studio/components/UserMenu.tsx`**

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface UserMenuProps {
  displayName: string | null;
  avatarUrl: string | null;
  email: string;
}

function getInitials(displayName: string | null, email: string): string {
  if (displayName) {
    return displayName
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }
  return email[0].toUpperCase();
}

export function UserMenu({ displayName, avatarUrl, email }: UserMenuProps) {
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/auth/login');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="avatar"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold overflow-hidden focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="avatar" className="h-full w-full object-cover" />
          ) : (
            getInitials(displayName, email)
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <p className="font-medium text-sm">{displayName ?? email}</p>
          <p className="text-xs text-muted-foreground">{email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push('/profile')}>
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleLogout} className="text-destructive">
          Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
cd apps/studio && npm test -- UserMenu
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/components/UserMenu.tsx apps/studio/__tests__/components/UserMenu.test.tsx
git commit -m "feat: UserMenu component — avatar dropdown with Profile + Logout"
```

---

## Task 4: Header Component + Layout Shell + Branding

**Files:**
- Create: `apps/studio/components/Header.tsx`
- Modify: `apps/studio/app/(dashboard)/layout.tsx`
- Modify: `apps/studio/components/Sidebar.tsx`
- Modify: `apps/studio/app/auth/login/page.tsx`

- [ ] **Step 1: Create `apps/studio/components/Header.tsx`**

```tsx
import { UserMenu } from '@/components/UserMenu';

interface HeaderProps {
  displayName: string | null;
  avatarUrl: string | null;
  email: string;
}

export function Header({ displayName, avatarUrl, email }: HeaderProps) {
  return (
    <header className="h-14 sticky top-0 z-40 border-b border-border bg-card flex items-center justify-between px-6">
      <div className="flex flex-col leading-tight">
        <span className="text-base font-bold tracking-tight text-primary">🌸 Roxy Studio</span>
        <span className="text-xs text-muted-foreground">by Thinqer</span>
      </div>
      <UserMenu displayName={displayName} avatarUrl={avatarUrl} email={email} />
    </header>
  );
}
```

- [ ] **Step 2: Update `apps/studio/app/(dashboard)/layout.tsx`**

```tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/Sidebar';
import { Header } from '@/components/Header';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();

  if (!claimsData?.claims) {
    redirect('/auth/login');
  }

  const userId = claimsData.claims.sub;
  const email = claimsData.claims.email as string;

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, avatar_url')
    .eq('id', userId)
    .maybeSingle();

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        displayName={profile?.display_name ?? null}
        avatarUrl={profile?.avatar_url ?? null}
        email={email}
      />
      <div className="flex flex-1">
        <Sidebar />
        <main className="flex-1 p-8 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update `apps/studio/components/Sidebar.tsx` — remove logo block, add Profile nav item**

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/profile',   label: 'Profile' },
  { href: '/events',    label: 'Events' },
  { href: '/rooms',     label: 'Rooms' },
  { href: '/games',     label: 'Games' },
  { href: '/community', label: 'Community' },
  { href: '/payouts',   label: 'Payouts' },
  { href: '/settings',  label: 'Settings' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 min-h-full border-r border-border bg-card">
      <nav className="p-4 space-y-1">
        {navItems.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'block rounded-md px-3 py-2 text-sm font-medium transition-colors',
              pathname === href
                ? 'bg-primary/20 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 4: Update `apps/studio/app/auth/login/page.tsx` — branding tagline**

```tsx
import { Suspense } from 'react';
import { LoginForm } from '@/components/login-form';

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm space-y-4">
        <div className="text-center">
          <span className="text-2xl font-bold tracking-tight">🌸 Roxy Studio</span>
          <p className="text-sm text-muted-foreground mt-1">For WLW by WLW · Thinqer</p>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/studio/components/Header.tsx \
        apps/studio/app/\(dashboard\)/layout.tsx \
        apps/studio/components/Sidebar.tsx \
        apps/studio/app/auth/login/page.tsx
git commit -m "feat: Header shell, layout restructure, branding — Roxy Studio / For WLW by WLW · Thinqer"
```

---

## Task 5: Profile Page + ProfileForm + Tests

**Files:**
- Create: `apps/studio/app/(dashboard)/profile/page.tsx`
- Create: `apps/studio/app/(dashboard)/profile/error.tsx`
- Create: `apps/studio/components/ProfileForm.tsx`
- Create: `apps/studio/__tests__/components/ProfileForm.test.tsx`

- [ ] **Step 1: Create the test file `apps/studio/__tests__/components/ProfileForm.test.tsx`**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEq = vi.fn().mockResolvedValue({ error: null });
const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
const mockFrom = vi.fn().mockReturnValue({ update: mockUpdate });

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: mockFrom }),
}));

const { ProfileForm } = await import('@/components/ProfileForm');

const defaultProps = {
  userId: 'user-123',
  profile: { display_name: 'Nicole', username: 'nicole_roxy', bio: 'Hello!', avatar_url: null },
  email: 'nicole@test.com',
};

describe('ProfileForm', () => {
  beforeEach(() => {
    mockEq.mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ update: mockUpdate });
    vi.clearAllMocks();
    mockEq.mockResolvedValue({ error: null });
    mockUpdate.mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ update: mockUpdate });
  });

  it('renders all fields with initial values', () => {
    render(<ProfileForm {...defaultProps} />);
    expect(screen.getByDisplayValue('Nicole')).toBeInTheDocument();
    expect(screen.getByDisplayValue('nicole_roxy')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Hello!')).toBeInTheDocument();
    expect(screen.getByDisplayValue('nicole@test.com')).toBeInTheDocument();
  });

  it('email field is read-only', () => {
    render(<ProfileForm {...defaultProps} />);
    expect(screen.getByDisplayValue('nicole@test.com')).toHaveAttribute('readOnly');
  });

  it('shows "Profile saved" after successful save', async () => {
    const user = userEvent.setup();
    render(<ProfileForm {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(screen.getByText(/profile saved/i)).toBeInTheDocument();
    });
  });

  it('shows error message when save fails', async () => {
    mockEq.mockResolvedValue({ error: { message: 'DB error' } });
    mockUpdate.mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ update: mockUpdate });
    const user = userEvent.setup();
    render(<ProfileForm {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(screen.getByText(/failed to save/i)).toBeInTheDocument();
    });
  });

  it('rejects username with invalid characters before submit', async () => {
    const user = userEvent.setup();
    render(<ProfileForm {...defaultProps} />);
    const usernameInput = screen.getByDisplayValue('nicole_roxy');
    await user.clear(usernameInput);
    await user.type(usernameInput, 'bad username!');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(screen.getByText(/only letters, numbers, underscores/i)).toBeInTheDocument();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('disables save button while submitting', async () => {
    // Make the save hang indefinitely
    mockEq.mockReturnValue(new Promise(() => {}));
    mockUpdate.mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ update: mockUpdate });
    const user = userEvent.setup();
    render(<ProfileForm {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd apps/studio && npm test -- ProfileForm
```

Expected: FAIL — `Cannot find module '@/components/ProfileForm'`

- [ ] **Step 3: Create `apps/studio/components/ProfileForm.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const USERNAME_RE = /^[a-zA-Z0-9_]{1,30}$/;

interface ProfileFormProps {
  userId: string;
  profile: {
    display_name: string | null;
    username: string | null;
    bio: string | null;
    avatar_url: string | null;
  };
  email: string;
}

export function ProfileForm({ userId, profile, email }: ProfileFormProps) {
  const [displayName, setDisplayName] = useState(profile.display_name ?? '');
  const [username, setUsername] = useState(profile.username ?? '');
  const [bio, setBio] = useState(profile.bio ?? '');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    setError(null);
    setSuccess(false);

    if (displayName.length > 100) {
      setValidationError('Display name must be 100 characters or less.');
      return;
    }
    if (username && !USERNAME_RE.test(username)) {
      setValidationError('Username: only letters, numbers, underscores — max 30 chars.');
      return;
    }
    if (bio.length > 500) {
      setValidationError('Bio must be 500 characters or less.');
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { error: dbError } = await supabase
      .from('profiles')
      .update({ display_name: displayName || null, username: username || null, bio: bio || null })
      .eq('id', userId);

    setSaving(false);
    if (dbError) {
      if (dbError.message?.includes('profiles_username_format')) {
        setError('Username already taken or contains invalid characters.');
      } else {
        setError('Failed to save profile. Please try again.');
      }
    } else {
      setSuccess(true);
    }
  };

  const initials = profile.avatar_url
    ? null
    : (profile.display_name ?? email)
        .split(' ')
        .map((w: string) => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);

  return (
    <form onSubmit={handleSave} className="space-y-6 max-w-lg">
      {/* Avatar display */}
      <div className="flex items-center gap-4">
        <div
          aria-label="avatar"
          className="h-16 w-16 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xl font-bold overflow-hidden"
        >
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="avatar" className="h-full w-full object-cover" />
          ) : (
            initials
          )}
        </div>
        <p className="text-xs text-muted-foreground">Avatar upload coming soon.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="display_name">Display name</Label>
        <Input
          id="display_name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={100}
          placeholder="Your name"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="username">Username</Label>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground text-sm">@</span>
          <Input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={30}
            placeholder="yourhandle"
            className="flex-1"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="bio">Bio</Label>
        <textarea
          id="bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder="A little about yourself..."
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
        />
        <p className="text-xs text-muted-foreground text-right">{bio.length}/500</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" value={email} readOnly className="opacity-60 cursor-not-allowed" />
        <p className="text-xs text-muted-foreground">Email cannot be changed here.</p>
      </div>

      {validationError && <p className="text-sm text-destructive">{validationError}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && <p className="text-sm text-green-600">Profile saved ✓</p>}

      <Button type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save profile'}
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Create `apps/studio/app/(dashboard)/profile/page.tsx`**

```tsx
import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { ProfileForm } from '@/components/ProfileForm';

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  const email = claimsData?.claims?.email as string;
  if (!userId) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, username, avatar_url, bio')
    .eq('id', userId)
    .maybeSingle();

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Profile</h1>
        <p className="text-muted-foreground mt-1">Your public Roxy identity.</p>
      </div>
      <Suspense fallback={<div className="h-96 rounded-lg bg-muted animate-pulse" />}>
        <ProfileForm
          userId={userId}
          profile={{
            display_name: profile?.display_name ?? null,
            username: profile?.username ?? null,
            avatar_url: profile?.avatar_url ?? null,
            bio: profile?.bio ?? null,
          }}
          email={email}
        />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 5: Create `apps/studio/app/(dashboard)/profile/error.tsx`**

```tsx
'use client';

export default function ProfileError({ reset }: { reset: () => void }) {
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="text-muted-foreground">Failed to load your profile.</p>
      <button
        onClick={reset}
        className="text-sm underline text-primary hover:no-underline"
      >
        Try again
      </button>
    </div>
  );
}
```

- [ ] **Step 6: Run tests — verify all pass**

```bash
cd apps/studio && npm test -- ProfileForm
```

Expected: All 6 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/components/ProfileForm.tsx \
        apps/studio/app/\(dashboard\)/profile/page.tsx \
        apps/studio/app/\(dashboard\)/profile/error.tsx \
        apps/studio/__tests__/components/ProfileForm.test.tsx
git commit -m "feat: profile page + ProfileForm — display_name, username, bio edit with validation"
```

---

## Task 6: Community Page — Events & Games Sub-sections

**Files:**
- Modify: `apps/studio/app/(dashboard)/community/page.tsx`

- [ ] **Step 1: Replace `apps/studio/app/(dashboard)/community/page.tsx`**

```tsx
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';

export default async function CommunityPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return null;

  // Fetch communities this user admins
  const { data: memberRows } = await supabase
    .from('community_members')
    .select('communities(id, name, description, member_count), role')
    .eq('user_id', userId)
    .eq('role', 'admin');

  const communityIds: string[] = (memberRows ?? [])
    .map((r: any) => r.communities?.id)
    .filter(Boolean);

  // Fetch upcoming events for all admin communities
  const now = new Date().toISOString();
  const { data: eventsRows } = communityIds.length
    ? await supabase
        .from('events')
        .select('id, title, starts_at, community_id')
        .in('community_id', communityIds)
        .gte('starts_at', now)
        .order('starts_at', { ascending: true })
    : { data: [] };

  // Fetch activated games for all admin communities
  const { data: gamesRows } = communityIds.length
    ? await supabase
        .from('community_games')
        .select('community_id, games(id, title, is_official)')
        .in('community_id', communityIds)
    : { data: [] };

  const communities = (memberRows ?? []).map((r: any) => ({
    ...r.communities,
    role: r.role,
  }));

  const eventsByCommunity = (eventsRows ?? []).reduce<Record<string, any[]>>((acc, e: any) => {
    (acc[e.community_id] ??= []).push(e);
    return acc;
  }, {});

  const gamesByCommunity = (gamesRows ?? []).reduce<Record<string, any[]>>((acc, g: any) => {
    (acc[g.community_id] ??= []).push(g.games);
    return acc;
  }, {});

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Community</h1>
        <p className="text-muted-foreground mt-1">Communities you manage.</p>
      </div>

      {communities.length === 0 ? (
        <p className="text-muted-foreground text-sm">You are not an admin of any community.</p>
      ) : (
        <ul className="space-y-6">
          {communities.map((c: any) => {
            const events = (eventsByCommunity[c.id] ?? []).slice(0, 5);
            const games = gamesByCommunity[c.id] ?? [];

            return (
              <li key={c.id} className="border rounded-lg p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">{c.name}</h2>
                  <Badge variant="outline">{c.member_count ?? 0} members</Badge>
                </div>
                {c.description && (
                  <p className="text-sm text-muted-foreground">{c.description}</p>
                )}

                {/* Events sub-section */}
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">Upcoming Events</h3>
                  {events.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No upcoming events.</p>
                  ) : (
                    <ul className="space-y-1">
                      {events.map((ev: any) => (
                        <li key={ev.id} className="flex items-center justify-between text-sm">
                          <span>{ev.title}</span>
                          <span className="text-muted-foreground text-xs">
                            {new Date(ev.starts_at).toLocaleDateString('en-US', {
                              month: 'short', day: 'numeric', year: 'numeric',
                            })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Games sub-section */}
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">Activated Games</h3>
                  {games.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No games activated.{' '}
                      <a href="/games" className="underline">Visit Games to add some.</a>
                    </p>
                  ) : (
                    <ul className="flex flex-wrap gap-2">
                      {games.map((g: any) => (
                        <li key={g.id}>
                          <Badge variant={g.is_official ? 'default' : 'secondary'}>
                            {g.title}{g.is_official ? ' · Official' : ''}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/studio/app/\(dashboard\)/community/page.tsx
git commit -m "feat: community page — upcoming events + activated games per community"
```

---

## Task 7: GamesToggleClient + Tests

**Files:**
- Create: `apps/studio/components/GamesToggleClient.tsx`
- Create: `apps/studio/__tests__/components/GamesToggleClient.test.tsx`

- [ ] **Step 1: Create `apps/studio/__tests__/components/GamesToggleClient.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInsert = vi.fn().mockResolvedValue({ error: null });
const mockDeleteEq2 = vi.fn().mockResolvedValue({ error: null });
const mockDeleteEq1 = vi.fn().mockReturnValue({ eq: mockDeleteEq2 });
const mockDelete = vi.fn().mockReturnValue({ eq: mockDeleteEq1 });
const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert, delete: mockDelete });

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: mockFrom }),
}));

const { GamesToggleClient } = await import('@/components/GamesToggleClient');

const game = { id: 'game-1', title: 'Speed Dating', is_official: true };
const community = { id: 'comm-1', name: 'Sapphic NYC' };

describe('GamesToggleClient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows Activate when not activated', () => {
    render(<GamesToggleClient game={game} community={community} isActivated={false} />);
    expect(screen.getByRole('button', { name: /activate/i })).toBeInTheDocument();
  });

  it('shows Deactivate when activated', () => {
    render(<GamesToggleClient game={game} community={community} isActivated={true} />);
    expect(screen.getByRole('button', { name: /deactivate/i })).toBeInTheDocument();
  });

  it('inserts community_games row on activate', async () => {
    const user = userEvent.setup();
    render(<GamesToggleClient game={game} community={community} isActivated={false} />);
    await user.click(screen.getByRole('button', { name: /activate/i }));
    expect(mockFrom).toHaveBeenCalledWith('community_games');
    expect(mockInsert).toHaveBeenCalledWith({ community_id: 'comm-1', game_id: 'game-1' });
  });

  it('deletes community_games row on deactivate', async () => {
    const user = userEvent.setup();
    render(<GamesToggleClient game={game} community={community} isActivated={true} />);
    await user.click(screen.getByRole('button', { name: /deactivate/i }));
    expect(mockFrom).toHaveBeenCalledWith('community_games');
    expect(mockDelete).toHaveBeenCalled();
  });

  it('rolls back optimistic state on insert error', async () => {
    mockInsert.mockResolvedValueOnce({ error: { message: 'RLS denied' } });
    const user = userEvent.setup();
    render(<GamesToggleClient game={game} community={community} isActivated={false} />);
    await user.click(screen.getByRole('button', { name: /activate/i }));
    // After rollback, button goes back to Activate
    expect(await screen.findByRole('button', { name: /activate/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd apps/studio && npm test -- GamesToggleClient
```

Expected: FAIL — `Cannot find module '@/components/GamesToggleClient'`

- [ ] **Step 3: Create `apps/studio/components/GamesToggleClient.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

interface GamesToggleClientProps {
  game: { id: string; title: string; is_official: boolean };
  community: { id: string; name: string };
  isActivated: boolean;
}

export function GamesToggleClient({ game, community, isActivated }: GamesToggleClientProps) {
  const [activated, setActivated] = useState(isActivated);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    const prev = activated;
    setActivated(!prev); // optimistic
    setLoading(true);

    const supabase = createClient();
    let error: { message: string } | null = null;

    if (!prev) {
      const res = await supabase
        .from('community_games')
        .insert({ community_id: community.id, game_id: game.id });
      error = res.error;
    } else {
      const res = await supabase
        .from('community_games')
        .delete()
        .eq('community_id', community.id)
        .eq('game_id', game.id);
      error = res.error;
    }

    setLoading(false);
    if (error) {
      setActivated(prev); // rollback
    }
  };

  return (
    <Button
      variant={activated ? 'destructive' : 'outline'}
      size="sm"
      onClick={toggle}
      disabled={loading}
      aria-label={activated ? 'Deactivate' : 'Activate'}
    >
      {loading ? '…' : activated ? 'Deactivate' : 'Activate'}
    </Button>
  );
}
```

- [ ] **Step 4: Run tests — verify all pass**

```bash
cd apps/studio && npm test -- GamesToggleClient
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/components/GamesToggleClient.tsx \
        apps/studio/__tests__/components/GamesToggleClient.test.tsx
git commit -m "feat: GamesToggleClient — optimistic activate/deactivate with rollback"
```

---

## Task 8: Games Page

**Files:**
- Modify: `apps/studio/app/(dashboard)/games/page.tsx`
- Create: `apps/studio/app/(dashboard)/games/error.tsx`

- [ ] **Step 1: Replace `apps/studio/app/(dashboard)/games/page.tsx`**

```tsx
import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { GamesToggleClient } from '@/components/GamesToggleClient';

export default async function GamesPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return null;

  // All games in catalog
  const { data: games } = await supabase
    .from('games')
    .select('id, title, description, is_official')
    .order('is_official', { ascending: false });

  // Communities this user admins
  const { data: memberRows } = await supabase
    .from('community_members')
    .select('communities(id, name)')
    .eq('user_id', userId)
    .eq('role', 'admin');

  const communities = (memberRows ?? []).map((r: any) => r.communities).filter(Boolean);
  const communityIds = communities.map((c: any) => c.id);

  // Currently activated game+community pairs
  const { data: activatedRows } = communityIds.length
    ? await supabase
        .from('community_games')
        .select('community_id, game_id')
        .in('community_id', communityIds)
    : { data: [] };

  const activatedSet = new Set(
    (activatedRows ?? []).map((r: any) => `${r.community_id}:${r.game_id}`)
  );

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Games</h1>
        <p className="text-muted-foreground mt-1">
          Activate games for your communities. More games coming soon.
        </p>
      </div>

      {(games ?? []).length === 0 ? (
        <p className="text-muted-foreground text-sm">No games available yet.</p>
      ) : (
        <Suspense fallback={<div className="space-y-4">{Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-32 rounded-lg bg-muted animate-pulse" />)}</div>}>
          <ul className="space-y-4">
            {(games ?? []).map((game: any) => (
              <li key={game.id} className="border rounded-lg p-6 space-y-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">{game.title}</h2>
                  {game.is_official && <Badge>Official</Badge>}
                </div>
                {game.description && (
                  <p className="text-sm text-muted-foreground">{game.description}</p>
                )}
                {communities.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No communities to manage yet.</p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Your communities</p>
                    <ul className="flex flex-wrap gap-3">
                      {communities.map((community: any) => (
                        <li key={community.id} className="flex items-center gap-2">
                          <span className="text-sm">{community.name}</span>
                          <GamesToggleClient
                            game={game}
                            community={community}
                            isActivated={activatedSet.has(`${community.id}:${game.id}`)}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Suspense>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `apps/studio/app/(dashboard)/games/error.tsx`**

```tsx
'use client';

export default function GamesError({ reset }: { reset: () => void }) {
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="text-muted-foreground">Failed to load games catalog.</p>
      <button
        onClick={reset}
        className="text-sm underline text-primary hover:no-underline"
      >
        Try again
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/studio/app/\(dashboard\)/games/page.tsx \
        apps/studio/app/\(dashboard\)/games/error.tsx
git commit -m "feat: games catalog page — official games list with per-community activate toggles"
```

---

## Task 9: Full Test Run + TypeScript Check + PR

- [ ] **Step 1: Run all Studio tests**

```bash
cd apps/studio && npm test
```

Expected output contains:
```
Test Files  3 passed (3)
Tests      16 passed (16)
```

- [ ] **Step 2: Run TypeScript check**

```bash
cd apps/studio && npx tsc --noEmit
```

Expected: No output (zero errors).

- [ ] **Step 3: Update CLAUDE.md — migrations table and sessions table**

In `CLAUDE.md`, update the Migrations Completed table to add migration 023:
```
| `023_games_catalog.sql` | games, community_games, profile CHECK constraints |
```

Update "Next migration number" to `024`.

Add session 13 to the Sessions Completed table:
```
| 13 — Studio auth, profile, games | `session-13-studio-auth-profile-games` | TBD | Open |
```

- [ ] **Step 4: Commit CLAUDE.md**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md — migration 023, session 13"
```

- [ ] **Step 5: Push and open PR**

```bash
git push -u origin session-13-studio-auth-profile-games
gh pr create --base main \
  --title "feat: Studio header, profile, games catalog (session 13)" \
  --body "$(cat <<'EOF'
## Summary
- Sticky header with Roxy Studio / Thinqer branding + user avatar dropdown (Profile, Logout)
- Profile page: edit display_name, username, bio with client + DB validation (OWASP A03)
- Community page: upcoming events + activated games per community
- Games catalog page: activate/deactivate games per community with optimistic UI
- Migration 023: games, community_games tables + RLS + profile CHECK constraints
- Vitest + React Testing Library: 16 unit tests across UserMenu, ProfileForm, GamesToggleClient

## Test Plan
- [ ] Run `cd apps/studio && npm test` — 16 tests pass
- [ ] Run `cd apps/studio && npx tsc --noEmit` — zero TS errors
- [ ] Visit roxy-studio.vercel.app — header shows avatar + "by Thinqer" branding
- [ ] Open avatar dropdown — Profile and Logout work
- [ ] Visit /profile — fields pre-filled, save updates Supabase, invalid username blocked
- [ ] Visit /games — Speed Dating card shows with per-community toggle
- [ ] Visit /community — events + games sections render per community

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✓ Layout shell (Task 4)
- ✓ Branding — Header "by Thinqer", login "For WLW by WLW · Thinqer", Sidebar logo removed (Task 4)
- ✓ Header + UserMenu (Tasks 3, 4)
- ✓ Profile page + ProfileForm (Task 5)
- ✓ Community page — events + games (Task 6)
- ✓ Games page + GamesToggleClient (Tasks 7, 8)
- ✓ Migration 023 (Task 1)
- ✓ OWASP — RLS in migration, input validation in ProfileForm, userId from JWT never client (Tasks 1, 5)
- ✓ Enterprise — loading states, Suspense skeletons, error.tsx boundaries, optimistic UI with rollback (Tasks 5, 7, 8)
- ✓ Tests — UserMenu (Task 3), ProfileForm (Task 5), GamesToggleClient (Task 7)

**No placeholders:** All steps have complete code. ✓

**Type consistency:**
- `UserMenu` props: `{ displayName, avatarUrl, email }` — same in Header.tsx and test ✓
- `ProfileForm` props: `{ userId, profile: { display_name, username, bio, avatar_url }, email }` — consistent across page + test ✓
- `GamesToggleClient` props: `{ game: { id, title, is_official }, community: { id, name }, isActivated }` — consistent across games/page.tsx and test ✓
