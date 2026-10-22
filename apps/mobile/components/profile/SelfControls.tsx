import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, AccessibilityInfo, Animated, Platform } from 'react-native';
import { TouchableOpacity } from '../ui/PressableScale';
import { useProfileStore } from '../../store/profileStore';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { TYPE } from '../../lib/typography';
import { RADII, SPACE, MARGIN, type ThemeColors } from '../../lib/theme';
import { runSpring } from '../../lib/motion';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { logError } from '../../lib/errorLogger';
import { recordDailyCheckin } from '../../lib/streaks';
import { tapLight } from '../../lib/haptics';

interface Props {
  userId: string;
  /** Opens the Mini Wins sheet — the same sheet the Feed streak chip opens. */
  onOpenDaily?: () => void;
}

/** M3 switch (direction › Settings): 52 × 32 track, 24 dp thumb on, 16 off. */
const TRACK_W = 52;
const TRACK_H = 32;
const THUMB_ON = 24;
const THUMB_OFF = 16;
const TRACK_BORDER = 2;

/**
 * What stays on You: Dating, Ghost, Mini Wins (design direction v2 › You).
 *
 * "The two switches that matter, Dating and Ghost, as plain rows with a
 * one-line explanation each", then Mini Wins as a quiet card with the streak
 * count in `warningInk`. They stay here because they are state she sets on
 * herself, not places: Dating and Ghost must stay one tap from You on the day
 * she needs ghost mode. XP stays reachable inside the Mini Wins sheet.
 *
 * Both write `profiles` through `profileStore.updateProfile`. Every flip is
 * announced to a screen reader, and a light haptic lands with it (native).
 *
 * The switch is local until lane roxy-ai's shared `components/ui/Switch.tsx`
 * lands on main; it follows the same M3 spec (pink track + white thumb on,
 * raised track + control outline off), so the orchestrator can swap it 1:1.
 */
export function SelfControls({ userId, onOpenDaily }: Props) {
  const colors = useThemeColors();
  const s = styles(colors);

  const profile = useProfileStore((st) => st.profile);
  const updateProfile = useProfileStore((st) => st.updateProfile);

  const [savingDating, setSavingDating] = useState(false);
  const [savingGhost, setSavingGhost] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streakDays, setStreakDays] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void recordDailyCheckin().then((n) => {
      if (!cancelled) setStreakDays(n);
    });
    return () => { cancelled = true; };
  }, [userId]);

  const setMode = async (key: 'is_dating_mode' | 'is_ghost', value: boolean) => {
    const setSaving = key === 'is_dating_mode' ? setSavingDating : setSavingGhost;
    setSaving(true);
    setError(null);
    tapLight();
    try {
      await updateProfile({ [key]: value });
      AccessibilityInfo.announceForAccessibility(
        key === 'is_dating_mode'
          ? (value ? 'Dating mode on' : 'Dating mode off. Friends only.')
          : (value ? 'Ghost mode on. You are hidden from discovery.' : 'Ghost mode off. You are discoverable.')
      );
    } catch (e) {
      setError('That didn’t save. Check your connection and try again.');
      logError(e, 'SelfControls.setMode');
    } finally {
      setSaving(false);
    }
  };

  const datingOn = profile?.is_dating_mode ?? false;
  const ghostOn = profile?.is_ghost ?? false;
  const streak = streakDays && streakDays >= 1 ? `${streakDays}-day streak` : null;

  return (
    <View style={s.wrap} testID="self-controls">
      <SwitchRow
        label="Dating"
        hint="Off means friends only. Nobody sees you in dating."
        testID="toggle-dating"
        on={datingOn}
        disabled={savingDating}
        onPress={() => void setMode('is_dating_mode', !datingOn)}
      />
      <SwitchRow
        label="Ghost mode"
        hint="Hidden from discovery. You can still use everything."
        testID="toggle-ghost"
        on={ghostOn}
        disabled={savingGhost}
        onPress={() => void setMode('is_ghost', !ghostOn)}
      />

      {error ? (
        <Text style={s.error} accessibilityLiveRegion="assertive" testID="self-controls-error">
          {error}
        </Text>
      ) : null}

      <TouchableOpacity
        style={s.miniWins}
        onPress={onOpenDaily}
        disabled={!onOpenDaily}
        accessibilityRole="button"
        accessibilityLabel={`Mini Wins${streak ? `, ${streak}` : ''}. Three small things today.`}
        testID="you-mini-wins"
      >
        <View style={s.miniWinsCopy}>
          <Text style={s.miniWinsTitle}>Mini Wins</Text>
          <Text style={s.miniWinsSub}>Three small things today</Text>
        </View>
        {streak ? <Text style={s.streak}>{streak}</Text> : null}
      </TouchableOpacity>
    </View>
  );
}

function SwitchRow({
  label, hint, testID, on, disabled, onPress,
}: {
  label: string;
  hint: string;
  testID: string;
  on: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const s = styles(colors);
  const reducedMotion = useReducedMotion();
  // Inside the outline: off thumb centred at the start, on thumb flush at the end.
  const innerW = TRACK_W - TRACK_BORDER * 2;
  const innerH = TRACK_H - TRACK_BORDER * 2;
  const offLeft = (innerH - THUMB_OFF) / 2;
  const onLeft = innerW - (innerH - THUMB_ON) / 2 - THUMB_ON;
  const x = useRef(new Animated.Value(on ? 1 : 0)).current;

  useEffect(() => {
    runSpring(x, on ? 1 : 0, 'fastSpatial', reducedMotion, Platform.OS !== 'web');
  }, [on, reducedMotion, x]);

  const thumb = on ? THUMB_ON : THUMB_OFF;
  const top = (innerH - thumb) / 2;

  return (
    <TouchableOpacity
      style={s.row}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled }}
      accessibilityLabel={label}
      accessibilityHint={hint}
      testID={testID}
      feedback="layer"
    >
      <View style={s.rowCopy}>
        <Text style={s.rowLabel}>{label}</Text>
        <Text style={s.rowHint}>{hint}</Text>
      </View>
      <View
        testID={`${testID}-track`}
        style={[
          s.track,
          on
            ? { backgroundColor: colors.pink, borderColor: colors.pink }
            : { backgroundColor: colors.raised, borderColor: colors.control },
        ]}
      >
        <Animated.View
          style={[
            s.thumb,
            {
              width: thumb,
              height: thumb,
              top,
              left: offLeft,
              backgroundColor: on ? colors.onPink : colors.control,
              transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, onLeft - offLeft] }) }],
            },
          ]}
        />
      </View>
    </TouchableOpacity>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  wrap: { marginHorizontal: -MARGIN },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[3],
    minHeight: SPACE[7] + SPACE[3], paddingHorizontal: MARGIN, paddingVertical: SPACE[1],
  },
  rowCopy: { flex: 1, gap: SPACE[0] / 2 },
  rowLabel: { ...TYPE.label, color: colors.ink },
  rowHint: { ...TYPE.meta, color: colors.ink2 },
  track: {
    width: TRACK_W, height: TRACK_H, borderRadius: RADII.pill,
    borderWidth: TRACK_BORDER,
  },
  thumb: { position: 'absolute', borderRadius: RADII.pill },
  error: { ...TYPE.meta, color: colors.dangerInk, paddingHorizontal: MARGIN, paddingBottom: SPACE[0] },
  miniWins: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[2],
    marginHorizontal: MARGIN, marginTop: SPACE[1],
    minHeight: MIN_TOUCH_TARGET + SPACE[2], paddingHorizontal: MARGIN, paddingVertical: SPACE[2],
    borderRadius: RADII.md, backgroundColor: colors.surface,
  },
  miniWinsCopy: { flex: 1, gap: SPACE[0] / 2 },
  miniWinsTitle: { ...TYPE.label, color: colors.ink },
  miniWinsSub: { ...TYPE.meta, color: colors.ink2 },
  streak: { ...TYPE.label, color: colors.warningInk },
});
