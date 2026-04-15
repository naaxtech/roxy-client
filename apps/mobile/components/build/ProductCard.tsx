import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, ScrollView, Image } from 'react-native';
import { COLORS } from '../../lib/constants';
import type { ProductWithVariants, ProductVariant } from '../../types/marketplace';

interface ProductCardProps {
  product: ProductWithVariants;
  onAddToCart: (product: ProductWithVariants, variantId: string | null, qty: number) => void;
}

export function ProductCard({ product, onAddToCart }: ProductCardProps) {
  const [showVariants, setShowVariants] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);
  const [qty, setQty] = useState(1);
  const photo = product.product_photos?.[0];
  const displayPrice = selectedVariant
    ? selectedVariant.price_cents
    : product.base_price_cents;

  const handleAdd = () => {
    if (product.has_variants && !selectedVariant) {
      setShowVariants(true);
      return;
    }
    onAddToCart(product, selectedVariant?.id ?? null, qty);
    setShowVariants(false);
    setSelectedVariant(null);
    setQty(1);
  };

  const activeVariants = product.product_variants?.filter(v => v.is_active && v.stock > 0) ?? [];

  return (
    <View style={styles.card}>
      {photo ? (
        <Image source={{ uri: photo.url }} style={styles.photo} resizeMode="cover" />
      ) : (
        <View style={styles.photoPlaceholder}>
          <Text style={styles.photoPlaceholderText}>{product.category[0].toUpperCase()}</Text>
        </View>
      )}
      <View style={styles.body}>
        <Text style={styles.category}>{product.category}</Text>
        <Text style={styles.name} numberOfLines={2}>{product.name}</Text>
        <Text style={styles.price}>${(displayPrice / 100).toFixed(2)}</Text>
        {product.has_variants && <Text style={styles.variantHint}>{activeVariants.length} variants</Text>}
        <TouchableOpacity
          style={[styles.addBtn, product.has_variants && activeVariants.length === 0 && styles.addBtnDisabled]}
          onPress={handleAdd}
          disabled={product.has_variants && activeVariants.length === 0}
          accessibilityLabel={`Add ${product.name} to cart`}
        >
          <Text style={styles.addBtnText}>
            {product.has_variants && activeVariants.length === 0 ? 'Out of Stock' : 'Add to Cart'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Variant picker */}
      <Modal visible={showVariants} transparent animationType="slide" onRequestClose={() => setShowVariants(false)}>
        <View style={styles.variantOverlay}>
          <View style={styles.variantSheet}>
            <View style={styles.handle} />
            <Text style={styles.variantTitle}>{product.name}</Text>
            <Text style={styles.variantSubtitle}>Choose an option</Text>
            <ScrollView style={{ maxHeight: 240 }}>
              {activeVariants.map(v => {
                const label = [
                  v.option1_name ? `${v.option1_name}: ${v.option1_value}` : null,
                  v.option2_name ? `${v.option2_name}: ${v.option2_value}` : null,
                ].filter(Boolean).join(' / ') || v.sku || 'Default';
                return (
                  <TouchableOpacity
                    key={v.id}
                    style={[styles.variantRow, selectedVariant?.id === v.id && styles.variantRowSelected]}
                    onPress={() => setSelectedVariant(v)}
                  >
                    <Text style={styles.variantLabel}>{label}</Text>
                    <Text style={styles.variantPrice}>${(v.price_cents / 100).toFixed(2)}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            {/* Qty */}
            <View style={styles.qtyRow}>
              <TouchableOpacity onPress={() => setQty(q => Math.max(1, q - 1))} style={styles.qtyBtn}>
                <Text style={styles.qtyBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.qtyText}>{qty}</Text>
              <TouchableOpacity onPress={() => setQty(q => q + 1)} style={styles.qtyBtn}>
                <Text style={styles.qtyBtnText}>+</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.confirmBtn, !selectedVariant && styles.addBtnDisabled]}
              onPress={handleAdd}
              disabled={!selectedVariant}
            >
              <Text style={styles.addBtnText}>
                Add to Cart — ${((selectedVariant?.price_cents ?? product.base_price_cents) * qty / 100).toFixed(2)}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowVariants(false)} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: COLORS.surface, borderRadius: 12, overflow: 'hidden', marginBottom: 12 },
  photo: { width: '100%', height: 160 },
  photoPlaceholder: { width: '100%', height: 160, backgroundColor: COLORS.primary + '20', alignItems: 'center', justifyContent: 'center' },
  photoPlaceholderText: { fontSize: 48, color: COLORS.primary },
  body: { padding: 12, gap: 4 },
  category: { fontSize: 11, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  name: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  price: { fontSize: 16, fontWeight: '700', color: COLORS.primary },
  variantHint: { fontSize: 11, color: COLORS.textMuted },
  addBtn: { backgroundColor: COLORS.primary, borderRadius: 8, paddingVertical: 8, alignItems: 'center', marginTop: 8 },
  addBtnDisabled: { opacity: 0.4 },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  variantOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  variantSheet: { backgroundColor: COLORS.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingTop: 12 },
  handle: { width: 40, height: 4, backgroundColor: COLORS.textMuted, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  variantTitle: { fontSize: 17, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 4 },
  variantSubtitle: { fontSize: 13, color: COLORS.textMuted, marginBottom: 12 },
  variantRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, marginBottom: 6, backgroundColor: COLORS.surface },
  variantRowSelected: { borderWidth: 2, borderColor: COLORS.primary },
  variantLabel: { fontSize: 14, color: COLORS.textPrimary },
  variantPrice: { fontSize: 14, fontWeight: '700', color: COLORS.primary },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, marginVertical: 12 },
  qtyBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  qtyBtnText: { fontSize: 20, color: COLORS.textPrimary, fontWeight: '700' },
  qtyText: { fontSize: 18, fontWeight: '700', color: COLORS.textPrimary, minWidth: 24, textAlign: 'center' },
  confirmBtn: { backgroundColor: COLORS.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginBottom: 8 },
  cancelBtn: { alignItems: 'center', paddingVertical: 10 },
  cancelText: { color: COLORS.textMuted, fontSize: 14 },
});
