import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { STAGE } from './stageColors';
import { TYPE } from '../../lib/typography';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';

export type FeedSegment = 'foryou' | 'following' | 'communities';

export const FEED_SEGMENTS: { key: FeedSegment; label: string }[] = [
  { key: 'foryou', label: 'For You' },
  { key: 'following', label: 'Following' },
  { key: 'communities', label: 'Communities' },
];

interface Props {
  value: FeedSegment;
  onChange: (next: FeedSegment) => void;
}

/**
 * The three ways into the feed, drawn over the pager.
 *
 * A tab bar, not a filter chip row: these are peers and exactly one is always
 * on, so each carries `accessibilityRole="tab"` and a selected state a screen
 * reader can read. The active one is marked by weight AND a rule under it, never
 * by colour alone — the prototype's own treatment, and the only one that
 * survives a viewer who cannot separate pink from lilac.
 *
 * Ink comes from `STAGE`, not `useThemeColors()`: this sits on the permanently
 * dark pager. See `stageColors.ts`.
 */
export function FeedSegments({ value, onChange }: Props) {
  return (
    <View style={s.row} accessibilityRole="tablist" testID="feed-segments">
      {FEED_SEGMENTS.map((seg) => {
        const on = seg.key === value;
        return (
          <TouchableOpacity
            key={seg.key}
            testID={`feed-segment-${seg.key}`}
            onPress={() => onChange(seg.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={seg.label}
            activeOpacity={0.8}
            style={s.tab}
          >
            <Text style={[s.label, on ? s.labelOn : s.labelOff]}>{seg.label}</Text>
            <View style={[s.rule, on ? s.ruleOn : s.ruleOff]} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: 22 },
  tab: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  label: { ...TYPE.bodyLg },
  labelOn: { color: STAGE.textPrimary, fontWeight: '700' },
  labelOff: { color: STAGE.textSecondary, fontWeight: '600' },
  rule: { height: 2, width: '100%', marginTop: 4, borderRadius: 2 },
  ruleOn: { backgroundColor: STAGE.primaryInk },
  ruleOff: { backgroundColor: 'transparent' },
});
