import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { useAccess } from '../../hooks/useAccess';
import { useThemeColors } from '../../hooks/useThemeColors';
import { a11yState } from '../../lib/a11yState';
import { RADII, inkOn, type ThemeColors } from '../../lib/theme';
import { TYPE } from '../../lib/typography';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { fetchOfficialCommunity } from '../../lib/officialCommunity';
import {
  buildFirstSteps,
  dismissFirstSteps,
  fetchAdmissionCommunity,
  loadFirstSteps,
  markStepDone,
  type AdmissionCommunity,
  type FirstStepId,
} from '../../lib/welcomeIn';

/**
 * Her first five minutes, as four small taps (G-11, ideal flow step 9).
 *
 * Each step opens a screen that already exists; tapping it ticks it. The
 * state lives on this device under her user id and the whole card can be
 * hidden — it is an invitation, not a gate. Renders nothing until it knows
 * whether she dismissed it, so it never flashes and vanishes.
 */
export function FirstStepsCard({ testID = 'first-steps-card' }: { testID?: string }) {
  const colors = useThemeColors();
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { can, canCommunity } = useAccess();
  const [done, setDone] = useState<FirstStepId[]>([]);
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [community, setCommunity] = useState<AdmissionCommunity | null>(null);
  const [official, setOfficial] = useState<AdmissionCommunity | null>(null);
  const s = styles(colors);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void loadFirstSteps(userId).then((state) => {
      if (cancelled) return;
      setDone(state.done);
      setDismissed(state.dismissed);
    });
    void fetchAdmissionCommunity(userId).then((c) => { if (!cancelled) setCommunity(c); });
    void Promise.resolve(fetchOfficialCommunity())
      .then((o) => { if (!cancelled && o) setOfficial(o); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [userId]);

  const open = useCallback(async (id: FirstStepId, route: string) => {
    if (!userId) return;
    setDone((d) => (d.includes(id) ? d : [...d, id]));
    router.push(route as never);
    await markStepDone(userId, id);
  }, [userId, router]);

  const hide = useCallback(async () => {
    if (!userId) return;
    setDismissed(true);
    await dismissFirstSteps(userId);
  }, [userId]);

  if (!userId || dismissed !== false) return null;

  const steps = buildFirstSteps({ community, official, can, canCommunity });
  const remaining = steps.filter((step) => !done.includes(step.id)).length;

  return (
    <View style={s.card} testID={testID}>
      <View style={s.head}>
        <Text style={s.eyebrow}>Your first five minutes</Text>
        <TouchableOpacity
          onPress={() => void hide()}
          style={s.hide}
          accessibilityRole="button"
          accessibilityLabel="Hide first steps"
          hitSlop={8}
        >
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
      <Text style={s.title}>
        {remaining === 0 ? "You're all set. Welcome home." : `${remaining} small ${remaining === 1 ? 'step' : 'steps'} to feel at home`}
      </Text>
      {steps.map((step) => {
        const isDone = done.includes(step.id);
        return (
          <TouchableOpacity
            key={step.id}
            style={s.row}
            onPress={() => void open(step.id, step.route)}
            accessibilityRole="button"
            accessibilityLabel={step.a11yLabel}
            {...a11yState({ checked: isDone })}
            testID={`first-step-${step.id}`}
          >
            <View style={[s.tick, isDone && s.tickDone]}>
              <Ionicons
                name={isDone ? 'checkmark' : (step.icon as never)}
                size={16}
                color={isDone ? inkOn(colors.success) : colors.primaryInk}
              />
            </View>
            <View style={s.copy}>
              <Text style={[s.rowTitle, isDone && s.rowTitleDone]}>{step.title}</Text>
              <Text style={s.rowBody}>{step.body}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  card: {
    borderRadius: RADII.lg,
    backgroundColor: colors.surface,
    padding: 16,
    gap: 6,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: {
    ...TYPE.micro,
    color: colors.primaryInk,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  hide: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  title: { ...TYPE.title, color: colors.textPrimary, marginBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: 8,
  },
  tick: {
    width: 32,
    height: 32,
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceLight,
  },
  tickDone: { backgroundColor: colors.success },
  copy: { flex: 1, gap: 2 },
  rowTitle: { ...TYPE.bodyLg, color: colors.textPrimary, fontWeight: '700' },
  rowTitleDone: { color: colors.textMuted, textDecorationLine: 'line-through' },
  rowBody: { ...TYPE.body, color: colors.textSecondary },
});
