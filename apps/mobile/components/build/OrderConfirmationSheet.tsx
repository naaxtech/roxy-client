import React from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { COLORS } from '../../lib/constants';

interface OrderConfirmationSheetProps {
  visible: boolean;
  orderId: string | null;
  onClose: () => void;
  onViewOrders: () => void;
}

export function OrderConfirmationSheet({ visible, orderId, onClose, onViewOrders }: OrderConfirmationSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.emoji}>🎉</Text>
          <Text style={styles.title}>Order Placed!</Text>
          <Text style={styles.subtitle}>Your order has been confirmed. You'll receive an email confirmation shortly.</Text>
          {orderId && <Text style={styles.orderId}>Order #{orderId.slice(-8).toUpperCase()}</Text>}
          <TouchableOpacity style={styles.primaryBtn} onPress={onViewOrders}>
            <Text style={styles.primaryBtnText}>View My Orders</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={styles.secondaryBtn}>
            <Text style={styles.secondaryBtnText}>Continue Shopping</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: COLORS.background, borderRadius: 20, padding: 28, alignItems: 'center', width: '100%', gap: 8 },
  emoji: { fontSize: 56 },
  title: { fontSize: 24, fontWeight: '700', color: COLORS.textPrimary },
  subtitle: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20 },
  orderId: { fontSize: 13, color: COLORS.textMuted, fontFamily: 'monospace', marginTop: 4 },
  primaryBtn: { backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32, marginTop: 12, width: '100%', alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondaryBtn: { paddingVertical: 10 },
  secondaryBtnText: { color: COLORS.textMuted, fontSize: 14 },
});
