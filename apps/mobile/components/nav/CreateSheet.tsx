import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Pressable, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/errorLogger';
import { useThemeColors } from '../../hooks/useThemeColors';
import { RADII, BRAND_GRADIENT, type ThemeColors } from '../../lib/theme';
import { TYPE } from '../../lib/typography';
import { deriveSellerStatus, canSell, type SellerStatus } from '../../lib/sellerStatus';
import { TAB_MIN_TOUCH } from './navTokens';
import { a11yState } from '../../lib/a11yState';

const ON_COLOR = '#FFFFFF';

type CreateKind = 'post' | 'event' | 'room' | 'product' | 'game';

type KindRow = {
  kind: CreateKind;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  blockedReason: string | null;
  subtitle: string;
};

/**
 * The ＋ slot.
 *
 * Post always lands on her own profile. Communities are approved special
 * accounts now — there is no "where does this go?" step, and a failed
 * membership lookup must never block posting.
 */
export function CreateSheet({ visible, userId, onClose }: Props) {
  const colors = useThemeColors();
  const router = useRouter();
  const [seller, setSeller] = useState<SellerStatus>('none');

  const loadSeller = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('businesses')
      .select('is_verified, can_sell, stripe_account_id')
      .eq('owner_id', userId);
    setSeller(deriveSellerStatus(error ? [] : data));
    if (error) logError(error, 'CreateSheet.sellerStatus');
  }, [userId]);

  useEffect(() => {
    if (!visible) return;
    void loadSeller();
  }, [visible, loadSeller]);

  const s = styles(colors);

  const openComposer = () => {
    onClose();
    router.push({ pathname: '/community/create-post' });
  };

  const productReason = canSell(seller)
    ? null
    : seller === 'review'
      ? 'Your seller application is in review — we will let you know.'
      : 'Approved sellers only. Apply from You › Sell on Roxy.';

  const KINDS: KindRow[] = [
    {
      kind: 'post',
      icon: 'create-outline',
      title: 'Post',
      subtitle: 'Video, photos or a text card for your profile',
      blockedReason: null,
    },
    {
      kind: 'event',
      icon: 'ticket-outline',
      title: 'Event',
      subtitle: 'In person with tickets, or an online room',
      blockedReason: 'Hosts create events in Roxy Studio.',
    },
    {
      kind: 'room',
      icon: 'mic-outline',
      title: 'Room',
      subtitle: 'Go live now — audio or video hangout',
      blockedReason: 'Community admins open rooms in Roxy Studio.',
    },
    {
      kind: 'product',
      icon: 'bag-handle-outline',
      title: 'Product',
      subtitle: 'Add to your shop and tag it on posts',
      blockedReason: productReason,
    },
    {
      kind: 'game',
      icon: 'game-controller-outline',
      title: 'Game',
      subtitle: 'Host a deck or trivia night',
      blockedReason: 'Game submissions go through Roxy Studio.',
    },
  ];

  const onKind = (row: KindRow) => {
    if (row.blockedReason) return;
    if (row.kind === 'post') openComposer();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Dismiss" />
      <View style={s.sheet} testID="create-sheet">
        <View style={s.grabber} />

        <View style={s.header}>
          <View style={s.headerText}>
            <Text style={s.title}>Create</Text>
            <Text style={s.subtitle}>What are you making?</Text>
          </View>
          <TouchableOpacity
            style={s.close}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            activeOpacity={0.75}
          >
            <Ionicons name="close" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView style={s.list} contentContainerStyle={s.listContent}>
          {KINDS.map((row) => {
            const blocked = row.blockedReason !== null;
            return (
              <TouchableOpacity
                key={row.kind}
                style={[s.row, blocked && s.rowBlocked]}
                onPress={() => onKind(row)}
                disabled={blocked}
                testID={`create-kind-${row.kind}`}
                accessibilityRole="button"
                {...a11yState({ disabled: blocked })}
                accessibilityLabel={
                  blocked ? `${row.title}. Unavailable. ${row.blockedReason}` : row.title
                }
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={BRAND_GRADIENT}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[s.plate, blocked && s.plateBlocked]}
                >
                  <Ionicons name={row.icon} size={19} color={ON_COLOR} />
                </LinearGradient>
                <View style={s.rowText}>
                  <Text style={[s.rowTitle, blocked && s.rowTitleBlocked]}>{row.title}</Text>
                  <Text style={s.rowSub} numberOfLines={2}>
                    {row.blockedReason ?? row.subtitle}
                  </Text>
                </View>
                {blocked
                  ? <Ionicons name="lock-closed" size={15} color={colors.textMuted} />
                  : <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

interface Props {
  visible: boolean;
  userId: string | null;
  onClose: () => void;
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(8,3,18,0.66)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: RADII.sheet,
    borderTopRightRadius: RADII.sheet,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 28,
    gap: 4,
  },
  grabber: {
    alignSelf: 'center',
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.line,
    marginBottom: 12,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headerText: { flex: 1, gap: 3 },
  title: { color: colors.textPrimary, ...TYPE.headline },
  subtitle: { color: colors.textSecondary, ...TYPE.caption },
  close: {
    minWidth: TAB_MIN_TOUCH, minHeight: TAB_MIN_TOUCH,
    borderRadius: RADII.pill, backgroundColor: colors.surfaceLight,
    alignItems: 'center', justifyContent: 'center',
  },
  list: { marginTop: 10, maxHeight: 380 },
  listContent: { gap: 6, paddingBottom: 4 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    minHeight: 60, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: RADII.lg, backgroundColor: colors.surfaceLight,
  },
  rowBlocked: { backgroundColor: colors.background },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: colors.textPrimary, fontWeight: '700', ...TYPE.bodyLg },
  rowTitleBlocked: { color: colors.textSecondary },
  rowSub: { color: colors.textSecondary, ...TYPE.caption },
  plate: {
    width: 38, height: 38, borderRadius: RADII.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  plateBlocked: { opacity: 0.45 },
});
