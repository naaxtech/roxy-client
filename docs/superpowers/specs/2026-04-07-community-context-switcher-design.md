# Community Context Switcher — Design Spec
**Date:** 2026-04-07
**Branch:** session-15-community-filter (or next available)
**Status:** Approved, ready for implementation

---

## Problem

As users join more communities, content across Connect, Discover, and Build becomes an undifferentiated flood. There is no way to focus on one community's world at a time. A chip row approach fails at scale (15+ communities). A multi-select filter adds complexity without meaningful user value.

---

## Solution

A **single-community context switcher** placed in the header of Connect, Discover, and Build — beside each screen's title. Selecting a community scopes all content in that tab to that community. "All Communities" (default) shows the blended view as today.

The mental model is a focus lens, not a filter builder:
- **All Communities** → your full blended home feed
- **One community** → you're inside that community's space

Multi-select is explicitly out of scope. The useful cases are "everything" or "one specific place."

---

## Affected Tabs

| Tab | What gets scoped |
|---|---|
| **Connect → Feed** | Posts from selected community only |
| **Connect → Events** | Events hosted by selected community |
| **Connect → Rooms** | Rooms belonging to selected community |
| **Discover → Events** | Events filtered by selected community |
| **Discover → Communities** | No filter — this IS the communities browser |
| **Build → Businesses** | Businesses from selected community members |
| **Build → Impact Projects** | Impact projects from selected community |

**Not affected:**
- Grow tab — personal space, community-agnostic
- Profile tab — personal space
- Speed Dating — intentionally cross-community
- Games — intentionally cross-community
- Roxy Chat — personal AI, not community-scoped

---

## UI Placement — Option C

Switcher sits in the **screen header, right side**, beside the screen title:

```
┌──────────────────────────────────────┐
│  Connect   ║ 🥾 Hikers ▾ ║           │
├──────────────────────────────────────┤
│  Feed       Events       Rooms       │
│──────────────────────────────────────│
│  [content scoped to community]       │
└──────────────────────────────────────┘
```

When tapped, a bottom sheet slides up with a searchable list:

```
┌──────────────────────────────────────┐
│  ▬▬▬                                 │
│                                      │
│  View a Community                    │
│  ┌────────────────────────────────┐  │
│  │  🔍  Search your communities   │  │
│  └────────────────────────────────┘  │
│                                      │
│  ●  All Communities                  │
│  ○  🥾  Lesbian Hikers Madrid        │
│  ○  🎮  WLW Gamers                   │
│  ○  🌈  Queer Book Club              │
│  ○  💜  Trans Support Space          │
│  ○  📚  WLW Sci-Fi Readers           │
│         · · ·                        │
│                                      │
└──────────────────────────────────────┘
```

Tapping a row selects it immediately and dismisses the sheet. No "Apply" button needed for single-select.

The switcher button label:
- **All** when no community selected
- **Community name (truncated ~12 chars) + ▾** when one is selected

---

## Architecture

### New store: `communityFilterStore`

```ts
// apps/mobile/store/communityFilterStore.ts
interface CommunityFilterState {
  selectedCommunityId: string | null;  // null = All Communities
  setSelectedCommunity: (id: string | null) => void;
}
```

Zustand, no persistence — resets to null on app restart. Community context is a session-level choice, not a saved preference.

### New component: `<CommunityContextSwitcher>`

```ts
// apps/mobile/components/CommunityContextSwitcher.tsx
props: {
  communities: { id: string; name: string; emoji?: string }[];
}
```

- Reads `selectedCommunityId` from `communityFilterStore`
- Renders the header button (label + chevron)
- On press: opens bottom sheet with search + list
- Selecting a row: calls `setSelectedCommunity`, closes sheet
- Purely presentational except for store reads/writes

### New component: `<CommunityPickerSheet>`

Bottom sheet with:
- Search input (filters the list client-side, no network call)
- FlatList of user's communities, "All Communities" pinned at top
- Single-select radio-style rows
- Dismisses on selection

### Integration pattern per screen

Each affected screen:
1. Imports `useCommunityFilterStore`
2. Reads `selectedCommunityId`
3. Passes it as a query param: `WHERE community_id = $selectedCommunityId` when non-null
4. Re-fetches when `selectedCommunityId` changes (include in useEffect deps)
5. Renders `<CommunityContextSwitcher>` in its header

The communities list passed to the switcher comes from existing data already fetched on those screens (community_members join). No new network cost.

---

## Data Flow

```
User taps switcher
  → CommunityPickerSheet opens
  → User selects "WLW Gamers"
  → communityFilterStore.setSelectedCommunity("abc-123")
  → Sheet closes
  → Header button updates to "WLW Gamers ▾"
  → All three Connect sub-tabs re-query with WHERE community_id = "abc-123"
  → Discover Events re-queries
  → Build screens re-query
```

---

## Edge Cases

- **User not in any community:** Switcher shows only "All Communities". No empty state needed — the content screens already handle empty states.
- **Selected community deleted/left:** Store resets to null on next query failure. No crash.
- **Long community name:** Truncate at ~12 characters with ellipsis in the button label. Full name visible in the sheet.
- **Search with no results:** "No communities match" empty state in the sheet.

---

## Out of Scope

- Multi-select
- Persisting filter selection across app restarts
- Filtering Grow or Profile tabs
- Filtering Speed Dating or Games
- Per-tab independent filter states (one global selection)
