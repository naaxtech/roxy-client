import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useRoxyFab,
  onListScroll,
  nextTuck,
  enabledKeyFor,
  fabVisible,
  fabOnStage,
  fabTuck,
  fabScrollStep,
  laneClear,
  onListContentSizeChange,
  END_SLACK,
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

/**
 * Wave 3 (lane rule over scroll direction): the Wave 2 build brought her back
 * at the top of every list and on every scroll up, so at rest at 360 x 800 she
 * sat on Discover's "Joined", You's "Apply" and Settings' Ghost mode switch
 * (wave2/ship/shots/local-360/report.json `inLane`). The direction's lane
 * promise wins: at rest nothing readable or tappable sits under her. She is
 * out only where her lane is empty: at the end of a list (lists end FAB_LANE
 * higher) or on a list that fits; everywhere else she rests tucked, and a tap
 * on the tucked O still opens Roxy AI (M3: a collapsed FAB keeps its action).
 */
describe('at rest she sits only where her lane is empty', () => {
  const end = LONG.contentHeight - LONG.viewportHeight;

  it('at the top of a long list, content fills her lane: she rests tucked', () => {
    expect(nextTuck({ tucked: false, anchor: 0 }, sample(0)).tucked).toBe(true);
  });

  it('scrolling back up mid-list does not bring her out over content', () => {
    let s = nextTuck({ tucked: false, anchor: 0 }, sample(900));
    s = nextTuck(s, sample(400));
    expect(s.tucked).toBe(true);
  });

  it('at the end of the list her lane is empty (the list ends FAB_LANE higher): she is out', () => {
    expect(nextTuck({ tucked: true, anchor: 0 }, sample(end)).tucked).toBe(false);
    expect(nextTuck({ tucked: true, anchor: 0 }, sample(end - END_SLACK)).tucked).toBe(false);
  });

  it('a few dp short of the end, content already reaches into her lane: tucked', () => {
    expect(nextTuck({ tucked: false, anchor: 0 }, sample(end - END_SLACK - 4)).tucked).toBe(true);
  });

  it('a list that fits the screen leaves her lane empty: out', () => {
    expect(laneClear({ y: 0, contentHeight: 700, viewportHeight: 700 })).toBe(true);
    expect(laneClear({ y: 0, contentHeight: 500, viewportHeight: 700 })).toBe(true);
  });

  it('the slack only absorbs rounding (a fractional scroll end on web)', () => {
    expect(END_SLACK).toBeGreaterThan(0);
    expect(END_SLACK).toBeLessThanOrEqual(2);
  });
});

describe('onListScroll', () => {
  it('is a plain handler any list can pass straight to onScroll', () => {
    const end = LONG.contentHeight - LONG.viewportHeight;
    onListScroll(scrollEvent(0));
    expect(useRoxyFab.getState().tucked).toBe(true);
    onListScroll(scrollEvent(end));
    expect(useRoxyFab.getState().tucked).toBe(false);
    onListScroll(scrollEvent(end - 200));
    expect(useRoxyFab.getState().tucked).toBe(true);
  });

  it('a new screen starts at rest: tucked until its list reports an empty lane (the tabs layout calls untuck() on every route change)', () => {
    useRoxyFab.setState({ tucked: false });
    useRoxyFab.getState().untuck();
    expect(useRoxyFab.getState().tucked).toBe(true);
  });

  it('before any list reports, she rests tucked (off the Feed)', () => {
    jest.isolateModules(() => {
      const fresh = jest.requireActual('../../lib/roxyFab') as typeof import('../../lib/roxyFab');
      expect(fresh.useRoxyFab.getState().tucked).toBe(true);
      // The UI thread's copy starts in step: the button animates from it.
      expect(fresh.fabTuck.value).toBe(1);
    });
  });
});

describe('onListContentSizeChange (content that grows under her)', () => {
  it('rails that land after she came out at the end push content into her lane: she tucks', () => {
    const end = LONG.contentHeight - LONG.viewportHeight;
    onListScroll(scrollEvent(end));
    expect(useRoxyFab.getState().tucked).toBe(false);
    onListContentSizeChange(390, LONG.contentHeight + 600);
    expect(useRoxyFab.getState().tucked).toBe(true);
  });

  it('a size change never brings her out (a hidden tab\'s list may report it)', () => {
    onListScroll(scrollEvent(400));
    expect(useRoxyFab.getState().tucked).toBe(true);
    onListContentSizeChange(390, 300);
    expect(useRoxyFab.getState().tucked).toBe(true);
  });
});

/**
 * Jank audit #9: the Wave 2 handler wrote the store on nearly every scroll
 * event (the anchor moves with each sample), waking every `useRoxyFab`
 * subscriber 60 times a second. The anchor now lives outside the store; the
 * store changes only when she actually tucks or comes back, and the button
 * animates from a UI-thread shared value (`fabTuck`).
 */
describe('the tuck runs off the store (jank audit #9)', () => {
  it('a long scroll down writes the store once (the flip), not once per event', () => {
    const writes = jest.fn();
    const unsubscribe = useRoxyFab.subscribe(writes);
    const end = LONG.contentHeight - LONG.viewportHeight;
    onListScroll(scrollEvent(end));
    for (let y = end - 20; y >= 0; y -= 20) onListScroll(scrollEvent(y));
    unsubscribe();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(useRoxyFab.getState().tucked).toBe(true);
  });

  it('every flip lands in the shared value the button animates from', () => {
    const end = LONG.contentHeight - LONG.viewportHeight;
    onListScroll(scrollEvent(end));
    expect(fabTuck.value).toBe(0);
    onListScroll(scrollEvent(200));
    expect(fabTuck.value).toBe(1);
    onListScroll(scrollEvent(end));
    expect(fabTuck.value).toBe(0);
    useRoxyFab.setState({ tucked: true });
    expect(fabTuck.value).toBe(1);
  });

  it('the UI-thread step (a worklet) answers like the JS handler', () => {
    const end = LONG.contentHeight - LONG.viewportHeight;
    const step = (y: number) => fabScrollStep(y, LONG.contentHeight, LONG.viewportHeight);
    expect(step(0)).toBe(true);
    expect(step(end)).toBe(false);
    expect(step(end - 120)).toBe(true);
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

  // Wave 2 untucked her on the switch so she "returned whole"; on Settings
  // that put her over the Ghost mode switch. She returns in the rest state the
  // list on screen calls for.
  it('switching her off and on keeps the lane verdict of the list on screen', async () => {
    useRoxyFab.setState({ tucked: true });
    await useRoxyFab.getState().setEnabled('amara', false);
    await useRoxyFab.getState().setEnabled('amara', true);
    expect(useRoxyFab.getState().tucked).toBe(true);
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
