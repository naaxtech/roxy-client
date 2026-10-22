import { useLayoutEffect, useRef, type RefObject } from 'react';
import { Platform } from 'react-native';
import { SPRING } from '../../lib/motion';
import { currentWebStyle, startWebSpring } from '../motion/webSpring';

/**
 * Web only: the opacity of one Feed-stage colour layer, faded on the
 * compositor.
 *
 * Natively the bar cross-fades its colours with `interpolateColor` on the UI
 * thread. Reanimated on the web runs that on the page's main thread, and when
 * she left the Feed the destination's first render held that thread for most
 * of a second (feel run 3074493, 4x CPU): the bar froze half-way — a grey
 * ground with near-invisible labels — and then jumped (motion spec §3.1 row 4,
 * jank audit #7). On the web each stage colour is instead a layer over the
 * theme colour, and its opacity runs on `fastEffects` (ζ 1, so no overshoot)
 * as WAAPI with the spring's own curve; layers started in one commit stay in
 * step. A turn-around starts from the opacity on screen. Under Reduce Motion
 * the colours simply switch.
 *
 * `enteringFrom` is the stage the bar showed before this layer mounted: a pill
 * that mounts with the switch fades from there, like the rest of the bar.
 */
export function useWebStageFade<T>(on: boolean, reducedMotion: boolean, enteringFrom: boolean = on): RefObject<T> {
  const ref = useRef<T>(null);
  const was = useRef(enteringFrom);
  const running = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    if (was.current === on) return;
    const from = was.current;
    was.current = on;
    if (Platform.OS !== 'web' || reducedMotion) return;
    const el = ref.current as unknown as Element;
    const live = running.current?.playState === 'running' ? Number(currentWebStyle(el)?.opacity) : NaN;
    running.current = startWebSpring(
      el,
      [{ opacity: Number.isFinite(live) ? live : from ? 1 : 0 }, { opacity: on ? 1 : 0 }],
      SPRING.fastEffects,
    );
  }, [on, reducedMotion]);
  return ref;
}
