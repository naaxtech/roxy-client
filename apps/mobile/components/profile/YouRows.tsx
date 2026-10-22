import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { TouchableOpacity } from '../ui/PressableScale';
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/errorLogger';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { SPACE, MARGIN, type ThemeColors } from '../../lib/theme';
import { deriveSellerStatus, sellerStatusLabel, type SellerStatus } from '../../lib/sellerStatus';

/** Rows on You (direction › Spacing: rows 56). Icons: 24 dp outlines in ink2. */
const ROW_MIN = 56;
const ICON = 24;

type Row = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  testID: string;
  onPress: () => void;
};

interface Props {
  userId?: string;
  walletCount?: number;
  savedCount?: number;
  /** Opens her Saved tab below. */
  onOpenSaved: () => void;
}

/**
 * The places You leads to (design direction v2 › You): Tickets & orders,
 * Saved, Sell on Roxy, Settings & safety — plain rows on the ground, 24 dp
 * outline icons in `ink2`, a chevron, the count or status on the right.
 *
 * They used to hide behind the More menu (`YouMoreMenu`, which stays for My
 * people and Badges, and lists these too). The direction puts them on You so
 * the profile answers "where are my tickets?" without a hunt.
 *
 * "Roxy Premium" is in the direction's list but held for Nicole (no Premium
 * ships yet, and no dead button), so it is not drawn.
 */
export function YouRows({ userId, walletCount, savedCount, onOpenSaved }: Props) {
  const colors = useThemeColors();
  const router = useRouter();
  const s = styles(colors);
  const [seller, setSeller] = useState<SellerStatus>('none');

  const loadSeller = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('businesses')
      .select('is_verified, can_sell, stripe_account_id')
      .eq('owner_id', userId);
    setSeller(deriveSellerStatus(error ? [] : data));
    if (error) logError(error, 'YouRows.sellerStatus');
  }, [userId]);

  useEffect(() => { void loadSeller(); }, [loadSeller]);

  const rows: Row[] = [
    {
      icon: 'ticket-outline',
      label: 'Tickets & orders',
      value: walletCount ? String(walletCount) : undefined,
      testID: 'you-row-wallet',
      onPress: () => router.push('/tickets' as never),
    },
    {
      icon: 'bookmark-outline',
      label: 'Saved',
      value: savedCount ? String(savedCount) : undefined,
      testID: 'you-row-saved',
      onPress: onOpenSaved,
    },
    {
      icon: 'storefront-outline',
      label: 'Sell on Roxy',
      value: sellerStatusLabel(seller) || undefined,
      testID: 'you-row-sell',
      onPress: () => router.push('/support' as never),
    },
    {
      icon: 'shield-checkmark-outline',
      label: 'Settings & safety',
      testID: 'you-row-settings',
      onPress: () => router.push('/(tabs)/you/settings' as never),
    },
  ];

  return (
    <View style={s.list} testID="you-rows">
      {rows.map((row) => (
        <TouchableOpacity
          key={row.testID}
          style={s.row}
          onPress={row.onPress}
          accessibilityRole="button"
          accessibilityLabel={row.value ? `${row.label}, ${row.value}` : row.label}
          testID={row.testID}
          feedback="layer"
        >
          <Ionicons name={row.icon} size={ICON} color={colors.ink2} />
          <Text style={s.label} numberOfLines={2}>{row.label}</Text>
          {row.value ? <Text style={s.value}>{row.value}</Text> : null}
          <Ionicons name="chevron-forward" size={ICON - SPACE[1]} color={colors.ink3} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  list: { marginHorizontal: -MARGIN, marginTop: SPACE[2] },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[3],
    minHeight: ROW_MIN, paddingHorizontal: MARGIN,
  },
  label: { ...TYPE.label, color: colors.ink, flex: 1 },
  value: { ...TYPE.meta, color: colors.ink2 },
});
