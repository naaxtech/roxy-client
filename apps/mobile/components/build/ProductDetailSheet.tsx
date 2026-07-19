import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet,
  ScrollView, Image, NativeSyntheticEvent,
  NativeScrollEvent, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useAppWidth } from '../../hooks/useAppWidth';
import { usePopIn } from '../ui/popIn';
import { CheckoutSheet } from './CheckoutSheet';
import type { ProductWithVariants, ProductVariant } from '../../types/marketplace';

interface ProductDetailSheetProps {
  product: ProductWithVariants;
  businessId: string;
  businessName: string;
  visible: boolean;
  onClose: () => void;
  /** Called when user taps Add to Cart. variantId is null for products without variants. */
  onAddToCart: (variantId: string | null, qty: number) => void;
}

export function ProductDetailSheet({
  product,
  businessId,
  businessName,
  visible,
  onClose,
  onAddToCart,
}: ProductDetailSheetProps) {
  const colors = useThemeColors();
  const screenWidth = useAppWidth();
  const pop = usePopIn(visible);
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);
  const [qty, setQty] = useState(1);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [showBuyNow, setShowBuyNow] = useState(false);

  const photos = [...(product.product_photos ?? [])].sort((a, b) => a.position - b.position);
  const activeVariants = product.product_variants?.filter(v => v.is_active && v.stock > 0) ?? [];
  const isOutOfStock = product.has_variants && activeVariants.length === 0;
  const needsVariant = product.has_variants && !selectedVariant;

  const displayPrice = selectedVariant
    ? selectedVariant.price_cents
    : product.base_price_cents;

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
    setPhotoIndex(idx);
  };

  const handleAddToCart = () => {
    if (needsVariant) return;
    onAddToCart(selectedVariant?.id ?? null, qty);
    onClose();
  };

  const handleBuyNow = () => {
    if (needsVariant) return;
    setShowBuyNow(true);
  };

  const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingTop: 12,
      maxHeight: '92%',
      // Modal portals outside the web app frame — clamp to the app column.
      width: '100%',
      maxWidth: screenWidth,
      alignSelf: 'center',
    },
    handle: {
      width: 40, height: 4,
      backgroundColor: colors.textMuted,
      borderRadius: 2,
      alignSelf: 'center',
      marginBottom: 8,
    },
    closeBtn: { position: 'absolute', top: 16, right: 16, zIndex: 10, padding: 4 },
    gallery: { width: screenWidth, height: 280 },
    galleryImage: { width: screenWidth, height: 280 },
    photoPlaceholder: {
      width: '100%', height: 200,
      backgroundColor: colors.primary + '20',
      alignItems: 'center', justifyContent: 'center',
    },
    photoPlaceholderText: { fontSize: 64, color: colors.primary },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: 8 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.textMuted + '60' },
    dotActive: { backgroundColor: colors.primary },
    body: { padding: 20, gap: 8 },
    category: { fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
    name: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
    price: { fontSize: 22, fontWeight: '700', color: colors.primary },
    description: { fontSize: 14, color: colors.textMuted, lineHeight: 20, marginTop: 4 },
    section: { marginTop: 8, gap: 6 },
    sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
    outOfStock: { fontSize: 13, color: colors.textMuted },
    variantRow: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingVertical: 10, paddingHorizontal: 12,
      borderRadius: 8, backgroundColor: colors.surface,
    },
    variantRowSelected: { borderWidth: 2, borderColor: colors.primary },
    variantLabel: { fontSize: 14, color: colors.textPrimary },
    variantPrice: { fontSize: 14, fontWeight: '700', color: colors.primary },
    qtyRow: {
      flexDirection: 'row', alignItems: 'center',
      justifyContent: 'space-between', marginTop: 8,
    },
    qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    qtyBtn: {
      width: 32, height: 32, borderRadius: 16,
      backgroundColor: colors.surface,
      alignItems: 'center', justifyContent: 'center',
    },
    qtyBtnText: { fontSize: 18, color: colors.textPrimary, fontWeight: '700' },
    qtyText: {
      fontSize: 16, fontWeight: '700', color: colors.textPrimary,
      minWidth: 20, textAlign: 'center',
    },
    ctaSection: { gap: 10, marginTop: 16, paddingBottom: 24 },
    addToCartBtn: {
      backgroundColor: colors.primary,
      borderRadius: 12, paddingVertical: 14, alignItems: 'center',
    },
    addToCartText: { color: '#fff', fontWeight: '700', fontSize: 16 },
    buyNowBtn: {
      borderWidth: 1.5, borderColor: colors.primary,
      borderRadius: 12, paddingVertical: 13, alignItems: 'center',
    },
    buyNowText: { color: colors.primary, fontWeight: '700', fontSize: 16 },
    btnDisabled: { opacity: 0.4 },
  });

  return (
    <>
      <Modal
        visible={visible}
        animationType="none"
        transparent
        onRequestClose={onClose}
      >
        <View style={styles.overlay}>
          <Animated.View style={[styles.sheet, pop]}>
            <View style={styles.handle} />

            {/* Close button */}
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Photo gallery */}
              {photos.length > 0 ? (
                <View>
                  <ScrollView
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    onMomentumScrollEnd={handleScroll}
                    style={styles.gallery}
                  >
                    {photos.map(photo => (
                      <Image
                        key={photo.id}
                        source={{ uri: photo.url }}
                        style={styles.galleryImage}
                        resizeMode="cover"
                        accessibilityLabel={photo.alt_text ?? product.name}
                      />
                    ))}
                  </ScrollView>
                  {/* Dot indicators — only shown for 2+ photos */}
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
                  <Text style={styles.photoPlaceholderText}>
                    {product.category[0].toUpperCase()}
                  </Text>
                </View>
              )}

              {/* Product info */}
              <View style={styles.body}>
                <Text style={styles.category}>{product.category}</Text>
                <Text style={styles.name}>{product.name}</Text>
                <Text style={styles.price}>${(displayPrice / 100).toFixed(2)}</Text>

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
                      activeVariants.map(v => {
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
                            onPress={() => setSelectedVariant(v)}
                          >
                            <Text style={styles.variantLabel}>{label}</Text>
                            <Text style={styles.variantPrice}>
                              ${(v.price_cents / 100).toFixed(2)}
                            </Text>
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
                        onPress={() => setQty(q => Math.max(1, q - 1))}
                        style={styles.qtyBtn}
                        accessibilityLabel="Decrease quantity"
                      >
                        <Text style={styles.qtyBtnText}>−</Text>
                      </TouchableOpacity>
                      <Text style={styles.qtyText}>{qty}</Text>
                      <TouchableOpacity
                        onPress={() => setQty(q => q + 1)}
                        style={styles.qtyBtn}
                        accessibilityLabel="Increase quantity"
                      >
                        <Text style={styles.qtyBtnText}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {/* CTA buttons */}
                <View style={styles.ctaSection}>
                  <TouchableOpacity
                    style={[
                      styles.addToCartBtn,
                      (isOutOfStock || needsVariant) && styles.btnDisabled,
                    ]}
                    onPress={handleAddToCart}
                    disabled={isOutOfStock || needsVariant}
                    accessibilityLabel={
                      isOutOfStock ? 'Out of stock' : `Add ${product.name} to cart`
                    }
                  >
                    <Text style={styles.addToCartText}>
                      {isOutOfStock ? 'Out of Stock' : 'Add to Cart'}
                    </Text>
                  </TouchableOpacity>

                  {!isOutOfStock && (
                    <TouchableOpacity
                      style={[styles.buyNowBtn, needsVariant && styles.btnDisabled]}
                      onPress={handleBuyNow}
                      disabled={needsVariant}
                      accessibilityLabel={`Buy ${product.name} now`}
                    >
                      <Text style={styles.buyNowText}>Buy Now</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      {/* Buy Now checkout — opens on top of this sheet */}
      <CheckoutSheet
        businessId={businessId}
        businessName={businessName}
        visible={showBuyNow}
        onClose={() => setShowBuyNow(false)}
        onSuccess={() => { setShowBuyNow(false); onClose(); }}
        buyNowItem={{ product, variantId: selectedVariant?.id ?? null, quantity: qty }}
      />
    </>
  );
}
