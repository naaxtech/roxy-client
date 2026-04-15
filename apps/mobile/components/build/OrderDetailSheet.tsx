import React from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, ScrollView } from 'react-native';
import { COLORS } from '../../lib/constants';
import type { OrderWithItems } from '../../types/marketplace';

const STATUS_COLORS: Record<string, string> = {
  paid: '#3B82F6',
  shipped: '#F59E0B',
  delivered: '#10B981',
  refunded: '#EF4444',
  cancelled: '#6B7280',
};

interface OrderDetailSheetProps {
  order: OrderWithItems | null;
  onClose: () => void;
}

export function OrderDetailSheet({ order, onClose }: OrderDetailSheetProps) {
  if (!order) return null;

  return (
    <Modal visible={order !== null} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Order #{order.id.slice(-8).toUpperCase()}</Text>
            <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLORS[order.status] ?? '#6B7280') + '20' }]}>
              <Text style={[styles.statusText, { color: STATUS_COLORS[order.status] ?? '#6B7280' }]}>
                {order.status.toUpperCase()}
              </Text>
            </View>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Items */}
            <Text style={styles.sectionTitle}>Items</Text>
            {order.order_items.map((item) => (
              <View key={item.id} style={styles.itemRow}>
                <Text style={styles.itemName} numberOfLines={1}>{item.product_name} × {item.quantity}</Text>
                <Text style={styles.itemPrice}>${(item.total_price_cents / 100).toFixed(2)}</Text>
              </View>
            ))}
            {/* Totals */}
            <View style={styles.divider} />
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>${(order.subtotal_cents / 100).toFixed(2)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Shipping</Text>
              <Text style={styles.totalValue}>${(order.shipping_cost_cents / 100).toFixed(2)}</Text>
            </View>
            {order.tax_cents > 0 && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Tax</Text>
                <Text style={styles.totalValue}>${(order.tax_cents / 100).toFixed(2)}</Text>
              </View>
            )}
            <View style={styles.totalRow}>
              <Text style={[styles.totalLabel, { fontWeight: '700', color: COLORS.textPrimary }]}>Total</Text>
              <Text style={[styles.totalValue, { fontWeight: '700', color: COLORS.textPrimary }]}>
                ${(order.total_cents / 100).toFixed(2)}
              </Text>
            </View>
            {/* Shipping address */}
            <Text style={styles.sectionTitle}>Shipping To</Text>
            <Text style={styles.addressText}>{order.shipping_name}</Text>
            <Text style={styles.addressText}>{order.shipping_line1}{order.shipping_line2 ? `, ${order.shipping_line2}` : ''}</Text>
            <Text style={styles.addressText}>{order.shipping_city}, {order.shipping_state} {order.shipping_postal_code}</Text>
            {/* Tracking */}
            {order.tracking_number && (
              <View style={styles.trackingBox}>
                <Text style={styles.sectionTitle}>Tracking</Text>
                <Text style={styles.trackingNumber}>{order.tracking_number}</Text>
              </View>
            )}
            {/* Timeline */}
            {order.order_events.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Timeline</Text>
                {order.order_events.map((event) => (
                  <View key={event.id} style={styles.eventRow}>
                    <View style={styles.eventDot} />
                    <View style={styles.eventInfo}>
                      <Text style={styles.eventType}>{event.event_type.replace(/_/g, ' ').toUpperCase()}</Text>
                      <Text style={styles.eventDesc}>{event.description}</Text>
                      <Text style={styles.eventDate}>{new Date(event.created_at).toLocaleDateString()}</Text>
                    </View>
                  </View>
                ))}
              </>
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} accessibilityLabel="Close order detail">
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, maxHeight: '90%' },
  handle: { width: 40, height: 4, backgroundColor: COLORS.textMuted, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 16 },
  title: { fontSize: 17, fontWeight: '700', color: COLORS.textPrimary },
  statusBadge: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 6 },
  itemName: { flex: 1, fontSize: 14, color: COLORS.textPrimary },
  itemPrice: { fontSize: 14, fontWeight: '600', color: COLORS.textPrimary },
  divider: { height: 1, backgroundColor: COLORS.surface, marginHorizontal: 20, marginVertical: 8 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 3 },
  totalLabel: { fontSize: 14, color: COLORS.textSecondary },
  totalValue: { fontSize: 14, color: COLORS.textSecondary },
  addressText: { fontSize: 14, color: COLORS.textPrimary, paddingHorizontal: 20, paddingVertical: 1 },
  trackingBox: { marginHorizontal: 20, marginTop: 8 },
  trackingNumber: { fontSize: 15, fontWeight: '700', color: COLORS.primary, fontFamily: 'monospace' },
  eventRow: { flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 6, gap: 12 },
  eventDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.primary, marginTop: 5 },
  eventInfo: { flex: 1 },
  eventType: { fontSize: 11, fontWeight: '700', color: COLORS.textMuted, letterSpacing: 0.5 },
  eventDesc: { fontSize: 13, color: COLORS.textPrimary },
  eventDate: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  closeBtn: { position: 'absolute', top: 16, right: 16, padding: 8 },
  closeBtnText: { color: COLORS.textMuted, fontSize: 18, fontWeight: '700' },
});
