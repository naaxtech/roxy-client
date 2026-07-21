import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, Share, Linking,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
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
import type { Business, BusinessPhoto } from '../../types';
import type { ProductWithVariants } from '../../types/marketplace';

const BRAND_GRADIENT = ['#FF6A2E', '#FF2F71', '#E81C8E'] as const;

// The `businesses` table has no currency column yet (confirmed against
// types/index.ts). Every price on this route defaults to USD until the
// schema grows a real per-business (or per-order) currency source.
const DEFAULT_CURRENCY = 'usd';

type StorefrontTab = 'shop' | 'about' | 'photos' | 'policies';
const TABS: StorefrontTab[] = ['shop', 'about', 'photos', 'policies'];
const TAB_LABEL: Record<StorefrontTab, string> = {
  shop: 'Shop', about: 'About', photos: 'Photos', policies: 'Policies',
};

export default function BusinessStorefrontScreen() {
  const colors = useThemeColors();
  const screenWidth = useAppWidth();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuthStore();
  const { businesses, bookmarkedBusinessIds, toggleBookmark } = useBuildStore();
  const {
    productsByBusiness, loadingProducts, fetchProducts,
    getCartCount, getCartTotal,
  } = useMarketplaceStore();

  const businessId = id ?? '';

  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [photos, setPhotos] = useState<BusinessPhoto[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(true);
  const [photosError, setPhotosError] = useState(false);
  const [activeTab, setActiveTab] = useState<StorefrontTab>('shop');
  const [showCart, setShowCart] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [confirmedOrderId, setConfirmedOrderId] = useState<string | null>(null);

  const products = productsByBusiness[businessId] ?? [];
  const isLoadingProducts = loadingProducts[businessId] ?? false;
  const isBookmarked = businessId ? bookmarkedBusinessIds.has(businessId) : false;
  const cartCount = getCartCount(businessId);

  // Cold deep links (shared URL, new tab) have no history — back must still
  // land somewhere sensible instead of doing nothing on web.
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/build'));

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

  const handleCheckoutSuccess = (orderId: string) => {
    setShowCheckout(false);
    setConfirmedOrderId(orderId);
  };

  const handleViewOrders = () => {
    setConfirmedOrderId(null);
    router.push('/(tabs)/profile' as any);
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
          <Text style={styles.productPrice}>{formatMoney(product.base_price_cents, DEFAULT_CURRENCY)}</Text>
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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Sticky header */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconBtn} onPress={goBack} accessibilityLabel="Back" hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.topBarActions}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={handleShare}
            accessibilityLabel="Share this shop"
            hitSlop={8}
          >
            <Ionicons name="share-outline" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity
            testID="bookmark-btn"
            style={styles.iconBtn}
            onPress={handleBookmarkToggle}
            accessibilityLabel={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
            hitSlop={8}
          >
            <Ionicons
              name={isBookmarked ? 'heart' : 'heart-outline'}
              size={20}
              color={isBookmarked ? colors.roxy : colors.textPrimary}
            />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: cartCount > 0 ? 96 : 24 }}
      >
        {/* Hero */}
        <View style={styles.hero}>
          {business.logo_url ? (
            <Image
              source={{ uri: business.logo_url }}
              style={styles.logoImg}
              contentFit="cover"
              accessibilityLabel={business.name}
            />
          ) : (
            <LinearGradient
              colors={BRAND_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.logoPlate}
            >
              <Text style={styles.logoInitial}>{business.name?.[0]?.toUpperCase() ?? '?'}</Text>
            </LinearGradient>
          )}
          <Text style={styles.name}>{business.name}</Text>
          {business.is_verified && (
            <View style={styles.verifiedRow}>
              <Ionicons name="shield-checkmark" size={14} color={colors.primary} />
              <Text style={styles.verifiedText}>Verified WLW Business</Text>
            </View>
          )}
          {business.location_city && (
            <View style={styles.metaRow}>
              <Ionicons name="location-outline" size={13} color={colors.textMuted} />
              <Text style={styles.metaText}>{business.location_city}</Text>
            </View>
          )}
          {business.category && (
            <View style={styles.categoryChip}>
              <Text style={styles.categoryChipText}>{business.category}</Text>
            </View>
          )}
        </View>

        {/* Segmented tabs */}
        <View style={styles.tabBar}>
          {TABS.map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && styles.tabActive]}
              onPress={() => setActiveTab(tab)}
              accessibilityLabel={`${TAB_LABEL[tab]} tab`}
            >
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                {TAB_LABEL[tab]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Shop */}
        {activeTab === 'shop' && (
          <View style={styles.shopGrid}>
            {isLoadingProducts ? (
              <ActivityIndicator color={colors.roxy} style={{ marginTop: 40 }} />
            ) : products.length === 0 ? (
              renderSectionEmpty('storefront-outline', 'No products yet', "This shop hasn't listed products yet.")
            ) : (
              <View style={styles.grid}>
                {products.map((product) => renderProductCell(product))}
              </View>
            )}
          </View>
        )}

        {/* About */}
        {activeTab === 'about' && (
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
        )}

        {/* Photos */}
        {activeTab === 'photos' && (
          loadingPhotos ? (
            <ActivityIndicator color={colors.roxy} style={{ marginTop: 40 }} />
          ) : photosError ? (
            renderSectionEmpty(
              'alert-circle-outline',
              "Couldn't load photos",
              'Check your connection and try again.',
              loadPhotos,
            )
          ) : photos.length === 0 ? (
            renderSectionEmpty('images-outline', 'No photos yet')
          ) : (
            <View testID="photo-gallery">
              <BusinessPhotoGallery photos={photos} />
            </View>
          )
        )}

        {/* Policies */}
        {activeTab === 'policies' && (
          <View style={styles.policiesSection}>
            {renderPolicyRow('airplane-outline', 'Ships internationally where the seller allows')}
            {renderPolicyRow('lock-closed-outline', 'Secure checkout via Stripe')}
            {renderPolicyRow('pricetag-outline', `Prices shown in ${currencyCode(DEFAULT_CURRENCY)}`)}
            {renderPolicyRow('arrow-undo-outline', 'Returns handled by the seller — contact before buying')}
          </View>
        )}
      </ScrollView>

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
            <Text style={styles.cartBarTotal}>{formatMoney(getCartTotal(businessId), DEFAULT_CURRENCY)}</Text>
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
        visible={confirmedOrderId !== null}
        orderId={confirmedOrderId}
        onClose={() => setConfirmedOrderId(null)}
        onViewOrders={handleViewOrders}
      />
    </SafeAreaView>
  );
}
