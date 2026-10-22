import type { ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { LoadingO, Skeleton, SkeletonGroup, useWaitVisible } from '../feedback';
import { MARGIN, RADII, SPACE } from '../../lib/theme';

/**
 * Skeletons at the final geometry of the lists lane D owns (motion spec F8,
 * §1.3 rule 6): one progressbar per placeholder, every block on the shared
 * pulse clock (static under Reduce Motion), no stagger, no spinner.
 *
 * - `RowsSkeleton`: avatar + name line + preview line rows (inbox, new
 *   message, group members, blocked list, official chat).
 * - `ThreadSkeleton`: alternating bubbles (DM thread, channel).
 */
const ROW_MIN = 72;

/**
 * A control's label that becomes the faceless O while a wait runs (F11).
 * A wait under 200 ms never shows the O (the label stays, so a fast action
 * never flashes a loader); once shown the O stays at least 400 ms. On a
 * filled pink button pass `onFill`: the O sits on a surface disc so the pink
 * ring stays visible. Never a spinner.
 */
export function BusySwap({
  busy, children, onFill = false, label = 'Working', testID,
}: { busy: boolean; children: ReactNode; onFill?: boolean; label?: string; testID?: string }) {
  const show = useWaitVisible(busy);
  if (!show) return <>{children}</>;
  return <LoadingO size="busy" contained={onFill} accessibilityLabel={label} testID={testID ?? 'busy-o'} />;
}

export function RowsSkeleton({
  testID, label = 'Loading', rows = 3, avatar = 48,
}: { testID: string; label?: string; rows?: number; avatar?: number }) {
  return (
    <SkeletonGroup testID={testID} accessibilityLabel={label}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={s.row}>
          <Skeleton circle={avatar} testID="rows-skeleton-avatar" />
          <View style={s.lines}>
            <Skeleton width="40%" height={SPACE[2]} radius={RADII.pill} />
            <Skeleton width="75%" height={SPACE[2]} radius={RADII.pill} style={s.second} />
          </View>
        </View>
      ))}
    </SkeletonGroup>
  );
}

/** Bubble widths and heights that read as a conversation, not a pattern. */
const BUBBLES: { mine: boolean; width: `${number}%`; height: number }[] = [
  { mine: false, width: '62%', height: 40 },
  { mine: false, width: '44%', height: 40 },
  { mine: true, width: '56%', height: 40 },
  { mine: false, width: '70%', height: 58 },
  { mine: true, width: '38%', height: 40 },
  { mine: true, width: '64%', height: 58 },
];

export function ThreadSkeleton({ testID, label = 'Loading messages' }: { testID: string; label?: string }) {
  return (
    <SkeletonGroup testID={testID} accessibilityLabel={label} style={s.thread}>
      {BUBBLES.map((b, i) => (
        <Skeleton
          key={i}
          testID={b.mine ? 'thread-skeleton-mine' : 'thread-skeleton-theirs'}
          width={b.width}
          height={b.height}
          radius={20}
          style={b.mine ? s.mine : s.theirs}
        />
      ))}
    </SkeletonGroup>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[2],
    minHeight: ROW_MIN, paddingHorizontal: MARGIN, paddingVertical: SPACE[1],
  },
  lines: { flex: 1 },
  second: { marginTop: SPACE[0] },
  thread: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: MARGIN, paddingBottom: SPACE[2], gap: SPACE[1] },
  mine: { alignSelf: 'flex-end' },
  theirs: { alignSelf: 'flex-start' },
});
