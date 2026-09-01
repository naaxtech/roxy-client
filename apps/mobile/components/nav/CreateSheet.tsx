import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Pressable, ScrollView, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/errorLogger';
import { useThemeColors } from '../../hooks/useThemeColors';
import {
  COMMUNITY_CHIP_COLORS, RADII, BRAND_GRADIENT, inkOn, type ThemeColors,
} from '../../lib/theme';
import { TYPE } from '../../lib/typography';
import { deriveSellerStatus, canSell, type SellerStatus } from '../../lib/sellerStatus';
import { TAB_MIN_TOUCH } from './navTokens';
import { a11yState } from '../../lib/a11yState';

type MemberRow = { community_id: string; communities: { id: string; name: string } | null };
type Room = { id: string; name: string };
type Status = 'loading' | 'ready' | 'error';
type Step = 'kind' | 'room';

type CreateKind = 'post' | 'event' | 'room' | 'product' | 'game';

type KindRow = {
  kind: CreateKind;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  /** Why it is unavailable, or null when it is. Rendered as the row's subtitle. */
  blockedReason: string | null;
  subtitle: string;
};

/**
 * The ＋ slot.
 *
 * The prototype offers five things to make: Post, Event, Room, Product and Game.
 * Exactly one of them has a composer in this app — `/community/create-post`.
 * Events, rooms, products and games are created by hosts in **Roxy Studio**,
 * which is a separate deployment.
 *
 * So four of these five rows are drawn and disabled, with the real reason on the
 * row. That is deliberate. The alternative — showing five identical buttons and
 * having four of them open a toast that says "coming soon" — teaches a woman
 * that the ＋ button lies, and she stops pressing it. A row that tells her where
 * the thing actually happens is worth more than a row that pretends.
 *
 * Product is the interesting one: it is gated on seller approval rather than on
 * platform, so its reason changes as she moves through the pipeline, and the day
 * a product composer ships it only has to become reachable — the gate is already
 * correct. See `lib/sellerStatus.ts`.
 */
export function CreateSheet({ visible, userId, onClose }: Props) {
  const colors = useThemeColors();
  const router = useRouter();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [seller, setSeller] = useState<SellerStatus>('none');
  const [step, setStep] = useState<Step>('kind');

  const load = useCallback(async () => {
    if (!userId) return;
    setStatus('loading');

    const [memberRes, bizRes] = await Promise.all([
      supabase
        .from('community_members')
        .select('community_id, communities(id, name)')
        .eq('user_id', userId),
      supabase
        .from('businesses')
        .select('is_verified, can_sell, stripe_account_id')
        .eq('owner_id', userId),
    ]);

    // State first, logging second — always in that order. Telemetry is allowed
    // to fail; the error state a woman is looking at is not. Logging first meant
    // a throw inside the logger left the sheet spinning on "Finding your rooms…"
    // forever, which is the one outcome worse than the error itself.
    if (memberRes.error || !memberRes.data) {
      setStatus('error');
      logError(memberRes.error ?? new Error('no membership rows'), 'CreateSheet.load');
      return;
    }

    // A failed seller lookup must not block posting, and must never read as
    // "approved" — an unknown answer is 'none'. Fail closed.
    setSeller(deriveSellerStatus(bizRes.error ? [] : bizRes.data));
    if (bizRes.error) logError(bizRes.error, 'CreateSheet.sellerStatus');

    setRooms(
      (memberRes.data as unknown as MemberRow[])
        .map((row) => (row.communities ? { id: row.communities.id, name: row.communities.name } : null))
        .filter((r): r is Room => r !== null)
    );
    setStatus('ready');
  }, [userId]);

  useEffect(() => {
    if (!visible) return;
    setStep('kind');
    void load();
  }, [visible, load]);

  const s = styles(colors);

  // No communityId means the post lands on her profile. The composer reads the
  // absent param as a profile destination (lib/postComposer).
  const openComposer = (communityId?: string) => {
    onClose();
    router.push(
      communityId
        ? { pathname: '/community/create-post', params: { communityId } }
        : { pathname: '/community/create-post' }
    );
  };

  const productReason = canSell(seller)
    ? null
    : seller === 'review'
      ? 'Your seller application is in review — we will let you know.'
      : 'Approved sellers only. Apply from You › Sell on Roxy.';

  const KINDS: KindRow[] = [
    {
      kind: 'post',
      icon: 'flower-outline',
      title: 'Post',
      subtitle: 'Video, photos or a text card for the feed',
      // Never blocked. A post lands on her own profile unless she chooses a
      // community, so there is no longer a state where she has nowhere to post.
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
      subtitle: 'Host a deck or trivia night in your community',
      blockedReason: 'Game submissions go through Roxy Studio.',
    },
  ];

  const onKind = (row: KindRow) => {
    if (row.blockedReason) return;
    if (row.kind === 'post') {
      // No communities means no question worth asking — it goes on her profile.
      if (rooms.length === 0) { openComposer(); return; }
      setStep('room');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Dismiss" />
      <View style={s.sheet} testID="create-sheet">
        <View style={s.grabber} />

        <View style={s.header}>
          {step === 'room' ? (
            <TouchableOpacity
              style={s.close}
              onPress={() => setStep('kind')}
              testID="create-sheet-back"
              accessibilityRole="button"
              accessibilityLabel="Back"
              activeOpacity={0.75}
            >
              <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
          <View style={s.headerText}>
            <Text style={s.title}>{step === 'kind' ? 'Create' : 'Where does this go?'}</Text>
            <Text style={s.subtitle}>
              {step === 'kind'
                ? 'What are you making?'
                : 'Your profile, or one of your communities.'}
            </Text>
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

        {status === 'loading' && (
          <View style={s.state} testID="create-sheet-loading">
            <ActivityIndicator color={colors.roxy} />
            <Text style={s.stateText}>Finding your rooms…</Text>
          </View>
        )}

        {status === 'error' && (
          <View style={s.state}>
            <Text style={s.stateText}>We could not load your rooms.</Text>
            <TouchableOpacity
              style={s.stateCta}
              onPress={() => void load()}
              testID="create-sheet-retry"
              accessibilityRole="button"
              accessibilityLabel="Try again"
              activeOpacity={0.8}
            >
              <Text style={s.stateCtaText}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}

        {status === 'ready' && step === 'kind' && (
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
                    <Ionicons name={row.icon} size={19} color={inkOn(BRAND_GRADIENT[1])} />
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
        )}

        {/* The "you are not in a room yet" empty state was removed with the
            community requirement. It is unreachable now — with no communities
            the Post row goes straight to the profile composer and never sets
            this step — and an unreachable branch that still says a post needs a
            room to land in would outlive the rule it described. */}

        {status === 'ready' && step === 'room' && rooms.length > 0 && (
          <ScrollView style={s.list} contentContainerStyle={s.listContent}>
            {/* Her own wall, first and always. A post no longer needs a
                community to live in, and listing only communities here would
                say the opposite of what the app now does. */}
            <TouchableOpacity
              style={s.row}
              onPress={() => openComposer()}
              testID="create-sheet-profile"
              accessibilityRole="button"
              accessibilityLabel="Post to your profile"
              activeOpacity={0.8}
            >
              <View style={[s.crest, { backgroundColor: colors.roxy }]}>
                <Ionicons name="person" size={16} color={inkOn(colors.roxy)} />
              </View>
              <Text style={s.roomName} numberOfLines={1}>Your profile</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            {rooms.map((room, idx) => {
              const crest = COMMUNITY_CHIP_COLORS[idx % COMMUNITY_CHIP_COLORS.length];
              return (
                <TouchableOpacity
                  key={room.id}
                  style={s.row}
                  onPress={() => openComposer(room.id)}
                  testID={`create-sheet-room-${room.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Post to ${room.name}`}
                  activeOpacity={0.8}
                >
                  <View style={[s.crest, { backgroundColor: crest }]}>
                    <Text style={[s.crestText, { color: inkOn(crest) }]}>
                      {room.name[0]?.toUpperCase() ?? '?'}
                    </Text>
                  </View>
                  <Text style={s.roomName} numberOfLines={1}>{room.name}</Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
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
  state: { paddingVertical: 28, alignItems: 'center', gap: 14 },
  stateText: { color: colors.textSecondary, textAlign: 'center', ...TYPE.bodyLg },
  stateCta: {
    minHeight: TAB_MIN_TOUCH, justifyContent: 'center',
    paddingHorizontal: 22, borderRadius: RADII.pill,
    borderWidth: 1.5, borderColor: colors.roxy,
  },
  stateCtaText: { color: colors.roxy, fontWeight: '800', ...TYPE.bodyLg },
  list: { marginTop: 10, maxHeight: 380 },
  listContent: { gap: 6, paddingBottom: 4 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    minHeight: 60, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: RADII.lg, backgroundColor: colors.surfaceLight,
  },
  // Dimming the plate, not the text: the reason a row is unavailable is the most
  // useful sentence on it, so it stays at full contrast.
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
  crest: {
    width: 36, height: 36, borderRadius: RADII.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  crestText: { fontWeight: '800', ...TYPE.bodyLg },
  roomName: { flex: 1, color: colors.textPrimary, fontWeight: '700', ...TYPE.bodyLg },
});
