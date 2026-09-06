import type { AccessTier } from '../../lib/features';
import type { NavSlot } from './navTokens';

/**
 * The Roxy 3.0 bar: Feed · Discover · ＋ · Messages · You.
 *
 * Five destinations became four plus an action. The three that left are not
 * deleted, they are dissolved — Grow's ritual content is the streak chip and the
 * Mini Wins sheet on Feed and the Mini Wins card on You; Connect's browse is the
 * Feed's Communities segment and Discover's rails; Build's directory is
 * Discover's WLW-economy rail. `docs/handoff/roxy-3.0/PROMPT.md` carries the
 * full migration map, and `docs/sessions/` records where each screen landed.
 *
 * The ＋ sits at index 2 on purpose. It is the only slot that is an action
 * rather than a destination, and the centre is the one place a thumb reaches on
 * every phone size. `__tests__/components/nav/navSlots3.test.ts` pins both.
 *
 * Route names are directory names under `app/(tabs)/`, unchanged by any label
 * here — a slot whose directory does not exist renders as a silent gap, so the
 * test asserts each one against the filesystem.
 */
export const NAV_SLOTS_3: readonly NavSlot[] = [
  {
    kind: 'route',
    routeName: 'feed',
    label: 'Feed',
    icon: 'play-circle',
    iconInactive: 'play-circle-outline',
  },
  {
    kind: 'route',
    routeName: 'discover',
    label: 'Discover',
    icon: 'compass',
    iconInactive: 'compass-outline',
  },
  { kind: 'action', key: 'create', label: 'Create', icon: 'add' },
  {
    kind: 'route',
    routeName: 'messages',
    label: 'Messages',
    icon: 'chatbubble',
    iconInactive: 'chatbubble-outline',
  },
  {
    kind: 'route',
    routeName: 'you',
    label: 'You',
    icon: 'person',
    iconInactive: 'person-outline',
  },
];

/**
 * Limited launch bar: Archive · Chat · You.
 *
 * Feed still owns the `feed` directory — the screen swaps in the Archive
 * browse when the member is public. Messages owns official chat the same
 * way. Discover and Create stay registered on the navigator so deep links
 * resolve; they are simply not drawn.
 */
export const NAV_SLOTS_PUBLIC: readonly NavSlot[] = [
  {
    kind: 'route',
    routeName: 'feed',
    label: 'Archive',
    icon: 'library',
    iconInactive: 'library-outline',
  },
  {
    kind: 'route',
    routeName: 'messages',
    label: 'Chat',
    icon: 'chatbubble',
    iconInactive: 'chatbubble-outline',
  },
  {
    kind: 'route',
    routeName: 'you',
    label: 'You',
    icon: 'person',
    iconInactive: 'person-outline',
  },
];

export function navSlotsFor(tier: AccessTier): readonly NavSlot[] {
  return tier === 'beta' ? NAV_SLOTS_3 : NAV_SLOTS_PUBLIC;
}
