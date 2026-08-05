import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import { FeedPager } from '../../components/feed/FeedPager';
import type { FeedPagerCell } from '../../components/feed/FeedPager';

/** Records every prop set the pager hands the list, so the config is assertable. */
jest.mock('@shopify/flash-list', () => {
  const ReactLocal = require('react');
  const { View: RNView } = require('react-native');
  const captured: Record<string, unknown>[] = [];
  const FlashList = (props: Record<string, unknown>): React.ReactElement => {
    captured.push(props);
    return ReactLocal.createElement(RNView, { testID: 'flash-list' });
  };
  return { FlashList, __captured: captured };
});

interface TestItem {
  id: string;
  kind: string;
}

const ITEMS: TestItem[] = [
  { id: 'a', kind: 'video' },
  { id: 'b', kind: 'photo' },
  { id: 'c', kind: 'poll' },
];

const PAGE_H = 800;
const PAGE_W = 400;

interface CapturedListProps {
  data: TestItem[];
  keyExtractor: (item: TestItem, index: number) => string;
  extraData: unknown;
  estimatedItemSize: number;
  overrideItemLayout: (layout: { span?: number; size?: number }, item: TestItem) => void;
  getItemType: (item: TestItem, index: number) => string | number | undefined;
  drawDistance: number;
  initialScrollIndex: number;
  snapToInterval: number;
  snapToAlignment: string;
  decelerationRate: string;
  disableIntervalMomentum: boolean;
  showsVerticalScrollIndicator: boolean;
  pagingEnabled?: boolean;
  getItemLayout?: unknown;
  onScroll: (event: { nativeEvent: { contentOffset: { y: number } } }) => void;
  scrollEventThrottle: number;
  onEndReached?: () => void;
  onEndReachedThreshold: number;
  viewabilityConfig: {
    viewAreaCoveragePercentThreshold?: number;
    itemVisiblePercentThreshold?: number;
  };
  onViewableItemsChanged: (info: { viewableItems: { index: number | null }[] }) => void;
  renderItem: (info: { item: TestItem; index: number }) => React.ReactElement | null;
}

function captured(): CapturedListProps[] {
  const { __captured } = jest.requireMock('@shopify/flash-list') as {
    __captured: Record<string, unknown>[];
  };
  return __captured as unknown as CapturedListProps[];
}

function latest(): CapturedListProps {
  const all = captured();
  if (!all.length) throw new Error('the pager never rendered a list');
  return all[all.length - 1];
}

/** Every cell info object the pager has handed the caller's renderer. */
const cells: FeedPagerCell<TestItem>[] = [];

function recordCell(cell: FeedPagerCell<TestItem>): React.ReactElement {
  cells.push(cell);
  return <View testID={`cell-${cell.item.id}`} />;
}

interface PagerOptions {
  items?: TestItem[];
  placeholder?: React.ReactNode;
  initialIndex?: number;
  extraData?: unknown;
  getItemType?: (item: TestItem, index: number) => string | number;
  onActiveItemChange?: (itemId: string, index: number) => void;
  onEndReached?: () => void;
}

function pager(o: PagerOptions = {}): React.ReactElement {
  return (
    <FeedPager<TestItem>
      testID="pager"
      items={o.items ?? ITEMS}
      keyExtractor={(item) => item.id}
      getItemType={o.getItemType ?? ((item) => item.kind)}
      renderCell={recordCell}
      extraData={o.extraData}
      initialIndex={o.initialIndex}
      placeholder={o.placeholder}
      onActiveItemChange={o.onActiveItemChange}
      onEndReached={o.onEndReached}
    />
  );
}

type Rendered = ReturnType<typeof render>;

function measure(view: Rendered, height = PAGE_H, width = PAGE_W): void {
  fireEvent(view.getByTestId('pager'), 'layout', {
    nativeEvent: { layout: { height, width } },
  });
}

/** Mount and give the pager a measured viewport, which gates the list. */
function mountPager(o: PagerOptions = {}): Rendered {
  const view = render(pager(o));
  measure(view);
  return view;
}

/** The id the pager currently reports as active, read off a rendered cell. */
function activeIdOnCell(index = 0): string | null {
  const cell = latest().renderItem({ item: ITEMS[index], index });
  const info = cells[cells.length - 1];
  expect(cell).not.toBeNull();
  return info.activeItemId;
}

beforeEach(() => {
  captured().length = 0;
  cells.length = 0;
});

describe('FeedPager viewport gate', () => {
  it('holds the list back until the viewport has been measured', () => {
    const view = render(pager());

    expect(captured()).toEqual([]);
    expect(view.queryByTestId('flash-list')).toBeNull();

    measure(view);

    expect(view.queryByTestId('flash-list')).not.toBeNull();
    expect(latest().snapToInterval).toBe(PAGE_H);
  });

  it('sizes the page from the measurement rather than guessing', () => {
    mountPager();

    const props = latest();
    expect(props.estimatedItemSize).toBe(PAGE_H);
    // estimatedItemSize and overrideItemLayout are not interchangeable, and
    // getItemLayout does not exist in flash-list v1 — both of the supported
    // knobs have to be set.
    const layout: { span?: number; size?: number } = {};
    props.overrideItemLayout(layout, ITEMS[0]);
    expect(layout.size).toBe(PAGE_H);
    expect(props.getItemLayout).toBeUndefined();
  });

  it('draws two pages ahead so a swipe never lands on an undrawn cell', () => {
    mountPager();

    expect(latest().drawDistance).toBe(PAGE_H * 2);
  });

  it('ignores a re-layout that reports the same size', () => {
    const view = mountPager();
    const before = captured().length;

    measure(view, PAGE_H + 0.4, PAGE_W + 0.4);

    expect(captured().length).toBe(before);
  });
});

describe('FeedPager snap paging', () => {
  it('never sets pagingEnabled, which is broken on Android at this version', () => {
    mountPager();

    const props = latest();
    expect(props.pagingEnabled).toBeUndefined();
    expect(props.snapToInterval).toBe(PAGE_H);
    expect(props.snapToAlignment).toBe('start');
    expect(props.decelerationRate).toBe('fast');
    expect(props.disableIntervalMomentum).toBe(true);
    expect(props.showsVerticalScrollIndicator).toBe(false);
  });
});

describe('FeedPager viewability', () => {
  it('measures viewability against the viewport, not the item', () => {
    mountPager();

    const props = latest();
    expect(props.viewabilityConfig.viewAreaCoveragePercentThreshold).toBe(60);
    // flash-list 1.6.4 throws multipleViewabilityThresholdTypesNotSupported when
    // both are set, so the item-denominated key must be absent, not merely joined.
    expect(props.viewabilityConfig.itemVisiblePercentThreshold).toBeUndefined();
  });

  it('keeps viewabilityConfig and onViewableItemsChanged stable across re-renders', () => {
    mountPager();
    const first = latest();

    act(() => {
      first.onViewableItemsChanged({ viewableItems: [{ index: 1 }] });
    });

    const after = latest();
    expect(captured().length).toBeGreaterThan(1);
    expect(after.viewabilityConfig).toBe(first.viewabilityConfig);
    expect(after.onViewableItemsChanged).toBe(first.onViewableItemsChanged);
  });

  it('stays stable when the caller re-renders with new props', () => {
    const view = mountPager();
    const first = latest();

    view.rerender(pager({ extraData: { tick: 1 } }));

    expect(latest().viewabilityConfig).toBe(first.viewabilityConfig);
    expect(latest().onViewableItemsChanged).toBe(first.onViewableItemsChanged);
  });

  it('moves the active item when the viewport reports a new first item', () => {
    mountPager();

    act(() => {
      latest().onViewableItemsChanged({ viewableItems: [{ index: 2 }] });
    });

    expect(activeIdOnCell(2)).toBe('c');
  });

  it('ignores a viewability report with no index', () => {
    mountPager();

    act(() => {
      latest().onViewableItemsChanged({ viewableItems: [{ index: null }] });
    });

    expect(activeIdOnCell(0)).toBe('a');
  });
});

describe('FeedPager scroll fallback', () => {
  /**
   * flash-list defaults `minimumViewTime` to 250ms whether or not you ask for
   * one, so a fast flick fires viewability with an EMPTY array and the pager
   * would otherwise stay on the cell the viewer already swept past. The scroll
   * offset is the backstop, and it cannot be replaced by tuning
   * `minimumViewTime`.
   */
  it('derives the active item from the scroll offset when viewability reports nothing', () => {
    mountPager();

    act(() => {
      latest().onViewableItemsChanged({ viewableItems: [] });
    });
    expect(activeIdOnCell(0)).toBe('a');

    act(() => {
      latest().onScroll({ nativeEvent: { contentOffset: { y: PAGE_H * 2 } } });
    });

    expect(activeIdOnCell(2)).toBe('c');
  });

  it('clamps a scroll past the end of the list to the last item', () => {
    mountPager();

    act(() => {
      latest().onScroll({ nativeEvent: { contentOffset: { y: PAGE_H * 40 } } });
    });

    expect(activeIdOnCell(2)).toBe('c');
  });

  it('does not re-render for scroll events that stay on the same page', () => {
    mountPager();
    const before = captured().length;

    act(() => {
      latest().onScroll({ nativeEvent: { contentOffset: { y: 4 } } });
      latest().onScroll({ nativeEvent: { contentOffset: { y: 9 } } });
      latest().onScroll({ nativeEvent: { contentOffset: { y: 13 } } });
    });

    expect(captured().length).toBe(before);
  });
});

describe('FeedPager recycling pools', () => {
  it('passes the caller\'s getItemType through instead of collapsing to a constant', () => {
    mountPager();

    const props = latest();
    const video = props.getItemType(ITEMS[0], 0);
    const photo = props.getItemType(ITEMS[1], 1);
    const poll = props.getItemType(ITEMS[2], 2);

    expect(video).toBe('video');
    expect(photo).toBe('photo');
    expect(poll).toBe('poll');
    expect(new Set([video, photo, poll]).size).toBe(3);
  });

  it('lets the caller key pools on whatever it likes without the pager knowing', () => {
    mountPager({ getItemType: (item) => `roxy:${item.kind}` });

    expect(latest().getItemType(ITEMS[1], 1)).toBe('roxy:photo');
  });
});

describe('FeedPager active item', () => {
  it('identifies the active item by key, not by its slot', () => {
    mountPager();

    act(() => {
      latest().onViewableItemsChanged({ viewableItems: [{ index: 1 }] });
    });

    const props = latest();
    props.renderItem({ item: ITEMS[0], index: 0 });
    const inactive = cells[cells.length - 1];
    props.renderItem({ item: ITEMS[1], index: 1 });
    const active = cells[cells.length - 1];

    // Both cells are told the same id. Deciding "am I the one" is the cell's
    // job and it is an identity check, never index === activeIndex.
    expect(inactive.activeItemId).toBe('b');
    expect(active.activeItemId).toBe('b');
    expect(inactive.item.id).toBe('a');
    expect(active.item.id).toBe('b');
  });

  it('follows the item when the array shifts under a fixed index', () => {
    const view = mountPager();
    act(() => {
      latest().onViewableItemsChanged({ viewableItems: [{ index: 1 }] });
    });
    expect(activeIdOnCell(1)).toBe('b');

    // A page spliced onto the front is exactly what ReelsFeed.load does when a
    // viewer opens one specific post.
    view.rerender(pager({ items: [{ id: 'z', kind: 'video' }, ...ITEMS] }));

    latest().renderItem({ item: ITEMS[0], index: 1 });
    expect(cells[cells.length - 1].activeItemId).toBe('a');
  });

  it('reports no active item when the index has nothing in it', () => {
    mountPager({ items: [] });

    latest().renderItem({ item: ITEMS[0], index: 0 });
    expect(cells[cells.length - 1].activeItemId).toBeNull();
  });

  it('still gives the cell a positional index for decoder-window distance', () => {
    mountPager();
    act(() => {
      latest().onViewableItemsChanged({ viewableItems: [{ index: 2 }] });
    });

    latest().renderItem({ item: ITEMS[0], index: 0 });
    const info = cells[cells.length - 1];

    expect(info.index).toBe(0);
    expect(info.activeIndex).toBe(2);
  });

  it('hands the cell the measured page size', () => {
    mountPager();

    latest().renderItem({ item: ITEMS[0], index: 0 });
    const info = cells[cells.length - 1];

    expect(info.height).toBe(PAGE_H);
    expect(info.width).toBe(PAGE_W);
  });
});

describe('FeedPager extraData', () => {
  it('republishes extraData when the active item changes so recycled cells re-render', () => {
    mountPager({ extraData: { muted: true } });
    const before = latest().extraData;

    act(() => {
      latest().onViewableItemsChanged({ viewableItems: [{ index: 1 }] });
    });

    expect(latest().extraData).not.toBe(before);
  });

  it('carries the caller\'s own extraData through unchanged', () => {
    const callerData = { muted: true };
    mountPager({ extraData: callerData });

    expect(latest().extraData).toEqual(
      expect.objectContaining({ caller: callerData }),
    );
  });

  it('does not republish extraData when nothing has changed', () => {
    const view = mountPager({ extraData: ITEMS });
    const before = latest().extraData;

    view.rerender(pager({ extraData: ITEMS }));

    expect(latest().extraData).toBe(before);
  });
});

describe('FeedPager initial position', () => {
  it('opens positioned at the index the caller asked for', () => {
    mountPager({ initialIndex: 2 });

    expect(latest().initialScrollIndex).toBe(2);
    expect(activeIdOnCell(2)).toBe('c');
  });

  it('re-seeds the active slot when the list is rebuilt behind a placeholder', () => {
    const view = mountPager();
    act(() => {
      latest().onScroll({ nativeEvent: { contentOffset: { y: PAGE_H * 2 } } });
    });
    expect(activeIdOnCell(2)).toBe('c');

    // What a reload looks like from here: placeholder up while the caller
    // refetches, then a fresh list that scrolls back to initialScrollIndex. The
    // active slot has to follow the list, or the pager keeps playing an item
    // that is no longer under the viewport.
    view.rerender(pager({ placeholder: <Text>Loading</Text> }));
    view.rerender(pager({}));

    expect(latest().initialScrollIndex).toBe(0);
    expect(activeIdOnCell(0)).toBe('a');
  });

  it('does not re-seed when the caller merely appends a page', () => {
    const view = mountPager();
    act(() => {
      latest().onScroll({ nativeEvent: { contentOffset: { y: PAGE_H * 2 } } });
    });

    view.rerender(pager({ items: [...ITEMS, { id: 'd', kind: 'video' }] }));

    expect(activeIdOnCell(2)).toBe('c');
  });

  it('adopts a new initial index without rendering the old one first', () => {
    const view = mountPager();
    expect(activeIdOnCell(0)).toBe('a');
    const rendersBefore = captured().length;

    view.rerender(pager({ initialIndex: 2 }));

    // Every list render published after the reposition is already on the new
    // item: a wrong-item render would tell the wrong cell to start playing.
    for (const props of captured().slice(rendersBefore)) {
      props.renderItem({ item: ITEMS[2], index: 2 });
      expect(cells[cells.length - 1].activeItemId).toBe('c');
    }
    expect(captured().length).toBeGreaterThan(rendersBefore);
  });
});

describe('FeedPager placeholder', () => {
  it('renders the caller\'s placeholder instead of the list', () => {
    const view = mountPager({ placeholder: <Text>Loading</Text> });

    expect(view.getByText('Loading')).toBeTruthy();
    expect(view.queryByTestId('flash-list')).toBeNull();
    expect(captured()).toEqual([]);
  });

  it('measures the frame behind the placeholder so the list is ready the moment it clears', () => {
    const view = render(pager({ placeholder: <Text>Loading</Text> }));
    measure(view);

    // No second layout pass — the frame was measured while the placeholder held it.
    view.rerender(pager({ placeholder: null }));

    expect(view.queryByTestId('flash-list')).not.toBeNull();
    expect(latest().snapToInterval).toBe(PAGE_H);
  });
});

describe('FeedPager active item reporting', () => {
  it('reports the first item once the pager has data', () => {
    const onActiveItemChange = jest.fn();
    mountPager({ onActiveItemChange });

    expect(onActiveItemChange).toHaveBeenCalledTimes(1);
    expect(onActiveItemChange).toHaveBeenCalledWith('a', 0);
  });

  it('reports each newly active item exactly once', () => {
    const onActiveItemChange = jest.fn();
    const view = mountPager({ onActiveItemChange });
    onActiveItemChange.mockClear();

    act(() => {
      latest().onViewableItemsChanged({ viewableItems: [{ index: 1 }] });
    });
    view.rerender(pager({ onActiveItemChange, extraData: { tick: 1 } }));

    expect(onActiveItemChange).toHaveBeenCalledTimes(1);
    expect(onActiveItemChange).toHaveBeenCalledWith('b', 1);
  });

  it('reports nothing while the pager has no items', () => {
    const onActiveItemChange = jest.fn();
    mountPager({ items: [], onActiveItemChange });

    expect(onActiveItemChange).not.toHaveBeenCalled();
  });
});

describe('FeedPager pagination', () => {
  it('asks the caller for another page near the end', () => {
    const onEndReached = jest.fn();
    mountPager({ onEndReached });

    const props = latest();
    expect(props.onEndReachedThreshold).toBe(0.6);
    props.onEndReached?.();
    expect(onEndReached).toHaveBeenCalledTimes(1);
  });
});
