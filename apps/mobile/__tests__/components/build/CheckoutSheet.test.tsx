import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { CheckoutSheet } from '../../../components/build/CheckoutSheet';
import type { ProductWithVariants } from '../../../types/marketplace';

const mockInitPaymentSheet = jest.fn().mockResolvedValue({ error: null });
const mockPresentPaymentSheet = jest.fn().mockResolvedValue({ error: null });

jest.mock('@stripe/stripe-react-native', () => ({
  useStripe: () => ({
    initPaymentSheet: (...args: unknown[]) => mockInitPaymentSheet(...args),
    presentPaymentSheet: (...args: unknown[]) => mockPresentPaymentSheet(...args),
  }),
}));

const mockStoreState = {
  cartItems: {} as Record<string, unknown[]>,
  getCartTotal: jest.fn(() => 1998),
  createOrder: jest.fn(),
  clearCart: jest.fn(),
  buyNow: jest.fn(),
  latestOrderId: jest.fn(),
  awaitNewOrderId: jest.fn(),
  fetchOrders: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../../../store/marketplaceStore', () => ({
  useMarketplaceStore: () => mockStoreState,
}));

const product: ProductWithVariants = {
  id: 'prod-1', business_id: 'biz-1', name: 'Candle', description: null,
  base_price_cents: 999, category: 'beauty', status: 'approved',
  is_active: true, has_variants: false, rejection_reason: null,
  created_at: '', updated_at: '',
  product_variants: [], product_photos: [],
};

function renderSheet(onSuccess = jest.fn()) {
  const utils = render(
    <CheckoutSheet
      businessId="biz-1"
      businessName="NaaxTech"
      visible
      onClose={jest.fn()}
      onSuccess={onSuccess}
      buyNowItem={{ product, variantId: null, quantity: 2 }}
    />
  );
  return { ...utils, onSuccess };
}

/** Walks review → shipping → payment with a valid address. */
function fillAddressAndAdvance(utils: ReturnType<typeof renderSheet>) {
  fireEvent.press(utils.getByText('Continue to Shipping →'));
  fireEvent.changeText(utils.getByPlaceholderText('Jane Doe'), 'Jane Doe');
  fireEvent.changeText(utils.getByPlaceholderText('123 Main St'), '1 Main St');
  fireEvent.changeText(utils.getByPlaceholderText('New York'), 'LA');
  fireEvent.changeText(utils.getByPlaceholderText('NY'), 'CA');
  fireEvent.changeText(utils.getByPlaceholderText('10001'), '90001');
  fireEvent.press(utils.getByText('Continue to Payment →'));
}

describe('CheckoutSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoreState.buyNow.mockResolvedValue({ ok: true, clientSecret: 'pi_1_secret_x' });
    mockStoreState.latestOrderId.mockResolvedValue(null);
    mockStoreState.awaitNewOrderId.mockResolvedValue('order-123');
    mockInitPaymentSheet.mockResolvedValue({ error: null });
    mockPresentPaymentSheet.mockResolvedValue({ error: null });
  });

  it('opens a PaymentIntent with an idempotency key and hands the order id back', async () => {
    const utils = renderSheet();
    fillAddressAndAdvance(utils);
    fireEvent.press(utils.getByLabelText('Pay now'));

    await waitFor(() => expect(utils.onSuccess).toHaveBeenCalledWith('order-123'));

    const [, , , , , idempotencyKey] = mockStoreState.buyNow.mock.calls[0];
    expect(typeof idempotencyKey).toBe('string');
    expect(idempotencyKey.length).toBeGreaterThan(8);
    expect(mockInitPaymentSheet).toHaveBeenCalledWith(
      expect.objectContaining({ paymentIntentClientSecret: 'pi_1_secret_x' })
    );
  });

  // The order row is written by the Stripe webhook, so it can lag the payment.
  // A missing id means "not yet", never "your payment failed".
  it('still confirms when the order row has not landed yet', async () => {
    mockStoreState.awaitNewOrderId.mockResolvedValue(null);
    const utils = renderSheet();
    fillAddressAndAdvance(utils);
    fireEvent.press(utils.getByLabelText('Pay now'));

    await waitFor(() => expect(utils.onSuccess).toHaveBeenCalledWith(null));
  });

  it('shows the server reason when the order cannot be created', async () => {
    mockStoreState.buyNow.mockResolvedValue({ ok: false, message: '"Candle" is out of stock' });
    const utils = renderSheet();
    fillAddressAndAdvance(utils);
    fireEvent.press(utils.getByLabelText('Pay now'));

    expect(await utils.findByText('"Candle" is out of stock')).toBeTruthy();
    expect(utils.onSuccess).not.toHaveBeenCalled();
  });

  // A second create call would decrement stock again for the same purchase.
  it('reuses the open PaymentIntent when the buyer dismisses the sheet and retries', async () => {
    mockPresentPaymentSheet.mockResolvedValueOnce({ error: { code: 'Canceled', message: 'cancelled' } });
    const utils = renderSheet();
    fillAddressAndAdvance(utils);

    fireEvent.press(utils.getByLabelText('Pay now'));
    await waitFor(() => expect(mockPresentPaymentSheet).toHaveBeenCalledTimes(1));
    expect(utils.onSuccess).not.toHaveBeenCalled();

    fireEvent.press(utils.getByLabelText('Pay now'));
    await waitFor(() => expect(utils.onSuccess).toHaveBeenCalledWith('order-123'));

    expect(mockStoreState.buyNow).toHaveBeenCalledTimes(1);
    expect(mockPresentPaymentSheet).toHaveBeenCalledTimes(2);
  });

  it('does not treat a dismissed payment sheet as an error', async () => {
    mockPresentPaymentSheet.mockResolvedValue({ error: { code: 'Canceled', message: 'cancelled' } });
    const utils = renderSheet();
    fillAddressAndAdvance(utils);
    fireEvent.press(utils.getByLabelText('Pay now'));

    await waitFor(() => expect(mockPresentPaymentSheet).toHaveBeenCalled());
    expect(utils.queryByText('cancelled')).toBeNull();
  });
});
