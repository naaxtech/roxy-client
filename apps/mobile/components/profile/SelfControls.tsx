import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, AccessibilityInfo } from 'react-native';
import { useProfileStore } from '../../store/profileStore';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII, type ThemeColors } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { logError } from '../../lib/errorLogger';
import { recordDailyCheckin } from '../../lib/streaks';

interface Props {
  userId: string;
  /** Opens the Mini Wins sheet — the same sheet the Feed streak chip opens. */
  onOpenDaily?: () => void;
}

/**
 * What stays on You: Dating, Ghost, Mini Wins.
 *
 * Destinations (people, tickets, badges, saved, sell, settings) live in the
 * More menu. These three stay here because they are not places — they are
 * state she sets on herself. Dating and Ghost must stay two taps from You;
 * burying them one screen deeper is one tap too many on the day she needs
 * ghost mode.
 *
 * Both write `profiles` through `profileStore.updateProfile`. Every flip is
 * announced to a screen reader.
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
    try {
      await updateProfile({ [key]: value });
      AccessibilityInfo.announceForAccessibility(
        key === 'is_dating_mode'
          ? (value ? 'Dating mode on' : 'Dating mode off. Friends only.')
          : (value ? 'Ghost mode on. You are hidden from discovery.' : 'Ghost mode off. You are discoverable.')
      );
    } catch (e) {
      setError('That did not save. Try again.');
      logError(e, 'SelfControls.setMode');
    } finally {
      setSaving(false);
    }
  };

  const datingOn = profile?.is_dating_mode ?? false;
  const ghostOn = profile?.is_ghost ?? false;
  const streakLine = streakDays && streakDays >= 1
    ? `${streakDays}-day streak — keep it alive`
    : 'Mini Wins';

  return (
    <View style={s.wrap} testID="self-controls">
      <View style={s.togglePair}>
        <ModeToggle
          label="Dating mode"
          testID="toggle-dating"
          on={datingOn}
          disabled={savingDating}
          onColor={colors.primary}
          knobLeft={datingOn}
          onPress={() => void setMode('is_dating_mode', !datingOn)}
          hint="Off means friends only. Nobody sees you in dating."
        />
        <ModeToggle
          label="Ghost mode"
          testID="toggle-ghost"
          on={ghostOn}
          disabled={savingGhost}
          onColor={colors.secondary}
          knobLeft={ghostOn}
          onPress={() => void setMode('is_ghost', !ghostOn)}
          hint="Hidden from discovery. You can still use everything."
        />
      </View>

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
        accessibilityLabel={`${streakLine}. Open today's Mini Wins.`}
        activeOpacity={0.8}
        testID="you-mini-wins"
      >
        <View style={s.miniWinsIcon}>
          <Text style={s.miniWinsEmoji}>🔥</Text>
        </View>
        <View style={s.miniWinsCopy}>
          <Text style={s.miniWinsTitle}>{streakLine}</Text>
          <Text style={s.miniWinsSub}>Mini Wins · three small things today</Text>
        </View>
        <Text style={s.chevron}>›</Text>
      </TouchableOpacity>
    </View>
  );
}

function ModeToggle({
  label,
  testID,
  on,
  disabled,
  onColor,
  knobLeft,
  onPress,
  hint,
}: {
  label: string;
  testID: string;
  on: boolean;
  disabled: boolean;
  onColor: string;
  knobLeft: boolean;
  onPress: () => void;
  hint: string;
}) {
  const colors = useThemeColors();
  return (
    <TouchableOpacity
      style={[
        styles(colors).toggleCard,
        disabled && { opacity: 0.6 },
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      accessibilityHint={hint}
      testID={testID}
      activeOpacity={0.85}
    >
      <Text style={styles(colors).toggleLabel}>{label}</Text>
      <View style={[styles(colors).track, { backgroundColor: on ? onColor : colors.surfaceLight }]}>
        <View style={[styles(colors).knob, { left: knobLeft ? 16 : 2 }]} />
      </View>
    </TouchableOpacity>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  wrap: { gap: 10, marginTop: 4 },
  togglePair: { flexDirection: 'row', gap: 8 },
  toggleCard: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: MIN_TOUCH_TARGET + 8, paddingHorizontal: 11, paddingVertical: 9,
    borderRadius: 13, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.line, gap: 6,
  },
  toggleLabel: { ...TYPE.caption, color: colors.textPrimary, fontWeight: '700', flex: 1 },
  track: {
    width: 34, height: 20, borderRadius: RADII.pill, position: 'relative',
  },
  knob: {
    position: 'absolute', top: 2, width: 16, height: 16, borderRadius: RADII.pill,
    backgroundColor: '#FFF8FB', borderWidth: 1, borderColor: colors.lineStrong,
  },
  miniWins: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    borderRadius: RADII.md, paddingHorizontal: 12, paddingVertical: 11,
    minHeight: MIN_TOUCH_TARGET + 8,
  },
  miniWinsIcon: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: colors.primary + '22',
    alignItems: 'center', justifyContent: 'center',
  },
  miniWinsEmoji: { fontSize: 17 },
  miniWinsCopy: { flex: 1 },
  miniWinsTitle: { ...TYPE.body, color: colors.textPrimary, fontWeight: '700' },
  miniWinsSub: { ...TYPE.caption, color: colors.textMuted, fontWeight: '600', marginTop: 1 },
  chevron: { color: colors.textMuted, fontSize: 16 },
  error: { ...TYPE.caption, color: colors.errorInk, paddingBottom: 4 },
});
