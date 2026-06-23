import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet, Linking } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { Business, BusinessPhoto } from '../../types';
import { useThemeColors } from '../../hooks/useThemeColors';
import { BusinessPhotoGallery } from './BusinessPhotoGallery';
import { ProductCard } from './ProductCard';
import { CartDrawer } from './CartDrawer';
import { CheckoutSheet } from './CheckoutSheet';
import { OrderConfirmationSheet } from './OrderConfirmationSheet';
import { useMarketplaceStore } from '../../store/marketplaceStore';
import type { ProductWithVariants } from '../../types/marketplace';

type Tab = 'about' | 'products' | 'photos';

interface BusinessDetailSheetProps {
  business: Business | null;
  photos: BusinessPhoto[];
  isBookmarked: boolean;
  onBookmarkToggle: () => void;
  onClose: () => void;
  onViewOrders?: () => void;
}

export function BusinessDetailSheet({
  business,
  photos,
  isBookmarked,
  onBookmarkToggle,
  onClose,
  onViewOrders,
}: BusinessDetailSheetProps) {
  const colors = useThemeColors();
  const hasLinks = !!(business?.website_url || business?.instagram_handle);
  const [activeTab, setActiveTab] = useState<Tab>('about');
  const [showCart, setShowCart] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [confirmedOrderId, setConfirmedOrderId] = useState<string | null>(null);

  const {
    productsByBusiness,
    loadingProducts,
    fetchProducts,
    addToCart,
    getCartCount,
  } = useMarketplaceStore();

  const businessId = business?.id ?? '';
  const products = productsByBusiness[businessId] ?? [];
  const cartCount = getCartCount(businessId);

  // Fetch products when Products tab is opened
  useEffect(() => {
    if (activeTab === 'products' && businessId && !productsByBusiness[businessId]) {
      void fetchProducts(businessId);
    }
  }, [activeTab, businessId, productsByBusiness, fetchProducts]);

  // Reset to About tab when sheet opens for a new business
  useEffect(() => {
    if (business) setActiveTab('about');
  }, [business?.id]);

  const handleAddToCart = (product: ProductWithVariants, variantId: string | null, qty: number) => {
    void addToCart(businessId, product, variantId, qty);
  };

  const handleCheckoutSuccess = (orderId: string) => {
    setShowCheckout(false);
    setConfirmedOrderId(orderId);
  };

  const handleViewOrders = () => {
    setConfirmedOrderId(null);
    onClose();
    onViewOrders?.();
  };

  const styles = StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingTop: 12,
      maxHeight: '88%',
      flex: 1,
    },
    handle: {
      width: 40,
      height: 4,
      backgroundColor: colors.textMuted,
      borderRadius: 2,
      alignSelf: 'center',
      marginBottom: 16,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingLeft: 20,
      paddingRight: 88,
      paddingBottom: 16,
      gap: 12,
    },
    logoCircle: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.primary + '30',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    logoText: { color: colors.primary, fontWeight: '700', fontSize: 20 },
    headerInfo: { flex: 1, gap: 2 },
    name: { color: colors.textPrimary, fontWeight: '700', fontSize: 17 },
    verifiedBadge: { color: colors.primary, fontSize: 12, fontWeight: '600' },
    city: { color: colors.textMuted, fontSize: 12 },
    bookmarkBtn: {
      position: 'absolute',
      top: 16,
      right: 52,
      padding: 8,
    },
    bookmarkIcon: { fontSize: 22 },
    tabBar: {
      flexDirection: 'row',
      paddingHorizontal: 20,
      borderBottomWidth: 1,
      borderBottomColor: colors.surface,
      marginBottom: 4,
    },
    tab: {
      paddingVertical: 10,
      paddingHorizontal: 16,
      marginRight: 4,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
    },
    tabActive: { borderBottomColor: colors.primary },
    tabText: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
    tabTextActive: { color: colors.primary },
    description: {
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 20,
      paddingHorizontal: 20,
      paddingVertical: 12,
    },
    linksSection: { paddingHorizontal: 20, paddingVertical: 12, gap: 12 },
    linksHeader: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
    linkRow: {},
    linkText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
    emptyState: { alignItems: 'center', paddingVertical: 48 },
    emptyStateText: { color: colors.textMuted, fontSize: 15 },
    cartFab: {
      position: 'absolute',
      bottom: 24,
      right: 20,
      backgroundColor: colors.primary,
      borderRadius: 28,
      paddingVertical: 12,
      paddingHorizontal: 20,
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 8,
    },
    cartFabText: { color: '#fff', fontWeight: '700', fontSize: 16 },
    closeBtn: {
      position: 'absolute',
      top: 16,
      right: 16,
      padding: 8,
    },
  });

  return (
    <Modal
      visible={business !== null}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      {business && (
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            {/* Handle */}
            <View style={styles.handle} />

            {/* Header row */}
            <View style={styles.headerRow}>
              <View style={styles.logoCircle}>
                <Text style={styles.logoText}>{business.name[0].toUpperCase()}</Text>
              </View>
              <View style={styles.headerInfo}>
                <Text style={styles.name} numberOfLines={2}>{business.name}</Text>
                {business.is_verified && (
                  <Text style={styles.verifiedBadge}>★ Verified WLW Business</Text>
                )}
                {business.location_city && (
                  <Text style={styles.city}>📍 {business.location_city}</Text>
                )}
              </View>
            </View>

            {/* Bookmark button — absolute top-right, left of close */}
            <TouchableOpacity
              testID="bookmark-btn"
              style={styles.bookmarkBtn}
              onPress={onBookmarkToggle}
              accessibilityLabel={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
              hitSlop={12}
            >
              <Text style={styles.bookmarkIcon}>{isBookmarked ? '💜' : '🤍'}</Text>
            </TouchableOpacity>

            {/* Tab bar */}
            <View style={styles.tabBar}>
              {(['about', 'products', 'photos'] as Tab[]).map(tab => (
                <TouchableOpacity
                  key={tab}
                  style={[styles.tab, activeTab === tab && styles.tabActive]}
                  onPress={() => setActiveTab(tab)}
                  accessibilityLabel={`${tab} tab`}
                >
                  <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Tab content */}
            {activeTab === 'about' && (
              <ScrollView showsVerticalScrollIndicator={false}>
                {business.description && (
                  <Text style={styles.description}>{business.description}</Text>
                )}
                {hasLinks && (
                  <View style={styles.linksSection}>
                    <Text style={styles.linksHeader}>🔗 Links</Text>
                    {business.website_url && (
                      <TouchableOpacity
                        onPress={() => Linking.openURL(business.website_url!).catch(() => {})}
                        style={styles.linkRow}
                      >
                        <Text style={styles.linkText}>🌐 Website →</Text>
                      </TouchableOpacity>
                    )}
                    {business.instagram_handle && (
                      <TouchableOpacity
                        onPress={() =>
                          Linking.openURL(
                            `https://instagram.com/${business.instagram_handle}`
                          ).catch(() => {})
                        }
                        style={styles.linkRow}
                      >
                        <Text style={styles.linkText}>
                          📸 @{business.instagram_handle} →
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
                <View style={{ height: 40 }} />
              </ScrollView>
            )}

            {activeTab === 'photos' && (
              <ScrollView showsVerticalScrollIndicator={false}>
                {photos.length > 0 ? (
                  <View testID="photo-gallery">
                    <BusinessPhotoGallery photos={photos} />
                  </View>
                ) : (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyStateText}>No photos yet</Text>
                  </View>
                )}
                <View style={{ height: 40 }} />
              </ScrollView>
            )}

            {activeTab === 'products' && (
              <View style={{ flex: 1 }}>
                {loadingProducts[businessId] ? (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyStateText}>Loading products...</Text>
                  </View>
                ) : products.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyStateText}>No products available</Text>
                  </View>
                ) : (
                  <FlashList
                    data={products}
                    keyExtractor={item => item.id}
                    renderItem={({ item }) => (
                      <ProductCard
                        product={item}
                        businessId={businessId}
                        businessName={business.name}
                        onAddToCart={handleAddToCart}
                      />
                    )}
                    estimatedItemSize={260}
                    contentContainerStyle={{ padding: 16 }}
                    showsVerticalScrollIndicator={false}
                  />
                )}

                {/* Cart FAB */}
                {cartCount > 0 && (
                  <TouchableOpacity
                    style={styles.cartFab}
                    onPress={() => setShowCart(true)}
                    accessibilityLabel={`View cart, ${cartCount} items`}
                  >
                    <Text style={styles.cartFabText}>🛒 {cartCount}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Close button */}
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} accessibilityLabel="Close business detail">
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Cart drawer */}
          <CartDrawer
            businessId={businessId}
            businessName={business.name}
            visible={showCart}
            onClose={() => setShowCart(false)}
            onCheckout={() => { setShowCart(false); setShowCheckout(true); }}
          />

          {/* Checkout sheet */}
          <CheckoutSheet
            businessId={businessId}
            businessName={business.name}
            visible={showCheckout}
            onClose={() => setShowCheckout(false)}
            onSuccess={handleCheckoutSuccess}
          />

          {/* Order confirmation */}
          <OrderConfirmationSheet
            visible={confirmedOrderId !== null}
            orderId={confirmedOrderId}
            onClose={() => setConfirmedOrderId(null)}
            onViewOrders={handleViewOrders}
          />
        </View>
      )}
    </Modal>
  );
}

