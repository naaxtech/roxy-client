import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { THEMES } from '../../lib/theme';
import { TYPE } from '../../lib/typography';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';

export type ConsentAction = 'end' | 'report' | 'block' | 'leave';

/**
 * The four ways out, in the order the prototype prints them.
 *
 * Exported so a test can assert the count rather than trusting the render — a
 * fifth action, or a fourth that quietly became three, is exactly the kind of
 * change that should have to be deliberate.
 */
export const CONSENT_ACTIONS: {
  key: ConsentAction;
  label: string;
  /** Says what actually happens, because the label alone cannot. */
  a11y: string;
}[] = [
  { key: 'end', label: 'End call', a11y: 'End call. The date ends for both of you.' },
  { key: 'report', label: 'Report', a11y: 'Report. Reports are anonymous — she is never told.' },
  { key: 'block', label: 'Block', a11y: 'Block. She can never see you or match with you again.' },
  {
    key: 'leave',
    label: 'Leave quietly',
    a11y: 'Leave quietly. You leave now and nobody is told.',
  },
];

interface Props {
  onEnd: () => void;
  onReport: () => void;
  onBlock: () => void;
  onLeaveQuietly: () => void;
}

/**
 * The consent strip: End · Report · Block · Leave quietly.
 *
 * Pinned absolutely rather than laid out in flow, and that is the whole point.
 * A woman on a five-minute video date with a stranger needs the exit in the same
 * place every second of it, and a control that a parent layout can push below
 * the fold — or that content can grow over — is not an exit. The test asserts
 * the pinning, not just the presence.
 *
 * `Leave quietly` is a different promise from `End call`: nobody is told. If it
 * were a relabelled exit the label would be lying, so the promise is carried in
 * the accessibility label where a screen reader reads it out.
 *
 * Colours come from `THEMES.dark` regardless of the viewer's theme, because a
 * call stage is always dark — the same reason the feed pager is. There is no
 * light-mode video call to design for.
 */
export function ConsentStrip({ onEnd, onReport, onBlock, onLeaveQuietly }: Props) {
  const handlers: Record<ConsentAction, () => void> = {
    end: onEnd,
    report: onReport,
    block: onBlock,
    leave: onLeaveQuietly,
  };

  return (
    <View
      style={s.strip}
      testID="consent-strip"
      accessibilityLabel="Safety controls"
      accessibilityRole="toolbar"
    >
      <View style={s.row}>
        {CONSENT_ACTIONS.map((action) => (
          <TouchableOpacity
            key={action.key}
            testID={`consent-${action.key}`}
            onPress={handlers[action.key]}
            accessibilityRole="button"
            accessibilityLabel={action.a11y}
            activeOpacity={0.7}
            style={s.action}
          >
            <Text style={s.label}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={s.foot}>Reports are anonymous · leaving quietly tells nobody</Text>
    </View>
  );
}

const s = StyleSheet.create({
  strip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingBottom: 20,
    paddingTop: 10,
    paddingHorizontal: 12,
    // A wash rather than a solid bar: the video keeps going underneath, but the
    // labels stay legible over whatever happens to be on screen.
    backgroundColor: 'rgba(8,3,18,0.72)',
    gap: 6,
  },
  row: { flexDirection: 'row', justifyContent: 'center', gap: 14, flexWrap: 'wrap' },
  action: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  label: {
    ...TYPE.caption,
    color: THEMES.dark.textPrimary,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  foot: { ...TYPE.micro, color: THEMES.dark.textSecondary, textAlign: 'center' },
});
