import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GestureResponderEvent, LayoutChangeEvent } from 'react-native';
import { HEART, type PostReaction } from '../../lib/postReactions';
import { haptic, tapLight } from '../../lib/haptics';
import { PICKER, pickerHit, type Box } from './reactionGeometry';

/**
 * The reaction button's gesture, as one small state machine (direction v2 ›
 * Reactions):
 *
 *   touch down ─ 300 ms ─▶ picker open ─ slide ─▶ hovered emoji (selection haptic)
 *        │                       │
 *        └ lift before ─▶ tap    ├ lift on an emoji ─▶ that is her reaction (light haptic)
 *          (❤️, or take hers     ├ lift on the button ─▶ stays open for a tap
 *           back)                └ lift elsewhere ─▶ cancel
 *
 * Plain React Native responder events, not a gesture-handler detector: they
 * work the same on iOS, Android and the web export, and the feed pager can
 * still claim a vertical drag until the picker is open (termination request).
 *
 * Geometry: the picker is drawn by the HOST (the feed cell's chrome), so the
 * button's box is built from the layouts of the column, the rail and the
 * button (`layoutOf`), all relative to their parents. Layout events, not
 * `measure`: they arrive on every platform and in tests alike.
 */
export interface ReactionPickerController {
  open: boolean;
  hovered: PostReaction | null;
  /** The button's box in the host's coordinates. */
  anchor: Box;
  layoutOf: (key: 'column' | 'rail' | 'button') => (e: LayoutChangeEvent) => void;
  responder: {
    onStartShouldSetResponder: () => boolean;
    onResponderTerminationRequest: () => boolean;
    onResponderGrant: (e: GestureResponderEvent) => void;
    onResponderMove: (e: GestureResponderEvent) => void;
    onResponderRelease: (e: GestureResponderEvent) => void;
    onResponderTerminate: () => void;
  };
  /** Tap: ❤️ when she has none, otherwise take hers back. */
  tap: () => void;
  openPicker: () => void;
  pick: (emoji: PostReaction) => void;
  dismiss: () => void;
  /** Bumps on every committed change, so the button can squish. */
  pulse: number;
}

interface Options {
  reaction: PostReaction | null;
  onReact: (next: PostReaction | null) => void;
  /** Haptics stay under Reduce Motion (direction › Motion); kept for symmetry. */
  reducedMotion?: boolean;
  /** Told when the picker opens and closes (the FAB tucks while it is open). */
  onOpenChange?: (open: boolean) => void;
}

type Point = { x: number; y: number };
type TouchStart = { page: Point; host: Point };

/** The finger in host coordinates: where it started plus how far it travelled. */
function hostPoint(from: TouchStart | null, e: GestureResponderEvent): Point | null {
  if (!from) return null;
  const { pageX, pageY } = e.nativeEvent;
  return { x: from.host.x + (pageX - from.page.x), y: from.host.y + (pageY - from.page.y) };
}

export function useReactionPicker({
  reaction, onReact, onOpenChange,
}: Options): ReactionPickerController {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<PostReaction | null>(null);
  const [pulse, setPulse] = useState(0);

  const openRef = useRef(false);
  const hoveredRef = useRef<PostReaction | null>(null);
  const layouts = useRef<Record<'column' | 'rail' | 'button', Box>>({
    column: { x: 0, y: 0, width: 0, height: 0 },
    rail: { x: 0, y: 0, width: 0, height: 0 },
    button: { x: 0, y: 0, width: 48, height: 48 },
  });
  const [anchor, setAnchor] = useState<Box>({ x: 0, y: 0, width: 48, height: 48 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Where the touch started: page coordinates and its point in the host. */
  const start = useRef<TouchStart | null>(null);
  const scrolling = useRef(false);
  const leftButton = useRef(false);

  // The latest props, so the handlers below can stay stable.
  const latest = useRef({ reaction, onReact, onOpenChange });
  latest.current = { reaction, onReact, onOpenChange };

  const computeAnchor = useCallback((): Box => {
    const { column, rail, button } = layouts.current;
    return {
      x: column.x + rail.x + button.x,
      y: column.y + rail.y + button.y,
      width: button.width,
      height: button.height,
    };
  }, []);

  const layoutHandlers = useMemo(() => {
    const make = (key: 'column' | 'rail' | 'button') => (e: LayoutChangeEvent) => {
      const { x, y, width, height } = e.nativeEvent.layout;
      layouts.current[key] = { x, y, width, height };
      setAnchor(computeAnchor());
    };
    return { column: make('column'), rail: make('rail'), button: make('button') };
  }, [computeAnchor]);

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const setOpenState = useCallback((next: boolean) => {
    if (openRef.current === next) return;
    openRef.current = next;
    setOpen(next);
    if (!next) {
      hoveredRef.current = null;
      setHovered(null);
    }
    latest.current.onOpenChange?.(next);
  }, []);

  const openPicker = useCallback(() => {
    setAnchor(computeAnchor());
    setOpenState(true);
  }, [computeAnchor, setOpenState]);

  const dismiss = useCallback(() => {
    clearTimer();
    setOpenState(false);
  }, [clearTimer, setOpenState]);

  const pick = useCallback((emoji: PostReaction) => {
    setOpenState(false);
    if (emoji === latest.current.reaction) return;
    tapLight(false);
    setPulse((n) => n + 1);
    latest.current.onReact(emoji);
  }, [setOpenState]);

  const tap = useCallback(() => {
    const next = latest.current.reaction ? null : HEART;
    if (next) tapLight(false);
    setPulse((n) => n + 1);
    latest.current.onReact(next);
  }, []);

  const responder = useMemo(() => ({
    onStartShouldSetResponder: () => true,
    // Until the picker is open the pager may take the touch (a scroll);
    // once it is open the slide belongs to the picker.
    onResponderTerminationRequest: () => !openRef.current,
    onResponderGrant: (e: GestureResponderEvent) => {
      const { pageX, pageY, locationX, locationY } = e.nativeEvent;
      const box = computeAnchor();
      start.current = {
        page: { x: pageX, y: pageY },
        host: { x: box.x + locationX, y: box.y + locationY },
      };
      scrolling.current = false;
      leftButton.current = false;
      clearTimer();
      if (openRef.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        if (!scrolling.current) openPicker();
      }, PICKER.longPressMs);
    },
    onResponderMove: (e: GestureResponderEvent) => {
      const point = hostPoint(start.current, e);
      if (!point || !start.current) return;
      const dx = point.x - start.current.host.x;
      const dy = point.y - start.current.host.y;
      const moved = Math.hypot(dx, dy);
      if (!openRef.current) {
        if (moved > PICKER.tapSlop) {
          scrolling.current = true;
          clearTimer();
        }
        return;
      }
      if (moved > computeAnchor().width / 2) leftButton.current = true;
      const next = pickerHit(computeAnchor(), point);
      if (next !== hoveredRef.current) {
        hoveredRef.current = next;
        setHovered(next);
        if (next) haptic('select', false);
      }
    },
    onResponderRelease: (e: GestureResponderEvent) => {
      const wasPending = timer.current !== null;
      clearTimer();
      if (!openRef.current) {
        if (wasPending && !scrolling.current) tap();
        start.current = null;
        return;
      }
      const point = hostPoint(start.current, e);
      const under = point ? pickerHit(computeAnchor(), point) : hoveredRef.current;
      start.current = null;
      if (under) {
        pick(under);
        return;
      }
      // Still on the button: the picker stays for a tap. Anywhere else: cancel.
      if (leftButton.current) setOpenState(false);
      else {
        hoveredRef.current = null;
        setHovered(null);
      }
    },
    onResponderTerminate: () => {
      // The pager (or the OS) took the touch. An open picker stays open for a
      // tap rather than vanishing under her thumb.
      clearTimer();
      start.current = null;
      hoveredRef.current = null;
      setHovered(null);
    },
  }), [clearTimer, computeAnchor, openPicker, pick, setOpenState, tap]);

  useEffect(() => clearTimer, [clearTimer]);

  const layoutOf = useCallback(
    (key: 'column' | 'rail' | 'button') => layoutHandlers[key],
    [layoutHandlers],
  );

  return {
    open, hovered, anchor, layoutOf, responder, tap, openPicker, pick, dismiss, pulse,
  };
}
