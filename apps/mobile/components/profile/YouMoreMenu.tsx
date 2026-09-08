import { useCallback, useEffect, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/errorLogger';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII, type ThemeColors } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { deriveSellerStatus, sellerStatusLabel, type SellerStatus } from '../../lib/sellerStatus';

type Row = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  testID: string;
  onPress: () => void;
};

type Section = { title: string; rows: Row[] };

type Props = {
  visible: boolean;
  onClose: () => void;
  onOpenSaved: () => void;
  userId?: string;
  walletCount?: number;
  savedCount?: number;
};

/**
 * TikTok's hamburger: a full-screen More menu, not a pile of rows on the profile.
 *
 * You stays identity — cover, name, Dating / Ghost, Mini Wins, content tabs.
 * Destinations that used to sit under that (people, tickets, badges, saved,
 * sell, settings) live here, grouped so a woman can scan instead of scroll
 * past a second homepage. Closing first, then navigating, keeps the menu
 * from sitting on top of the screen she asked for.
 *
 * `/people` and `/badges` have no other door. If a row leaves this list,
 * check what else reaches its route first.
 */
export function YouMoreMenu({
  visible,
  onClose,
  onOpenSaved,
  userId,
  walletCount,
  savedCount,
}: Props) {
  const colors = useThemeColors();
  const router = useRouter();
  const s = styles(colors);
  const [seller, setSeller] = useState<SellerStatus>('none');

  const loadSeller = useCallback(async () => {
    if (!userId) {
      setSeller('none');
      return;
    }
    const { data, error } = await supabase
      .from('businesses')
      .select('is_verified, can_sell, stripe_account_id')
      .eq('owner_id', userId);
    setSeller(deriveSellerStatus(error ? [] : data));
    if (error) logError(error, 'YouMoreMenu.sellerStatus');
  }, [userId]);

  useEffect(() => {
    if (visible) void loadSeller();
  }, [visible, loadSeller]);

  const go = (path: string) => {
    onClose();
    router.push(path as never);
  };

  const sections: Section[] = [
    {
      title: 'Your stuff',
      rows: [
        {
          icon: 'people-outline',
          label: 'My people',
          testID: 'you-people',
          onPress: () => go('/people'),
        },
        {
          icon: 'ticket-outline',
          label: 'Tickets & orders',
          value: walletCount != null ? String(walletCount) : undefined,
          testID: 'you-wallet',
          onPress: () => go('/tickets'),
        },
        {
          icon: 'bookmark-outline',
          label: 'Saved',
          value: savedCount != null ? String(savedCount) : undefined,
          testID: 'you-saved',
          onPress: () => {
            onClose();
            onOpenSaved();
          },
        },
        {
          icon: 'ribbon-outline',
          label: 'Badges',
          testID: 'you-badges',
          onPress: () => go('/badges'),
        },
      ],
    },
    {
      title: 'Create',
      rows: [
        {
          icon: 'storefront-outline',
          label: 'Sell on Roxy',
          value: sellerStatusLabel(seller),
          testID: 'you-sell',
          onPress: () => go('/support'),
        },
      ],
    },
    {
      title: 'Account',
      rows: [
        {
          icon: 'settings-outline',
          label: 'Settings & safety',
          testID: 'you-settings',
          onPress: () => go('/(tabs)/you/settings'),
        },
      ],
    },
  ];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={s.safe} testID="you-more-menu">
        <View style={s.head}>
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close More"
            style={s.close}
            testID="you-more-close"
          >
            <Ionicons name="close" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={s.title}>More</Text>
          <View style={s.close} />
        </View>

        <ScrollView contentContainerStyle={s.list}>
          {sections.map((section) => (
            <View key={section.title} style={s.section}>
              <Text style={s.sectionTitle}>{section.title}</Text>
              <View style={s.card}>
                {section.rows.map((row, i) => (
                  <View key={row.testID}>
                    {i > 0 ? <View style={s.rule} /> : null}
                    <TouchableOpacity
                      style={s.row}
                      onPress={row.onPress}
                      accessibilityRole="button"
                      accessibilityLabel={row.value ? `${row.label}. ${row.value}` : row.label}
                      activeOpacity={0.8}
                      testID={row.testID}
                    >
                      <Ionicons name={row.icon} size={20} color={colors.textSecondary} />
                      <Text style={s.label}>{row.label}</Text>
                      {row.value ? <Text style={s.value}>{row.value}</Text> : null}
                      <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 10, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  close: {
    width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { ...TYPE.title, color: colors.textPrimary, fontWeight: '800' },
  list: { padding: 16, gap: 18, paddingBottom: 40 },
  section: { gap: 8 },
  sectionTitle: {
    ...TYPE.micro, color: colors.textMuted, fontWeight: '800',
    letterSpacing: 1.2, paddingHorizontal: 4,
  },
  card: {
    borderRadius: RADII.md, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.line, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    minHeight: MIN_TOUCH_TARGET + 4, paddingHorizontal: 14,
  },
  label: { ...TYPE.body, color: colors.textPrimary, fontWeight: '700', flex: 1 },
  value: { ...TYPE.caption, color: colors.textMuted, fontWeight: '700' },
  rule: { height: 1, backgroundColor: colors.line, marginLeft: 46 },
});
