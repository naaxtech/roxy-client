import React from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { usePopIn } from '../ui/popIn';
import { useThemeColors } from '../../hooks/useThemeColors';

const BRAND_GRADIENT = ['#FF6A2E', '#FF2F71', '#E81C8E'] as const;

interface OrderConfirmationSheetProps {
  visible: boolean;
  /**
   * null when the payment went through but the order row (written by the Stripe
   * webhook) has not appeared yet. The copy says so instead of implying failure.
   */
  orderId: string | null;
  onClose: () => void;
  onViewOrders: () => void;
}

export function OrderConfirmationSheet({ visible, orderId, onClose, onViewOrders }: OrderConfirmationSheetProps) {
  const colors = useThemeColors();
  const pop = usePopIn(visible);
  const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 24 },
    card: { backgroundColor: colors.background, borderRadius: 20, padding: 28, alignItems: 'center', width: '100%', maxWidth: 400, gap: 8 },
    iconPlate: {
      width: 64, height: 64, borderRadius: 32,
      alignItems: 'center', justifyContent: 'center', marginBottom: 4,
    },
    title: { fontSize: 24, fontWeight: '700', color: colors.textPrimary },
    subtitle: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
    orderId: { fontSize: 13, color: colors.textMuted, fontFamily: 'monospace', marginTop: 4 },
    primaryBtn: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32, marginTop: 12, width: '100%', alignItems: 'center' },
    primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
    secondaryBtn: { paddingVertical: 10 },
    secondaryBtnText: { color: colors.textMuted, fontSize: 14 },
  });

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Animated.View style={[styles.card, pop]}>
          <LinearGradient colors={BRAND_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.iconPlate}>
            <Ionicons name="checkmark-circle" size={34} color="#fff" />
          </LinearGradient>
          <Text style={styles.title}>{orderId ? 'Order Placed!' : 'Payment Received'}</Text>
          <Text style={styles.subtitle}>
            {orderId
              ? "Your order has been confirmed. You'll receive an email confirmation shortly."
              : "Your payment went through. We're still finalising the order — it'll appear in My Orders in a moment."}
          </Text>
          {orderId && <Text style={styles.orderId}>Order #{orderId.slice(-8).toUpperCase()}</Text>}
          <TouchableOpacity style={styles.primaryBtn} onPress={onViewOrders}>
            <Text style={styles.primaryBtnText}>View My Orders</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={styles.secondaryBtn}>
            <Text style={styles.secondaryBtnText}>Continue Shopping</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}
