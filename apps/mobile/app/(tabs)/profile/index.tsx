// apps/mobile/app/(tabs)/profile/index.tsx
import { useEffect, useState } from 'react';
import { StyleSheet, ActivityIndicator, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../../store/authStore';
import { useProfileStore } from '../../../store/profileStore';
import { useBuildStore } from '../../../store/buildStore';
import { useMarketplaceStore } from '../../../store/marketplaceStore';
import { supabase } from '../../../lib/supabase';
import { ProfileCard } from '../../../components/profile/ProfileCard';
import { ProfilePhotoGrid } from '../../../components/profile/ProfilePhotoGrid';
import { ProfileFavorites } from '../../../components/profile/ProfileFavorites';
import { SavedPosts } from '../../../components/profile/SavedPosts';
import { BusinessDetailSheet } from '../../../components/build/BusinessDetailSheet';
import { OrderDetailSheet } from '../../../components/build/OrderDetailSheet';
import { logError } from '../../../lib/errorLogger';
import { useThemeColors } from '../../../hooks/useThemeColors';
import type { UserBadgeProgress, Badge, Business, BusinessPhoto } from '../../../types';
import type { OrderWithItems } from '../../../types/marketplace';

type EarnedBadge = UserBadgeProgress & { badges: Badge | null };

const STATUS_COLORS: Record<string, string> = {
  paid: '#3B82F6',
  shipped: '#F59E0B',
  delivered: '#10B981',
  refunded: '#EF4444',
  cancelled: '#6B7280',
};

export default function ProfileScreen() {
  const { user } = useAuthStore();
  const { profile } = useProfileStore();
  const { bookmarkedBusinessIds, loadBookmarks, toggleBookmark } = useBuildStore();
  const { orders, loadingOrders, fetchOrders } = useMarketplaceStore();
  const router = useRouter();
  const colors = useThemeColors();

  const [badges, setBadges] = useState<EarnedBadge[]>([]);
  const [badgeLoadError, setBadgeLoadError] = useState(false);
  const [savedBusinesses, setSavedBusinesses] = useState<Business[]>([]);
  const [selectedBiz, setSelectedBiz] = useState<Business | null>(null);
  const [bizPhotos, setBizPhotos] = useState<BusinessPhoto[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OrderWithItems | null>(null);
  const [showOrders, setShowOrders] = useState(false);

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
        setBadgeLoadError(true);
      }
    })();

    void loadBookmarks(user.id);
    void fetchOrders();
  }, [user?.id, loadBookmarks, fetchOrders]);

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

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 12, paddingVertical: 8,
    },
    headerBtn: {
      width: 40, height: 40, borderRadius: 20,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    headerTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 16 },
    ordersSection: {
      marginTop: 8,
      marginHorizontal: 16,
      marginBottom: 32,
      backgroundColor: colors.surface,
      borderRadius: 16,
      overflow: 'hidden',
    },
    ordersSectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    ordersSectionTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    ordersHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    orderCountBadge: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    orderCountText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    ordersLoading: { paddingVertical: 24, alignItems: 'center' },
    ordersEmpty: { paddingHorizontal: 16, paddingBottom: 24, paddingTop: 8, alignItems: 'center', gap: 4 },
    ordersEmptyText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
    ordersEmptySubtext: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
    orderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderTopWidth: 1,
      borderTopColor: colors.background,
    },
    orderRowLeft: { gap: 2 },
    orderRowId: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, fontFamily: 'monospace' },
    orderRowDate: { fontSize: 12, color: colors.textMuted },
    orderRowItems: { fontSize: 12, color: colors.textSecondary },
    orderRowRight: { alignItems: 'flex-end', gap: 4 },
    orderRowTotal: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
    statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
    statusText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
    badgeError: { color: colors.error, fontSize: 13, textAlign: 'center', paddingHorizontal: 16, paddingTop: 4 },
    noBadges: { color: colors.textMuted, fontSize: 13, textAlign: 'center', paddingHorizontal: 16, paddingTop: 4 },
  });

  if (!user || !profile) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.roxy} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  const sortedOrders = [...orders].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Standard social profile header: back · @handle · settings */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => (router.canGoBack() ? router.back() : router.push('/(tabs)/grow' as any))}
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>@{profile.username}</Text>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => router.push('/(tabs)/profile/settings' as any)}
          accessibilityLabel="Settings"
        >
          <Ionicons name="settings-outline" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>
      <ScrollView showsVerticalScrollIndicator={false}>
        <ProfileCard
          profile={profile}
          badges={badges}
          isOwn={true}
          savedBusinesses={savedBusinesses}
          onOpenBusiness={handleOpenBiz}
          onEdit={() => router.push('/(tabs)/profile/edit' as any)}
        />

        {user?.id && (
          <>
            <ProfilePhotoGrid userId={user.id} editable />
            <SavedPosts userId={user.id} />
            <ProfileFavorites userId={user.id} editable />
          </>
        )}

        {badgeLoadError ? (
          <Text style={styles.badgeError}>Could not load badges</Text>
        ) : null}

        {/* My Orders section */}
        <View style={styles.ordersSection}>
          <TouchableOpacity
            style={styles.ordersSectionHeader}
            onPress={() => setShowOrders(v => !v)}
            accessibilityLabel="Toggle my orders"
          >
            <Text style={styles.ordersSectionTitle}>My Orders</Text>
            <View style={styles.ordersHeaderRight}>
              {orders.length > 0 && (
                <View style={styles.orderCountBadge}>
                  <Text style={styles.orderCountText}>{orders.length}</Text>
                </View>
              )}
              <Ionicons
                name={showOrders ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.textMuted}
              />
            </View>
          </TouchableOpacity>

          {showOrders && (
            <>
              {loadingOrders ? (
                <View style={styles.ordersLoading}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              ) : sortedOrders.length === 0 ? (
                <View style={styles.ordersEmpty}>
                  <Text style={styles.ordersEmptyText}>No orders yet</Text>
                  <Text style={styles.ordersEmptySubtext}>Shop from WLW businesses in the Build tab</Text>
                </View>
              ) : (
                sortedOrders.map((order) => (
                  <TouchableOpacity
                    key={order.id}
                    style={styles.orderRow}
                    onPress={() => setSelectedOrder(order)}
                    accessibilityLabel={`Order ${order.id.slice(-8).toUpperCase()}, ${order.status}`}
                  >
                    <View style={styles.orderRowLeft}>
                      <Text style={styles.orderRowId}>#{order.id.slice(-8).toUpperCase()}</Text>
                      <Text style={styles.orderRowDate}>
                        {new Date(order.created_at).toLocaleDateString()}
                      </Text>
                      <Text style={styles.orderRowItems}>
                        {order.order_items.length} item{order.order_items.length !== 1 ? 's' : ''}
                      </Text>
                    </View>
                    <View style={styles.orderRowRight}>
                      <Text style={styles.orderRowTotal}>
                        ${(order.total_cents / 100).toFixed(2)}
                      </Text>
                      <View style={[
                        styles.statusBadge,
                        { backgroundColor: (STATUS_COLORS[order.status] ?? '#6B7280') + '20' },
                      ]}>
                        <Text style={[
                          styles.statusText,
                          { color: STATUS_COLORS[order.status] ?? '#6B7280' },
                        ]}>
                          {order.status.toUpperCase()}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </>
          )}
        </View>
      </ScrollView>

      <BusinessDetailSheet
        business={selectedBiz}
        photos={bizPhotos}
        isBookmarked={selectedBiz ? bookmarkedBusinessIds.has(selectedBiz.id) : false}
        onBookmarkToggle={() =>
          selectedBiz && user?.id && toggleBookmark(selectedBiz.id, user.id)
        }
        onClose={() => { setSelectedBiz(null); setBizPhotos([]); }}
        onViewOrders={() => setShowOrders(true)}
      />

      <OrderDetailSheet
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
      />
    </SafeAreaView>
  );
}
