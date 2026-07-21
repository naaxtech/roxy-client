import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { ProductDetailSheet } from './ProductDetailSheet';
import { formatMoney } from '../../lib/currency';
import type { ProductWithVariants } from '../../types/marketplace';

interface ProductCardProps {
  product: ProductWithVariants;
  businessId: string;
  businessName: string;
  onAddToCart: (product: ProductWithVariants, variantId: string | null, qty: number) => void;
}

export function ProductCard({ product, businessId, businessName, onAddToCart }: ProductCardProps) {
  const colors = useThemeColors();
  const [showDetail, setShowDetail] = useState(false);

  const photos = [...(product.product_photos ?? [])].sort((a, b) => a.position - b.position);
  const coverPhoto = photos[0];
  const isOutOfStock = product.has_variants &&
    (product.product_variants?.filter(v => v.is_active && v.stock > 0) ?? []).length === 0;

  const handleAddToCart = (variantId: string | null, qty: number) => {
    onAddToCart(product, variantId, qty);
  };

  const styles = StyleSheet.create({
    card: { backgroundColor: colors.surface, borderRadius: 12, overflow: 'hidden', marginBottom: 12 },
    photo: { width: '100%', height: 160 },
    photoPlaceholder: {
      width: '100%', height: 160,
      backgroundColor: colors.primary + '20',
      alignItems: 'center', justifyContent: 'center',
    },
    photoPlaceholderText: { fontSize: 48, color: colors.primary },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: 4, paddingVertical: 6 },
    dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.textMuted + '80' },
    body: { padding: 12, gap: 4 },
    category: { fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
    name: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
    price: { fontSize: 16, fontWeight: '700', color: colors.primary },
    outOfStock: { fontSize: 11, color: colors.textMuted },
  });

  return (
    <>
      <TouchableOpacity
        style={styles.card}
        onPress={() => setShowDetail(true)}
        accessibilityLabel={`View ${product.name} details`}
        activeOpacity={0.85}
      >
        {coverPhoto ? (
          <Image source={{ uri: coverPhoto.url }} style={styles.photo} resizeMode="cover" />
        ) : (
          <View style={styles.photoPlaceholder}>
            <Text style={styles.photoPlaceholderText}>{product.category[0].toUpperCase()}</Text>
          </View>
        )}

        {/* Dot indicators — only when 2+ photos */}
        {photos.length > 1 && (
          <View style={styles.dots}>
            {photos.map((_, i) => (
              <View key={i} testID="card-photo-dot" style={styles.dot} />
            ))}
          </View>
        )}

        <View style={styles.body}>
          <Text style={styles.category}>{product.category}</Text>
          <Text style={styles.name} numberOfLines={2}>{product.name}</Text>
          <Text style={styles.price}>{formatMoney(product.base_price_cents, 'usd')}</Text>
          {isOutOfStock && <Text style={styles.outOfStock}>Out of stock</Text>}
        </View>
      </TouchableOpacity>

      <ProductDetailSheet
        product={product}
        businessId={businessId}
        businessName={businessName}
        visible={showDetail}
        onClose={() => setShowDetail(false)}
        onAddToCart={handleAddToCart}
      />
    </>
  );
}
