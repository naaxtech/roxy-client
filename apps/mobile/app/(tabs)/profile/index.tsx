// apps/mobile/app/(tabs)/profile/index.tsx
import { useEffect, useState } from 'react';
import { StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../../store/authStore';
import { useProfileStore } from '../../../store/profileStore';
import { supabase } from '../../../lib/supabase';
import { COLORS } from '../../../lib/constants';
import { ProfileCard } from '../../../components/profile/ProfileCard';
import { logError } from '../../../lib/errorLogger';
import type { UserBadgeProgress, Badge } from '../../../types';

type EarnedBadge = UserBadgeProgress & { badges: Badge | null };

export default function ProfileScreen() {
  const { user } = useAuthStore();
  const { profile } = useProfileStore();
  const router = useRouter();
  const [badges, setBadges] = useState<EarnedBadge[]>([]);

  useEffect(() => {
    if (!user?.id) return;
    void Promise.resolve(
      supabase.from('user_badge_progress').select('*, badges(*)').eq('user_id', user.id)
    ).then(({ data }) => { if (data) setBadges(data as EarnedBadge[]); })
      .catch((e) => logError(e, 'profileScreen_fetchBadges'));
  }, [user?.id]);

  if (!user || !profile) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={COLORS.roxy} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ProfileCard
        profile={profile}
        badges={badges}
        isOwn={true}
        onEdit={() => router.push('/(tabs)/profile/edit' as any)}
        onSettings={() => router.push('/(tabs)/profile/settings' as any)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
});
