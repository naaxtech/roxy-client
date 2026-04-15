import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, ScrollView, TextInput, ActivityIndicator, Alert } from 'react-native';
import { useStripe } from '@stripe/stripe-react-native';
import { COLORS } from '../../lib/constants';
import { useMarketplaceStore } from '../../store/marketplaceStore';
import type { ShippingAddress } from '../../types/marketplace';

type Step = 'review' | 'shipping' | 'payment';

const STEPS: Step[] = ['review', 'shipping', 'payment'];

interface CheckoutSheetProps {
  businessId: string;
  businessName: string;
  visible: boolean;
  onClose: () => void;
  onSuccess: (orderId: string) => void;
}

export function CheckoutSheet({ businessId, businessName, visible, onClose, onSuccess }: CheckoutSheetProps) {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const { cartItems, getCartTotal, createOrder, clearCart } = useMarketplaceStore();

  const [step, setStep] = useState<Step>('review');
  const [shipping, setShipping] = useState<ShippingAddress>({
    name: '', line1: '', line2: '', city: '', state: '', postal_code: '', country: 'US',
  });
  const [paymentLoading, setPaymentLoading] = useState(false);

  const items = cartItems[businessId] ?? [];
  const subtotal = getCartTotal(businessId);

  const isShippingValid = !!(shipping.name && shipping.line1 && shipping.city && shipping.state && shipping.postal_code);

  const handlePayment = async () => {
    if (!isShippingValid) return;
    setPaymentLoading(true);
    try {
      const result = await createOrder(businessId, shipping);
      if (!result) {
        Alert.alert('Error', 'Failed to create order. Please try again.');
        return;
      }
      const { clientSecret, orderId } = result;

      const { error: initError } = await initPaymentSheet({
        paymentIntentClientSecret: clientSecret,
        merchantDisplayName: `Roxy × ${businessName}`,
        allowsDelayedPaymentMethods: false,
      });
      if (initError) {
        Alert.alert('Payment Error', initError.message);
        return;
      }

      const { error: payError } = await presentPaymentSheet();
      if (payError) {
        if (payError.code !== 'Canceled') {
          Alert.alert('Payment Failed', payError.message);
        }
        return;
      }

      // Payment succeeded
      clearCart(businessId);
      onSuccess(orderId);
    } finally {
      setPaymentLoading(false);
    }
  };

  const renderReview = () => (
    <ScrollView showsVerticalScrollIndicator={false}>
      <Text style={styles.stepTitle}>Review Order</Text>
      {items.map((item) => {
        const price = item.variant ? item.variant.price_cents : (item.product?.base_price_cents ?? 0);
        return (
          <View key={item.id} style={styles.reviewItem}>
            <Text style={styles.reviewItemName} numberOfLines={1}>{item.product?.name ?? 'Product'} × {item.quantity}</Text>
            <Text style={styles.reviewItemPrice}>${(price * item.quantity / 100).toFixed(2)}</Text>
          </View>
        );
      })}
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Subtotal</Text>
        <Text style={styles.totalAmount}>${(subtotal / 100).toFixed(2)}</Text>
      </View>
      <Text style={styles.shippingNote}>Shipping calculated at next step</Text>
      <TouchableOpacity style={styles.primaryBtn} onPress={() => setStep('shipping')}>
        <Text style={styles.primaryBtnText}>Continue to Shipping →</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  const renderShipping = () => (
    <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <Text style={styles.stepTitle}>Shipping Address</Text>
      {[
        { key: 'name' as const, label: 'Full Name', placeholder: 'Jane Doe' },
        { key: 'line1' as const, label: 'Address', placeholder: '123 Main St' },
        { key: 'line2' as const, label: 'Apt/Suite (optional)', placeholder: 'Apt 4B' },
        { key: 'city' as const, label: 'City', placeholder: 'New York' },
        { key: 'state' as const, label: 'State', placeholder: 'NY' },
        { key: 'postal_code' as const, label: 'ZIP Code', placeholder: '10001' },
      ].map(({ key, label, placeholder }) => (
        <View key={key} style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <TextInput
            style={styles.input}
            value={shipping[key] as string}
            onChangeText={(v) => setShipping(s => ({ ...s, [key]: v }))}
            placeholder={placeholder}
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize={key === 'state' ? 'characters' : 'words'}
            autoCorrect={false}
          />
        </View>
      ))}
      <View style={styles.rowBtns}>
        <TouchableOpacity style={styles.backBtn} onPress={() => setStep('review')}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryBtn, { flex: 1 }, !isShippingValid && styles.btnDisabled]}
          onPress={() => setStep('payment')}
          disabled={!isShippingValid}
        >
          <Text style={styles.primaryBtnText}>Continue to Payment →</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  const renderPayment = () => (
    <View>
      <Text style={styles.stepTitle}>Payment</Text>
      <View style={styles.summaryBox}>
        <Text style={styles.summaryLabel}>Shipping to</Text>
        <Text style={styles.summaryValue}>{shipping.name}</Text>
        <Text style={styles.summaryValue}>{shipping.line1}{shipping.line2 ? `, ${shipping.line2}` : ''}</Text>
        <Text style={styles.summaryValue}>{shipping.city}, {shipping.state} {shipping.postal_code}</Text>
      </View>
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={[styles.totalAmount, { fontSize: 22 }]}>${(subtotal / 100).toFixed(2)}</Text>
      </View>
      <View style={styles.rowBtns}>
        <TouchableOpacity style={styles.backBtn} onPress={() => setStep('shipping')}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryBtn, { flex: 1 }, paymentLoading && styles.btnDisabled]}
          onPress={handlePayment}
          disabled={paymentLoading}
          accessibilityLabel="Pay now"
        >
          {paymentLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>Pay ${(subtotal / 100).toFixed(2)} →</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          {/* Step indicator */}
          <View style={styles.steps}>
            {STEPS.map((s, i) => (
              <React.Fragment key={s}>
                <View style={[
                  styles.stepDot,
                  step === s && styles.stepDotActive,
                  STEPS.indexOf(step) > i && styles.stepDotDone,
                ]}>
                  <Text style={styles.stepDotText}>{i + 1}</Text>
                </View>
                {i < 2 && (
                  <View style={[styles.stepLine, STEPS.indexOf(step) > i && styles.stepLineDone]} />
                )}
              </React.Fragment>
            ))}
          </View>
          <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
            {step === 'review' && renderReview()}
            {step === 'shipping' && renderShipping()}
            {step === 'payment' && renderPayment()}
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} accessibilityLabel="Close checkout">
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, maxHeight: '92%' },
  handle: { width: 40, height: 4, backgroundColor: COLORS.textMuted, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  steps: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, marginBottom: 20 },
  stepDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  stepDotActive: { backgroundColor: COLORS.primary },
  stepDotDone: { backgroundColor: COLORS.primary + '80' },
  stepDotText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  stepLine: { flex: 1, height: 2, backgroundColor: COLORS.surface },
  stepLineDone: { backgroundColor: COLORS.primary + '80' },
  stepTitle: { fontSize: 20, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 16 },
  reviewItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.surface },
  reviewItemName: { flex: 1, fontSize: 14, color: COLORS.textPrimary },
  reviewItemPrice: { fontSize: 14, fontWeight: '700', color: COLORS.textPrimary },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  totalLabel: { fontSize: 15, color: COLORS.textSecondary },
  totalAmount: { fontSize: 18, fontWeight: '700', color: COLORS.textPrimary },
  shippingNote: { fontSize: 12, color: COLORS.textMuted, marginBottom: 16 },
  primaryBtn: { backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  btnDisabled: { opacity: 0.4 },
  fieldGroup: { marginBottom: 12 },
  fieldLabel: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 4, fontWeight: '600' },
  input: { backgroundColor: COLORS.surface, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: COLORS.textPrimary, fontSize: 15 },
  rowBtns: { flexDirection: 'row', gap: 10, marginTop: 8 },
  backBtn: { paddingVertical: 16, paddingHorizontal: 16, borderRadius: 12, backgroundColor: COLORS.surface, alignItems: 'center' },
  backBtnText: { color: COLORS.textMuted, fontWeight: '600' },
  summaryBox: { backgroundColor: COLORS.surface, borderRadius: 10, padding: 14, marginBottom: 12, gap: 2 },
  summaryLabel: { fontSize: 12, color: COLORS.textMuted, fontWeight: '600', marginBottom: 4 },
  summaryValue: { fontSize: 14, color: COLORS.textPrimary },
  closeBtn: { position: 'absolute', top: 16, right: 16, padding: 8 },
  closeBtnText: { color: COLORS.textMuted, fontSize: 18, fontWeight: '700' },
});
