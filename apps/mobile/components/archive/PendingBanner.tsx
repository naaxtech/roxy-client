import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { tintFill } from './archiveTokens';

interface Props {
  /**
   * `browse` is the headed banner at the top of the Archive. `locked` is the
   * line inside a sheet she cannot use yet — same fact, different room, so it
   * does not repeat the heading she has already read.
   */
  variant?: 'browse' | 'locked';
  actionLabel?: string;
  onActionPress?: () => void;
  testID?: string;
}

const BROWSE_TITLE = 'Membership pending — you still get the Archive';
const BROWSE_BODY =
  "Browse, search, read every review and score anything you've seen. " +
  'Writing reviews, adding entries and the rest of Roxy unlock when a mod ' +
  'approves you — usually within 24h.';
const LOCKED_BODY =
  "Your membership is still pending, so this one is read-only for now. " +
  "You can keep scoring anything you've seen — that counts and stays.";

/**
 * What a pending member is told, and the tone it is told in.
 *
 * Migration 079 is a postmortem about the opposite of this: a new signup landed
 * on `vetting_status='pending'`, every RLS helper returned false, and she was
 * locked out of the whole app with no screen explaining why. So the copy leads
 * with what she CAN do and names the wait in hours, rather than apologising for
 * a restriction.
 *
 * Gold, not red. Waiting is not an error, and an error colour here would tell
 * her something went wrong with her application when nothing has.
 *
 * The whole thing is one `alert` node rather than an icon followed by two
 * paragraphs — a screen reader should read it as a single announcement, not as
 * an hourglass and then some prose.
 *
 * src: docs/handoff/roxy-3.0/Roxy App.dc.html · locked copy line 1323 · 2026-09-01
 */
export function PendingBanner({
  variant = 'browse',
  actionLabel,
  onActionPress,
  testID,
}: Props) {
  const colors = useThemeColors();
  const body = variant === 'locked' ? LOCKED_BODY : BROWSE_BODY;
  const label = variant === 'locked' ? `Membership pending. ${body}` : `${BROWSE_TITLE}. ${body}`;

  const s = StyleSheet.create({
    wrap: {
      gap: 6,
      padding: 12,
      borderRadius: RADII.md,
      borderWidth: 1,
      borderColor: colors.goldInk,
      backgroundColor: tintFill(colors, colors.gold),
    },
    title: { ...TYPE.body, color: colors.textPrimary, fontWeight: '800' },
    body: { ...TYPE.caption, color: colors.textSecondary },
    action: {
      minHeight: MIN_TOUCH_TARGET,
      justifyContent: 'center',
      alignSelf: 'flex-start',
    },
    actionText: { ...TYPE.caption, color: colors.goldInk, fontWeight: '700' },
  });

  return (
    <View
      style={s.wrap}
      testID={testID}
      accessibilityRole="alert"
      accessibilityLabel={label}
    >
      {variant === 'browse' ? <Text style={s.title}>{BROWSE_TITLE}</Text> : null}
      <Text style={s.body}>{body}</Text>
      {actionLabel && onActionPress ? (
        <TouchableOpacity
          style={s.action}
          onPress={onActionPress}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          testID={testID ? `${testID}-action` : undefined}
        >
          <Text style={s.actionText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
