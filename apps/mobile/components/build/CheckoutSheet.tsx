import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, ScrollView, TextInput, ActivityIndicator, Animated } from 'react-native';
import { useStripe } from '@stripe/stripe-react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMarketplaceStore } from '../../store/marketplaceStore';
import { useThemeColors } from '../../hooks/useThemeColors';
import { FRAME_MAX_WIDTH } from '../../hooks/useAppWidth';
import { usePopIn } from '../ui/popIn';
import { formatMoney, currencyCode } from '../../lib/currency';
import { newIdempotencyKey, checkoutSignature } from '../../lib/idempotency';
import type { ProductWithVariants, ShippingAddress, CheckoutLine } from '../../types/marketplace';

type Step = 'review' | 'shipping' | 'payment';

const STEPS: Step[] = ['review', 'shipping', 'payment'];

/** idle → creating (server opens the PaymentIntent) → paying (Stripe sheet) → confirming (webhook writes the order). */
type Phase = 'idle' | 'creating' | 'paying' | 'confirming';

const PHASE_LABEL: Record<Exclude<Phase, 'idle'>, string> = {
  creating: 'Preparing your order…',
  paying: 'Opening secure checkout…',
  confirming: 'Confirming your order…',
};

interface CheckoutSheetProps {
  businessId: string;
  businessName: string;
  visible: boolean;
  onClose: () => void;
  /** orderId is null when payment succeeded but the order row has not landed yet. */
  onSuccess: (orderId: string | null) => void;
  /** When set, bypasses the cart and checks out this single item directly. Cart is not cleared on success. */
  buyNowItem?: { product: ProductWithVariants; variantId: string | null; quantity: number };
}

export function CheckoutSheet({ businessId, businessName, visible, onClose, onSuccess, buyNowItem }: CheckoutSheetProps) {
  const colors = useThemeColors();
  const pop = usePopIn(visible);
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const {
    cartItems, getCartTotal, createOrder, clearCart, buyNow,
    latestOrderId, awaitNewOrderId, fetchOrders,
    businessCurrency, fetchBusinessCurrency, releaseCheckout,
  } = useMarketplaceStore();
  /** The seller's own currency — the one create-product-order opens the intent in. */
  const currency = businessCurrency(businessId);

  const [step, setStep] = useState<Step>('review');
  const [shipping, setShipping] = useState<ShippingAddress>({
    name: '', line1: '', line2: '', city: '', state: '', postal_code: '', country: 'US',
  });
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  /**
   * The PaymentIntent already opened for this exact basket + address. Reused when the
   * buyer dismisses the Stripe sheet and taps Pay again: asking the server for a second
   * PaymentIntent would decrement stock a second time for the same purchase.
   *
   * A ref, not state — nothing renders from it, and the close and unmount paths both
   * have to read whatever is current at the moment they fire.
   */
  const openIntent = useRef<{ clientSecret: string; paymentIntentId: string | null; signature: string } | null>(null);
  const paymentLoading = phase !== 'idle';

  // When buyNowItem is set, use it instead of cart
  const cartItemsList = cartItems[businessId] ?? [];
  const items = buyNowItem
    ? [{
        id: 'buy-now',
        cart_id: '',
        product_id: buyNowItem.product.id,
        variant_id: buyNowItem.variantId,
        quantity: buyNowItem.quantity,
        added_at: '',
        product: buyNowItem.product,
        variant: buyNowItem.variantId
          ? buyNowItem.product.product_variants.find(v => v.id === buyNowItem.variantId)
          : undefined,
      }]
    : cartItemsList;

  const subtotal = buyNowItem
    ? (() => {
        const variant = buyNowItem.variantId
          ? buyNowItem.product.product_variants.find(v => v.id === buyNowItem.variantId)
          : null;
        const unitPrice = variant ? variant.price_cents : buyNowItem.product.base_price_cents;
        return unitPrice * buyNowItem.quantity;
      })()
    : getCartTotal(businessId);

  const isShippingValid = !!(shipping.name && shipping.line1 && shipping.city && shipping.state && shipping.postal_code);

  const lines: CheckoutLine[] = items.map((item) => ({
    product_id: item.product_id,
    variant_id: item.variant_id,
    quantity: item.quantity,
  }));

  // An intent still open at this point belongs to a buyer who has gone, and it is holding
  // stock nobody else can buy. Handing it back here turns most abandonment into an
  // immediate release instead of waiting out the server's hold window.
  const abandonOpenIntent = async (): Promise<void> => {
    const abandoned = openIntent.current;
    openIntent.current = null;
    if (abandoned?.paymentIntentId) await releaseCheckout(abandoned.paymentIntentId);
  };

  // Closing the sheet ends the attempt: the next open starts at review with a fresh
  // PaymentIntent, never a stale client secret for a basket the buyer has since changed.
  useEffect(() => {
    if (visible) return;
    setStep('review');
    setPhase('idle');
    setError(null);
    void abandonOpenIntent();
    // Deliberately keyed on `visible` alone: abandonOpenIntent reads a ref and a stable
    // Zustand action, so listing it would re-run this reset on every render.
  }, [visible]);

  // Navigating away mid-checkout is the same abandonment without the visibility change
  // that would otherwise report it. Cleanup only, so it runs once on unmount.
  useEffect(() => () => { void abandonOpenIntent(); }, []);

  // Self-sufficient rather than relying on whichever screen opened the sheet: a deep link
  // into a product reaches checkout without the business page ever mounting.
  useEffect(() => {
    if (!visible) return;
    void fetchBusinessCurrency(businessId);
  }, [visible, businessId, fetchBusinessCurrency]);

  const handlePayment = async () => {
    if (!isShippingValid || phase !== 'idle') return;
    setError(null);

    const signature = checkoutSignature(lines, shipping);
    let clientSecret = openIntent.current?.signature === signature ? openIntent.current.clientSecret : null;

    if (!clientSecret) {
      setPhase('creating');
      // A basket or address change makes the previous intent dead weight. Awaited, not
      // fired and forgotten: the units it is holding are frequently the very units the
      // new basket needs, and on a one-of-a-kind item the buyer would be told they were
      // out of stock by their own abandoned reservation.
      await abandonOpenIntent();
      const started = buyNowItem
        ? await buyNow(businessId, buyNowItem.product, buyNowItem.variantId, buyNowItem.quantity, shipping, newIdempotencyKey())
        : await createOrder(businessId, shipping, newIdempotencyKey());
      if (!started.ok) {
        setError(started.message);
        setPhase('idle');
        return;
      }
      clientSecret = started.clientSecret;
      openIntent.current = { clientSecret, paymentIntentId: started.paymentIntentId, signature };
    }

    // Captured before payment so the order the webhook writes is identifiable
    // without trusting the device clock.
    const previousOrderId = await latestOrderId(businessId);

    setPhase('paying');
    const { error: initError } = await initPaymentSheet({
      paymentIntentClientSecret: clientSecret,
      merchantDisplayName: `Roxy × ${businessName}`,
      allowsDelayedPaymentMethods: false,
    });
    if (initError) {
      setError(initError.message);
      setPhase('idle');
      return;
    }

    const { error: payError } = await presentPaymentSheet();
    if (payError) {
      // Dismissing the sheet is not a failure — the PaymentIntent stays open and
      // the next Pay tap reuses it.
      if (payError.code !== 'Canceled') setError(payError.message);
      setPhase('idle');
      return;
    }

    // Paid. The order row arrives via the Stripe webhook a moment later.
    setPhase('confirming');
    if (!buyNowItem) clearCart(businessId);
    // Cleared without releasing: these units are sold, and handing them back would put
    // stock on the shelf that has already shipped.
    openIntent.current = null;
    const orderId = await awaitNewOrderId(businessId, previousOrderId);
    await fetchOrders();
    setPhase('idle');
    onSuccess(orderId);
  };

  const renderReview = () => (
    <ScrollView showsVerticalScrollIndicator={false}>
      <Text style={styles.stepTitle}>Review Order</Text>
      {items.map((item) => {
        const price = item.variant ? item.variant.price_cents : (item.product?.base_price_cents ?? 0);
        return (
          <View key={item.id} style={styles.reviewItem}>
            <Text style={styles.reviewItemName} numberOfLines={1}>{item.product?.name ?? 'Product'} × {item.quantity}</Text>
            <Text style={styles.reviewItemPrice}>{formatMoney(price * item.quantity, currency)}</Text>
          </View>
        );
      })}
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Subtotal</Text>
        <Text style={styles.totalAmount}>{formatMoney(subtotal, currency)}</Text>
      </View>
      {/* create-product-order hardcodes shipping to 0 server-side — it is a constant
          there, not a field this client may send — so the total on the payment step IS
          the subtotal. Saying "calculated at next step" promised a step that never runs. */}
      <Text style={styles.shippingNote}>No separate shipping charge — the total on the next step is what you pay.</Text>
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
            placeholderTextColor={colors.textMuted}
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
        <Text style={[styles.totalAmount, { fontSize: 22 }]}>{formatMoney(subtotal, currency)}</Text>
      </View>
      <Text style={styles.intlNote}>Prices in {currencyCode(currency)} · Secure checkout via Stripe</Text>
      {error && (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={16} color={colors.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
      {phase !== 'idle' && (
        <Text style={styles.phaseText} accessibilityLiveRegion="polite">{PHASE_LABEL[phase]}</Text>
      )}
      <View style={styles.rowBtns}>
        <TouchableOpacity
          style={[styles.backBtn, paymentLoading && styles.btnDisabled]}
          onPress={() => setStep('shipping')}
          disabled={paymentLoading}
        >
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
            <Text style={styles.primaryBtnText}>Pay {formatMoney(subtotal, currency)} →</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, maxHeight: '92%', width: '100%', maxWidth: FRAME_MAX_WIDTH, alignSelf: 'center' },
    handle: { width: 40, height: 4, backgroundColor: colors.textMuted, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
    steps: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, marginBottom: 20 },
    stepDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    stepDotActive: { backgroundColor: colors.primary },
    stepDotDone: { backgroundColor: colors.primary + '80' },
    stepDotText: { color: '#fff', fontWeight: '700', fontSize: 12 },
    stepLine: { flex: 1, height: 2, backgroundColor: colors.surface },
    stepLineDone: { backgroundColor: colors.primary + '80' },
    stepTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: 16 },
    reviewItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.surface },
    reviewItemName: { flex: 1, fontSize: 14, color: colors.textPrimary },
    reviewItemPrice: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
    totalLabel: { fontSize: 15, color: colors.textSecondary },
    totalAmount: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
    shippingNote: { fontSize: 12, color: colors.textMuted, marginBottom: 16 },
    intlNote: { fontSize: 12, color: colors.textMuted, marginTop: 4, marginBottom: 8 },
    errorBox: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 8,
      backgroundColor: colors.error + '18', borderRadius: 10,
      paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8,
    },
    errorText: { flex: 1, color: colors.error, fontSize: 13, lineHeight: 18, fontWeight: '600' },
    phaseText: { color: colors.textMuted, fontSize: 12, marginBottom: 8 },
    primaryBtn: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
    primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
    btnDisabled: { opacity: 0.4 },
    fieldGroup: { marginBottom: 12 },
    fieldLabel: { fontSize: 13, color: colors.textSecondary, marginBottom: 4, fontWeight: '600' },
    input: { backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: colors.textPrimary, fontSize: 15 },
    rowBtns: { flexDirection: 'row', gap: 10, marginTop: 8 },
    backBtn: { paddingVertical: 16, paddingHorizontal: 16, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'center' },
    backBtnText: { color: colors.textMuted, fontWeight: '600' },
    summaryBox: { backgroundColor: colors.surface, borderRadius: 10, padding: 14, marginBottom: 12, gap: 2 },
    summaryLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '600', marginBottom: 4 },
    summaryValue: { fontSize: 14, color: colors.textPrimary },
    closeBtn: { position: 'absolute', top: 16, right: 16, padding: 8, zIndex: 10 },
  });

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Animated.View style={[styles.sheet, pop]}>
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
          <TouchableOpacity
            style={[styles.closeBtn, paymentLoading && styles.btnDisabled]}
            onPress={onClose}
            disabled={paymentLoading}
            accessibilityLabel="Close checkout"
          >
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

