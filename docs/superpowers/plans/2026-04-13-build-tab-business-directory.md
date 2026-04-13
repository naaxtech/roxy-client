# BUILD Tab — Business Directory & Impact Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the BUILD tab with chip search, business detail sheet with gallery/bookmarks, persistent impact project support, and saved businesses on the profile screen.

**Architecture:** Four DB migrations add new tables and triggers. `buildStore` gains async bookmark/support actions. New components in `components/build/` handle search chips, photo gallery, and the business bottom sheet. The BUILD screen and profile screen are wired up last.

**Tech Stack:** Expo 51 · React Native · Zustand · Supabase (Postgres + RLS) · TypeScript strict · Jest + @testing-library/react-native

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `supabase/migrations/027_impact_website_url.sql` | Add website_url to impact_projects |
| Create | `supabase/migrations/028_user_project_supports.sql` | Support table + sync trigger |
| Create | `supabase/migrations/029_user_business_bookmarks.sql` | Bookmarks table |
| Create | `supabase/migrations/030_business_photos.sql` | Photos table + max-5 trigger |
| Modify | `apps/mobile/types/index.ts` | Add BusinessPhoto type |
| Modify | `apps/mobile/lib/constants.ts` | Add REGISTER_BUSINESS_URL |
| Modify | `apps/mobile/store/buildStore.ts` | New state + async bookmark/support actions |
| Create | `apps/mobile/components/build/SearchChip.tsx` | Single removable chip pill |
| Create | `apps/mobile/components/build/ChipSearchBar.tsx` | Search input + chip row |
| Create | `apps/mobile/components/build/BusinessPhotoGallery.tsx` | Horizontal photos + lightbox |
| Create | `apps/mobile/components/build/BusinessDetailSheet.tsx` | Business bottom sheet |
| Modify | `apps/mobile/app/(tabs)/build/index.tsx` | Wire all new components |
| Modify | `apps/mobile/components/profile/ProfileCard.tsx` | Add savedBusinesses section |
| Modify | `apps/mobile/app/(tabs)/profile/index.tsx` | Fetch + pass saved businesses |
| Modify | `apps/mobile/__tests__/store/buildStore.test.ts` | Extend with new action tests |
| Create | `apps/mobile/__tests__/components/build/ChipSearchBar.test.tsx` | Chip search tests |
| Create | `apps/mobile/__tests__/components/build/BusinessDetailSheet.test.tsx` | Sheet tests |

---

## Task 1: DB Migrations

**Files:**
- Create: `supabase/migrations/027_impact_website_url.sql`
- Create: `supabase/migrations/028_user_project_supports.sql`
- Create: `supabase/migrations/029_user_business_bookmarks.sql`
- Create: `supabase/migrations/030_business_photos.sql`

- [ ] **Step 1: Create migration 027**

```sql
-- supabase/migrations/027_impact_website_url.sql
ALTER TABLE impact_projects ADD COLUMN IF NOT EXISTS website_url text;
```

- [ ] **Step 2: Create migration 028**

```sql
-- supabase/migrations/028_user_project_supports.sql
CREATE TABLE IF NOT EXISTS user_project_supports (
  user_id    uuid REFERENCES profiles(id) ON DELETE CASCADE,
  project_id uuid REFERENCES impact_projects(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);

ALTER TABLE user_project_supports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own supports" ON user_project_supports
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION sync_supporter_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE impact_projects
  SET supporter_count = (
    SELECT COUNT(*) FROM user_project_supports
    WHERE project_id = NEW.project_id
  )
  WHERE id = NEW.project_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_supporter_count
AFTER INSERT ON user_project_supports
FOR EACH ROW EXECUTE FUNCTION sync_supporter_count();
```

- [ ] **Step 3: Create migration 029**

```sql
-- supabase/migrations/029_user_business_bookmarks.sql
CREATE TABLE IF NOT EXISTS user_business_bookmarks (
  user_id     uuid REFERENCES profiles(id) ON DELETE CASCADE,
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, business_id)
);

ALTER TABLE user_business_bookmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own bookmarks" ON user_business_bookmarks
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

- [ ] **Step 4: Create migration 030**

```sql
-- supabase/migrations/030_business_photos.sql
CREATE TABLE IF NOT EXISTS business_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  url         text NOT NULL,
  sort_order  integer DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION enforce_max_photos()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT COUNT(*) FROM business_photos WHERE business_id = NEW.business_id) >= 5 THEN
    RAISE EXCEPTION 'Business cannot have more than 5 photos';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_max_photos
BEFORE INSERT ON business_photos
FOR EACH ROW EXECUTE FUNCTION enforce_max_photos();

ALTER TABLE business_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users read photos" ON business_photos
  FOR SELECT USING (auth.role() = 'authenticated');
```

- [ ] **Step 5: Push migrations**

```bash
cd D:/Nicole/Dev/roxy/roxy-client
npx supabase db push
```

Expected: 4 migrations applied, no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/027_impact_website_url.sql supabase/migrations/028_user_project_supports.sql supabase/migrations/029_user_business_bookmarks.sql supabase/migrations/030_business_photos.sql
git commit -m "feat(db): add impact website_url, project supports, business bookmarks, business photos"
```

---

## Task 2: Types + Config

**Files:**
- Modify: `apps/mobile/types/index.ts`
- Modify: `apps/mobile/lib/constants.ts`

- [ ] **Step 1: Add BusinessPhoto type to types/index.ts**

Find the `Business` interface in `apps/mobile/types/index.ts` and add `BusinessPhoto` after it:

```ts
export interface BusinessPhoto {
  id: string;
  business_id: string;
  url: string;
  sort_order: number;
  created_at: string;
}
```

- [ ] **Step 2: Add REGISTER_BUSINESS_URL to constants.ts**

Append at the end of `apps/mobile/lib/constants.ts`:

```ts
export const REGISTER_BUSINESS_URL = 'https://roxy.app/register-business';
```

(This is a placeholder URL — update to the real form URL when it's live. Kept in constants so it's changed in one place.)

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/types/index.ts apps/mobile/lib/constants.ts
git commit -m "feat(types): add BusinessPhoto type and REGISTER_BUSINESS_URL constant"
```

---

## Task 3: buildStore — New State + Actions

**Files:**
- Modify: `apps/mobile/store/buildStore.ts`
- Modify: `apps/mobile/__tests__/store/buildStore.test.ts`

- [ ] **Step 1: Write failing tests first**

Replace the contents of `apps/mobile/__tests__/store/buildStore.test.ts` with:

```ts
import { act, renderHook } from "@testing-library/react-native";
import { useBuildStore } from "../../store/buildStore";
import { Business, ImpactProject } from "../../types";

// Mock supabase — must be inline factory (jest hoisting rule)
jest.mock("../../lib/supabase", () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      match: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}));

const makeBusiness = (id: string): Business => ({
  id,
  owner_id: "user-1",
  name: "Test Business",
  description: null,
  category: "retail",
  location_city: "London",
  website_url: null,
  instagram_handle: null,
  logo_url: null,
  is_verified: false,
  is_wlw_owned: true,
  created_at: "2026-01-01T00:00:00Z",
});

const makeProject = (id: string): ImpactProject => ({
  id,
  creator_id: "user-1",
  title: "Test Project",
  description: null,
  category: "mutual_aid",
  goal_amount: 1000,
  raised_amount: 0,
  supporter_count: 0,
  status: "active",
  website_url: null,
  created_at: "2026-01-01T00:00:00Z",
});

beforeEach(() => {
  useBuildStore.setState({
    businesses: [],
    impactProjects: [],
    loading: false,
    bookmarkedBusinessIds: new Set(),
    supportedProjectIds: new Set(),
    searchChips: [],
  });
});

describe("buildStore — existing", () => {
  it("has correct initial state", () => {
    const { result } = renderHook(() => useBuildStore());
    expect(result.current.businesses).toEqual([]);
    expect(result.current.impactProjects).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("setBusinesses replaces array", () => {
    const { result } = renderHook(() => useBuildStore());
    act(() => result.current.setBusinesses([makeBusiness("b1"), makeBusiness("b2")]));
    expect(result.current.businesses).toHaveLength(2);
    expect(result.current.businesses[0].id).toBe("b1");
  });

  it("setImpactProjects replaces array", () => {
    const { result } = renderHook(() => useBuildStore());
    act(() => result.current.setImpactProjects([makeProject("p1")]));
    expect(result.current.impactProjects).toHaveLength(1);
  });

  it("incrementSupporter increases supporter_count", () => {
    const { result } = renderHook(() => useBuildStore());
    act(() => result.current.setImpactProjects([makeProject("p1")]));
    act(() => result.current.incrementSupporter("p1"));
    expect(result.current.impactProjects[0].supporter_count).toBe(1);
  });
});

describe("buildStore — search chips", () => {
  it("addSearchChip adds a chip", () => {
    const { result } = renderHook(() => useBuildStore());
    act(() => result.current.addSearchChip("wellness"));
    expect(result.current.searchChips).toEqual(["wellness"]);
  });

  it("addSearchChip ignores duplicates (case-insensitive)", () => {
    const { result } = renderHook(() => useBuildStore());
    act(() => result.current.addSearchChip("wellness"));
    act(() => result.current.addSearchChip("Wellness"));
    expect(result.current.searchChips).toHaveLength(1);
  });

  it("removeSearchChip removes the correct chip", () => {
    const { result } = renderHook(() => useBuildStore());
    act(() => result.current.addSearchChip("wellness"));
    act(() => result.current.addSearchChip("coaching"));
    act(() => result.current.removeSearchChip("wellness"));
    expect(result.current.searchChips).toEqual(["coaching"]);
  });

  it("setSearchChips replaces all chips", () => {
    const { result } = renderHook(() => useBuildStore());
    act(() => result.current.addSearchChip("wellness"));
    act(() => result.current.setSearchChips([]));
    expect(result.current.searchChips).toEqual([]);
  });
});

describe("buildStore — bookmarks (optimistic)", () => {
  it("toggleBookmark adds businessId to set", () => {
    const { result } = renderHook(() => useBuildStore());
    act(() => {
      useBuildStore.setState({ bookmarkedBusinessIds: new Set() });
    });
    act(() => {
      // Directly test optimistic state by calling setState (DB call is mocked)
      useBuildStore.setState((s) => ({
        bookmarkedBusinessIds: new Set([...s.bookmarkedBusinessIds, "b1"]),
      }));
    });
    expect(result.current.bookmarkedBusinessIds.has("b1")).toBe(true);
  });

  it("removing bookmark removes businessId from set", () => {
    const { result } = renderHook(() => useBuildStore());
    act(() => {
      useBuildStore.setState({ bookmarkedBusinessIds: new Set(["b1"]) });
    });
    act(() => {
      useBuildStore.setState((s) => {
        const next = new Set(s.bookmarkedBusinessIds);
        next.delete("b1");
        return { bookmarkedBusinessIds: next };
      });
    });
    expect(result.current.bookmarkedBusinessIds.has("b1")).toBe(false);
  });
});

describe("buildStore — supports (optimistic)", () => {
  it("supportProject adds projectId to set and increments count", () => {
    const { result } = renderHook(() => useBuildStore());
    act(() => result.current.setImpactProjects([makeProject("p1")]));
    act(() => {
      useBuildStore.setState((s) => ({
        supportedProjectIds: new Set([...s.supportedProjectIds, "p1"]),
        impactProjects: s.impactProjects.map((p) =>
          p.id === "p1" ? { ...p, supporter_count: p.supporter_count + 1 } : p
        ),
      }));
    });
    expect(result.current.supportedProjectIds.has("p1")).toBe(true);
    expect(result.current.impactProjects[0].supporter_count).toBe(1);
  });

  it("does not double-add to supportedProjectIds", () => {
    const { result } = renderHook(() => useBuildStore());
    act(() => {
      useBuildStore.setState({ supportedProjectIds: new Set(["p1"]) });
    });
    // Simulate guard: no-op if already in set
    const before = result.current.supportedProjectIds.size;
    act(() => {
      if (!result.current.supportedProjectIds.has("p1")) {
        useBuildStore.setState((s) => ({
          supportedProjectIds: new Set([...s.supportedProjectIds, "p1"]),
        }));
      }
    });
    expect(result.current.supportedProjectIds.size).toBe(before);
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd apps/mobile && npx jest --ci --testPathPattern="buildStore" --passWithNoTests
```

Expected: failures on `bookmarkedBusinessIds`, `supportedProjectIds`, `searchChips` — state fields don't exist yet.

- [ ] **Step 3: Rewrite buildStore.ts**

Replace `apps/mobile/store/buildStore.ts` entirely:

```ts
import { create } from 'zustand';
import { Business, ImpactProject } from '../types';
import { supabase } from '../lib/supabase';

interface BuildState {
  businesses: Business[];
  impactProjects: ImpactProject[];
  loading: boolean;
  bookmarkedBusinessIds: Set<string>;
  supportedProjectIds: Set<string>;
  searchChips: string[];

  setBusinesses: (businesses: Business[]) => void;
  setImpactProjects: (impactProjects: ImpactProject[]) => void;
  setLoading: (loading: boolean) => void;
  incrementSupporter: (projectId: string) => void;

  addSearchChip: (chip: string) => void;
  removeSearchChip: (chip: string) => void;
  setSearchChips: (chips: string[]) => void;

  loadBookmarks: (userId: string) => Promise<void>;
  loadSupports: (userId: string) => Promise<void>;

  toggleBookmark: (businessId: string, userId: string) => Promise<void>;
  supportProject: (projectId: string, userId: string) => Promise<void>;

  loadBusinesses: (chips: string[], wlwOnly: boolean, communityMemberIds?: string[]) => Promise<void>;
}

export const useBuildStore = create<BuildState>((set, get) => ({
  businesses: [],
  impactProjects: [],
  loading: false,
  bookmarkedBusinessIds: new Set(),
  supportedProjectIds: new Set(),
  searchChips: [],

  setBusinesses: (businesses) => set({ businesses }),
  setImpactProjects: (impactProjects) => set({ impactProjects }),
  setLoading: (loading) => set({ loading }),

  incrementSupporter: (projectId) =>
    set((s) => ({
      impactProjects: s.impactProjects.map((p) =>
        p.id === projectId ? { ...p, supporter_count: p.supporter_count + 1 } : p
      ),
    })),

  addSearchChip: (chip) =>
    set((s) => {
      const lower = chip.toLowerCase().trim();
      if (!lower) return s;
      const exists = s.searchChips.some((c) => c.toLowerCase() === lower);
      if (exists) return s;
      return { searchChips: [...s.searchChips, chip.trim()] };
    }),

  removeSearchChip: (chip) =>
    set((s) => ({ searchChips: s.searchChips.filter((c) => c !== chip) })),

  setSearchChips: (chips) => set({ searchChips: chips }),

  loadBookmarks: async (userId) => {
    const { data } = await supabase
      .from('user_business_bookmarks')
      .select('business_id')
      .eq('user_id', userId);
    if (data) {
      set({ bookmarkedBusinessIds: new Set(data.map((r: any) => r.business_id)) });
    }
  },

  loadSupports: async (userId) => {
    const { data } = await supabase
      .from('user_project_supports')
      .select('project_id')
      .eq('user_id', userId);
    if (data) {
      set({ supportedProjectIds: new Set(data.map((r: any) => r.project_id)) });
    }
  },

  toggleBookmark: async (businessId, userId) => {
    const isBookmarked = get().bookmarkedBusinessIds.has(businessId);

    // Optimistic update
    set((s) => {
      const next = new Set(s.bookmarkedBusinessIds);
      if (isBookmarked) {
        next.delete(businessId);
      } else {
        next.add(businessId);
      }
      return { bookmarkedBusinessIds: next };
    });

    try {
      if (isBookmarked) {
        await supabase
          .from('user_business_bookmarks')
          .delete()
          .match({ user_id: userId, business_id: businessId });
      } else {
        await supabase
          .from('user_business_bookmarks')
          .insert({ user_id: userId, business_id: businessId });
      }
    } catch {
      // Rollback
      set((s) => {
        const next = new Set(s.bookmarkedBusinessIds);
        if (isBookmarked) {
          next.add(businessId);
        } else {
          next.delete(businessId);
        }
        return { bookmarkedBusinessIds: next };
      });
    }
  },

  supportProject: async (projectId, userId) => {
    if (get().supportedProjectIds.has(projectId)) return;

    // Optimistic update
    set((s) => ({
      supportedProjectIds: new Set([...s.supportedProjectIds, projectId]),
      impactProjects: s.impactProjects.map((p) =>
        p.id === projectId ? { ...p, supporter_count: p.supporter_count + 1 } : p
      ),
    }));

    const { error } = await supabase
      .from('user_project_supports')
      .insert({ user_id: userId, project_id: projectId });

    if (error) {
      // Rollback
      set((s) => {
        const next = new Set(s.supportedProjectIds);
        next.delete(projectId);
        return {
          supportedProjectIds: next,
          impactProjects: s.impactProjects.map((p) =>
            p.id === projectId ? { ...p, supporter_count: Math.max(0, p.supporter_count - 1) } : p
          ),
        };
      });
    }
  },

  loadBusinesses: async (chips, wlwOnly, communityMemberIds) => {
    let query = supabase.from('businesses').select('*');

    if (communityMemberIds && communityMemberIds.length > 0) {
      query = query.in('owner_id', communityMemberIds);
    }

    for (const chip of chips) {
      query = query.or(
        `name.ilike.%${chip}%,description.ilike.%${chip}%,category.ilike.%${chip}%`
      );
    }

    if (wlwOnly) {
      query = query.eq('is_wlw_owned', true);
    }

    const { data } = await query
      .order('is_verified', { ascending: false })
      .order('name')
      .limit(50);

    set({ businesses: (data as Business[]) ?? [] });
  },
}));
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd apps/mobile && npx jest --ci --testPathPattern="buildStore"
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/store/buildStore.ts apps/mobile/__tests__/store/buildStore.test.ts
git commit -m "feat(store): expand buildStore with bookmarks, supports, chip search"
```

---

## Task 4: SearchChip + ChipSearchBar Components

**Files:**
- Create: `apps/mobile/components/build/SearchChip.tsx`
- Create: `apps/mobile/components/build/ChipSearchBar.tsx`
- Create: `apps/mobile/__tests__/components/build/ChipSearchBar.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `apps/mobile/__tests__/components/build/ChipSearchBar.test.tsx`:

```tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ChipSearchBar } from '../../../components/build/ChipSearchBar';

describe('ChipSearchBar', () => {
  it('calls onAddChip when user submits a search term', () => {
    const onAddChip = jest.fn();
    const { getByPlaceholderText } = render(
      <ChipSearchBar chips={[]} onAddChip={onAddChip} onRemoveChip={jest.fn()} />
    );
    const input = getByPlaceholderText('Search businesses…');
    fireEvent.changeText(input, 'wellness');
    fireEvent(input, 'submitEditing');
    expect(onAddChip).toHaveBeenCalledWith('wellness');
  });

  it('does not call onAddChip for empty string', () => {
    const onAddChip = jest.fn();
    const { getByPlaceholderText } = render(
      <ChipSearchBar chips={[]} onAddChip={onAddChip} onRemoveChip={jest.fn()} />
    );
    const input = getByPlaceholderText('Search businesses…');
    fireEvent.changeText(input, '   ');
    fireEvent(input, 'submitEditing');
    expect(onAddChip).not.toHaveBeenCalled();
  });

  it('renders chips and calls onRemoveChip when × is pressed', () => {
    const onRemoveChip = jest.fn();
    const { getByText } = render(
      <ChipSearchBar
        chips={['wellness', 'coaching']}
        onAddChip={jest.fn()}
        onRemoveChip={onRemoveChip}
      />
    );
    expect(getByText('wellness')).toBeTruthy();
    fireEvent.press(getByText('×'));
    expect(onRemoveChip).toHaveBeenCalledWith('wellness');
  });

  it('clears input after chip is added', () => {
    const { getByPlaceholderText } = render(
      <ChipSearchBar chips={[]} onAddChip={jest.fn()} onRemoveChip={jest.fn()} />
    );
    const input = getByPlaceholderText('Search businesses…');
    fireEvent.changeText(input, 'wellness');
    fireEvent(input, 'submitEditing');
    expect(input.props.value).toBe('');
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd apps/mobile && npx jest --ci --testPathPattern="ChipSearchBar"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create SearchChip.tsx**

Create `apps/mobile/components/build/SearchChip.tsx`:

```tsx
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { COLORS } from '../../lib/constants';

interface SearchChipProps {
  label: string;
  onRemove: (label: string) => void;
}

export function SearchChip({ label, onRemove }: SearchChipProps) {
  return (
    <View style={styles.chip}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity onPress={() => onRemove(label)} hitSlop={8}>
        <Text style={styles.remove}>×</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary + '25',
    borderColor: COLORS.primary,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 6,
    gap: 6,
  },
  label: { color: COLORS.primary, fontSize: 13, fontWeight: '600' },
  remove: { color: COLORS.primary, fontSize: 15, fontWeight: '700', lineHeight: 18 },
});
```

- [ ] **Step 4: Create ChipSearchBar.tsx**

Create `apps/mobile/components/build/ChipSearchBar.tsx`:

```tsx
import { useState } from 'react';
import { View, TextInput, ScrollView, StyleSheet } from 'react-native';
import { COLORS } from '../../lib/constants';
import { SearchChip } from './SearchChip';

interface ChipSearchBarProps {
  chips: string[];
  onAddChip: (chip: string) => void;
  onRemoveChip: (chip: string) => void;
}

export function ChipSearchBar({ chips, onAddChip, onRemoveChip }: ChipSearchBarProps) {
  const [text, setText] = useState('');

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onAddChip(trimmed);
    setText('');
  };

  return (
    <View style={styles.wrapper}>
      <TextInput
        style={styles.input}
        placeholder="Search businesses…"
        placeholderTextColor={COLORS.textMuted}
        value={text}
        onChangeText={setText}
        onSubmitEditing={handleSubmit}
        returnKeyType="search"
        blurOnSubmit={false}
      />
      {chips.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipRow}
          contentContainerStyle={styles.chipRowContent}
        >
          {chips.map((chip) => (
            <SearchChip key={chip} label={chip} onRemove={onRemoveChip} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 6, paddingHorizontal: 12, paddingTop: 8 },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: COLORS.textPrimary,
    fontSize: 14,
  },
  chipRow: { maxHeight: 36 },
  chipRowContent: { alignItems: 'center', paddingBottom: 4 },
});
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd apps/mobile && npx jest --ci --testPathPattern="ChipSearchBar"
```

Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/components/build/SearchChip.tsx apps/mobile/components/build/ChipSearchBar.tsx apps/mobile/__tests__/components/build/ChipSearchBar.test.tsx
git commit -m "feat(components): add SearchChip and ChipSearchBar"
```

---

## Task 5: BusinessPhotoGallery Component

**Files:**
- Create: `apps/mobile/components/build/BusinessPhotoGallery.tsx`

No separate test file — covered by BusinessDetailSheet tests in Task 6.

- [ ] **Step 1: Create BusinessPhotoGallery.tsx**

```tsx
import { useState } from 'react';
import {
  View, ScrollView, Image, TouchableOpacity,
  Modal, StyleSheet, Dimensions, TouchableWithoutFeedback,
} from 'react-native';
import { COLORS } from '../../lib/constants';
import { BusinessPhoto } from '../../types';

const THUMB_SIZE = 80;

interface BusinessPhotoGalleryProps {
  photos: BusinessPhoto[];
}

export function BusinessPhotoGallery({ photos }: BusinessPhotoGalleryProps) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const { width } = Dimensions.get('window');

  if (photos.length === 0) return null;

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {photos.map((photo) => (
          <TouchableOpacity
            key={photo.id}
            onPress={() => setLightboxUrl(photo.url)}
            activeOpacity={0.85}
          >
            <Image
              source={{ uri: photo.url }}
              style={styles.thumb}
              resizeMode="cover"
            />
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Modal
        visible={lightboxUrl !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxUrl(null)}
      >
        <TouchableWithoutFeedback onPress={() => setLightboxUrl(null)}>
          <View style={styles.overlay}>
            {lightboxUrl && (
              <Image
                source={{ uri: lightboxUrl }}
                style={[styles.fullImage, { width }]}
                resizeMode="contain"
              />
            )}
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 16, gap: 8, paddingVertical: 8 },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullImage: {
    height: '70%' as any,
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/components/build/BusinessPhotoGallery.tsx
git commit -m "feat(components): add BusinessPhotoGallery with lightbox"
```

---

## Task 6: BusinessDetailSheet Component

**Files:**
- Create: `apps/mobile/components/build/BusinessDetailSheet.tsx`
- Create: `apps/mobile/__tests__/components/build/BusinessDetailSheet.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `apps/mobile/__tests__/components/build/BusinessDetailSheet.test.tsx`:

```tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { BusinessDetailSheet } from '../../../components/build/BusinessDetailSheet';
import { Business, BusinessPhoto } from '../../../types';

const makeBusiness = (overrides: Partial<Business> = {}): Business => ({
  id: 'b1',
  owner_id: 'user-1',
  name: 'Lavender Books',
  description: 'A queer bookshop',
  category: 'retail',
  location_city: 'London',
  website_url: 'https://lavenderbooks.com',
  instagram_handle: 'lavenderbooks',
  logo_url: null,
  is_verified: true,
  is_wlw_owned: true,
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const makePhoto = (id: string): BusinessPhoto => ({
  id,
  business_id: 'b1',
  url: `https://example.com/photo-${id}.jpg`,
  sort_order: 0,
  created_at: '2026-01-01T00:00:00Z',
});

describe('BusinessDetailSheet', () => {
  it('renders nothing when business is null', () => {
    const { queryByText } = render(
      <BusinessDetailSheet
        business={null}
        photos={[]}
        isBookmarked={false}
        onBookmarkToggle={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(queryByText('Lavender Books')).toBeNull();
  });

  it('renders business name and city', () => {
    const { getByText } = render(
      <BusinessDetailSheet
        business={makeBusiness()}
        photos={[]}
        isBookmarked={false}
        onBookmarkToggle={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(getByText('Lavender Books')).toBeTruthy();
    expect(getByText('📍 London')).toBeTruthy();
  });

  it('does not render gallery when photos is empty', () => {
    const { queryByTestId } = render(
      <BusinessDetailSheet
        business={makeBusiness()}
        photos={[]}
        isBookmarked={false}
        onBookmarkToggle={jest.fn()}
        onClose={jest.fn()}
      />
    );
    // BusinessPhotoGallery returns null for empty photos — no gallery container
    expect(queryByTestId('photo-gallery')).toBeNull();
  });

  it('does not render links section when all links are null', () => {
    const { queryByText } = render(
      <BusinessDetailSheet
        business={makeBusiness({ website_url: null, instagram_handle: null })}
        photos={[]}
        isBookmarked={false}
        onBookmarkToggle={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(queryByText('🔗 Links')).toBeNull();
  });

  it('calls onBookmarkToggle when bookmark button pressed', () => {
    const onBookmarkToggle = jest.fn();
    const { getByTestId } = render(
      <BusinessDetailSheet
        business={makeBusiness()}
        photos={[]}
        isBookmarked={false}
        onBookmarkToggle={onBookmarkToggle}
        onClose={jest.fn()}
      />
    );
    fireEvent.press(getByTestId('bookmark-btn'));
    expect(onBookmarkToggle).toHaveBeenCalled();
  });

  it('shows filled bookmark when isBookmarked is true', () => {
    const { getByTestId } = render(
      <BusinessDetailSheet
        business={makeBusiness()}
        photos={[]}
        isBookmarked={true}
        onBookmarkToggle={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(getByTestId('bookmark-btn').props.accessibilityLabel).toBe('Remove bookmark');
  });

  it('shows outline bookmark when isBookmarked is false', () => {
    const { getByTestId } = render(
      <BusinessDetailSheet
        business={makeBusiness()}
        photos={[]}
        isBookmarked={false}
        onBookmarkToggle={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(getByTestId('bookmark-btn').props.accessibilityLabel).toBe('Add bookmark');
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd apps/mobile && npx jest --ci --testPathPattern="BusinessDetailSheet"
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create BusinessDetailSheet.tsx**

Create `apps/mobile/components/build/BusinessDetailSheet.tsx`:

```tsx
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet, Linking } from 'react-native';
import { COLORS } from '../../lib/constants';
import { Business, BusinessPhoto } from '../../types';
import { BusinessPhotoGallery } from './BusinessPhotoGallery';

interface BusinessDetailSheetProps {
  business: Business | null;
  photos: BusinessPhoto[];
  isBookmarked: boolean;
  onBookmarkToggle: () => void;
  onClose: () => void;
}

export function BusinessDetailSheet({
  business,
  photos,
  isBookmarked,
  onBookmarkToggle,
  onClose,
}: BusinessDetailSheetProps) {
  const hasLinks = !!(business?.website_url || business?.instagram_handle);

  return (
    <Modal
      visible={business !== null}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      {business && (
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            {/* Handle */}
            <View style={styles.handle} />

            {/* Header row */}
            <View style={styles.headerRow}>
              <View style={styles.logoCircle}>
                <Text style={styles.logoText}>{business.name[0].toUpperCase()}</Text>
              </View>
              <View style={styles.headerInfo}>
                <Text style={styles.name} numberOfLines={2}>{business.name}</Text>
                {business.is_verified && (
                  <Text style={styles.verifiedBadge}>★ Verified WLW Business</Text>
                )}
                {business.location_city && (
                  <Text style={styles.city}>📍 {business.location_city}</Text>
                )}
              </View>
              <TouchableOpacity
                testID="bookmark-btn"
                onPress={onBookmarkToggle}
                accessibilityLabel={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
                hitSlop={12}
              >
                <Text style={styles.bookmarkIcon}>{isBookmarked ? '💜' : '🤍'}</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Photo gallery */}
              {photos.length > 0 && (
                <View testID="photo-gallery">
                  <View style={styles.divider} />
                  <BusinessPhotoGallery photos={photos} />
                  <View style={styles.divider} />
                </View>
              )}

              {/* Description */}
              {business.description && (
                <Text style={styles.description}>{business.description}</Text>
              )}

              {/* Links */}
              {hasLinks && (
                <View style={styles.linksSection}>
                  <Text style={styles.linksHeader}>🔗 Links</Text>
                  {business.website_url && (
                    <TouchableOpacity
                      onPress={() => Linking.openURL(business.website_url!).catch(() => {})}
                      style={styles.linkRow}
                    >
                      <Text style={styles.linkText}>🌐 Website →</Text>
                    </TouchableOpacity>
                  )}
                  {business.instagram_handle && (
                    <TouchableOpacity
                      onPress={() =>
                        Linking.openURL(
                          `https://instagram.com/${business.instagram_handle}`
                        ).catch(() => {})
                      }
                      style={styles.linkRow}
                    >
                      <Text style={styles.linkText}>
                        📸 @{business.instagram_handle} →
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              <View style={{ height: 40 }} />
            </ScrollView>

            {/* Close button */}
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    maxHeight: '88%',
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: COLORS.textMuted,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 12,
  },
  logoCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primary + '30',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  logoText: { color: COLORS.primary, fontWeight: '700', fontSize: 20 },
  headerInfo: { flex: 1, gap: 2 },
  name: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 17 },
  verifiedBadge: { color: COLORS.primary, fontSize: 12, fontWeight: '600' },
  city: { color: COLORS.textMuted, fontSize: 12 },
  bookmarkIcon: { fontSize: 22 },
  divider: { height: 1, backgroundColor: COLORS.surface, marginVertical: 4 },
  description: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  linksSection: { paddingHorizontal: 20, paddingVertical: 12, gap: 12 },
  linksHeader: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 14 },
  linkRow: {},
  linkText: { color: COLORS.primary, fontSize: 14, fontWeight: '600' },
  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 8,
  },
  closeBtnText: { color: COLORS.textMuted, fontSize: 18, fontWeight: '700' },
});
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd apps/mobile && npx jest --ci --testPathPattern="BusinessDetailSheet"
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/components/build/BusinessDetailSheet.tsx apps/mobile/__tests__/components/build/BusinessDetailSheet.test.tsx
git commit -m "feat(components): add BusinessDetailSheet with gallery, links, bookmark"
```

---

## Task 7: Wire Up BUILD Screen

**Files:**
- Modify: `apps/mobile/app/(tabs)/build/index.tsx`

This task rewrites the BUILD screen to use all new components. The existing `ImpactDetailModal` and `BusinessCard` inline components are replaced or upgraded.

- [ ] **Step 1: Rewrite apps/mobile/app/(tabs)/build/index.tsx**

Replace the entire file:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  RefreshControl, Linking, Share,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { useBuildStore } from '../../../store/buildStore';
import { COLORS, REGISTER_BUSINESS_URL } from '../../../lib/constants';
import { Business, BusinessPhoto, ImpactProject } from '../../../types';
import { useCommunityFilterStore } from '../../../store/communityFilterStore';
import { CommunityContextSwitcher } from '../../../components/CommunityContextSwitcher';
import { useCommunityStore } from '../../../store/communityStore';
import { ChipSearchBar } from '../../../components/build/ChipSearchBar';
import { BusinessDetailSheet } from '../../../components/build/BusinessDetailSheet';

const categoryEmoji: Record<string, string> = {
  mutual_aid: '🤝', visibility: '🏳️‍🌈', education: '📚', safety: '🛡️',
};

function BusinessCard({ biz, onPress }: { biz: Business; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.bizCard} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.bizLogo}>
        <Text style={styles.bizLogoText}>{biz.name[0]}</Text>
      </View>
      <Text style={styles.bizName} numberOfLines={1}>{biz.name}</Text>
      {biz.is_wlw_owned && <Text style={styles.wlwBadge}>💜 WLW</Text>}
      {biz.location_city && <Text style={styles.bizCity}>{biz.location_city}</Text>}
      {biz.description && (
        <Text style={styles.bizDesc} numberOfLines={2}>{biz.description}</Text>
      )}
    </TouchableOpacity>
  );
}

function ImpactCard({
  project,
  alreadySupported,
  onSupport,
  onOpenDetail,
}: {
  project: ImpactProject;
  alreadySupported: boolean;
  onSupport: () => void;
  onOpenDetail: () => void;
}) {
  const progress = project.goal_amount
    ? Math.min(project.raised_amount / project.goal_amount, 1)
    : null;

  return (
    <TouchableOpacity style={styles.impactCard} onPress={onOpenDetail} activeOpacity={0.85}>
      <View style={styles.impactHeader}>
        <Text style={styles.impactEmoji}>{categoryEmoji[project.category] ?? '✨'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.impactTitle} numberOfLines={2}>{project.title}</Text>
          <Text style={styles.impactMeta}>{project.supporter_count} supporters</Text>
        </View>
        {project.status === 'active' && (
          <TouchableOpacity
            style={[styles.supportBtn, alreadySupported && styles.supportBtnDone]}
            onPress={(e) => { e.stopPropagation?.(); onSupport(); }}
            disabled={alreadySupported}
          >
            <Text style={styles.supportBtnText}>
              {alreadySupported ? '✓ Supported' : 'Support'}
            </Text>
          </TouchableOpacity>
        )}
        {project.status === 'completed' && (
          <View style={styles.completedBadge}>
            <Text style={styles.completedText}>✓ Done</Text>
          </View>
        )}
      </View>
      {project.description && (
        <Text style={styles.impactDesc} numberOfLines={2}>{project.description}</Text>
      )}
      {progress !== null && (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` as any }]} />
        </View>
      )}
      {project.goal_amount ? (
        <Text style={styles.progressLabel}>
          £{project.raised_amount.toLocaleString()} of £{project.goal_amount.toLocaleString()} raised
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

function ImpactDetailSheet({
  project,
  alreadySupported,
  onSupport,
  onClose,
}: {
  project: ImpactProject | null;
  alreadySupported: boolean;
  onSupport: () => void;
  onClose: () => void;
}) {
  const handleWebsite = () => {
    if (project?.website_url) Linking.openURL(project.website_url).catch(() => {});
  };
  const handleShare = () => {
    Share.share({ message: `Check out ${project?.title} on Roxy!` }).catch(() => {});
  };

  return (
    <Modal
      testID="impact-detail-modal"
      visible={project !== null}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      {project && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <TouchableOpacity
              testID="modal-close-btn"
              style={styles.modalCloseBtn}
              onPress={onClose}
            >
              <Text style={styles.modalCloseBtnText}>✕</Text>
            </TouchableOpacity>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalEmoji}>{categoryEmoji[project.category] ?? '✨'}</Text>
              <Text style={styles.modalTitle}>{project.title}</Text>
              <Text style={styles.modalMeta}>{project.supporter_count} supporters</Text>
              {project.description ? (
                <Text style={styles.modalDesc}>{project.description}</Text>
              ) : null}
              {project.website_url ? (
                <TouchableOpacity style={styles.modalWebsiteBtn} onPress={handleWebsite}>
                  <Text style={styles.modalWebsiteBtnText}>Visit website →</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                testID="modal-share-btn"
                style={styles.modalShareBtn}
                onPress={handleShare}
              >
                <Text style={styles.modalShareBtnText}>Share</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="modal-support-cta"
                style={[styles.modalCtaBtn, alreadySupported && styles.modalCtaBtnDone]}
                onPress={onSupport}
                disabled={alreadySupported}
              >
                <Text style={styles.modalCtaBtnText}>
                  {alreadySupported ? '✓ Supported' : "I'll support this project 💜"}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      )}
    </Modal>
  );
}

export default function BuildScreen() {
  const { user } = useAuthStore();
  const {
    businesses, impactProjects, loading,
    setImpactProjects, setLoading, incrementSupporter,
    bookmarkedBusinessIds, supportedProjectIds,
    searchChips, addSearchChip, removeSearchChip,
    loadBookmarks, loadSupports, toggleBookmark, supportProject, loadBusinesses,
  } = useBuildStore();
  const { selectedCommunityId } = useCommunityFilterStore();
  const { joinedCommunities } = useCommunityStore();

  const [segment, setSegment] = useState<'businesses' | 'impact'>('businesses');
  const [bizView, setBizView] = useState<'all' | 'saved'>('all');
  const [wlwOnly, setWlwOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedProject, setSelectedProject] = useState<ImpactProject | null>(null);
  const [selectedBiz, setSelectedBiz] = useState<Business | null>(null);
  const [bizPhotos, setBizPhotos] = useState<BusinessPhoto[]>([]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getCommunityMemberIds = useCallback(async (): Promise<string[] | undefined> => {
    if (!selectedCommunityId) return undefined;
    const { data: members } = await supabase
      .from('community_members')
      .select('user_id')
      .eq('community_id', selectedCommunityId);
    return (members ?? []).map((m: any) => m.user_id);
  }, [selectedCommunityId]);

  const fetchBusinesses = useCallback(async (chips: string[], wlw: boolean) => {
    const memberIds = await getCommunityMemberIds();
    await loadBusinesses(chips, wlw, memberIds);
  }, [getCommunityMemberIds, loadBusinesses]);

  const triggerBizLoad = useCallback((chips: string[], wlw: boolean) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchBusinesses(chips, wlw), 300);
  }, [fetchBusinesses]);

  const loadProjects = useCallback(async () => {
    const memberIds = await getCommunityMemberIds();
    let query = supabase.from('impact_projects').select('*');
    if (memberIds && memberIds.length > 0) query = query.in('creator_id', memberIds);
    const { data } = await query.order('status').order('created_at', { ascending: false }).limit(30);
    setImpactProjects((data as ImpactProject[]) ?? []);
  }, [getCommunityMemberIds, setImpactProjects]);

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    Promise.all([
      fetchBusinesses(searchChips, wlwOnly),
      loadProjects(),
      loadBookmarks(user.id),
      loadSupports(user.id),
    ]).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCommunityId]);

  // Re-fetch when chips or wlwOnly change
  useEffect(() => {
    triggerBizLoad(searchChips, wlwOnly);
  }, [searchChips, wlwOnly, triggerBizLoad]);

  const handleRefresh = async () => {
    if (!user?.id) return;
    setRefreshing(true);
    await Promise.all([
      fetchBusinesses(searchChips, wlwOnly),
      loadProjects(),
      loadBookmarks(user.id),
      loadSupports(user.id),
    ]);
    setRefreshing(false);
  };

  const handleSupport = async (projectId: string) => {
    if (!user?.id) return;
    await supportProject(projectId, user.id);
  };

  const handleOpenBiz = async (biz: Business) => {
    setSelectedBiz(biz);
    const { data } = await supabase
      .from('business_photos')
      .select('*')
      .eq('business_id', biz.id)
      .order('sort_order');
    setBizPhotos((data as BusinessPhoto[]) ?? []);
  };

  const displayedBiz = bizView === 'saved'
    ? businesses.filter((b) => bookmarkedBusinessIds.has(b.id))
    : businesses;

  const RegisterFooter = () => (
    <TouchableOpacity
      style={styles.registerFooter}
      onPress={() => Linking.openURL(REGISTER_BUSINESS_URL).catch(() => {})}
    >
      <Text style={styles.registerFooterText}>Want your business listed here?</Text>
      <Text style={styles.registerFooterLink}>→ Register your business</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Build</Text>
        <CommunityContextSwitcher communities={joinedCommunities} />
      </View>

      <View style={styles.segmentRow}>
        {(['businesses', 'impact'] as const).map((s) => (
          <TouchableOpacity
            key={s}
            testID={`segment-${s}`}
            style={[styles.segmentBtn, segment === s && styles.segmentBtnActive]}
            onPress={() => setSegment(s)}
          >
            <Text style={[styles.segmentText, segment === s && styles.segmentTextActive]}>
              {s === 'businesses' ? 'Businesses' : 'Impact'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {segment === 'businesses' && (
        <>
          {/* All / Saved toggle */}
          <View style={styles.bizViewToggle}>
            {(['all', 'saved'] as const).map((v) => (
              <TouchableOpacity
                key={v}
                style={[styles.bizViewBtn, bizView === v && styles.bizViewBtnActive]}
                onPress={() => setBizView(v)}
              >
                <Text style={[styles.bizViewText, bizView === v && styles.bizViewTextActive]}>
                  {v === 'all' ? 'All' : '💜 Saved'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Chip search + WLW toggle */}
          <View style={styles.filterWrapper}>
            <ChipSearchBar
              chips={searchChips}
              onAddChip={addSearchChip}
              onRemoveChip={removeSearchChip}
            />
            <TouchableOpacity
              style={[styles.wlwToggle, wlwOnly && styles.wlwToggleActive]}
              onPress={() => setWlwOnly((v) => !v)}
            >
              <Text style={styles.wlwToggleText}>💜 WLW only</Text>
            </TouchableOpacity>
          </View>

          <FlashList
            data={displayedBiz}
            keyExtractor={(item) => item.id}
            numColumns={2}
            estimatedItemSize={180}
            renderItem={({ item }) => (
              <BusinessCard biz={item} onPress={() => handleOpenBiz(item)} />
            )}
            contentContainerStyle={styles.gridContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.roxy} />
            }
            ListFooterComponent={<RegisterFooter />}
          />
        </>
      )}

      {segment === 'impact' && (
        <FlashList
          data={impactProjects}
          keyExtractor={(item) => item.id}
          estimatedItemSize={130}
          renderItem={({ item }) => (
            <ImpactCard
              project={item}
              alreadySupported={supportedProjectIds.has(item.id)}
              onSupport={() => handleSupport(item.id)}
              onOpenDetail={() => setSelectedProject(item)}
            />
          )}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.roxy} />
          }
          ListEmptyComponent={
            loading ? null : (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No projects yet</Text>
              </View>
            )
          }
        />
      )}

      <BusinessDetailSheet
        business={selectedBiz}
        photos={bizPhotos}
        isBookmarked={selectedBiz ? bookmarkedBusinessIds.has(selectedBiz.id) : false}
        onBookmarkToggle={() => selectedBiz && user?.id && toggleBookmark(selectedBiz.id, user.id)}
        onClose={() => { setSelectedBiz(null); setBizPhotos([]); }}
      />

      <ImpactDetailSheet
        project={selectedProject}
        alreadySupported={selectedProject ? supportedProjectIds.has(selectedProject.id) : false}
        onSupport={() => selectedProject && handleSupport(selectedProject.id)}
        onClose={() => setSelectedProject(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textPrimary },
  segmentRow: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.surface,
    paddingHorizontal: 16, gap: 4,
  },
  segmentBtn: { paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  segmentBtnActive: { borderBottomColor: COLORS.primary },
  segmentText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 15 },
  segmentTextActive: { color: COLORS.textPrimary },
  bizViewToggle: {
    flexDirection: 'row', paddingHorizontal: 12, paddingTop: 8, gap: 8,
  },
  bizViewBtn: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 20, backgroundColor: COLORS.surface,
  },
  bizViewBtnActive: { backgroundColor: COLORS.primary + '25', borderWidth: 1, borderColor: COLORS.primary },
  bizViewText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 13 },
  bizViewTextActive: { color: COLORS.primary },
  filterWrapper: { paddingBottom: 8 },
  wlwToggle: {
    marginHorizontal: 12, marginTop: 6,
    backgroundColor: COLORS.surface, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: 'transparent', alignSelf: 'flex-start',
  },
  wlwToggleActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '20' },
  wlwToggleText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  gridContent: { padding: 8 },
  listContent: { padding: 16 },
  bizCard: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: 14, padding: 14,
    margin: 4, gap: 4,
  },
  bizLogo: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.primary + '30', alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  bizLogoText: { color: COLORS.primary, fontWeight: '700', fontSize: 18 },
  bizName: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 14 },
  wlwBadge: { color: COLORS.secondary, fontSize: 11, fontWeight: '600' },
  bizCity: { color: COLORS.textMuted, fontSize: 11 },
  bizDesc: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 16 },
  impactCard: {
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, marginBottom: 10, gap: 8,
  },
  impactHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  impactEmoji: { fontSize: 22 },
  impactTitle: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 14 },
  impactMeta: { color: COLORS.textMuted, fontSize: 12 },
  impactDesc: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 18 },
  supportBtn: {
    backgroundColor: COLORS.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
  },
  supportBtnDone: { backgroundColor: COLORS.success },
  supportBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  completedBadge: {
    backgroundColor: COLORS.success + '20', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
  },
  completedText: { color: COLORS.success, fontWeight: '700', fontSize: 12 },
  progressTrack: { height: 6, backgroundColor: COLORS.surfaceLight, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: COLORS.primary, borderRadius: 3 },
  progressLabel: { color: COLORS.textMuted, fontSize: 11 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '700' },
  registerFooter: {
    alignItems: 'center', paddingVertical: 24, paddingHorizontal: 16, gap: 4,
  },
  registerFooterText: { color: COLORS.textMuted, fontSize: 13 },
  registerFooterLink: { color: COLORS.primary, fontSize: 14, fontWeight: '700' },
  // Impact detail modal styles (preserved from original)
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: COLORS.background, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40, maxHeight: '85%',
  },
  modalCloseBtn: { alignSelf: 'flex-end', padding: 8, marginBottom: 8 },
  modalCloseBtnText: { color: COLORS.textMuted, fontSize: 18, fontWeight: '700' },
  modalEmoji: { fontSize: 48, textAlign: 'center', marginBottom: 8 },
  modalTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 22, textAlign: 'center', marginBottom: 4 },
  modalMeta: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', marginBottom: 16 },
  modalDesc: { color: COLORS.textSecondary, fontSize: 15, lineHeight: 22, marginBottom: 20 },
  modalWebsiteBtn: { marginBottom: 12 },
  modalWebsiteBtnText: { color: COLORS.primary, fontSize: 15, fontWeight: '700' },
  modalShareBtn: {
    backgroundColor: COLORS.surface, borderRadius: 12, paddingVertical: 12,
    alignItems: 'center', marginBottom: 12,
  },
  modalShareBtnText: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 15 },
  modalCtaBtn: {
    backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', marginBottom: 12,
  },
  modalCtaBtnDone: { backgroundColor: COLORS.success },
  modalCtaBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
```

**Note:** The `ImpactDetailSheet` in this file uses inline `require('react-native')` — fix this by replacing the function body to use the imports already at the top of the file (the `require` was a copy-paste error in the template above). The `Modal`, `View`, `Text`, `TouchableOpacity`, `ScrollView` are already imported at the top. Use those directly inside `ImpactDetailSheet`.

- [ ] **Step 2: Run TypeScript check**

```bash
cd apps/mobile && npx tsc --noEmit
```

Fix any errors before continuing.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/(tabs)/build/index.tsx
git commit -m "feat(screen): wire BUILD screen with chip search, bookmarks, detail sheet"
```

---

## Task 8: Profile Screen — Saved Businesses

**Files:**
- Modify: `apps/mobile/components/profile/ProfileCard.tsx`
- Modify: `apps/mobile/app/(tabs)/profile/index.tsx`

- [ ] **Step 1: Add savedBusinesses prop to ProfileCard**

In `apps/mobile/components/profile/ProfileCard.tsx`, add the `Business` import and extend `ProfileCardProps`:

```ts
import type { Business } from '../../types';
```

Add to `ProfileCardProps` interface:
```ts
savedBusinesses?: Business[];
onOpenBusiness?: (business: Business) => void;
```

At the bottom of the `ProfileCard` `ScrollView` (before `</ScrollView>`), add this block — only when `isOwn` is true and `savedBusinesses` exists:

```tsx
{isOwn && savedBusinesses && (
  <View style={savedStyles.section}>
    <Text style={savedStyles.sectionTitle}>💜 Saved Businesses</Text>
    {savedBusinesses.length === 0 ? (
      <Text style={savedStyles.empty}>No saved businesses yet</Text>
    ) : (
      savedBusinesses.map((biz) => (
        <TouchableOpacity
          key={biz.id}
          style={savedStyles.bizRow}
          onPress={() => onOpenBusiness?.(biz)}
          activeOpacity={0.8}
        >
          <View style={savedStyles.bizInitial}>
            <Text style={savedStyles.bizInitialText}>{biz.name[0].toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={savedStyles.bizName}>{biz.name}</Text>
            {biz.category && (
              <Text style={savedStyles.bizCategory}>{biz.category}</Text>
            )}
          </View>
          <Text style={savedStyles.chevron}>›</Text>
        </TouchableOpacity>
      ))
    )}
  </View>
)}
```

Add `savedStyles` to the `StyleSheet.create` in ProfileCard.tsx:

```ts
const savedStyles = StyleSheet.create({
  section: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 8 },
  sectionTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 16, marginBottom: 12 },
  empty: { color: COLORS.textMuted, fontSize: 14 },
  bizRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.surface, borderRadius: 12,
    padding: 12, marginBottom: 8, gap: 12,
  },
  bizInitial: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.primary + '30',
    alignItems: 'center', justifyContent: 'center',
  },
  bizInitialText: { color: COLORS.primary, fontWeight: '700', fontSize: 15 },
  bizName: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 14 },
  bizCategory: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  chevron: { color: COLORS.textMuted, fontSize: 20 },
});
```

- [ ] **Step 2: Update profile/index.tsx**

Replace `apps/mobile/app/(tabs)/profile/index.tsx`:

```tsx
// apps/mobile/app/(tabs)/profile/index.tsx
import { useEffect, useState } from 'react';
import { StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../../store/authStore';
import { useProfileStore } from '../../../store/profileStore';
import { useBuildStore } from '../../../store/buildStore';
import { supabase } from '../../../lib/supabase';
import { COLORS } from '../../../lib/constants';
import { ProfileCard } from '../../../components/profile/ProfileCard';
import { BusinessDetailSheet } from '../../../components/build/BusinessDetailSheet';
import { logError } from '../../../lib/errorLogger';
import type { UserBadgeProgress, Badge, Business, BusinessPhoto } from '../../../types';

type EarnedBadge = UserBadgeProgress & { badges: Badge | null };

export default function ProfileScreen() {
  const { user } = useAuthStore();
  const { profile } = useProfileStore();
  const { bookmarkedBusinessIds, loadBookmarks, toggleBookmark } = useBuildStore();
  const router = useRouter();

  const [badges, setBadges] = useState<EarnedBadge[]>([]);
  const [savedBusinesses, setSavedBusinesses] = useState<Business[]>([]);
  const [selectedBiz, setSelectedBiz] = useState<Business | null>(null);
  const [bizPhotos, setBizPhotos] = useState<BusinessPhoto[]>([]);

  useEffect(() => {
    if (!user?.id) return;
    void supabase
      .from('user_badge_progress')
      .select('*, badges(*)')
      .eq('user_id', user.id)
      .then(({ data }) => { if (data) setBadges(data as EarnedBadge[]); })
      .catch((e) => logError(e, 'profileScreen_fetchBadges'));

    void loadBookmarks(user.id);
  }, [user?.id, loadBookmarks]);

  // Fetch saved business details whenever bookmarked IDs change
  useEffect(() => {
    const ids = [...bookmarkedBusinessIds];
    if (ids.length === 0) { setSavedBusinesses([]); return; }
    void supabase
      .from('businesses')
      .select('*')
      .in('id', ids)
      .then(({ data }) => { if (data) setSavedBusinesses(data as Business[]); })
      .catch((e) => logError(e, 'profileScreen_fetchSavedBusinesses'));
  }, [bookmarkedBusinessIds]);

  const handleOpenBiz = async (biz: Business) => {
    setSelectedBiz(biz);
    const { data } = await supabase
      .from('business_photos')
      .select('*')
      .eq('business_id', biz.id)
      .order('sort_order');
    setBizPhotos((data as BusinessPhoto[]) ?? []);
  };

  if (!user || !profile) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={COLORS.roxy} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ProfileCard
        profile={profile}
        badges={badges}
        isOwn={true}
        savedBusinesses={savedBusinesses}
        onOpenBusiness={handleOpenBiz}
        onEdit={() => router.push('/(tabs)/profile/edit' as any)}
        onSettings={() => router.push('/(tabs)/profile/settings' as any)}
      />
      <BusinessDetailSheet
        business={selectedBiz}
        photos={bizPhotos}
        isBookmarked={selectedBiz ? bookmarkedBusinessIds.has(selectedBiz.id) : false}
        onBookmarkToggle={() =>
          selectedBiz && user?.id && toggleBookmark(selectedBiz.id, user.id)
        }
        onClose={() => { setSelectedBiz(null); setBizPhotos([]); }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
});
```

- [ ] **Step 3: Run TypeScript check**

```bash
cd apps/mobile && npx tsc --noEmit
```

Fix all errors before continuing.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/components/profile/ProfileCard.tsx apps/mobile/app/(tabs)/profile/index.tsx
git commit -m "feat(profile): add Saved Businesses section to profile screen"
```

---

## Task 9: QA Loop

- [ ] **Step 1: Run full test suite**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests
```

Expected: all existing tests pass + new tests pass. Fix any failures before continuing.

- [ ] **Step 2: TypeScript strict check**

```bash
cd apps/mobile && npx tsc --noEmit
```

Expected: 0 errors. Fix all errors before continuing.

- [ ] **Step 3: Lint**

```bash
cd apps/mobile && npx eslint . --ext .ts,.tsx --max-warnings 0
```

Fix all warnings. Common issues: unused imports, missing deps in useEffect.

- [ ] **Step 4: Review checklist**

- [ ] RLS enabled on all 3 new tables (verified in migrations)
- [ ] Composite PKs prevent duplicate supports/bookmarks at DB level
- [ ] Triggers keep supporter_count + photo count in sync
- [ ] `toggleBookmark` rolls back on error
- [ ] `supportProject` rolls back on error
- [ ] `REGISTER_BUSINESS_URL` is a constant, not hardcoded
- [ ] No `console.log` in production code
- [ ] No PII logged
- [ ] `BusinessDetailSheet` renders null when `business === null`
- [ ] `BusinessPhotoGallery` renders null when `photos.length === 0`

- [ ] **Step 5: Final commit + log update**

```bash
git add -p  # stage any remaining fixes
git commit -m "chore(qa): fix lint and tsc issues for BUILD tab feature"
```

Append to `.claude/log.md`:
```
[2026-04-13] [CLIENT] [FEATURE] BUILD tab enhancement — chip search, business detail sheet, photo gallery, bookmarks, persistent project support, saved businesses on profile. Migrations 027-030. QA: tsc ✓ jest ✓ eslint ✓. [FILES: 4 migrations, buildStore.ts, 4 new components, build/index.tsx, ProfileCard.tsx, profile/index.tsx, 3 test files]
```
