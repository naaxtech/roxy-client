// apps/mobile/app/(tabs)/profile/[userId].tsx
import { useEffect, useState } from 'react';
import { StyleSheet, ActivityIndicator, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../lib/supabase';
import { ProfileCard } from '../../../components/profile/ProfileCard';
import { logError } from '../../../lib/errorLogger';
import { useAuthStore } from '../../../store/authStore';
import { useFriendStore } from '../../../store/friendStore';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { showAlert } from '../../../lib/confirm';
import type { Profile, UserBadgeProgress, Badge } from '../../../types';

type EarnedBadge = UserBadgeProgress & { badges: Badge | null };
type FriendshipState = 'none' | 'sent' | 'received' | 'friends';

export default function UserProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const { friends, pendingReceived, pendingSent, sendRequest, acceptRequest } = useFriendStore();
  const colors = useThemeColors();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [badges, setBadges] = useState<EarnedBadge[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    notFound: { color: colors.textMuted, textAlign: 'center', marginTop: 60, fontSize: 16 },
  });

  useEffect(() => {
    if (!userId) return;
    Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase.from('user_badge_progress').select('*, badges(*)').eq('user_id', userId),
    ])
      .then(([profileRes, badgesRes]) => {
        if (profileRes.error || !profileRes.data) {
          setNotFound(true);
        } else {
          setProfile(profileRes.data as Profile);
          // The badge query is already scoped to the profile being viewed, so
          // it needs no change now that 086 lets one member read another's
          // earned badges. What it did need was a voice: a PostgREST failure
          // here returns { data: null, error } without throwing, so it never
          // reached the .catch below and an empty strip was indistinguishable
          // from "she has no badges" -- which is most of why the RLS bug this
          // screen was built on top of went unnoticed for so long.
          if (badgesRes.error) {
            logError(badgesRes.error, 'userProfile_fetchBadges');
          } else if (badgesRes.data) {
            setBadges(badgesRes.data as EarnedBadge[]);
          }
        }
      })
      .catch((e) => { logError(e, 'userProfile_fetch'); setNotFound(true); })
      .finally(() => setLoading(false));
  }, [userId]);

  const getFriendshipState = (): FriendshipState => {
    if (!userId) return 'none';
    if (friends.some((f) => f.profile.id === userId)) return 'friends';
    if (pendingSent.some((f) => f.profile.id === userId)) return 'sent';
    if (pendingReceived.some((f) => f.profile.id === userId)) return 'received';
    return 'none';
  };

  const handleAddFriend = async () => {
    if (!userId) return;
    try { await sendRequest(userId); }
    catch (e: any) { logError(e, 'userProfile_addFriend'); showAlert('Error', e?.message); }
  };

  const handleAcceptFriend = async () => {
    const row = pendingReceived.find((f) => f.profile.id === userId);
    if (!row) return;
    try { await acceptRequest(row.id); }
    catch (e: any) { logError(e, 'userProfile_acceptFriend'); showAlert('Error', e?.message); }
  };

  const handleMessage = async () => {
    if (!user || !userId) return;
    // Look for existing DM conversation, or create one
    const { data: existing } = await supabase
      .from('conversations')
      .select('id')
      .eq('conversation_type', 'direct')
      .contains('participant_ids', [user.id, userId])
      .maybeSingle();

    if (existing?.id) {
      router.push(`/chat/${existing.id}` as any);
      return;
    }

    const { data: created, error } = await supabase
      .from('conversations')
      .insert({ participant_ids: [user.id, userId], conversation_type: 'direct' })
      .select('id')
      .single();

    if (error || !created) { showAlert('Error', 'Could not open chat.'); return; }
    router.push(`/chat/${created.id}` as any);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.roxy} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  if (notFound || !profile) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.notFound}>Profile not found</Text>
      </SafeAreaView>
    );
  }

  const friendshipState = getFriendshipState();

  return (
    <SafeAreaView style={styles.container}>
      <ProfileCard
        profile={profile}
        badges={badges}
        isOwn={false}
        onBack={() => router.back()}
        friendshipState={friendshipState}
        onAddFriend={friendshipState === 'none' ? handleAddFriend : undefined}
        onAcceptFriend={friendshipState === 'received' ? handleAcceptFriend : undefined}
        onMessage={handleMessage}
      />
    </SafeAreaView>
  );
}
