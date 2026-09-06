import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import type {
  LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ViewToken,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { activeIndexFromScroll } from '../../lib/reels';

/** Everything the pager knows about one cell when it asks the caller to draw it. */
export interface FeedPagerCell<TItem> {
  item: TItem;
  /**
   * This cell's slot in the list. Positional ONLY — it is the right input for
   * distance maths such as the video decoder window, and the wrong input for
   * "should this cell be doing something", because a slot number carries
   * neither identity nor type.
   */
  index: number;
  /** The slot the pager is on. Same caveat, same single use. */
  activeIndex: number;
  /**
   * The key of the item the pager is on, or null when the slot is empty.
   *
   * This is what a cell keys behaviour off. `index === activeIndex` is stale the
   * moment the array shifts under it, and it says nothing about what kind of
   * cell this is — an index match would cheerfully tell a poll or a game cell to
   * start playing.
   */
  activeItemId: string | null;
  /** Measured page width, falling back to the window before the first layout. */
  width: number;
  /** Measured page height. Non-zero: the list is not built before it is measured. */
  height: number;
}

export interface FeedPagerProps<TItem> {
  items: TItem[];
  /** The item's identity. Also what the pager reports as the active item. */
  keyExtractor: (item: TItem, index: number) => string;
  /**
   * One recycling pool per kind of cell. REQUIRED, and never a constant — see
   * the note on heterogeneous cells above.
   */
  getItemType: (item: TItem, index: number) => string | number;
  /** Draws one cell. The pager has no opinion about what comes back. */
  renderCell: (cell: FeedPagerCell<TItem>) => ReactElement | null;
  /**
   * Anything outside `items` that a recycled cell renders from — likes, mute,
   * reduced motion. The pager merges its own active-item state in, so a cell
   * re-renders when the pager moves without the caller having to know that.
   */
  extraData?: unknown;
  /**
   * Open on this slot instead of the top. Drives both the list's initial scroll
   * and the initial active item, so a pager opened at a tapped grid item never
   * renders a frame with the wrong item active.
   */
  initialIndex?: number;
  /**
   * Rendered in the pager's frame instead of the list whenever it is not null:
   * the caller's loading, error and empty states. The frame is measured behind
   * it, so the list is ready to build the instant the placeholder clears.
   */
  placeholder?: ReactNode;
  /**
   * Fires when the active item CHANGES, never on a bare re-render, and never
   * for an empty pager. Carries the key first, for the same reason
   * `activeItemId` exists at all.
   */
  onActiveItemChange?: (itemId: string, index: number) => void;
  onEndReached?: () => void;
  testID?: string;
}

/**
 * One video plays at a time, and the threshold is measured against the
 * VIEWPORT, not the item.
 *
 * Both implementations pick their denominator off which key you set —
 * `viewAreaMode ? pixelsVisible / listMainSize : pixelsVisible / itemSize` in
 * flash-list, `viewAreaMode ? pixels / viewportHeight : pixels / itemLength` in
 * React Native. Visible pixels can never exceed the viewport, so under
 * `itemVisiblePercentThreshold` the best score a cell taller than the viewport
 * can ever reach is `viewport / itemSize`: it stops being able to hit 100% the
 * moment it overflows, and it drops under a threshold T once it grows past
 * `viewport ÷ T`. Nothing is then viewable and no video ever plays. Under
 * `viewAreaCoveragePercentThreshold` a cell filling the viewport scores 100%
 * however tall it is, so the config is correct on its own rather than correct
 * only for as long as a cell keeps fitting.
 *
 * Exactly one of the two may be set: flash-list throws
 * `multipleViewabilityThresholdTypesNotSupported` when it sees both.
 *
 * src: https://github.com/Shopify/flash-list/blob/v1.6.4/src/viewability/ViewabilityHelper.ts · @shopify/flash-list 1.6.4 · 2026-08-05
 * src: https://github.com/facebook/react-native/blob/v0.74.5/packages/virtualized-lists/Lists/ViewabilityHelper.js · react-native 0.74.5 · 2026-08-05
 */
const VIEWABILITY_CONFIG = { viewAreaCoveragePercentThreshold: 60 } as const;

/** Ask for the next page well before the viewer reaches the end of this one. */
const END_REACHED_THRESHOLD = 0.6;

/**
 * The vertical full-screen pager. One page per item, whatever an item is.
 *
 * Owns exactly the machinery that makes a snap pager work and nothing else: the
 * FlashList setup, the viewport measurement, viewability, the derivation of
 * which item is active, the decoder-window draw distance, and the scroll-offset
 * fallback. It has no idea what a cell looks like, where items come from, or
 * that video exists.
 *
 * ## Why the interface is shaped like this
 *
 * The pager has to carry heterogeneous cells — video, photo, text, poll,
 * resource, event, game — without learning a single one of their names. Three
 * props do that, and the split between them is the whole design:
 *
 *  - `renderCell` is a callback, not a component map keyed by type. A map looks
 *    tidier right up until the cells need domain callbacks — like, save, RSVP,
 *    open author — at which point every cell has to accept one uniform props
 *    bag and the caller ends up threading a context object through it anyway. A
 *    render callback lets the caller `switch` on its own type field and hand
 *    each component exactly the props that component wants, which is also how
 *    FlashList's own `renderItem` works, so there is one idiom rather than two.
 *  - `getItemType` is REQUIRED and is the caller's function. FlashList keeps one
 *    recycling pool per returned value, so a constant makes it recycle a game
 *    cell's view tree into a video cell and rebuild the whole subtree on every
 *    swipe. Requiring it means a new caller cannot quietly reintroduce that by
 *    omission — it has to answer "what kind of cell is this?" out loud.
 *  - `keyExtractor` is how the pager names the active item without knowing that
 *    items have an `id`. `activeItemId` is `keyExtractor(items[activeIndex])`,
 *    so identity is entirely the caller's definition.
 *
 * `items` + `initialIndex` is why one pager serves three sources: For You,
 * Following, and one profile's posts opened at the grid item that was tapped.
 * The pager neither fetches nor paginates — it asks, via `onEndReached`.
 */
export function FeedPager<TItem>({
  items,
  keyExtractor,
  getItemType,
  renderCell,
  extraData,
  initialIndex = 0,
  placeholder,
  onActiveItemChange,
  onEndReached,
  testID,
}: FeedPagerProps<TItem>): ReactElement {
  const { width: windowWidth } = useWindowDimensions();

  /**
   * The real viewport, measured — NOT `useWindowDimensions().height`.
   *
   * A pager mounts below a header and above a tab bar, so the window is
   * 150–200dp taller than the space it actually gets. Sizing a page to the
   * window overflows every cell past its own viewport, which puts the action
   * rail off-screen and drags viewability down with it.
   *
   * Viewability does not depend on this being right — the config above is
   * viewport-denominated — but the snap interval and `estimatedItemSize` still
   * have to agree with the height a cell is actually given.
   */
  const [pageH, setPageH] = useState(0);
  const [pageW, setPageW] = useState(0);

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { height, width } = e.nativeEvent.layout;
    setPageH((prev) => (Math.abs(prev - height) < 1 ? prev : height));
    setPageW((prev) => (Math.abs(prev - width) < 1 ? prev : width));
  }, []);

  const [activeIndex, setActiveIndex] = useState(initialIndex);

  /**
   * Both sources of the active index funnel through here, and the ref makes the
   * write idempotent. `onScroll` fires around 60 times a second; without the
   * guard every frame would call `setActiveIndex`, and even a same-value
   * setState re-runs `renderItem` for every mounted cell — on a video list that
   * is a dropped-frame machine. State moves once per page, not once per frame.
   */
  const activeIndexRef = useRef(initialIndex);
  const applyActiveIndex = useCallback((next: number) => {
    if (activeIndexRef.current === next) return;
    activeIndexRef.current = next;
    setActiveIndex(next);
  }, []);

  // The frame is measured before the list is built: rendering against an
  // unmeasured page would bake a zero item size into FlashList's layout cache.
  // A non-null placeholder holds the frame in the caller's place.
  const showsList = placeholder == null && pageH > 0;

  /**
   * The active slot is seeded from `initialIndex`, during render rather than in
   * an effect.
   *
   * Two things reposition a pager, and both are late. `initialIndex` arrives
   * once the caller's page has loaded and it knows which slot the viewer asked
   * for; and a rebuilt list — the caller put a placeholder up to reload, then
   * took it down — scrolls back to `initialScrollIndex` under an active slot
   * that is still wherever the viewer had scrolled to. Appending a page does
   * neither, so paginating never moves the viewer.
   *
   * An effect would let one render escape with the wrong slot active, and on a
   * mixed pager that render tells the wrong cell it is the active one — a video
   * cell acts on that immediately. Adjusting here costs nothing: "When you call
   * the `set` function during render, React will re-render that component
   * immediately after your component exits with a `return` statement, and before
   * rendering the children."
   *
   * src: https://react.dev/reference/react/useState#storing-information-from-previous-renders · react 18.2.0 · 2026-08-05
   */
  const positionRef = useRef({ requested: initialIndex, listBuilt: false });
  const repositioned = positionRef.current.requested !== initialIndex;
  const rebuilt = showsList && !positionRef.current.listBuilt;
  positionRef.current = { requested: initialIndex, listBuilt: showsList };
  if ((repositioned || rebuilt) && activeIndexRef.current !== initialIndex) {
    activeIndexRef.current = initialIndex;
    setActiveIndex(initialIndex);
  }

  /**
   * Both must keep a stable identity for the life of the component.
   *
   * "Changing viewabilityConfig on the fly is not supported" and "Changing
   * onViewableItemsChanged nullability on the fly is not supported" are
   * `invariant`s in `FlatList#componentDidUpdate`, and the docs repeat the
   * first. A `useMemo` would not do: memo is a cache with permission to forget,
   * and one dropped entry here is a hard throw. Safe to close over
   * `applyActiveIndex` — it is itself stable.
   *
   * src: https://github.com/facebook/react-native/blob/v0.74.5/packages/react-native/Libraries/Lists/FlatList.js · react-native 0.74.5 · 2026-08-05
   * src: https://reactnative-archive-august-2025.netlify.app/docs/0.74/flatlist · react-native 0.74.5 · 2026-08-05
   */
  const viewabilityConfig = useRef(VIEWABILITY_CONFIG).current;
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0];
      if (first?.index != null) applyActiveIndex(first.index);
    },
  ).current;

  /**
   * Viewability alone loses the active index, so the scroll offset backs it up.
   *
   * `minimumViewTime` is not the cleaner replacement it looks like: flash-list
   * already applies one whether or not you ask for it —
   * `const minimumViewTime = this.viewabilityConfig?.minimumViewTime ?? 250`,
   * with the comment "Default of 0 can impact performance when user scrolls
   * fast." So every viewability callback on this list is ALREADY debounced a
   * quarter of a second, which is precisely why a fast flick leaves the active
   * item on the cell the viewer already swept past, its audio playing under the
   * new cell's frame. Raising `minimumViewTime` makes that worse and dropping it
   * to 0 trades it for dropped frames. The scroll offset never lies and costs
   * nothing, so it stays as the fallback.
   *
   * src: https://github.com/Shopify/flash-list/blob/v1.6.4/src/viewability/ViewabilityHelper.ts · @shopify/flash-list 1.6.4 · 2026-08-05
   */
  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    applyActiveIndex(activeIndexFromScroll(e.nativeEvent.contentOffset.y, pageH, items.length));
  }, [pageH, items.length, applyActiveIndex]);

  /** WHICH item is active, not merely which slot. */
  const activeItem: TItem | undefined = items[activeIndex];
  const activeItemId = activeItem === undefined ? null : keyExtractor(activeItem, activeIndex);

  // Held in a ref so an inline arrow at the call site cannot turn "the active
  // item changed" into "the caller re-rendered".
  const notifyRef = useRef(onActiveItemChange);
  useEffect(() => { notifyRef.current = onActiveItemChange; }, [onActiveItemChange]);

  const notifiedRef = useRef<string | null>(null);
  useEffect(() => {
    if (notifiedRef.current === activeItemId) return;
    notifiedRef.current = activeItemId;
    // An empty pager reports nothing rather than reporting emptiness: callers
    // use this to record what was looked at, and "nothing" is not an event.
    if (activeItemId !== null) notifyRef.current?.(activeItemId, activeIndex);
  }, [activeItemId]);

  /**
   * FlashList recycles cells, so without this it has no reason to re-render one
   * when the pager moves or a caller-owned flag flips: a recycled cell would
   * keep the previous item's play state and icons. The pager's own state is
   * merged in here rather than demanded of the caller, because the caller has no
   * business knowing that the active item has to be in `extraData`.
   */
  const listExtraData = useMemo(
    () => ({ activeIndex, activeItemId, caller: extraData }),
    [activeIndex, activeItemId, extraData],
  );

  /**
   * Exact page size, so FlashList never guesses a cell's height and the snap
   * interval and viewability maths agree with what is on screen.
   * `getItemLayout` is not supported in v1; `estimatedItemSize` and
   * `overrideItemLayout` do different jobs and both are needed.
   * src: https://shopify.github.io/flash-list/docs/1.x/usage · @shopify/flash-list 1.6.4 · 2026-08-05
   */
  const overrideItemLayout = useCallback(
    (layout: { span?: number; size?: number }) => { layout.size = pageH; },
    [pageH],
  );

  const width = pageW > 0 ? pageW : windowWidth;

  const list = showsList ? (
    <FlashList
      data={items}
      keyExtractor={keyExtractor}
      extraData={listExtraData}
      estimatedItemSize={pageH}
      overrideItemLayout={overrideItemLayout}
      getItemType={getItemType}
      // Default is 250dp — under half a page, so the next cell has not been
      // drawn when the swipe lands on it and the viewer gets a black frame.
      // This is also the real bound on how many cells are mounted at once, which
      // is what the video decoder window is measured against.
      drawDistance={pageH * 2}
      initialScrollIndex={initialIndex}
      // No `pagingEnabled`: snapToInterval overrides it, and pairing the two on
      // Android with flash-list 1.6.x + RN 0.74 jumps the list to the last
      // index. src: https://github.com/Shopify/flash-list/issues/1200 · @shopify/flash-list 1.6.4 · 2026-08-05
      snapToInterval={pageH}
      snapToAlignment="start"
      decelerationRate="fast"
      disableIntervalMomentum
      showsVerticalScrollIndicator={false}
      onScroll={handleScroll}
      scrollEventThrottle={16}
      onEndReached={onEndReached}
      onEndReachedThreshold={END_REACHED_THRESHOLD}
      viewabilityConfig={viewabilityConfig}
      onViewableItemsChanged={onViewableItemsChanged}
      renderItem={({ item, index }) => renderCell({
        item, index, activeIndex, activeItemId, width, height: pageH,
      })}
    />
  ) : null;

  return (
    <View testID={testID} style={styles.frame} onLayout={handleLayout}>
      {placeholder ?? list}
    </View>
  );
}

// Static: a full-bleed pager letterboxes on black on every surface it serves, so
// it never reads the theme.
const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: '#000' },
});
