import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useRoxyFab,
  onListScroll,
  nextTuck,
  enabledKeyFor,
  fabVisible,
  fabOnStage,
  TUCK_THRESHOLD,
  EDGE_ZONE,
} from '../../lib/roxyFab';
import { FAB_LANE, FAB_SIZE, FAB_TUCKED, FAB_MARGIN, FAB_TUCKED_HIT } from '../../components/nav/navTokens';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';

/**
 * The Roxy AI button's lane, tuck and on/off switch (design direction v2 ›
 * The Roxy AI button). The lane is a promise to every screen: at rest nothing
 * readable or tappable sits in the bottom end 88 × 88; while a list scrolls
 * down she tucks to 40 dp; members can switch her off, and that choice is
 * theirs alone — kept per member, so a second account on the same phone does
 * not inherit it.
 */

const LONG = { contentHeight: 3000, viewportHeight: 700 };
const sample = (y: number) => ({ y, ...LONG });

function scrollEvent(y: number, contentHeight = LONG.contentHeight, viewportHeight = LONG.viewportHeight) {
  return {
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize: { width: 390, height: contentHeight },
      layoutMeasurement: { width: 390, height: viewportHeight },
    },
  } as never;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  useRoxyFab.setState({ enabled: true, loadedFor: null, tucked: false, anchor: 0 });
});

describe('the lane tokens', () => {
  it('reserves 88 × 88 dp and seats a 56 dp button 16 dp from the edge and the bar', () => {
    expect(FAB_LANE).toBe(88);
    expect(FAB_SIZE).toBe(56);
    expect(FAB_TUCKED).toBe(40);
    expect(FAB_MARGIN).toBe(16);
    // The button plus its margin on both sides is exactly the lane.
    expect(FAB_SIZE + 2 * FAB_MARGIN).toBe(FAB_LANE);
  });

  it('keeps a 48 dp hit target while tucked (48 × 28)', () => {
    expect(FAB_TUCKED_HIT.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    expect(FAB_TUCKED_HIT.width).toBe(28);
  });
});

describe('nextTuck (M3 extended-FAB scroll behaviour)', () => {
  it('tucks once the list has travelled down past the threshold', () => {
    let s = { tucked: false, anchor: 100 };
    s = nextTuck(s, sample(100 + TUCK_THRESHOLD - 1));
    expect(s.tucked).toBe(false);
    s = nextTuck(s, sample(100 + TUCK_THRESHOLD + 1));
    expect(s.tucked).toBe(true);
  });

  it('ignores jitter: small moves either way change nothing', () => {
    let s = { tucked: true, anchor: 500 };
    s = nextTuck(s, sample(498));
    s = nextTuck(s, sample(503));
    s = nextTuck(s, sample(495));
    expect(s.tucked).toBe(true);
  });

  it('comes back on a scroll up measured from the lowest point, not the first', () => {
    let s = { tucked: false, anchor: 100 };
    s = nextTuck(s, sample(400)); // down: tucked, anchor follows to 400
    s = nextTuck(s, sample(900)); // further down: anchor 900
    expect(s.tucked).toBe(true);
    s = nextTuck(s, sample(900 - TUCK_THRESHOLD + 1));
    expect(s.tucked).toBe(true);
    s = nextTuck(s, sample(900 - TUCK_THRESHOLD - 1));
    expect(s.tucked).toBe(false);
  });

  it('comes back at the top of the list', () => {
    const s = nextTuck({ tucked: true, anchor: 300 }, sample(EDGE_ZONE - 1));
    expect(s.tucked).toBe(false);
  });

  it('comes back at the end of the list, where her lane is empty', () => {
    const end = LONG.contentHeight - LONG.viewportHeight;
    const s = nextTuck({ tucked: true, anchor: end - 200 }, sample(end - 2));
    expect(s.tucked).toBe(false);
  });

  it('never tucks on a list too short to scroll', () => {
    const s = nextTuck({ tucked: false, anchor: 0 }, { y: 60, contentHeight: 700, viewportHeight: 700 });
    expect(s.tucked).toBe(false);
  });
});

describe('onListScroll', () => {
  it('is a plain handler any list can pass straight to onScroll', () => {
    onListScroll(scrollEvent(0));
    onListScroll(scrollEvent(200));
    expect(useRoxyFab.getState().tucked).toBe(true);
    onListScroll(scrollEvent(120));
    expect(useRoxyFab.getState().tucked).toBe(false);
  });

  it('untuck() brings her back at once (a tap, a route change)', () => {
    useRoxyFab.setState({ tucked: true, anchor: 800 });
    useRoxyFab.getState().untuck();
    expect(useRoxyFab.getState().tucked).toBe(false);
  });
});

describe('Roxy AI on/off, kept per member on this phone', () => {
  it('is on for a member who never chose', async () => {
    await useRoxyFab.getState().load('amara');
    expect(useRoxyFab.getState().enabled).toBe(true);
    expect(useRoxyFab.getState().loadedFor).toBe('amara');
  });

  it('switching her off is remembered for that member', async () => {
    await useRoxyFab.getState().load('amara');
    await useRoxyFab.getState().setEnabled('amara', false);
    expect(useRoxyFab.getState().enabled).toBe(false);
    expect(await AsyncStorage.getItem(enabledKeyFor('amara'))).toBe('off');

    useRoxyFab.setState({ enabled: true, loadedFor: null });
    await useRoxyFab.getState().load('amara');
    expect(useRoxyFab.getState().enabled).toBe(false);
  });

  it("another member on the same phone does not inherit her choice", async () => {
    await useRoxyFab.getState().setEnabled('amara', false);
    await useRoxyFab.getState().load('mariam');
    expect(useRoxyFab.getState().enabled).toBe(true);
    expect(useRoxyFab.getState().loadedFor).toBe('mariam');
  });

  it('turning her back on (Undo) is remembered too', async () => {
    await useRoxyFab.getState().setEnabled('amara', false);
    await useRoxyFab.getState().setEnabled('amara', true);
    expect(await AsyncStorage.getItem(enabledKeyFor('amara'))).toBe('on');
    expect(useRoxyFab.getState().enabled).toBe(true);
  });

  it('switching her off also untucks, so she returns whole when switched back on', async () => {
    useRoxyFab.setState({ tucked: true });
    await useRoxyFab.getState().setEnabled('amara', false);
    expect(useRoxyFab.getState().tucked).toBe(false);
  });

  it('a corrupt stored value reads as on', async () => {
    await AsyncStorage.setItem(enabledKeyFor('amara'), 'maybe');
    await useRoxyFab.getState().load('amara');
    expect(useRoxyFab.getState().enabled).toBe(true);
  });

  it('the screen changes before storage answers (optimistic)', () => {
    void useRoxyFab.getState().setEnabled('amara', false);
    expect(useRoxyFab.getState().enabled).toBe(false);
  });
});

describe('fabVisible / fabOnStage (the tabs layout decides where she shows)', () => {
  const SUPPRESSED = ['roxy-chat', '/messages', '/chat/'];
  const base = { pathname: '/discover', allowed: true, enabled: true, loadedFor: 'amara', userId: 'amara', suppressedOn: SUPPRESSED };

  it('shows on Feed, Discover and You when she is on', () => {
    for (const pathname of ['/feed', '/discover', '/you']) {
      expect(fabVisible({ ...base, pathname })).toBe(true);
    }
  });

  it('leaves at once when switched off', () => {
    expect(fabVisible({ ...base, enabled: false })).toBe(false);
  });

  it('waits for her own choice to load, so an "off" never flashes on', () => {
    expect(fabVisible({ ...base, loadedFor: null })).toBe(false);
    expect(fabVisible({ ...base, loadedFor: 'someone-else' })).toBe(false);
  });

  it('stays off where FAB_SUPPRESSED_ON says (her chat, Messages, chats)', () => {
    for (const pathname of ['/roxy-chat', '/messages', '/messages/requests', '/chat/abc']) {
      expect(fabVisible({ ...base, pathname })).toBe(false);
    }
  });

  it('stays off for a tier without the companion', () => {
    expect(fabVisible({ ...base, allowed: false })).toBe(false);
  });

  it('knows the Feed stage', () => {
    expect(fabOnStage('/feed')).toBe(true);
    expect(fabOnStage('/feed/following')).toBe(true);
    expect(fabOnStage('/discover')).toBe(false);
    expect(fabOnStage('/feedback')).toBe(false);
  });
});
