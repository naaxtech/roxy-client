# Community Context Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-screen community context switcher to Connect, Discover, and Build that filters all content to a selected community, with "All Communities" as the default.

**Architecture:** A global Zustand store holds one `selectedCommunityId | null`. A shared `CommunityContextSwitcher` component renders a header button that opens a searchable bottom sheet (React Native Modal). Each affected screen reads the store value and adds a WHERE clause to its Supabase queries when non-null. Build tab filters by community membership (subquery), not a community_id column (businesses/impact_projects have none).

**Tech Stack:** React Native, Zustand, Supabase JS, `@testing-library/react-native`, Jest

---

## File Map

| Action | File | Purpose |
|---|---|---|
| Create | `apps/mobile/store/communityFilterStore.ts` | Global `selectedCommunityId` state |
| Create | `apps/mobile/components/CommunityContextSwitcher.tsx` | Switcher button + picker bottom sheet |
| Create | `apps/mobile/__tests__/store/communityFilterStore.test.ts` | Store tests |
| Create | `apps/mobile/__tests__/components/CommunityContextSwitcher.test.tsx` | Component tests |
| Modify | `apps/mobile/app/(tabs)/connect/index.tsx` | Header switcher + filtered queries |
| Modify | `apps/mobile/app/(tabs)/discover/index.tsx` | Header switcher + filtered events query |
| Modify | `apps/mobile/app/(tabs)/build/index.tsx` | Header switcher + filtered by member queries |

---

## Task 1: communityFilterStore

**Files:**
- Create: `apps/mobile/store/communityFilterStore.ts`
- Create: `apps/mobile/__tests__/store/communityFilterStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/__tests__/store/communityFilterStore.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react-native';
import { useCommunityFilterStore } from '../../store/communityFilterStore';

describe('communityFilterStore', () => {
  beforeEach(() => {
    useCommunityFilterStore.setState({ selectedCommunityId: null });
  });

  it('initialises with null selection', () => {
    const { result } = renderHook(() => useCommunityFilterStore());
    expect(result.current.selectedCommunityId).toBeNull();
  });

  it('setSelectedCommunity stores the id', () => {
    const { result } = renderHook(() => useCommunityFilterStore());
    act(() => { result.current.setSelectedCommunity('abc-123'); });
    expect(result.current.selectedCommunityId).toBe('abc-123');
  });

  it('setSelectedCommunity(null) resets to All Communities', () => {
    useCommunityFilterStore.setState({ selectedCommunityId: 'abc-123' });
    const { result } = renderHook(() => useCommunityFilterStore());
    act(() => { result.current.setSelectedCommunity(null); });
    expect(result.current.selectedCommunityId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/mobile && npx jest __tests__/store/communityFilterStore.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '../../store/communityFilterStore'`

- [ ] **Step 3: Implement the store**

Create `apps/mobile/store/communityFilterStore.ts`:

```ts
import { create } from 'zustand';

interface CommunityFilterState {
  selectedCommunityId: string | null;
  setSelectedCommunity: (id: string | null) => void;
}

export const useCommunityFilterStore = create<CommunityFilterState>((set) => ({
  selectedCommunityId: null,
  setSelectedCommunity: (id) => set({ selectedCommunityId: id }),
}));
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/mobile && npx jest __tests__/store/communityFilterStore.test.ts --no-coverage
```

Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/store/communityFilterStore.ts apps/mobile/__tests__/store/communityFilterStore.test.ts
git commit -m "feat: communityFilterStore — global community context selection"
```

---

## Task 2: CommunityContextSwitcher component

**Files:**
- Create: `apps/mobile/components/CommunityContextSwitcher.tsx`
- Create: `apps/mobile/__tests__/components/CommunityContextSwitcher.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/__tests__/components/CommunityContextSwitcher.test.tsx`:

```tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { CommunityContextSwitcher } from '../../components/CommunityContextSwitcher';
import { useCommunityFilterStore } from '../../store/communityFilterStore';

const communities = [
  { id: 'c1', name: 'Queer Book Club' },
  { id: 'c2', name: 'WLW Gamers' },
  { id: 'c3', name: 'Lesbian Hikers Madrid' },
];

beforeEach(() => {
  useCommunityFilterStore.setState({ selectedCommunityId: null });
});

describe('CommunityContextSwitcher', () => {
  it('shows "All ▾" when no community selected', () => {
    const { getByText } = render(<CommunityContextSwitcher communities={communities} />);
    expect(getByText('All ▾')).toBeTruthy();
  });

  it('shows truncated community name when one is selected', () => {
    useCommunityFilterStore.setState({ selectedCommunityId: 'c3' });
    const { getByText } = render(<CommunityContextSwitcher communities={communities} />);
    // "Lesbian Hikers Madrid" (21 chars) → slice(0, 10) + "… ▾" = "Lesbian Hi… ▾"
    expect(getByText('Lesbian Hi… ▾')).toBeTruthy();
  });

  it('opens the picker sheet on button press', () => {
    const { getByTestId, getByText } = render(<CommunityContextSwitcher communities={communities} />);
    fireEvent.press(getByTestId('community-switcher-btn'));
    expect(getByText('View a Community')).toBeTruthy();
    expect(getByText('All Communities')).toBeTruthy();
    expect(getByText('Queer Book Club')).toBeTruthy();
  });

  it('selects a community and closes the sheet', () => {
    const { getByTestId, getByText, queryByText } = render(
      <CommunityContextSwitcher communities={communities} />
    );
    fireEvent.press(getByTestId('community-switcher-btn'));
    fireEvent.press(getByTestId('community-option-c2'));
    expect(useCommunityFilterStore.getState().selectedCommunityId).toBe('c2');
    expect(queryByText('View a Community')).toBeNull();
  });

  it('selecting All Communities resets to null', () => {
    useCommunityFilterStore.setState({ selectedCommunityId: 'c1' });
    const { getByTestId } = render(<CommunityContextSwitcher communities={communities} />);
    fireEvent.press(getByTestId('community-switcher-btn'));
    fireEvent.press(getByTestId('community-option-all'));
    expect(useCommunityFilterStore.getState().selectedCommunityId).toBeNull();
  });

  it('filters the list by search text', () => {
    const { getByTestId, getByText, queryByText } = render(
      <CommunityContextSwitcher communities={communities} />
    );
    fireEvent.press(getByTestId('community-switcher-btn'));
    fireEvent.changeText(getByTestId('community-search-input'), 'gamer');
    expect(getByText('WLW Gamers')).toBeTruthy();
    expect(queryByText('Queer Book Club')).toBeNull();
  });

  it('shows empty state when search has no matches', () => {
    const { getByTestId, getByText } = render(<CommunityContextSwitcher communities={communities} />);
    fireEvent.press(getByTestId('community-switcher-btn'));
    fireEvent.changeText(getByTestId('community-search-input'), 'zzznomatch');
    expect(getByText('No communities match')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/mobile && npx jest __tests__/components/CommunityContextSwitcher.test.tsx --no-coverage
```

Expected: FAIL — `Cannot find module '../../components/CommunityContextSwitcher'`

- [ ] **Step 3: Implement the component**

Create `apps/mobile/components/CommunityContextSwitcher.tsx`:

```tsx
import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, FlatList,
} from 'react-native';
import { useCommunityFilterStore } from '../store/communityFilterStore';
import { COLORS } from '../lib/constants';

type CommunityOption = { id: string; name: string };

interface Props {
  communities: CommunityOption[];
}

export function CommunityContextSwitcher({ communities }: Props) {
  const { selectedCommunityId, setSelectedCommunity } = useCommunityFilterStore();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selected = communities.find((c) => c.id === selectedCommunityId);
  const rawLabel = selected ? selected.name : 'All';
  const label = rawLabel.length > 12 ? rawLabel.slice(0, 10) + '… ▾' : rawLabel + ' ▾';

  const filtered = search
    ? communities.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    : communities;

  const handleSelect = (id: string | null) => {
    setSelectedCommunity(id);
    setOpen(false);
    setSearch('');
  };

  type Row = { id: string | null; name: string };
  const rows: Row[] = [{ id: null, name: 'All Communities' }, ...filtered];

  return (
    <>
      <TouchableOpacity
        style={styles.btn}
        onPress={() => setOpen(true)}
        activeOpacity={0.75}
        testID="community-switcher-btn"
      >
        <Text style={styles.btnText} numberOfLines={1}>{label}</Text>
      </TouchableOpacity>

      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={() => { setOpen(false); setSearch(''); }}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => { setOpen(false); setSearch(''); }}
        >
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>View a Community</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Search your communities..."
              placeholderTextColor={COLORS.textMuted}
              value={search}
              onChangeText={setSearch}
              testID="community-search-input"
              autoCorrect={false}
            />
            <FlatList
              data={rows}
              keyExtractor={(item) => item.id ?? '__all__'}
              style={styles.list}
              renderItem={({ item }) => {
                const isSelected = item.id === selectedCommunityId;
                return (
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => handleSelect(item.id)}
                    testID={`community-option-${item.id ?? 'all'}`}
                  >
                    <View style={[styles.radio, isSelected && styles.radioSelected]} />
                    <Text style={[styles.rowText, isSelected && styles.rowTextSelected]}>
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No communities match</Text>
              }
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: COLORS.primary + '60',
    maxWidth: 160,
  },
  btnText: {
    color: COLORS.primary,
    fontWeight: '700',
    fontSize: 12,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 40,
    maxHeight: '70%',
  },
  handle: {
    width: 40, height: 4,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    color: COLORS.textPrimary,
    fontWeight: '800',
    fontSize: 16,
    marginBottom: 12,
  },
  searchInput: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    color: COLORS.textPrimary,
    fontSize: 14,
    marginBottom: 12,
  },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceLight,
  },
  radio: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 2, borderColor: COLORS.textMuted,
  },
  radioSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary,
  },
  rowText: { color: COLORS.textSecondary, fontSize: 14, flex: 1 },
  rowTextSelected: { color: COLORS.textPrimary, fontWeight: '700' },
  emptyText: {
    color: COLORS.textMuted, fontSize: 13,
    paddingVertical: 16, textAlign: 'center',
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/mobile && npx jest __tests__/components/CommunityContextSwitcher.test.tsx --no-coverage
```

Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/components/CommunityContextSwitcher.tsx apps/mobile/__tests__/components/CommunityContextSwitcher.test.tsx
git commit -m "feat: CommunityContextSwitcher — header button + searchable picker sheet"
```

---

## Task 3: Connect screen integration

**Files:**
- Modify: `apps/mobile/app/(tabs)/connect/index.tsx`

The Connect screen already imports `useCommunityStore` (for `joinedIds`). We add:
1. `joinedCommunities` from the same store — used to populate the switcher
2. `selectedCommunityId` from `useCommunityFilterStore`
3. Switcher in the header beside "Connect" title
4. `loadFeed` — filter by selected community when non-null
5. `loadEvents` — same
6. `loadRooms` — add community filter on rooms (not games)
7. All three callbacks get `selectedCommunityId` in their `useCallback` deps

- [ ] **Step 1: Add imports and store reads**

At the top of `apps/mobile/app/(tabs)/connect/index.tsx`, add these two imports after the existing import block:

```ts
import { useCommunityFilterStore } from '../../../store/communityFilterStore';
import { CommunityContextSwitcher } from '../../../components/CommunityContextSwitcher';
```

Inside `ConnectScreen`, destructure `joinedCommunities` alongside existing `joinedIds`:

```ts
// Replace this line:
const { joinedIds, fetchJoined } = useCommunityStore();
// With:
const { joinedIds, joinedCommunities, fetchJoined } = useCommunityStore();
```

Add the filter store read directly below:

```ts
const { selectedCommunityId } = useCommunityFilterStore();
```

- [ ] **Step 2: Update loadFeed to respect filter**

Replace the `loadFeed` callback:

```ts
const loadFeed = useCallback(async () => {
  const ids = Array.from(joinedIds);
  if (ids.length === 0) { setPosts([]); return; }
  setLoadingFeed(true);
  let query = supabase
    .from('posts')
    .select('*, comment_count, profiles(display_name, avatar_url), communities(name)')
    .order('created_at', { ascending: false })
    .limit(50);
  if (selectedCommunityId) {
    query = query.eq('community_id', selectedCommunityId);
  } else {
    query = query.in('community_id', ids);
  }
  const { data } = await query;
  if (data) setPosts(data as PostRow[]);
  setLoadingFeed(false);
}, [joinedIds, selectedCommunityId]);
```

- [ ] **Step 3: Update loadEvents to respect filter**

Replace the `loadEvents` callback:

```ts
const loadEvents = useCallback(async () => {
  const ids = Array.from(joinedIds);
  if (ids.length === 0) { setEvents([]); return; }
  setLoadingEvents(true);
  const now = new Date().toISOString();
  let query = supabase
    .from('events')
    .select('*, communities(name)')
    .gte('starts_at', now)
    .order('starts_at')
    .limit(20);
  if (selectedCommunityId) {
    query = query.eq('community_id', selectedCommunityId);
  } else {
    query = query.in('community_id', ids);
  }
  const { data } = await query;
  if (data) setEvents(data as EventRow[]);
  setLoadingEvents(false);
}, [joinedIds, selectedCommunityId]);
```

- [ ] **Step 4: Update loadRooms to respect filter**

Replace the `loadRooms` callback:

```ts
const loadRooms = useCallback(async () => {
  setLoadingRooms(true);
  let roomsQuery = supabase
    .from('community_rooms')
    .select('id, name, room_type, community_id, communities(name), is_active')
    .eq('is_active', true)
    .order('name');
  if (selectedCommunityId) {
    roomsQuery = roomsQuery.eq('community_id', selectedCommunityId);
  }
  const [{ data: gamesData }, { data: roomsData }] = await Promise.all([
    supabase.from('games').select('*').eq('is_active', true).order('name'),
    roomsQuery,
  ]);
  if (gamesData) setGames(gamesData as GameRow[]);
  if (roomsData) setRooms(roomsData as unknown as CommunityRoomRow[]);
  setLoadingRooms(false);
}, [selectedCommunityId]);
```

- [ ] **Step 5: Update the header JSX**

Replace the existing header View:

```tsx
{/* Header */}
<View style={styles.header}>
  <Text style={styles.headerTitle}>Connect</Text>
  <CommunityContextSwitcher communities={joinedCommunities} />
</View>
```

Update the header style in `StyleSheet.create` to be a row:

```ts
header: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingHorizontal: 16,
  paddingVertical: 8,
  borderBottomWidth: 1,
  borderBottomColor: COLORS.surface,
},
```

- [ ] **Step 6: Run full test suite**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests --no-coverage
```

Expected: all existing tests still pass

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/app/(tabs)/connect/index.tsx
git commit -m "feat: Connect screen — community context switcher in header, filtered queries"
```

---

## Task 4: Discover screen integration

**Files:**
- Modify: `apps/mobile/app/(tabs)/discover/index.tsx`

Discover has a header with title + search input stacked in a column. The switcher goes on a new row beside the title (title left, switcher right), keeping the search input below.

Only the Events sub-tab is filtered. Communities and Games tabs are unchanged.

- [ ] **Step 1: Add imports and store reads**

Add these imports to `apps/mobile/app/(tabs)/discover/index.tsx` after the existing imports:

```ts
import { useCommunityFilterStore } from '../../../store/communityFilterStore';
import { CommunityContextSwitcher } from '../../../components/CommunityContextSwitcher';
```

Inside `DiscoverScreen`, add:

```ts
const { selectedCommunityId } = useCommunityFilterStore();
```

Also destructure `joinedCommunities` from `useCommunityStore` (it's already imported):

```ts
// Replace:
const { allCommunities, joinedIds, fetchAll, fetchJoined, joinCommunity, leaveCommunity } = useCommunityStore();
// With:
const { allCommunities, joinedIds, joinedCommunities, fetchAll, fetchJoined, joinCommunity, leaveCommunity } = useCommunityStore();
```

- [ ] **Step 2: Update loadEvents to respect filter**

Replace the `loadEvents` callback:

```ts
const loadEvents = useCallback(async () => {
  setLoadingEvents(true);
  const now = new Date().toISOString();
  let query = supabase
    .from('events')
    .select('*, communities(name)')
    .gte('starts_at', now)
    .order('starts_at')
    .limit(50);
  if (selectedCommunityId) {
    query = query.eq('community_id', selectedCommunityId);
  }
  const { data } = await query;
  if (data) setEvents(data as EventRow[]);
  setLoadingEvents(false);
}, [selectedCommunityId]);
```

Also add `selectedCommunityId` to the effect that triggers `loadEvents`:

```ts
useEffect(() => {
  if (subTab === 'events') { loadEvents(); loadInterested(); }
}, [subTab, loadEvents, loadInterested]);
```

(No change needed here — `loadEvents` already changes identity when `selectedCommunityId` changes, so this effect auto-re-runs.)

- [ ] **Step 3: Update the header JSX**

Replace the existing header View:

```tsx
{/* Header */}
<View style={styles.header}>
  <View style={styles.headerTop}>
    <Text style={styles.headerTitle}>Discover</Text>
    <CommunityContextSwitcher communities={joinedCommunities} />
  </View>
  <TextInput
    style={styles.searchInput}
    placeholder="Search communities, events..."
    placeholderTextColor={COLORS.textMuted}
    value={search}
    onChangeText={setSearch}
    returnKeyType="search"
  />
</View>
```

Add `headerTop` to the stylesheet:

```ts
headerTop: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 8,
},
```

- [ ] **Step 4: Run full test suite**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests --no-coverage
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/(tabs)/discover/index.tsx
git commit -m "feat: Discover screen — community context switcher, filtered events query"
```

---

## Task 5: Build screen integration

**Files:**
- Modify: `apps/mobile/app/(tabs)/build/index.tsx`

Build has no header row currently — just a segment row at the top. Add a header with title + switcher above the segment row. When a community is selected, filter businesses by `owner_id` and impact projects by `creator_id` matching community members — a two-step query (fetch member IDs, then filter). If the community has no members, return empty arrays.

- [ ] **Step 1: Add imports and store reads**

Add to the imports in `apps/mobile/app/(tabs)/build/index.tsx`:

```ts
import { useCommunityFilterStore } from '../../../store/communityFilterStore';
import { CommunityContextSwitcher } from '../../../components/CommunityContextSwitcher';
import { useCommunityStore } from '../../../store/communityStore';
```

Inside `BuildScreen`, add:

```ts
const { selectedCommunityId } = useCommunityFilterStore();
const { joinedCommunities } = useCommunityStore();
```

- [ ] **Step 2: Update loadBusinesses to respect filter**

Replace the `loadBusinesses` callback:

```ts
const loadBusinesses = useCallback(async () => {
  if (selectedCommunityId) {
    const { data: members } = await supabase
      .from('community_members')
      .select('user_id')
      .eq('community_id', selectedCommunityId);
    const memberIds = (members ?? []).map((m: any) => m.user_id);
    if (memberIds.length === 0) { setBusinesses([]); return; }
    const { data } = await supabase
      .from('businesses')
      .select('*')
      .in('owner_id', memberIds)
      .order('is_verified', { ascending: false })
      .order('name')
      .limit(50);
    setBusinesses((data as Business[]) ?? []);
  } else {
    const { data } = await supabase
      .from('businesses')
      .select('*')
      .order('is_verified', { ascending: false })
      .order('name')
      .limit(50);
    setBusinesses((data as Business[]) ?? []);
  }
}, [setBusinesses, selectedCommunityId]);
```

- [ ] **Step 3: Update loadProjects to respect filter**

Replace the `loadProjects` callback:

```ts
const loadProjects = useCallback(async () => {
  if (selectedCommunityId) {
    const { data: members } = await supabase
      .from('community_members')
      .select('user_id')
      .eq('community_id', selectedCommunityId);
    const memberIds = (members ?? []).map((m: any) => m.user_id);
    if (memberIds.length === 0) { setImpactProjects([]); return; }
    const { data } = await supabase
      .from('impact_projects')
      .select('*')
      .in('creator_id', memberIds)
      .order('status')
      .order('created_at', { ascending: false })
      .limit(30);
    setImpactProjects((data as ImpactProject[]) ?? []);
  } else {
    const { data } = await supabase
      .from('impact_projects')
      .select('*')
      .order('status')
      .order('created_at', { ascending: false })
      .limit(30);
    setImpactProjects((data as ImpactProject[]) ?? []);
  }
}, [setImpactProjects, selectedCommunityId]);
```

- [ ] **Step 4: Add header with switcher**

The Build screen currently starts with `<SafeAreaView>` then immediately the segment row. Add a header above it:

```tsx
<SafeAreaView style={styles.container} edges={['top']}>
  {/* Header */}
  <View style={styles.header}>
    <Text style={styles.headerTitle}>Build</Text>
    <CommunityContextSwitcher communities={joinedCommunities} />
  </View>

  {/* Existing segment row stays unchanged below */}
  <View style={styles.segmentRow}>
    ...
  </View>
  ...
```

Add to `StyleSheet.create`:

```ts
header: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingHorizontal: 16,
  paddingVertical: 10,
  borderBottomWidth: 1,
  borderBottomColor: COLORS.surface,
},
headerTitle: {
  fontSize: 18,
  fontWeight: '800',
  color: COLORS.textPrimary,
},
```

- [ ] **Step 5: Run full test suite**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests --no-coverage
```

Expected: all tests pass. BuildTab tests should still pass since the segment row and card rendering are unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/app/(tabs)/build/index.tsx
git commit -m "feat: Build screen — community context switcher, filter by community membership"
```

---

## Task 6: Full run and finish

- [ ] **Step 1: Run full test suite one final time**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests --no-coverage
```

Expected: all tests pass (54+)

- [ ] **Step 2: Invoke finishing-a-development-branch skill**

Use `superpowers:finishing-a-development-branch` to handle merge/PR options.
