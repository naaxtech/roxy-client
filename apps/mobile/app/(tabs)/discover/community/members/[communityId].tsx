import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../../../lib/supabase';
import { useAuthStore } from '../../../../../store/authStore';
import { useFriendStore } from '../../../../../store/friendStore';
import { useThemeColors } from '../../../../../hooks/useThemeColors';
import { logError } from '../../../../../lib/errorLogger';
import { showAlert, confirmAction } from '../../../../../lib/confirm';
import { fetchMyChannelRole } from '../../../../../lib/channels';
import {
  canModerateMember, fetchElevatedRoles, fetchJoinRequests, removeCommunityMember, respondJoinRequest,
  fetchCommunityBans, unbanCommunityMember,
  type JoinRequest, type CommunityBan,
} from '../../../../../lib/communityMembership';
import { MIN_TOUCH_TARGET } from '../../../../../lib/touchTargets';

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
  // CHAT-09 moderator tools. Hints for what to draw; the RPCs are the gate.
  const [isModerator, setIsModerator] = useState(false);
  const [roles, setRoles] = useState<Map<string, string>>(new Map());
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  // Who is banned here, so a ban can be lifted (the ban copy promises it can).
  const [bans, setBans] = useState<CommunityBan[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const loadModeration = useCallback(async () => {
    if (!communityId || !user?.id) return;
    try {
      const { isModerator: mod } = await fetchMyChannelRole(communityId, user.id);
      setIsModerator(mod);
      if (!mod) return;
      const [r, q, b] = await Promise.all([
        fetchElevatedRoles(communityId), fetchJoinRequests(communityId), fetchCommunityBans(communityId),
      ]);
      setRoles(r);
      setRequests(q);
      setBans(b);
    } catch (e) {
      logError(e, 'members_moderation_load');
    }
  }, [communityId, user?.id]);

  const answerRequest = async (req: JoinRequest, approve: boolean) => {
    if (!communityId || busy) return;
    setBusy(`req-${req.user_id}`);
    try {
      await respondJoinRequest(communityId, req.user_id, approve);
      setRequests((prev) => prev.filter((x) => x.user_id !== req.user_id));
      if (approve) await loadMembers();
    } catch (e) {
      logError(e, 'members_join_request');
      showAlert('Not done', e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const moderate = async (member: MemberProfile, ban: boolean) => {
    if (!communityId || busy) return;
    const name = member.display_name || member.username || 'this member';
    const yes = await confirmAction(
      ban ? `Ban ${name}?` : `Remove ${name}?`,
      ban
        ? `${name} leaves this community and can't rejoin, ask to join or be invited back until a moderator lifts the ban.`
        : `${name} leaves this community. She can join again later.`,
      ban ? 'Ban' : 'Remove',
    );
    if (!yes) return;
    setBusy(`mod-${member.id}`);
    try {
      await removeCommunityMember(communityId, member.id, { ban });
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
      if (ban) {
        setBans((prev) => [{
          user_id: member.id, reason: null, created_at: new Date().toISOString(), expires_at: null,
          profile: { id: member.id, display_name: member.display_name, username: member.username, avatar_url: member.avatar_url },
        }, ...prev.filter((x) => x.user_id !== member.id)]);
      }
    } catch (e) {
      logError(e, 'members_moderate');
      showAlert('Not done', e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const liftBan = async (ban: CommunityBan) => {
    if (!communityId || busy) return;
    const name = ban.profile?.display_name || ban.profile?.username || 'this member';
    const yes = await confirmAction(
      `Lift the ban on ${name}?`,
      `${name} can ask to join, be invited or join again. She is not added back by this.`,
      'Lift ban',
    );
    if (!yes) return;
    setBusy(`ban-${ban.user_id}`);
    try {
      await unbanCommunityMember(communityId, ban.user_id);
      setBans((prev) => prev.filter((x) => x.user_id !== ban.user_id));
    } catch (e) {
      logError(e, 'members_unban');
      showAlert('Not done', e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(null);
    }
  };

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
      void loadModeration();
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
      showAlert('Error', e?.message);
    }
  };

  const handleAccept = async (memberId: string) => {
    const friendshipId = receivedMap.get(memberId);
    if (!friendshipId) return;
    try {
      await acceptRequest(friendshipId);
    } catch (e: any) {
      logError(e, 'handleAccept');
      showAlert('Error', e?.message);
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
    section: {
      color: colors.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1.2,
      textTransform: 'uppercase', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6,
    },
    reqNote: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
    modBtn: { minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
    liftBtn: {
      minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: 12,
      borderWidth: 1, borderColor: colors.textMuted + '60', borderRadius: 16,
    },
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
        ListHeaderComponent={
          isModerator && requests.length > 0 ? (
            <View testID="join-requests">
              <Text style={styles.section}>Asking to join · {requests.length}</Text>
              {requests.map((req) => {
                const name = req.profile?.display_name || req.profile?.username || 'Someone';
                const off = busy === `req-${req.user_id}`;
                return (
                  <View key={req.user_id} style={styles.row} testID={`join-request-${req.user_id}`}>
                    <TouchableOpacity
                      style={styles.rowLeft}
                      onPress={() => router.push(`/user/${req.user_id}` as any)}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${name}'s profile`}
                    >
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>{name[0]?.toUpperCase() ?? '?'}</Text>
                      </View>
                      <View style={styles.rowInfo}>
                        <Text style={styles.rowName}>{name}</Text>
                        {req.note ? <Text style={styles.reqNote} numberOfLines={2}>{req.note}</Text> : null}
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.modBtn}
                      onPress={() => void answerRequest(req, false)}
                      disabled={off}
                      accessibilityRole="button"
                      accessibilityLabel={`Say no to ${name}`}
                    >
                      <Ionicons name="close-circle-outline" size={24} color={colors.textMuted} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.modBtn}
                      onPress={() => void answerRequest(req, true)}
                      disabled={off}
                      accessibilityRole="button"
                      accessibilityLabel={`Let ${name} in`}
                    >
                      <Ionicons name="checkmark-circle" size={26} color={colors.roxy} />
                    </TouchableOpacity>
                  </View>
                );
              })}
              <Text style={styles.section}>Members</Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          isModerator && bans.length > 0 ? (
            <View testID="community-bans">
              <Text style={styles.section}>Banned · {bans.length}</Text>
              {bans.map((ban) => {
                const name = ban.profile?.display_name || ban.profile?.username || 'Someone';
                return (
                  <View key={ban.user_id} style={styles.row} testID={`banned-${ban.user_id}`}>
                    <View style={styles.rowLeft}>
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>{name[0]?.toUpperCase() ?? '?'}</Text>
                      </View>
                      <View style={styles.rowInfo}>
                        <Text style={styles.rowName}>{name}</Text>
                        {ban.reason ? <Text style={styles.reqNote} numberOfLines={2}>{ban.reason}</Text> : null}
                      </View>
                    </View>
                    <TouchableOpacity
                      style={styles.liftBtn}
                      onPress={() => void liftBan(ban)}
                      disabled={!!busy}
                      accessibilityRole="button"
                      accessibilityLabel={`Lift the ban on ${name}`}
                    >
                      <Text style={styles.requestedText}>Lift ban</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No members yet</Text>
          </View>
        }
        renderItem={({ item }) => {
          const isSelf = item.id === user?.id;
          const state = isSelf ? 'self' : getFriendshipState(item.id);
          const name = item.display_name || item.username || 'this member';
          const canMod = isModerator && !isSelf
            && canModerateMember(roles.get(user?.id ?? '') ?? 'moderator', roles.get(item.id) ?? 'member');
          return (
            <View style={styles.row} testID={`member-${item.id}`}>
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
              {canMod ? (
                <>
                  <TouchableOpacity
                    style={styles.modBtn}
                    onPress={() => void moderate(item, false)}
                    disabled={!!busy}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${name} from the community`}
                  >
                    <Ionicons name="person-remove-outline" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.modBtn}
                    onPress={() => void moderate(item, true)}
                    disabled={!!busy}
                    accessibilityRole="button"
                    accessibilityLabel={`Ban ${name}`}
                  >
                    <Ionicons name="ban-outline" size={18} color={colors.error} />
                  </TouchableOpacity>
                </>
              ) : null}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

