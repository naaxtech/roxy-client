import { useCallback, useEffect, useState } from 'react';
import { View, Text, Switch, TouchableOpacity, StyleSheet, AccessibilityInfo } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/errorLogger';
import { useProfileStore } from '../../store/profileStore';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII, type ThemeColors } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { deriveSellerStatus, sellerStatusLabel, type SellerStatus } from '../../lib/sellerStatus';

interface Props {
  userId: string;
}

/**
 * The self-variant block: the two safety modes, then the wallet and the shop.
 *
 * The two toggles are the reason this component sits at the top of the You tab
 * rather than inside Settings. The brief's requirement is that dating mode and
 * ghost mode are **two taps from anywhere in the app**, and from any tab that is
 * You → the toggle. Burying them one screen deeper would be one tap too many on
 * the day a woman actually needs ghost mode, which is the only day it matters.
 *
 * Both write `profiles` through `profileStore.updateProfile`. They are not in
 * `safetyStore` — that store owns blocking and reporting, and these two are
 * profile state that other people's queries read.
 *
 * Every flip is announced to a screen reader. A safety control whose new state
 * is only visible is a safety control half the people who need it cannot
 * confirm they have set.
 */
export function SelfControls({ userId }: Props) {
  const colors = useThemeColors();
  const router = useRouter();
  const s = styles(colors);

  const profile = useProfileStore((st) => st.profile);
  const updateProfile = useProfileStore((st) => st.updateProfile);

  const [seller, setSeller] = useState<SellerStatus>('none');
  const [savingDating, setSavingDating] = useState(false);
  const [savingGhost, setSavingGhost] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSeller = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('businesses')
      .select('is_verified, can_sell, stripe_account_id')
      .eq('owner_id', userId);
    // Fail closed: an unknown answer about permission is 'none', never approved.
    setSeller(deriveSellerStatus(err ? [] : data));
    if (err) logError(err, 'SelfControls.sellerStatus');
  }, [userId]);

  useEffect(() => { void loadSeller(); }, [loadSeller]);

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
      // updateProfile throws on a refused write, so the switch snaps back to the
      // store's value and she is told. Never leave a safety toggle looking on
      // when the row did not change.
      setError('That did not save. Try again.');
      logError(e, 'SelfControls.setMode');
    } finally {
      setSaving(false);
    }
  };

  const rows: { icon: keyof typeof Ionicons.glyphMap; label: string; value?: string; onPress: () => void; testID: string }[] = [
    {
      icon: 'ticket-outline',
      label: 'Tickets & orders',
      onPress: () => router.push('/tickets' as never),
      testID: 'you-wallet',
    },
    {
      icon: 'bookmark-outline',
      label: 'Saved',
      onPress: () => router.push('/(tabs)/feed' as never),
      testID: 'you-saved',
    },
    {
      icon: 'storefront-outline',
      label: 'Sell on Roxy',
      value: sellerStatusLabel(seller),
      onPress: () => router.push('/support' as never),
      testID: 'you-sell',
    },
  ];

  return (
    <View style={s.wrap} testID="self-controls">
      <View style={s.card}>
        <View style={s.toggleRow}>
          <View style={s.toggleText}>
            <Text style={s.label}>Dating mode</Text>
            <Text style={s.hint}>Off means friends only. Nobody sees you in dating.</Text>
          </View>
          <Switch
            testID="toggle-dating"
            value={profile?.is_dating_mode ?? false}
            disabled={savingDating}
            onValueChange={(v) => void setMode('is_dating_mode', v)}
            accessibilityLabel="Dating mode"
            trackColor={{ false: colors.surfaceLight, true: colors.primary }}
          />
        </View>

        <View style={s.rule} />

        <View style={s.toggleRow}>
          <View style={s.toggleText}>
            <Text style={s.label}>Ghost mode</Text>
            <Text style={s.hint}>Hidden from discovery. You can still use everything.</Text>
          </View>
          <Switch
            testID="toggle-ghost"
            value={profile?.is_ghost ?? false}
            disabled={savingGhost}
            onValueChange={(v) => void setMode('is_ghost', v)}
            accessibilityLabel="Ghost mode"
            trackColor={{ false: colors.surfaceLight, true: colors.secondary }}
          />
        </View>

        {error ? (
          <Text style={s.error} accessibilityLiveRegion="assertive" testID="self-controls-error">
            {error}
          </Text>
        ) : null}
      </View>

      <View style={s.card}>
        {rows.map((row, i) => (
          <View key={row.testID}>
            {i > 0 ? <View style={s.rule} /> : null}
            <TouchableOpacity
              style={s.linkRow}
              onPress={row.onPress}
              accessibilityRole="button"
              accessibilityLabel={row.value ? `${row.label}. ${row.value}` : row.label}
              activeOpacity={0.8}
              testID={row.testID}
            >
              <Ionicons name={row.icon} size={19} color={colors.roxy} />
              <Text style={s.label}>{row.label}</Text>
              {row.value ? <Text style={s.value}>{row.value}</Text> : null}
              <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  wrap: { paddingHorizontal: 18, gap: 12, marginTop: 4 },
  card: {
    borderRadius: RADII.lg, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.line,
    paddingHorizontal: 14,
  },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    minHeight: MIN_TOUCH_TARGET + 12, paddingVertical: 10,
  },
  toggleText: { flex: 1, gap: 2 },
  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    minHeight: MIN_TOUCH_TARGET + 4,
  },
  label: { ...TYPE.bodyLg, color: colors.textPrimary, fontWeight: '600', flex: 1 },
  hint: { ...TYPE.caption, color: colors.textSecondary, lineHeight: 17 },
  value: { ...TYPE.caption, color: colors.roxy, fontWeight: '700' },
  rule: { height: 1, backgroundColor: colors.line },
  error: { ...TYPE.caption, color: colors.errorInk, paddingBottom: 10 },
});
