# UX Coherence Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the disjointed UX seams in roxy-client so all five tabs tell one coherent community-first story (spec: `docs/superpowers/specs/2026-07-18-ux-coherence-revamp-design.md`).

**Architecture:** Navigation/IA surgery on existing Expo Router screens — one extracted lib helper, one new screen (new-DM picker), one file move (communities browser → Connect group), one root shim, plus section-level edits to Grow/Play/Messages/community-detail. No schema changes, no new stores.

**Tech Stack:** Expo Router v3, React Native, TypeScript strict, Zustand (existing stores only), Supabase JS, Jest + @testing-library/react-native.

## Global Constraints

- Branch: `session-19-ux-coherence` → PR to `main`.
- All work under `apps/mobile/` unless a path says otherwise.
- Roxy is a **wingwoman** — never "AI"/"assistant"/"chatbot" in user-facing strings.
- Icon buttons require `accessibilityLabel`.
- No `console.log`; use `logError` from `lib/errorLogger`.
- QA loop before PR: `npx eslint . --ext .ts,.tsx --max-warnings 0` · `npx tsc --noEmit` · `npx jest --ci --passWithNoTests` (313+ passing) — all from `apps/mobile/`.
- Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Extract `openDirectChat` helper + tests

**Files:**
- Create: `apps/mobile/lib/directMessages.ts`
- Modify: `apps/mobile/app/(tabs)/grow/people.tsx` (replace `handleFriendTap` body)
- Test: `apps/mobile/__tests__/directMessages.test.ts`

**Interfaces:**
- Produces: `openDirectChat(userId: string, partnerId: string): Promise<string>` — returns the conversation id (found or created); throws on Supabase error. Caller navigates.

- [ ] **Step 1: Write failing tests** in `__tests__/directMessages.test.ts`:

```ts
import { openDirectChat } from '../lib/directMessages';

jest.mock('../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));
const { supabase } = jest.requireMock('../lib/supabase');

function mockFindResult(result: { data: any; error: any }, insertResult?: { data: any; error: any }) {
  const maybeSingle = jest.fn().mockResolvedValue(result);
  const single = jest.fn().mockResolvedValue(insertResult ?? { data: null, error: null });
  (supabase.from as jest.Mock).mockImplementation(() => ({
    select: jest.fn(() => ({
      contains: jest.fn(() => ({ eq: jest.fn(() => ({ limit: jest.fn(() => ({ maybeSingle })) })) })),
    })),
    insert: jest.fn(() => ({ select: jest.fn(() => ({ single })) })),
  }));
}

describe('openDirectChat', () => {
  it('returns existing conversation id when one exists', async () => {
    mockFindResult({ data: { id: 'conv-1' }, error: null });
    await expect(openDirectChat('me', 'her')).resolves.toBe('conv-1');
  });

  it('creates a conversation when none exists', async () => {
    mockFindResult({ data: null, error: null }, { data: { id: 'conv-new' }, error: null });
    await expect(openDirectChat('me', 'her')).resolves.toBe('conv-new');
  });

  it('throws when the lookup fails', async () => {
    mockFindResult({ data: null, error: new Error('rls denied') });
    await expect(openDirectChat('me', 'her')).rejects.toThrow('rls denied');
  });
});
```

- [ ] **Step 2: Run** `npx jest __tests__/directMessages.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** `lib/directMessages.ts`:

```ts
import { supabase } from './supabase';
import { Analytics } from './analytics';

/** Find or create the 1:1 conversation between two users. Returns the conversation id. */
export async function openDirectChat(userId: string, partnerId: string): Promise<string> {
  const { data, error: searchError } = await supabase
    .from('conversations')
    .select('id')
    .contains('participant_ids', [userId, partnerId])
    .eq('conversation_type', 'direct')
    .limit(1)
    .maybeSingle();
  if (searchError) throw searchError;
  if (data) {
    Analytics.dmOpened(data.id);
    return data.id;
  }
  const { data: created, error } = await supabase
    .from('conversations')
    .insert({ participant_ids: [userId, partnerId], conversation_type: 'direct' })
    .select('id')
    .single();
  if (error) throw error;
  Analytics.dmCreated();
  return created.id;
}
```

(If the test's Analytics import chain pulls native modules, add `jest.mock('../lib/analytics', () => ({ Analytics: { dmOpened: jest.fn(), dmCreated: jest.fn() } }))` to the test.)

- [ ] **Step 4: Run test** → PASS.
- [ ] **Step 5: Refactor `grow/people.tsx`** — `handleFriendTap` becomes:

```ts
const handleFriendTap = async (item: FriendshipRow) => {
  if (!user) return;
  try {
    const convId = await openDirectChat(user.id, item.profile.id);
    router.push(`/chat/${convId}` as any);
  } catch (e: any) {
    logError(e, 'handleFriendTap');
    Alert.alert('Error', e?.message);
  }
};
```

Remove the now-unused direct `supabase`/`Analytics` imports if nothing else in the file uses them.

- [ ] **Step 6: Run** `npx tsc --noEmit` and `npx jest --ci` → clean. **Commit** `feat(messages): extract openDirectChat helper`.

---

### Task 2: Move communities browser to Connect + root shim

**Files:**
- Create: `apps/mobile/app/(tabs)/connect/communities.tsx` (moved content, unchanged logic; fix relative import depth if needed — it stays `../../../` from this depth)
- Create: `apps/mobile/app/communities.tsx` shim: `export { default } from './(tabs)/connect/communities';`
- Delete: `apps/mobile/app/(tabs)/discover/communities.tsx`
- Modify (reference updates, old → new):
  - `app/(tabs)/grow/index.tsx` lines ~571, ~609 → `/(tabs)/connect/communities`
  - `app/(tabs)/discover/index.tsx` lines ~240, ~351, ~362 → `/communities`
  - `app/(tabs)/messages/index.tsx` line ~292 → replaced in Task 3 (skip here)
  - `app/(tabs)/connect/index.tsx` empty-state CTAs (~406, ~477): `router.push('/(tabs)/discover')` → `router.push('/(tabs)/connect/communities')`, button text "Discover Communities →" → "Find your communities →"

**Interfaces:**
- Produces: route `/communities` (cross-tab shim) and `/(tabs)/connect/communities` (in-tab).

- [ ] **Step 1:** `git mv` the file, create the shim, update all references above.
- [ ] **Step 2:** Grep for stragglers: `discover/communities` must return zero hits in `app/`.
- [ ] **Step 3:** `npx tsc --noEmit` → clean. **Commit** `refactor(nav): communities browser lives in Connect, /communities shim for cross-tab links`.

---

### Task 3: Messages new-DM picker

**Files:**
- Create: `apps/mobile/app/(tabs)/messages/new.tssx` → **`new.tsx`** (typo guard: file must be `new.tsx`)
- Modify: `apps/mobile/app/(tabs)/messages/index.tsx` (the `+` button)
- Test: `apps/mobile/__tests__/MessagesNew.test.tsx`

**Interfaces:**
- Consumes: `openDirectChat` from Task 1; `useFriendStore` (`friends`, `fetchAll`), `isOnline`, `sortByPresence`.

- [ ] **Step 1: Write failing render test** `__tests__/MessagesNew.test.tsx`:

```tsx
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import NewMessageScreen from '../app/(tabs)/messages/new';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }) }));
jest.mock('../lib/directMessages', () => ({ openDirectChat: jest.fn().mockResolvedValue('conv-9') }));
jest.mock('../store/authStore', () => ({ useAuthStore: () => ({ user: { id: 'me' } }) }));

const friends = [
  { id: 'f1', profile: { id: 'u1', display_name: 'Sam', username: 'sam', last_seen_at: null } },
];
jest.mock('../store/friendStore', () => ({
  useFriendStore: () => ({ friends, fetchAll: jest.fn().mockResolvedValue(undefined) }),
  isOnline: () => false,
  sortByPresence: (f: any) => f,
}));

it('renders friends and opens a chat on tap', async () => {
  const { getByText } = render(<NewMessageScreen />);
  fireEvent.press(getByText('Sam'));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/chat/conv-9'));
});

it('shows empty state with communities CTA when no friends', () => {
  friends.length = 0;
  const { getByText } = render(<NewMessageScreen />);
  expect(getByText(/Add friends in your communities/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run** → FAIL (screen missing).
- [ ] **Step 3: Implement `app/(tabs)/messages/new.tsx`** — header ("New message", back arrow with `accessibilityLabel="Back"`), FlatList of `sortByPresence(friends)` with gradient initial avatars + online dots (copy the `personGrad` pattern from `grow/people.tsx`), row tap → guard `creating` flag → `openDirectChat` → `router.push('/chat/'+id)`; on error `logError` + `Alert.alert`. Loading spinner while `fetchAll` resolves. Empty state text "Add friends in your communities first 💜" + button "Find your communities →" → `router.push('/communities')`. Full component ~150 lines; follow `people.tsx` styling idioms.
- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Rewire Messages `+`** in `messages/index.tsx`: `onPress={() => router.push('/(tabs)/messages/new' as any)}`, `accessibilityLabel="New message"` (already). Update empty-state copy to "Your people are in your communities — say hi in a feed or add friends from a member list 💜".
- [ ] **Step 6:** tsc + jest → clean. **Commit** `feat(messages): new-DM friend picker; + button starts a chat`.

---

### Task 4: Grow tab coherence

**Files:**
- Modify: `apps/mobile/app/(tabs)/grow/index.tsx`
- Delete: `apps/mobile/app/(tabs)/grow/chats.tsx`

- [ ] **Step 1: Greeting block** — insert between header and Roxy Hero:

```tsx
{/* Greeting */}
<View style={styles.greet}>
  <Text style={styles.greetTitle}>
    {greetingWord()},{'\n'}
    <Text style={styles.greetName}>{firstName} </Text>🌸
  </Text>
  <Text style={styles.greetSub}>
    {buzzingCount > 0
      ? `${buzzingCount} ${buzzingCount === 1 ? 'community is' : 'communities are'} buzzing today`
      : 'Your communities are quiet — start something 💜'}
  </Text>
</View>
```

with helpers in the same file:

```ts
function greetingWord(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
```

`const firstName = profile?.display_name?.split(' ')[0] ?? 'you';`
`const buzzingCount = Object.keys(communityActivity).length;`
Styles: `greet: { paddingHorizontal: 4, paddingTop: 2 }`, `greetTitle: { fontSize: 26, fontWeight: '800', color: colors.textPrimary, lineHeight: 32 }`, `greetName: { color: colors.roxy }`, `greetSub: { color: colors.textMuted, fontSize: 13, fontWeight: '600', marginTop: 4 }`.

- [ ] **Step 2: Remove My Chats** — delete the `{chatTotal > 0 && (...)}` section, the `chatPreviews`/`chatTotal` state + loader effect, `DirectChatPreview` type, `chatGrad` usage there (keep `chatGrad` — My People still uses it), and the `chatPreview*`/`chatViewAll*` styles. Delete `app/(tabs)/grow/chats.tsx`.
- [ ] **Step 3: Header gear** — replace the bell `Ionicons name="notifications-outline"` with `name="settings-outline"`, `accessibilityLabel="Settings"` (route already `/profile/settings`).
- [ ] **Step 4: Sister card** — insert between My People and My Journey:

```tsx
{/* Sister — quiet support space */}
<TouchableOpacity
  style={[styles.section, styles.sisterCard]}
  onPress={() => router.push('/sister-button' as any)}
  activeOpacity={0.8}
>
  <Text style={styles.sisterEmoji}>🕯️</Text>
  <View style={{ flex: 1 }}>
    <Text style={styles.sectionTitle}>Need to talk?</Text>
    <Text style={styles.sisterSub}>Sister is here for the heavy days — private, gentle, judgement-free.</Text>
  </View>
  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
</TouchableOpacity>
```

Styles: `sisterCard: { flexDirection: 'row', alignItems: 'center', gap: 12 }`, `sisterEmoji: { fontSize: 26 }`, `sisterSub: { color: colors.textMuted, fontSize: 12, marginTop: 2, lineHeight: 17 }`.
Create shim `apps/mobile/app/sister-button.tsx`: `export { default } from './(tabs)/connect/sister-button/index';`

- [ ] **Step 5: Copy fixes** — communities empty state: `Find your communities →` wrapped in a TouchableOpacity routing to `/(tabs)/connect/communities`; My People empty: "Add friends from your communities →" (TouchableOpacity → same route).
- [ ] **Step 6:** eslint (no unused vars) + tsc + jest → clean. **Commit** `feat(grow): greeting block, Sister card, chats dedupe, honest header icon`.

---

### Task 5: Play tab link fixes

**Files:**
- Modify: `apps/mobile/app/(tabs)/discover/index.tsx`

- [ ] **Step 1:** Live-now row `onPress` → `router.push(`/(tabs)/connect/community-room-session?room_id=${room.id}` as any)`.
- [ ] **Step 2:** "All →" keeps `/(tabs)/connect` (Rooms live there). Header icon and both "Browse →"/empty-state links → `/communities` (done in Task 2 — verify).
- [ ] **Step 3:** tsc → clean. **Commit** `fix(play): live rooms join the session directly`.

---

### Task 6: Community detail tab order

**Files:**
- Modify: `apps/mobile/app/(tabs)/discover/community/[id].tsx:35`

- [ ] **Step 1:** `const TABS: SubTab[] = ['posts', 'rooms', 'games', 'events'];` (pager + tab strip both derive from `TABS`; verify the label render uses the same array and any hardcoded label map covers all four).
- [ ] **Step 2:** tsc + jest → clean. **Commit** `style(community): tab order Posts·Rooms·Games·Events per handoff`.

---

### Task 7: QA loop, log, PR

- [ ] **Step 1:** From `apps/mobile/`: `npx eslint . --ext .ts,.tsx --max-warnings 0` → 0 problems.
- [ ] **Step 2:** `npx tsc --noEmit` → 0 errors.
- [ ] **Step 3:** `npx jest --ci --passWithNoTests` → all suites pass (313+ plus new).
- [ ] **Step 4:** Append session entry to `.claude/log.md`; note spec + plan paths.
- [ ] **Step 5:** `git push -u origin session-19-ux-coherence`; `gh pr create --base main` with summary from the spec. State "QA loop complete: lint ✓ tsc ✓ jest ✓" in the PR body.
