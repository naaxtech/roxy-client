import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Share, Linking,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { useBuildStore } from '../../store/buildStore';
import { useMarketplaceStore } from '../../store/marketplaceStore';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useAppWidth } from '../../hooks/useAppWidth';
import { formatMoney, currencyCode } from '../../lib/currency';
import { logError } from '../../lib/errorLogger';
import { BusinessPhotoGallery } from '../../components/build/BusinessPhotoGallery';
import { CartDrawer } from '../../components/build/CartDrawer';
import { CheckoutSheet } from '../../components/build/CheckoutSheet';
import { OrderConfirmationSheet } from '../../components/build/OrderConfirmationSheet';
import { ProfileShell } from '../../components/profile/ProfileShell';
import type { PopulatedTabs, ProfileTab } from '../../components/profile/profileVariant';
import { deriveSellerStatus, canSell } from '../../lib/sellerStatus';
import type { Business, BusinessPhoto } from '../../types';
import type { ProductWithVariants } from '../../types/marketplace';

export default function BusinessStorefrontScreen() {
  const colors = useThemeColors();
  const screenWidth = useAppWidth();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuthStore();
  const { businesses, bookmarkedBusinessIds, toggleBookmark } = useBuildStore();
  const {
    productsByBusiness, loadingProducts, fetchProducts,
    getCartCount, getCartTotal, businessCurrency,
  } = useMarketplaceStore();

  const businessId = id ?? '';

  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [photos, setPhotos] = useState<BusinessPhoto[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(true);
  const [photosError, setPhotosError] = useState(false);
  const [shellTab, setShellTab] = useState<ProfileTab | null>(null);
  const [showCart, setShowCart] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  // Set once payment succeeds. orderId inside is null while the Stripe webhook is
  // still writing the row, so visibility can't hang off the id itself.
  const [checkoutResult, setCheckoutResult] = useState<{ orderId: string | null } | null>(null);

  const products = productsByBusiness[businessId] ?? [];
  const isLoadingProducts = loadingProducts[businessId] ?? false;
  const isBookmarked = businessId ? bookmarkedBusinessIds.has(businessId) : false;
  const cartCount = getCartCount(businessId);

  // Cold deep links (shared URL, new tab) have no history — back must still
  // land somewhere sensible instead of doing nothing on web.
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/discover'));

  // Business — try the already-loaded Build tab list first, then fall back
  // to a direct fetch so a cold deep link still resolves.
  useEffect(() => {
    if (!businessId) { setNotFound(true); setLoading(false); return; }
    const cached = businesses.find((b) => b.id === businessId);
    if (cached) {
      setBusiness(cached);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data, error } = await supabase
          .from('businesses')
          .select('*')
          .eq('id', businessId)
          .single();
        if (cancelled) return;
        if (error || !data) {
          setNotFound(true);
        } else {
          setBusiness(data as Business);
        }
      } catch (e) {
        if (cancelled) return;
        logError(e, 'business_storefront_load_business');
        setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [businessId, businesses]);

  // Photos — identical query to the Build tab's business-open handler.
  const loadPhotos = useCallback(async () => {
    if (!businessId) return;
    setLoadingPhotos(true);
    setPhotosError(false);
    try {
      const { data, error } = await supabase
        .from('business_photos')
        .select('*')
        .eq('business_id', businessId)
        .order('sort_order');
      if (error) { setPhotosError(true); return; }
      setPhotos((data as BusinessPhoto[]) ?? []);
    } catch (e) {
      logError(e, 'business_storefront_load_photos');
      setPhotosError(true);
    } finally {
      setLoadingPhotos(false);
    }
  }, [businessId]);

  useEffect(() => { void loadPhotos(); }, [loadPhotos]);

  // Products — Shop is the default tab, so fetch on mount; the store caches
  // per business so returning to this screen doesn't refetch.
  useEffect(() => {
    if (!businessId) return;
    if (!productsByBusiness[businessId]) {
      void fetchProducts(businessId);
    }
  }, [businessId, productsByBusiness, fetchProducts]);

  const handleBookmarkToggle = () => {
    if (!businessId || !user?.id) return;
    void toggleBookmark(businessId, user.id);
  };

  const handleShare = () => {
    if (!business) return;
    Share.share({ message: `Check out ${business.name} on Roxy!` }).catch(() => {});
  };

  const handleCheckoutSuccess = (orderId: string | null) => {
    setShowCheckout(false);
    setCheckoutResult({ orderId });
  };

  const handleViewOrders = () => {
    setCheckoutResult(null);
    router.push({ pathname: '/(tabs)/you', params: { orders: '1' } } as any);
  };

  // 2-col grid math derives from useAppWidth() (not raw window width) so the
  // grid respects the same clamped column WebAppFrame renders on web.
  const gridHPadding = 16;
  const gridGap = 12;
  const cellWidth = (screenWidth - gridHPadding * 2 - gridGap) / 2;

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 12, paddingVertical: 8,
    },
    topBarActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    iconBtn: {
      width: 40, height: 40, borderRadius: 20,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surface,
    },

    hero: { alignItems: 'center', paddingHorizontal: 20, paddingTop: 4, paddingBottom: 20, gap: 4 },
    logoImg: { width: 84, height: 84, borderRadius: 42, maxWidth: '100%' },
    logoPlate: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
    logoInitial: { color: '#fff', fontSize: 32, fontWeight: '800' },
    name: { color: colors.textPrimary, fontSize: 22, fontWeight: '800', textAlign: 'center', marginTop: 10 },
    verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
    verifiedText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
    metaText: { color: colors.textMuted, fontSize: 13 },
    categoryChip: {
      backgroundColor: colors.surface, borderRadius: 12,
      paddingHorizontal: 12, paddingVertical: 4, marginTop: 8,
    },
    categoryChipText: {
      color: colors.textSecondary, fontSize: 12, fontWeight: '600',
      textTransform: 'capitalize',
    },

    tabBar: {
      flexDirection: 'row', paddingHorizontal: 16,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    tab: {
      flex: 1, paddingVertical: 13, alignItems: 'center',
      borderBottomWidth: 2, borderBottomColor: 'transparent',
    },
    tabActive: { borderBottomColor: colors.roxy },
    tabText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
    tabTextActive: { color: colors.roxy, fontWeight: '700' },

    // Shop
    shopGrid: { padding: gridHPadding },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: gridGap },
    productCell: { width: cellWidth, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.surface },
    productPhoto: { width: '100%', height: cellWidth, maxWidth: '100%' },
    productPhotoPlaceholder: {
      width: '100%', height: cellWidth,
      backgroundColor: colors.primary + '20',
      alignItems: 'center', justifyContent: 'center',
    },
    productBody: { padding: 10, gap: 3 },
    productCategory: {
      fontSize: 10, color: colors.textMuted,
      textTransform: 'uppercase', letterSpacing: 0.4,
    },
    productName: { fontSize: 13.5, fontWeight: '700', color: colors.textPrimary },
    productPrice: { fontSize: 14, fontWeight: '800', color: colors.primary },
    outOfStock: { fontSize: 11, color: colors.textMuted },

    // About
    aboutSection: { padding: 20, gap: 16 },
    description: { color: colors.textSecondary, fontSize: 14, lineHeight: 21 },
    linksSection: { gap: 2 },
    linkRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    linkText: { flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: '600' },

    // Policies
    policiesSection: { padding: 20, gap: 2 },
    policyRow: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 12,
      paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    policyText: { flex: 1, color: colors.textSecondary, fontSize: 13.5, lineHeight: 19 },

    // Shared empty/error block — vector icon, never emoji chrome.
    sectionEmpty: { alignItems: 'center', justifyContent: 'center', padding: 40, gap: 10 },
    sectionEmptyTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', textAlign: 'center' },
    sectionEmptyBody: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19 },
    retryLink: { color: colors.primary, fontSize: 13, fontWeight: '700', marginTop: 4 },

    notFoundWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 10 },
    notFoundTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700', textAlign: 'center' },
    notFoundBody: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },
    notFoundBack: { color: colors.primary, fontWeight: '700', fontSize: 14, marginTop: 8 },

    cartBar: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: colors.primary, paddingHorizontal: 20, paddingVertical: 16,
      borderTopLeftRadius: 18, borderTopRightRadius: 18,
    },
    cartBarLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    cartCountBadge: {
      minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6,
      backgroundColor: 'rgba(255,255,255,0.25)',
      alignItems: 'center', justifyContent: 'center',
    },
    cartCountText: { color: '#fff', fontWeight: '800', fontSize: 12 },
    cartBarTotal: { color: '#fff', fontWeight: '800', fontSize: 16 },
    cartBarCta: { color: '#fff', fontWeight: '700', fontSize: 14 },
  });

  const renderSectionEmpty = (
    icon: keyof typeof Ionicons.glyphMap,
    title: string,
    body?: string,
    onRetry?: () => void,
  ) => (
    <View style={styles.sectionEmpty}>
      <Ionicons name={icon} size={40} color={colors.textMuted} />
      <Text style={styles.sectionEmptyTitle}>{title}</Text>
      {body ? <Text style={styles.sectionEmptyBody}>{body}</Text> : null}
      {onRetry && (
        <TouchableOpacity onPress={onRetry} accessibilityLabel="Retry">
          <Text style={styles.retryLink}>Try again</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const renderPolicyRow = (icon: keyof typeof Ionicons.glyphMap, text: string) => (
    <View style={styles.policyRow}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={styles.policyText}>{text}</Text>
    </View>
  );

  const renderProductCell = (product: ProductWithVariants) => {
    const sortedPhotos = [...(product.product_photos ?? [])].sort((a, b) => a.position - b.position);
    const coverPhoto = sortedPhotos[0];
    const isOutOfStock = product.has_variants &&
      (product.product_variants?.filter((v) => v.is_active && v.stock > 0) ?? []).length === 0;

    return (
      <TouchableOpacity
        key={product.id}
        style={styles.productCell}
        onPress={() => router.push(`/product/${product.id}` as any)}
        activeOpacity={0.85}
        accessibilityLabel={`View ${product.name}`}
      >
        {coverPhoto ? (
          <Image
            source={{ uri: coverPhoto.url }}
            style={styles.productPhoto}
            contentFit="cover"
            accessibilityLabel={product.name}
          />
        ) : (
          <View style={styles.productPhotoPlaceholder}>
            <Ionicons name="pricetag-outline" size={30} color={colors.primary} />
          </View>
        )}
        <View style={styles.productBody}>
          <Text style={styles.productCategory}>{product.category}</Text>
          <Text style={styles.productName} numberOfLines={2}>{product.name}</Text>
          <Text style={styles.productPrice}>{formatMoney(product.base_price_cents, businessCurrency(businessId))}</Text>
          {isOutOfStock && <Text style={styles.outOfStock}>Out of stock</Text>}
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.iconBtn} onPress={goBack} accessibilityLabel="Back" hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <ActivityIndicator color={colors.roxy} style={{ marginTop: 48 }} />
      </SafeAreaView>
    );
  }

  if (notFound || !business) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.iconBtn} onPress={goBack} accessibilityLabel="Back" hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <View style={styles.notFoundWrap}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
          <Text style={styles.notFoundTitle}>This shop isn&apos;t available</Text>
          <Text style={styles.notFoundBody}>It may have been removed, or the link is incorrect.</Text>
          <TouchableOpacity onPress={goBack}>
            <Text style={styles.notFoundBack}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const approved = canSell(deriveSellerStatus([business]));
  const populated: PopulatedTabs = {
    posts: false,
    shop: approved,
    events: false,
    rooms: false,
    games: false,
    about: !!(business.description || business.website_url || business.instagram_handle),
    saved: false,
    photos: photos.length > 0,
    policies: approved,
  };

  const renderTab = (tab: ProfileTab) => {
    if (tab === 'shop') {
      return (
        <View style={styles.shopGrid}>
          {isLoadingProducts || !productsByBusiness[businessId] ? (
            <ActivityIndicator color={colors.roxy} style={{ marginTop: 40 }} />
          ) : products.length === 0 ? (
            renderSectionEmpty('storefront-outline', 'No products yet', "This shop hasn't listed products yet.")
          ) : (
            <View style={styles.grid}>
              {products.map((product) => renderProductCell(product))}
            </View>
          )}
        </View>
      );
    }
    if (tab === 'about') {
      return (
        <View style={styles.aboutSection}>
          {business.description
            ? <Text style={styles.description}>{business.description}</Text>
            : renderSectionEmpty('document-text-outline', 'No description yet')}
          {(business.website_url || business.instagram_handle) && (
            <View style={styles.linksSection}>
              {business.website_url && (
                <TouchableOpacity
                  style={styles.linkRow}
                  onPress={() => Linking.openURL(business.website_url!).catch(() => {})}
                >
                  <Ionicons name="globe-outline" size={18} color={colors.primary} />
                  <Text style={styles.linkText}>Website</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              )}
              {business.instagram_handle && (
                <TouchableOpacity
                  style={styles.linkRow}
                  onPress={() => Linking.openURL(`https://instagram.com/${business.instagram_handle}`).catch(() => {})}
                >
                  <Ionicons name="logo-instagram" size={18} color={colors.primary} />
                  <Text style={styles.linkText}>@{business.instagram_handle}</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      );
    }
    if (tab === 'photos') {
      if (loadingPhotos) return <ActivityIndicator color={colors.roxy} style={{ marginTop: 40 }} />;
      if (photosError) {
        return renderSectionEmpty(
          'alert-circle-outline',
          "Couldn't load photos",
          'Check your connection and try again.',
          loadPhotos,
        );
      }
      if (photos.length === 0) return renderSectionEmpty('images-outline', 'No photos yet');
      return (
        <View testID="photo-gallery">
          <BusinessPhotoGallery photos={photos} />
        </View>
      );
    }
    return (
      <View style={styles.policiesSection}>
        {renderPolicyRow('airplane-outline', 'Ships internationally where the seller allows')}
        {renderPolicyRow('lock-closed-outline', 'Secure checkout via Stripe')}
        {renderPolicyRow('pricetag-outline', `Prices shown in ${currencyCode(businessCurrency(businessId))}`)}
        {renderPolicyRow('arrow-undo-outline', 'Returns handled by the seller — contact before buying')}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="business-shell">
      <ProfileShell
        variant="seller"
        name={business.name}
        subtitle={[business.category, business.location_city].filter(Boolean).join(' · ') || null}
        bio={business.description}
        avatarUrl={business.logo_url}
        coverUrl={photos[0]?.url ?? null}
        verified={business.is_verified}
        sellerApproved={approved}
        stats={approved ? [
          { value: String(products.length), label: 'Products' },
          { value: business.location_city ?? '—', label: 'Ships from' },
          { value: business.is_wlw_owned ? 'WLW' : 'Shop', label: 'Owned' },
        ] : undefined}
        onBack={goBack}
        headerActions={[
          {
            icon: 'share-outline',
            label: 'Share this shop',
            onPress: handleShare,
            testID: 'business-share',
          },
          {
            icon: isBookmarked ? 'heart' : 'heart-outline',
            label: isBookmarked ? 'Remove bookmark' : 'Add bookmark',
            onPress: handleBookmarkToggle,
            testID: 'bookmark-btn',
          },
        ]}
        primaryAction={{ label: approved ? 'Shop' : 'About' }}
        populated={populated}
        selectedTab={shellTab}
        onSelectTab={setShellTab}
        renderTab={renderTab}
        testID="profile-shell"
      />

      {/* Bottom cart bar */}
      {cartCount > 0 && (
        <TouchableOpacity
          style={styles.cartBar}
          onPress={() => setShowCart(true)}
          accessibilityLabel={`View cart, ${cartCount} items`}
        >
          <View style={styles.cartBarLeft}>
            <View style={styles.cartCountBadge}>
              <Text style={styles.cartCountText}>{cartCount}</Text>
            </View>
            <Text style={styles.cartBarTotal}>{formatMoney(getCartTotal(businessId), businessCurrency(businessId))}</Text>
          </View>
          <Text style={styles.cartBarCta}>View cart →</Text>
        </TouchableOpacity>
      )}

      <CartDrawer
        businessId={businessId}
        businessName={business.name}
        visible={showCart}
        onClose={() => setShowCart(false)}
        onCheckout={() => { setShowCart(false); setShowCheckout(true); }}
      />

      <CheckoutSheet
        businessId={businessId}
        businessName={business.name}
        visible={showCheckout}
        onClose={() => setShowCheckout(false)}
        onSuccess={handleCheckoutSuccess}
      />

      <OrderConfirmationSheet
        visible={checkoutResult !== null}
        orderId={checkoutResult?.orderId ?? null}
        onClose={() => setCheckoutResult(null)}
        onViewOrders={handleViewOrders}
      />
    </SafeAreaView>
  );
}
