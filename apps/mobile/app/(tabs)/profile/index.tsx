// apps/mobile/app/(tabs)/profile/index.tsx
import { useEffect, useState } from 'react';
import { StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../../store/authStore';
import { useProfileStore } from '../../../store/profileStore';
import { useBuildStore } from '../../../store/buildStore';
import { supabase } from '../../../lib/supabase';
import { COLORS } from '../../../lib/constants';
import { ProfileCard } from '../../../components/profile/ProfileCard';
import { BusinessDetailSheet } from '../../../components/build/BusinessDetailSheet';
import { logError } from '../../../lib/errorLogger';
import type { UserBadgeProgress, Badge, Business, BusinessPhoto } from '../../../types';

type EarnedBadge = UserBadgeProgress & { badges: Badge | null };

export default function ProfileScreen() {
  const { user } = useAuthStore();
  const { profile } = useProfileStore();
  const { bookmarkedBusinessIds, loadBookmarks, toggleBookmark } = useBuildStore();
  const router = useRouter();

  const [badges, setBadges] = useState<EarnedBadge[]>([]);
  const [savedBusinesses, setSavedBusinesses] = useState<Business[]>([]);
  const [selectedBiz, setSelectedBiz] = useState<Business | null>(null);
  const [bizPhotos, setBizPhotos] = useState<BusinessPhoto[]>([]);

  useEffect(() => {
    if (!user?.id) return;
    void (async () => {
      try {
        const { data } = await supabase
          .from('user_badge_progress')
          .select('*, badges(*)')
          .eq('user_id', user.id);
        if (data) setBadges(data as EarnedBadge[]);
      } catch (e: any) {
        logError(e, 'profileScreen_fetchBadges');
      }
    })();

    void loadBookmarks(user.id);
  }, [user?.id, loadBookmarks]);

  // Fetch saved business details whenever bookmarked IDs change
  useEffect(() => {
    const ids = [...bookmarkedBusinessIds];
    if (ids.length === 0) { setSavedBusinesses([]); return; }
    void (async () => {
      try {
        const { data } = await supabase
          .from('businesses')
          .select('*')
          .in('id', ids);
        if (data) setSavedBusinesses(data as Business[]);
      } catch (e: any) {
        logError(e, 'profileScreen_fetchSavedBusinesses');
      }
    })();
  }, [bookmarkedBusinessIds]);

  const handleOpenBiz = async (biz: Business) => {
    setSelectedBiz(biz);
    const { data } = await supabase
      .from('business_photos')
      .select('*')
      .eq('business_id', biz.id)
      .order('sort_order');
    setBizPhotos((data as BusinessPhoto[]) ?? []);
  };

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
        savedBusinesses={savedBusinesses}
        onOpenBusiness={handleOpenBiz}
        onEdit={() => router.push('/(tabs)/profile/edit' as any)}
        onSettings={() => router.push('/(tabs)/profile/settings' as any)}
      />
      <BusinessDetailSheet
        business={selectedBiz}
        photos={bizPhotos}
        isBookmarked={selectedBiz ? bookmarkedBusinessIds.has(selectedBiz.id) : false}
        onBookmarkToggle={() =>
          selectedBiz && user?.id && toggleBookmark(selectedBiz.id, user.id)
        }
        onClose={() => { setSelectedBiz(null); setBizPhotos([]); }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
});
