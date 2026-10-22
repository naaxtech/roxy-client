import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, Pressable, Animated, useWindowDimensions,
} from 'react-native';
import { TouchableOpacity } from '../ui/PressableScale';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/errorLogger';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { RADII, SPACE, MARGIN, type ThemeColors, scrim, popElevation } from '../../lib/theme';
import { TYPE, emphasized } from '../../lib/typography';
import { runSpring } from '../../lib/motion';
import { deriveSellerStatus, canSell, type SellerStatus } from '../../lib/sellerStatus';
import { isOfficialAccount } from '../../lib/officialGrant';
import { TAB_MIN_TOUCH } from './navTokens';

/** The direction's icon size for the sheet: 24 dp outlines in `ink2`. */
const ICON = 24;
/** The one large row (direction › Spacing: rows 56 / 64 / 72). */
const POST_ROW_MIN = 72;

type ActionRow = {
  kind: 'post' | 'event';
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
};

type QuietLine = {
  key: 'communities' | 'sell';
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
};

/** Who may sell, in one sentence — never a padlocked Product button. */
function sellLine(seller: SellerStatus): string {
  if (canSell(seller)) return 'Tag your shop items on any post.';
  if (seller === 'review') return 'Your seller application is in review. We’ll let you know.';
  return 'Sell on Roxy — apply from You.';
}

/**
 * The ＋ slot (design direction v2 › Create sheet).
 *
 * "Make something", ONE large Post row, then one quiet line each for what else
 * exists and who can make it. 24 dp outline icons in `ink2`, no tinted tiles.
 * v0 drew five gradient tiles with four padlocks; for almost every member the
 * only thing on the sheet she could do was hidden among things she could not.
 * v0's Product row also did nothing when it unlocked (no handler) — products
 * are tagged on posts, so an approved seller is told that instead.
 *
 * Post always lands on her own profile. Communities are approved special
 * accounts now — there is no "where does this go?" step, and a failed
 * membership lookup must never block posting. An official community account
 * keeps a real Event row (feature parity: hosting events from here).
 *
 * The sheet rises on `SPRING.spatial` (Reduce Motion: it is simply there).
 */
export function CreateSheet({ visible, userId, onClose }: Props) {
  const colors = useThemeColors();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const { height } = useWindowDimensions();
  const rise = useRef(new Animated.Value(height)).current;
  const [seller, setSeller] = useState<SellerStatus>('none');
  const [official, setOfficial] = useState(false);

  const loadAccess = useCallback(async () => {
    if (!userId) return;
    const [{ data, error }, { data: profile, error: profileErr }] = await Promise.all([
      supabase
        .from('businesses')
        .select('is_verified, can_sell, stripe_account_id')
        .eq('owner_id', userId),
      supabase
        .from('profiles')
        .select('official_community_id')
        .eq('id', userId)
        .maybeSingle(),
    ]);
    setSeller(deriveSellerStatus(error ? [] : data));
    setOfficial(isOfficialAccount(profile));
    if (error) logError(error, 'CreateSheet.sellerStatus');
    if (profileErr) logError(profileErr, 'CreateSheet.official');
  }, [userId]);

  useEffect(() => {
    if (!visible) return;
    void loadAccess();
  }, [visible, loadAccess]);

  useEffect(() => {
    if (!visible) {
      rise.setValue(height);
      return;
    }
    runSpring(rise, 0, 'spatial', reducedMotion);
  }, [visible, height, reducedMotion, rise]);

  const s = styles(colors);

  const rows: ActionRow[] = [
    {
      kind: 'post',
      icon: 'create-outline',
      title: 'Post',
      subtitle: 'A photo, a video or a few words',
    },
    ...(official
      ? [{
          kind: 'event' as const,
          icon: 'ticket-outline' as const,
          title: 'Event',
          subtitle: 'Tickets in person, or an online room',
        }]
      : []),
  ];

  const lines: QuietLine[] = [
    {
      key: 'communities',
      icon: 'people-outline',
      text: official
        ? 'Rooms and games come from Roxy Studio.'
        : 'Events, rooms and games come from communities. Ask an admin of one you’re in.',
    },
    { key: 'sell', icon: 'storefront-outline', text: sellLine(seller) },
  ];

  const onRow = (row: ActionRow) => {
    onClose();
    router.push({ pathname: row.kind === 'post' ? '/community/create-post' : '/community/create-event' });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Dismiss" />
      <Animated.View
        style={[s.sheet, popElevation(colors), { transform: [{ translateY: rise }] }]}
        testID="create-sheet"
      >
        <View style={s.grabber} />

        <View style={s.header}>
          <Text style={s.title} accessibilityRole="header">Make something</Text>
          <TouchableOpacity
            style={s.close}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={ICON} color={colors.ink2} />
          </TouchableOpacity>
        </View>

        <View style={s.rows}>
          {rows.map((row) => (
            <TouchableOpacity
              key={row.kind}
              style={s.row}
              onPress={() => onRow(row)}
              testID={`create-kind-${row.kind}`}
              accessibilityRole="button"
              accessibilityLabel={`${row.title} — ${row.subtitle.toLowerCase()}`}
            >
              <Ionicons
                name={row.icon}
                size={ICON}
                color={colors.ink2}
                testID={`create-icon-${row.kind}`}
              />
              <View style={s.rowText}>
                <Text style={s.rowTitle}>{row.title}</Text>
                <Text style={s.rowSub} numberOfLines={2}>{row.subtitle}</Text>
              </View>
              <Ionicons name="chevron-forward" size={ICON} color={colors.ink3} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={s.lines}>
          {lines.map((line) => (
            <View
              key={line.key}
              style={s.line}
              testID={`create-line-${line.key}`}
              accessible
              accessibilityRole="text"
              accessibilityLabel={line.text}
            >
              <Ionicons
                name={line.icon}
                size={ICON}
                color={colors.ink2}
                testID={`create-icon-${line.key}`}
              />
              <Text style={s.lineText}>{line.text}</Text>
            </View>
          ))}
        </View>
      </Animated.View>
    </Modal>
  );
}

interface Props {
  visible: boolean;
  userId: string | null;
  onClose: () => void;
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  scrim: { flex: 1, backgroundColor: scrim(0.5) },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: RADII.sheet,
    borderTopRightRadius: RADII.sheet,
    paddingHorizontal: MARGIN,
    paddingTop: SPACE[1],
    paddingBottom: SPACE[6],
    gap: SPACE[3],
  },
  grabber: {
    alignSelf: 'center',
    width: SPACE[6], height: SPACE[0], borderRadius: RADII.pill,
    backgroundColor: colors.control,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACE[2] },
  title: { ...TYPE.title, color: colors.ink, flex: 1 },
  close: {
    minWidth: TAB_MIN_TOUCH, minHeight: TAB_MIN_TOUCH,
    borderRadius: RADII.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  rows: { gap: SPACE[1] },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[3],
    minHeight: POST_ROW_MIN, paddingHorizontal: MARGIN, paddingVertical: SPACE[2],
    borderRadius: RADII.md, backgroundColor: colors.raised,
  },
  rowText: { flex: 1, gap: SPACE[0] / 2 },
  rowTitle: { ...emphasized('label'), color: colors.ink },
  rowSub: { ...TYPE.body, color: colors.ink2 },
  lines: { gap: SPACE[3], paddingHorizontal: SPACE[0] },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE[3] },
  lineText: { ...TYPE.body, color: colors.ink2, flex: 1 },
});
