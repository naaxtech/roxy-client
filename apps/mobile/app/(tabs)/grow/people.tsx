import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../../store/authStore';
import { useFriendStore, FriendshipRow, isOnline, sortByPresence } from '../../../store/friendStore';
import { supabase } from '../../../lib/supabase';
import { logError } from '../../../lib/errorLogger';
import { Analytics } from '../../../lib/analytics';
import { useThemeColors } from '../../../hooks/useThemeColors';

const PERSON_GRADS: [string, string][] = [
  ['#FF6A2E', '#E81C8E'], ['#8B5CF6', '#E879A6'], ['#FF2F71', '#8B5CF6'],
  ['#F472B6', '#FF6A2E'], ['#C4476A', '#8B5CF6'], ['#FF8A3D', '#FF2F71'],
];
function personGrad(name: string): [string, string] {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return PERSON_GRADS[Math.abs(h) % PERSON_GRADS.length];
}

type SubTab = 'friends' | 'requests' | 'sent';

export default function PeopleScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { user } = useAuthStore();
  const {
    friends, pendingReceived, pendingSent,
    fetchAll, acceptRequest, rejectRequest, cancelRequest, unfriend,
  } = useFriendStore();
  const [subTab, setSubTab] = useState<SubTab>('friends');
  const [loading, setLoading] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!user) return;
    setLoading(true);
    fetchAll(user.id).finally(() => setLoading(false));
  }, [user?.id]);

  const handleFriendTap = async (item: FriendshipRow) => {
    if (!user) return;
    try {
      const { data, error: searchError } = await supabase
        .from('conversations')
        .select('id')
        .contains('participant_ids', [user.id, item.profile.id])
        .eq('conversation_type', 'direct')
        .limit(1)
        .maybeSingle();

      if (searchError) throw searchError;

      if (data) {
        Analytics.dmOpened(data.id);
        router.push(`/chat/${data.id}` as any);
        return;
      }

      const { data: created, error } = await supabase
        .from('conversations')
        .insert({ participant_ids: [user.id, item.profile.id], conversation_type: 'direct' })
        .select('id')
        .single();

      if (error) throw error;
      Analytics.dmCreated();
      router.push(`/chat/${created.id}` as any);
    } catch (e: any) {
      logError(e, 'handleFriendTap');
      Alert.alert('Error', e?.message);
    }
  };

  const confirmUnfriend = (item: FriendshipRow) => {
    Alert.alert('Remove friend', `Remove ${item.profile.display_name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          try { await unfriend(item.id); }
          catch (e: any) { logError(e, 'confirmUnfriend'); Alert.alert('Error', e?.message); }
        },
      },
    ]);
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
    subTabRow: {
      flexDirection: 'row',
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    subTab: {
      flex: 1, paddingVertical: 10, alignItems: 'center',
      borderBottomWidth: 2, borderBottomColor: 'transparent',
    },
    subTabActive: { borderBottomColor: colors.roxy },
    subTabText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
    subTabTextActive: { color: colors.roxy, fontWeight: '700' },
    listContent: { paddingVertical: 4, flexGrow: 1 },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingHorizontal: 16, paddingVertical: 10,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    avatar: {
      width: 38, height: 38, borderRadius: 19,
      alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    },
    avatarText: { color: '#fff', fontWeight: '800', fontSize: 14 },
    avatarWrap: { position: 'relative' },
    onlineDot: {
      position: 'absolute', bottom: 0, right: 0,
      width: 9, height: 9, borderRadius: 5,
      backgroundColor: colors.success,
      borderWidth: 1.5, borderColor: colors.background,
    },
    rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
    rowInfo: { flex: 1 },
    rowName: { color: colors.textPrimary, fontWeight: '600', fontSize: 14 },
    rowSub: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
    actionBtns: { flexDirection: 'row', gap: 8 },
    acceptBtn: {
      backgroundColor: colors.roxy, borderRadius: 16,
      paddingHorizontal: 12, paddingVertical: 6,
    },
    acceptBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
    messageBtn: {
      backgroundColor: colors.roxy, borderRadius: 16,
      paddingHorizontal: 12, paddingVertical: 6,
    },
    messageBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
    mutedBtn: {
      borderWidth: 1, borderColor: colors.textMuted + '60', borderRadius: 16,
      paddingHorizontal: 12, paddingVertical: 6,
    },
    mutedBtnText: { color: colors.textMuted, fontWeight: '600', fontSize: 12 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60, paddingHorizontal: 32 },
    emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  });

  function AvatarCircle({ name }: { name: string }) {
    return (
      <LinearGradient colors={personGrad(name)} style={styles.avatar}>
        <Text style={styles.avatarText}>{name?.[0]?.toUpperCase() ?? '?'}</Text>
      </LinearGradient>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back-outline" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My People</Text>
      </View>

      <View style={styles.subTabRow}>
        {(['friends', 'requests', 'sent'] as SubTab[]).map((tab) => {
          const label: Record<SubTab, string> = {
            friends: 'Friends',
            requests: `Requests${pendingReceived.length > 0 ? ` (${pendingReceived.length})` : ''}`,
            sent: 'Sent',
          };
          return (
            <TouchableOpacity
              key={tab}
              style={[styles.subTab, subTab === tab && styles.subTabActive]}
              onPress={() => setSubTab(tab)}
            >
              <Text style={[styles.subTabText, subTab === tab && styles.subTabTextActive]}>
                {label[tab]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.roxy} style={{ marginTop: 40 }} />
      ) : (
        <>
          {subTab === 'friends' && (
            <FlatList
              data={sortByPresence(friends)}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>No friends yet. Find people in communities! 💜</Text>
                </View>
              }
              renderItem={({ item }) => (
                <View style={styles.row}>
                  <TouchableOpacity
                    style={styles.avatarWrap}
                    onPress={() => router.push(`/user/${item.profile.id}` as any)}
                  >
                    <AvatarCircle name={item.profile.display_name} />
                    {isOnline(item.profile.last_seen_at) && <View style={styles.onlineDot} />}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.rowInfo}
                    onPress={() => router.push(`/user/${item.profile.id}` as any)}
                  >
                    <Text style={styles.rowName}>{item.profile.display_name}</Text>
                    <Text style={styles.rowSub}>@{item.profile.username}</Text>
                  </TouchableOpacity>
                  <View style={styles.actionBtns}>
                    <TouchableOpacity style={styles.messageBtn} onPress={() => handleFriendTap(item)}>
                      <Text style={styles.messageBtnText}>Message</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.mutedBtn} onPress={() => confirmUnfriend(item)}>
                      <Text style={styles.mutedBtnText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            />
          )}

          {subTab === 'requests' && (
            <FlatList
              data={pendingReceived}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>No pending requests</Text>
                </View>
              }
              renderItem={({ item }) => (
                <View style={styles.row}>
                  <TouchableOpacity
                    style={styles.rowLeft}
                    onPress={() => router.push(`/user/${item.profile.id}` as any)}
                    activeOpacity={0.7}
                  >
                    <AvatarCircle name={item.profile.display_name} />
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowName}>{item.profile.display_name}</Text>
                      <Text style={styles.rowSub}>@{item.profile.username}</Text>
                    </View>
                  </TouchableOpacity>
                  <View style={styles.actionBtns}>
                    <TouchableOpacity
                      style={styles.acceptBtn}
                      onPress={async () => {
                        try { await acceptRequest(item.id); }
                        catch (e: any) { logError(e, 'acceptRequest'); Alert.alert('Error', e?.message); }
                      }}
                    >
                      <Text style={styles.acceptBtnText}>Accept</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.mutedBtn}
                      onPress={async () => {
                        try { await rejectRequest(item.id); }
                        catch (e: any) { logError(e, 'rejectRequest'); Alert.alert('Error', e?.message); }
                      }}
                    >
                      <Text style={styles.mutedBtnText}>Decline</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            />
          )}

          {subTab === 'sent' && (
            <FlatList
              data={pendingSent}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>No sent requests</Text>
                </View>
              }
              renderItem={({ item }) => (
                <View style={styles.row}>
                  <TouchableOpacity
                    style={styles.rowLeft}
                    onPress={() => router.push(`/user/${item.profile.id}` as any)}
                    activeOpacity={0.7}
                  >
                    <AvatarCircle name={item.profile.display_name} />
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowName}>{item.profile.display_name}</Text>
                      <Text style={styles.rowSub}>@{item.profile.username}</Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.mutedBtn}
                    onPress={async () => {
                      try { await cancelRequest(item.id); }
                      catch (e: any) { logError(e, 'cancelRequest'); Alert.alert('Error', e?.message); }
                    }}
                  >
                    <Text style={styles.mutedBtnText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              )}
            />
          )}
        </>
      )}
    </SafeAreaView>
  );
}

