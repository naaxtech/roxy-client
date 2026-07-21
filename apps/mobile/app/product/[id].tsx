import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, Share, NativeSyntheticEvent, NativeScrollEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useBuildStore } from '../../store/buildStore';
import { useMarketplaceStore } from '../../store/marketplaceStore';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useAppWidth } from '../../hooks/useAppWidth';
import { formatMoney } from '../../lib/currency';
import { logError } from '../../lib/errorLogger';
import { CheckoutSheet } from '../../components/build/CheckoutSheet';
import { OrderConfirmationSheet } from '../../components/build/OrderConfirmationSheet';
import type { Business } from '../../types';
import type { ProductWithVariants, ProductVariant } from '../../types/marketplace';

const BRAND_GRADIENT = ['#FF6A2E', '#FF2F71', '#E81C8E'] as const;

// Products (like businesses — see app/business/[id].tsx) have no currency
// column yet. Every price on this route defaults to USD until the schema
// grows a real per-product (or per-order) currency source.
const DEFAULT_CURRENCY = 'usd';

export default function ProductDetailScreen() {
  const colors = useThemeColors();
  const screenWidth = useAppWidth();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { businesses } = useBuildStore();
  const { productsByBusiness, addToCart } = useMarketplaceStore();

  const productId = id ?? '';

  const [product, setProduct] = useState<ProductWithVariants | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [business, setBusiness] = useState<Business | null>(null);

  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);
  const [qty, setQty] = useState(1);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [showCheckout, setShowCheckout] = useState(false);
  const [confirmedOrderId, setConfirmedOrderId] = useState<string | null>(null);

  // Cold deep links (shared URL, new tab) have no history — back must still
  // land somewhere sensible instead of doing nothing on web.
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/build'));

  // Reused verbatim from ProductDetailSheet: variant/qty/price/stock computations.
  const photos = [...(product?.product_photos ?? [])].sort((a, b) => a.position - b.position);
  const activeVariants = product?.product_variants?.filter((v) => v.is_active && v.stock > 0) ?? [];
  const isOutOfStock = !!product?.has_variants && activeVariants.length === 0;
  const needsVariant = !!product?.has_variants && !selectedVariant;
  const ctaDisabled = isOutOfStock || needsVariant;
  const displayPrice = selectedVariant ? selectedVariant.price_cents : (product?.base_price_cents ?? 0);
  // Qty stepper ceiling: only a selected variant carries a stock number (base
  // products have none), so only that case gets an upper clamp.
  const qtyCeiling = selectedVariant ? selectedVariant.stock : null;

  // Product — the store already caches every business's product list (with
  // variants + photos) once the storefront has fetched it, so check there
  // first; a cold deep link (no storefront visit yet) falls back to a direct
  // fetch by id with the identical nested select fetchProducts uses.
  useEffect(() => {
    if (!productId) { setNotFound(true); setLoading(false); return; }

    const cached = Object.values(productsByBusiness).flat().find((p) => p.id === productId);
    if (cached) {
      setProduct(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data, error } = await supabase
          .from('products')
          .select('*, product_variants(*), product_photos(*)')
          .eq('id', productId)
          .single();
        if (cancelled) return;
        if (error || !data) {
          setNotFound(true);
        } else {
          setProduct(data as ProductWithVariants);
        }
      } catch (e) {
        if (cancelled) return;
        logError(e, 'product_detail_load_product');
        setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [productId, productsByBusiness]);

  // Reset selection state whenever the product identity changes so a reused
  // screen instance (e.g. navigating product -> product) never carries over
  // a stale variant/qty/photo index from the previous product.
  useEffect(() => {
    setSelectedVariant(null);
    setQty(1);
    setPhotoIndex(0);
  }, [productId]);

  // Seller — cache-first against the Build tab's business list (same pattern
  // as app/business/[id].tsx), then a direct fetch so the seller row and the
  // CheckoutSheet merchant name resolve even on a cold deep link. Runs in the
  // background; the product page itself never blocks on this.
  useEffect(() => {
    const businessId = product?.business_id;
    if (!businessId) return;
    const cached = businesses.find((b) => b.id === businessId);
    if (cached) { setBusiness(cached); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('businesses')
          .select('*')
          .eq('id', businessId)
          .single();
        if (cancelled) return;
        if (!error && data) setBusiness(data as Business);
      } catch (e) {
        if (!cancelled) logError(e, 'product_detail_load_business');
      }
    })();
    return () => { cancelled = true; };
  }, [product?.business_id, businesses]);

  const handleShare = () => {
    if (!product) return;
    Share.share({ message: `Check out ${product.name} on Roxy!` }).catch(() => {});
  };

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
    setPhotoIndex(idx);
  };

  const handleSelectVariant = (v: ProductVariant) => {
    setSelectedVariant(v);
    setQty((q) => Math.min(q, v.stock));
  };

  // Mirrors ProductDetailSheet.handleAddToCart (addToCart + close) — closing
  // this full-screen route means returning to the shop, where the cart bar
  // (live in useMarketplaceStore) immediately reflects the new item.
  const handleAddToCart = () => {
    if (!product || ctaDisabled) return;
    void addToCart(product.business_id, product, selectedVariant?.id ?? null, qty);
    goBack();
  };

  const handleBuyNow = () => {
    if (ctaDisabled) return;
    setShowCheckout(true);
  };

  const handleCheckoutSuccess = (orderId: string) => {
    setShowCheckout(false);
    setConfirmedOrderId(orderId);
  };

  const handleViewOrders = () => {
    setConfirmedOrderId(null);
    router.push('/(tabs)/profile' as any);
  };

  const galleryHeight = screenWidth;

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 12, paddingVertical: 8,
    },
    iconBtn: {
      width: 40, height: 40, borderRadius: 20,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.surface,
    },

    scrollContent: { paddingBottom: 130 },

    gallery: { width: screenWidth, height: galleryHeight, maxWidth: '100%' },
    galleryImage: { width: screenWidth, height: galleryHeight, maxWidth: '100%' },
    photoPlaceholder: {
      width: screenWidth, height: galleryHeight, maxWidth: '100%',
      backgroundColor: colors.primary + '20',
      alignItems: 'center', justifyContent: 'center',
    },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: 10 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.textMuted + '60' },
    dotActive: { backgroundColor: colors.primary },

    body: { padding: 20, gap: 8 },
    category: { fontSize: 12, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
    name: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
    price: { fontSize: 24, fontWeight: '800', color: colors.primary },
    stockPill: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      alignSelf: 'flex-start', backgroundColor: colors.surface,
      borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginTop: 2,
    },
    stockPillText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
    description: { fontSize: 14, color: colors.textSecondary, lineHeight: 21, marginTop: 6 },

    section: { marginTop: 10, gap: 8 },
    sectionLabel: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
    outOfStock: { fontSize: 13, color: colors.textMuted },
    variantRow: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingVertical: 12, paddingHorizontal: 14,
      borderRadius: 10, backgroundColor: colors.surface,
    },
    variantRowSelected: { borderWidth: 2, borderColor: colors.primary },
    variantLabel: { fontSize: 14, color: colors.textPrimary, fontWeight: '600' },
    variantPrice: { fontSize: 14, fontWeight: '700', color: colors.primary },

    qtyRow: {
      flexDirection: 'row', alignItems: 'center',
      justifyContent: 'space-between', marginTop: 10,
    },
    qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    qtyBtn: {
      width: 34, height: 34, borderRadius: 17,
      backgroundColor: colors.surface,
      alignItems: 'center', justifyContent: 'center',
    },
    qtyBtnDisabled: { opacity: 0.4 },
    qtyText: {
      fontSize: 16, fontWeight: '700', color: colors.textPrimary,
      minWidth: 24, textAlign: 'center',
    },

    sellerRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingVertical: 12, paddingHorizontal: 14, marginTop: 18,
      borderRadius: 12, backgroundColor: colors.surface,
    },
    sellerLogoImg: { width: 36, height: 36, borderRadius: 18, maxWidth: '100%' },
    sellerLogoPlate: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    sellerLogoInitial: { color: '#fff', fontWeight: '800', fontSize: 14 },
    sellerTextWrap: { flex: 1 },
    sellerLabel: { fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
    sellerName: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },

    ctaBar: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      flexDirection: 'row', gap: 12,
      backgroundColor: colors.background,
      paddingHorizontal: 20, paddingTop: 12, paddingBottom: 22,
      borderTopWidth: 1, borderTopColor: colors.surface,
    },
    addToCartBtn: {
      flex: 1, backgroundColor: colors.primary,
      borderRadius: 12, paddingVertical: 15, alignItems: 'center',
    },
    addToCartText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    buyNowBtn: {
      flex: 1, borderWidth: 1.5, borderColor: colors.primary,
      borderRadius: 12, paddingVertical: 13.5, alignItems: 'center',
    },
    buyNowText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
    btnDisabled: { opacity: 0.4 },

    notFoundWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 10 },
    notFoundTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700', textAlign: 'center' },
    notFoundBody: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },
    notFoundBack: { color: colors.primary, fontWeight: '700', fontSize: 14, marginTop: 8 },
  });

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

  if (notFound || !product) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.iconBtn} onPress={goBack} accessibilityLabel="Back" hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <View style={styles.notFoundWrap}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
          <Text style={styles.notFoundTitle}>This product isn&apos;t available</Text>
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
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={handleShare}
          accessibilityLabel="Share this product"
          hitSlop={8}
        >
          <Ionicons name="share-outline" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Image gallery */}
        {photos.length > 0 ? (
          <View>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={handleScroll}
              style={styles.gallery}
            >
              {photos.map((photo) => (
                <Image
                  key={photo.id}
                  source={{ uri: photo.url }}
                  style={styles.galleryImage}
                  contentFit="cover"
                  accessibilityLabel={photo.alt_text ?? product.name}
                />
              ))}
            </ScrollView>
            {photos.length > 1 && (
              <View style={styles.dots}>
                {photos.map((_, i) => (
                  <View
                    key={i}
                    testID="photo-dot"
                    style={[styles.dot, i === photoIndex && styles.dotActive]}
                  />
                ))}
              </View>
            )}
          </View>
        ) : (
          <View style={styles.photoPlaceholder}>
            <Ionicons name="pricetag-outline" size={64} color={colors.primary} />
          </View>
        )}

        {/* Product info */}
        <View style={styles.body}>
          <Text style={styles.category}>{product.category}</Text>
          <Text style={styles.name}>{product.name}</Text>
          <Text style={styles.price}>{formatMoney(displayPrice, DEFAULT_CURRENCY)}</Text>

          {isOutOfStock && (
            <View style={styles.stockPill}>
              <Ionicons name="alert-circle-outline" size={14} color={colors.textMuted} />
              <Text style={styles.stockPillText}>Out of stock</Text>
            </View>
          )}

          {product.description ? (
            <Text style={styles.description}>{product.description}</Text>
          ) : null}

          {/* Variant picker */}
          {product.has_variants && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Choose a variant</Text>
              {activeVariants.length === 0 ? (
                <Text style={styles.outOfStock}>Out of stock</Text>
              ) : (
                activeVariants.map((v) => {
                  const label = [
                    v.option1_name ? `${v.option1_name}: ${v.option1_value}` : null,
                    v.option2_name ? `${v.option2_name}: ${v.option2_value}` : null,
                  ].filter(Boolean).join(' / ') || v.sku || 'Default';
                  return (
                    <TouchableOpacity
                      key={v.id}
                      style={[
                        styles.variantRow,
                        selectedVariant?.id === v.id && styles.variantRowSelected,
                      ]}
                      onPress={() => handleSelectVariant(v)}
                      activeOpacity={0.85}
                      accessibilityLabel={`Select variant ${label}`}
                    >
                      <Text style={styles.variantLabel}>{label}</Text>
                      <Text style={styles.variantPrice}>{formatMoney(v.price_cents, DEFAULT_CURRENCY)}</Text>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          )}

          {/* Qty stepper */}
          {!isOutOfStock && (
            <View style={styles.qtyRow}>
              <Text style={styles.sectionLabel}>Quantity</Text>
              <View style={styles.qtyControls}>
                <TouchableOpacity
                  onPress={() => setQty((q) => Math.max(1, q - 1))}
                  style={styles.qtyBtn}
                  accessibilityLabel="Decrease quantity"
                  hitSlop={8}
                >
                  <Ionicons name="remove" size={18} color={colors.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.qtyText}>{qty}</Text>
                <TouchableOpacity
                  onPress={() => setQty((q) => (qtyCeiling !== null ? Math.min(qtyCeiling, q + 1) : q + 1))}
                  style={[styles.qtyBtn, qtyCeiling !== null && qty >= qtyCeiling && styles.qtyBtnDisabled]}
                  disabled={qtyCeiling !== null && qty >= qtyCeiling}
                  accessibilityLabel="Increase quantity"
                  hitSlop={8}
                >
                  <Ionicons name="add" size={18} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Seller row */}
          <TouchableOpacity
            style={styles.sellerRow}
            onPress={() => router.push(`/business/${product.business_id}` as any)}
            activeOpacity={0.85}
            accessibilityLabel={`View ${business?.name ?? 'seller'} shop`}
          >
            {business?.logo_url ? (
              <Image
                source={{ uri: business.logo_url }}
                style={styles.sellerLogoImg}
                contentFit="cover"
                accessibilityLabel={business.name}
              />
            ) : (
              <LinearGradient
                colors={BRAND_GRADIENT}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.sellerLogoPlate}
              >
                {business?.name ? (
                  <Text style={styles.sellerLogoInitial}>{business.name[0].toUpperCase()}</Text>
                ) : (
                  <Ionicons name="storefront-outline" size={16} color="#fff" />
                )}
              </LinearGradient>
            )}
            <View style={styles.sellerTextWrap}>
              <Text style={styles.sellerLabel}>Sold by</Text>
              <Text style={styles.sellerName}>{business?.name ?? 'View shop'}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Sticky bottom CTA bar */}
      <View style={styles.ctaBar}>
        <TouchableOpacity
          style={[styles.addToCartBtn, ctaDisabled && styles.btnDisabled]}
          onPress={handleAddToCart}
          disabled={ctaDisabled}
          accessibilityLabel={isOutOfStock ? 'Out of stock' : `Add ${product.name} to cart`}
        >
          <Text style={styles.addToCartText}>{isOutOfStock ? 'Out of Stock' : 'Add to Cart'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.buyNowBtn, ctaDisabled && styles.btnDisabled]}
          onPress={handleBuyNow}
          disabled={ctaDisabled}
          accessibilityLabel={`Buy ${product.name} now`}
        >
          <Text style={styles.buyNowText}>Buy Now</Text>
        </TouchableOpacity>
      </View>

      <CheckoutSheet
        businessId={product.business_id}
        businessName={business?.name ?? 'Seller'}
        visible={showCheckout}
        onClose={() => setShowCheckout(false)}
        onSuccess={handleCheckoutSuccess}
        buyNowItem={{ product, variantId: selectedVariant?.id ?? null, quantity: qty }}
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
