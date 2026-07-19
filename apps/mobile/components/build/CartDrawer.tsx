import React from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, ScrollView, Animated } from 'react-native';
import { usePopIn } from '../ui/popIn';
import { Ionicons } from '@expo/vector-icons';
import { useMarketplaceStore } from '../../store/marketplaceStore';
import { useThemeColors } from '../../hooks/useThemeColors';
import { FRAME_MAX_WIDTH } from '../../hooks/useAppWidth';

interface CartDrawerProps {
  businessId: string;
  businessName: string;
  visible: boolean;
  onClose: () => void;
  onCheckout: () => void;
}

export function CartDrawer({ businessId, businessName, visible, onClose, onCheckout }: CartDrawerProps) {
  const colors = useThemeColors();
  const pop = usePopIn(visible);
  const { cartItems, removeFromCart, updateQuantity, getCartTotal, getCartCount } = useMarketplaceStore();
  const items = cartItems[businessId] ?? [];
  const total = getCartTotal(businessId);
  const count = getCartCount(businessId);

  const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, paddingBottom: 32, width: '100%', maxWidth: FRAME_MAX_WIDTH, alignSelf: 'center' },
    handle: { width: 40, height: 4, backgroundColor: colors.textMuted, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 12 },
    title: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
    count: { fontSize: 13, color: colors.textMuted },
    empty: { alignItems: 'center', paddingVertical: 32 },
    emptyText: { color: colors.textMuted, fontSize: 15 },
    itemRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.surface },
    itemInfo: { flex: 1 },
    itemName: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
    itemVariant: { fontSize: 12, color: colors.textMuted },
    itemPrice: { fontSize: 12, color: colors.textSecondary },
    qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    qtyBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    qtyBtnText: { fontSize: 16, color: colors.textPrimary, fontWeight: '700' },
    qtyText: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, minWidth: 20, textAlign: 'center' },
    footer: { paddingHorizontal: 20, paddingTop: 12, gap: 8 },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    totalLabel: { fontSize: 15, color: colors.textSecondary },
    totalAmount: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
    shippingNote: { fontSize: 12, color: colors.textMuted },
    checkoutBtn: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
    btnDisabled: { opacity: 0.4 },
    checkoutBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
    cancelBtn: { alignItems: 'center', paddingVertical: 10 },
    cancelText: { color: colors.textMuted, fontSize: 14 },
  });

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Animated.View style={[styles.sheet, pop]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Cart · {businessName}</Text>
            <Text style={styles.count}>{count} item{count !== 1 ? 's' : ''}</Text>
          </View>
          {items.length === 0 ? (
            <View style={styles.empty}><Text style={styles.emptyText}>Your cart is empty</Text></View>
          ) : (
            <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
              {items.map((item) => {
                const price = item.variant ? item.variant.price_cents : (item.product?.base_price_cents ?? 0);
                const variantLabel = item.variant
                  ? [
                      item.variant.option1_name ? item.variant.option1_value : null,
                      item.variant.option2_name ? item.variant.option2_value : null,
                    ].filter(Boolean).join(' / ')
                  : null;
                return (
                  <View key={item.id} style={styles.itemRow}>
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemName} numberOfLines={1}>{item.product?.name ?? 'Product'}</Text>
                      {variantLabel ? <Text style={styles.itemVariant}>{variantLabel}</Text> : null}
                      <Text style={styles.itemPrice}>${(price / 100).toFixed(2)} each</Text>
                    </View>
                    <View style={styles.qtyRow}>
                      <TouchableOpacity onPress={() => updateQuantity(businessId, item.id, item.quantity - 1)} style={styles.qtyBtn}>
                        <Text style={styles.qtyBtnText}>−</Text>
                      </TouchableOpacity>
                      <Text style={styles.qtyText}>{item.quantity}</Text>
                      <TouchableOpacity onPress={() => updateQuantity(businessId, item.id, item.quantity + 1)} style={styles.qtyBtn}>
                        <Text style={styles.qtyBtnText}>+</Text>
                      </TouchableOpacity>
                    </View>
                    <TouchableOpacity onPress={() => removeFromCart(businessId, item.id)} hitSlop={10}>
                      <Ionicons name="close" size={16} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>
          )}
          <View style={styles.footer}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalAmount}>${(total / 100).toFixed(2)}</Text>
            </View>
            <Text style={styles.shippingNote}>+ shipping calculated at checkout</Text>
            <TouchableOpacity
              style={[styles.checkoutBtn, items.length === 0 && styles.btnDisabled]}
              onPress={onCheckout}
              disabled={items.length === 0}
              accessibilityLabel="Proceed to checkout"
            >
              <Text style={styles.checkoutBtnText}>Checkout →</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Continue Shopping</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

