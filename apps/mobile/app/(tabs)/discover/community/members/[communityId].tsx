import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../../../lib/supabase';
import { useAuthStore } from '../../../../../store/authStore';
import { useFriendStore } from '../../../../../store/friendStore';
import { useThemeColors } from '../../../../../hooks/useThemeColors';
import { logError } from '../../../../../lib/errorLogger';

type MemberProfile = {
  id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
};

type FriendshipState = 'none' | 'sent' | 'received' | 'friends';

export default function MembersScreen() {
  const colors = useThemeColors();
  const { communityId } = useLocalSearchParams<{ communityId: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const { friends, pendingReceived, pendingSent, sendRequest, acceptRequest, fetchAll } = useFriendStore();

  const [members, setMembers] = useState<MemberProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [justSent, setJustSent] = useState<Set<string>>(new Set());

  const loadMembers = useCallback(async () => {
    if (!communityId) return;
    const { data } = await supabase
      .from('community_members')
      .select('profiles(id, display_name, username, avatar_url)')
      .eq('community_id', communityId)
      .limit(100);
    if (data) {
      setMembers((data as any[]).map((r) => r.profiles).filter(Boolean) as MemberProfile[]);
    }
  }, [communityId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    (async () => {
      await loadMembers();
      if (user?.id) await fetchAll(user.id);
      setLoading(false);
    })();
  }, [communityId]);

  const friendIds = new Set(friends.map((f) => f.profile.id));
  const receivedMap = new Map(pendingReceived.map((f) => [f.profile.id, f.id]));
  const sentIds = new Set([...pendingSent.map((f) => f.profile.id), ...justSent]);

  const getFriendshipState = (memberId: string): FriendshipState => {
    if (friendIds.has(memberId)) return 'friends';
    if (receivedMap.has(memberId)) return 'received';
    if (sentIds.has(memberId)) return 'sent';
    return 'none';
  };

  const handleAddFriend = async (memberId: string) => {
    try {
      await sendRequest(memberId);
      setJustSent((prev) => new Set([...prev, memberId]));
    } catch (e: any) {
      logError(e, 'handleAddFriend');
      Alert.alert('Error', e?.message);
    }
  };

  const handleAccept = async (memberId: string) => {
    const friendshipId = receivedMap.get(memberId);
    if (!friendshipId) return;
    try {
      await acceptRequest(friendshipId);
    } catch (e: any) {
      logError(e, 'handleAccept');
      Alert.alert('Error', e?.message);
    }
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 16, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    backBtn: { padding: 4 },
    headerTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
    listContent: { paddingVertical: 4 },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingHorizontal: 16, paddingVertical: 10,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    avatar: {
      width: 38, height: 38, borderRadius: 19,
      backgroundColor: colors.surfaceLight,
      alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    },
    avatarText: { color: colors.textSecondary, fontWeight: '700', fontSize: 14 },
    rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
    rowInfo: { flex: 1 },
    rowName: { color: colors.textPrimary, fontWeight: '600', fontSize: 14 },
    rowSub: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
    addBtn: {
      borderWidth: 1, borderColor: colors.roxy, borderRadius: 16,
      paddingHorizontal: 12, paddingVertical: 6,
    },
    addBtnText: { color: colors.roxy, fontWeight: '700', fontSize: 12 },
    requestedChip: {
      borderWidth: 1, borderColor: colors.textMuted + '60', borderRadius: 16,
      paddingHorizontal: 12, paddingVertical: 6,
    },
    requestedText: { color: colors.textMuted, fontSize: 12 },
    acceptBtn: {
      backgroundColor: colors.roxy, borderRadius: 16,
      paddingHorizontal: 12, paddingVertical: 6,
    },
    acceptBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
    friendsLabel: { color: colors.roxy, fontSize: 12, fontWeight: '600' },
    empty: { alignItems: 'center', paddingVertical: 60 },
    emptyText: { color: colors.textMuted, fontSize: 14 },
  });

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.roxy} style={{ marginTop: 48 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back-outline" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Members</Text>
      </View>

      <FlatList
        data={members}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No members yet</Text>
          </View>
        }
        renderItem={({ item }) => {
          const isSelf = item.id === user?.id;
          const state = isSelf ? 'self' : getFriendshipState(item.id);
          return (
            <View style={styles.row}>
              <TouchableOpacity
                style={styles.rowLeft}
                onPress={() => !isSelf && router.push(`/user/${item.id}` as any)}
                activeOpacity={isSelf ? 1 : 0.7}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{item.display_name?.[0]?.toUpperCase() ?? '?'}</Text>
                </View>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowName}>{item.display_name}</Text>
                  <Text style={styles.rowSub}>@{item.username}</Text>
                </View>
              </TouchableOpacity>
              {state === 'none' && (
                <TouchableOpacity style={styles.addBtn} onPress={() => handleAddFriend(item.id)}>
                  <Text style={styles.addBtnText}>Add Friend</Text>
                </TouchableOpacity>
              )}
              {state === 'sent' && (
                <View style={styles.requestedChip}>
                  <Text style={styles.requestedText}>Requested</Text>
                </View>
              )}
              {state === 'received' && (
                <TouchableOpacity style={styles.acceptBtn} onPress={() => handleAccept(item.id)}>
                  <Text style={styles.acceptBtnText}>Accept</Text>
                </TouchableOpacity>
              )}
              {state === 'friends' && (
                <Text style={styles.friendsLabel}>Friends 💜</Text>
              )}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

