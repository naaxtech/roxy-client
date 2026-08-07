import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Pressable, ScrollView, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useThemeColors } from '../../hooks/useThemeColors';
import { COMMUNITY_CHIP_COLORS, type ThemeColors } from '../../lib/theme';
import { TAB_MIN_TOUCH } from './navTokens';

type MemberRow = { community_id: string; communities: { id: string; name: string } | null };
type Room = { id: string; name: string };
type Status = 'loading' | 'ready' | 'error';

interface Props {
  visible: boolean;
  userId: string | null;
  onClose: () => void;
}

/**
 * The ⊕ slot's destination.
 *
 * The composer at `/community/create-post` has always required a `communityId`
 * — without one it renders a form whose submit silently returns. So the create
 * slot cannot be a bare `router.push`; something has to ask which room the post
 * belongs to. This sheet is that question and nothing more: it opens the route
 * that already exists, and it invents no screen of its own.
 *
 * Asking it out loud is also the honest product answer. On Roxy a post is
 * always addressed to a room, and a woman who is in four of them is choosing an
 * audience, not filling in a field.
 */
export function CreateSheet({ visible, userId, onClose }: Props) {
  const colors = useThemeColors();
  const router = useRouter();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [status, setStatus] = useState<Status>('loading');

  const load = useCallback(async () => {
    if (!userId) return;
    setStatus('loading');
    const { data, error } = await supabase
      .from('community_members')
      .select('community_id, communities(id, name)')
      .eq('user_id', userId);

    if (error || !data) {
      setStatus('error');
      return;
    }
    setRooms(
      (data as unknown as MemberRow[])
        .map((row) => (row.communities ? { id: row.communities.id, name: row.communities.name } : null))
        .filter((r): r is Room => r !== null)
    );
    setStatus('ready');
  }, [userId]);

  useEffect(() => {
    if (!visible) return;
    void load();
  }, [visible, load]);

  const s = styles(colors);

  const openComposer = (communityId: string) => {
    onClose();
    router.push({ pathname: '/community/create-post', params: { communityId } });
  };

  const findRooms = () => {
    onClose();
    router.push('/(tabs)/connect?tab=communities');
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Dismiss" />
      <View style={s.sheet} testID="create-sheet">
        <View style={s.grabber} />

        <View style={s.header}>
          <View style={s.headerText}>
            <Text style={s.title}>Post to a room</Text>
            <Text style={s.subtitle}>Everything on Roxy lands somewhere. Pick where this goes.</Text>
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

        {status === 'ready' && rooms.length === 0 && (
          <View style={s.state}>
            <Text style={s.stateText}>You are not in a room yet — a post needs one to land in.</Text>
            <TouchableOpacity
              style={s.stateCta}
              onPress={findRooms}
              testID="create-sheet-empty-cta"
              accessibilityRole="button"
              accessibilityLabel="Find rooms"
              activeOpacity={0.8}
            >
              <Text style={s.stateCtaText}>Find rooms</Text>
            </TouchableOpacity>
          </View>
        )}

        {status === 'ready' && rooms.length > 0 && (
          <ScrollView style={s.list} contentContainerStyle={s.listContent}>
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
                    <Text style={[s.crestText, { color: '#fff' }]}>
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

const styles = (colors: ThemeColors) => StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 28,
    gap: 4,
  },
  grabber: {
    alignSelf: 'center',
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.textMuted + '55',
    marginBottom: 12,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headerText: { flex: 1, gap: 3 },
  title: { color: colors.textPrimary, fontSize: 19, fontWeight: '800', letterSpacing: -0.3 },
  subtitle: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  close: {
    minWidth: TAB_MIN_TOUCH, minHeight: TAB_MIN_TOUCH,
    borderRadius: 22, backgroundColor: colors.surfaceLight,
    alignItems: 'center', justifyContent: 'center',
  },
  state: { paddingVertical: 28, alignItems: 'center', gap: 14 },
  stateText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  stateCta: {
    minHeight: TAB_MIN_TOUCH, justifyContent: 'center',
    paddingHorizontal: 22, borderRadius: 999,
    borderWidth: 1.5, borderColor: colors.roxy,
  },
  stateCtaText: { color: colors.roxy, fontSize: 14, fontWeight: '800' },
  list: { marginTop: 10, maxHeight: 320 },
  listContent: { gap: 6, paddingBottom: 4 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    minHeight: 56, paddingHorizontal: 12,
    borderRadius: 16, backgroundColor: colors.surfaceLight,
  },
  crest: {
    width: 36, height: 36, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  crestText: { fontSize: 16, fontWeight: '800' },
  roomName: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
});
