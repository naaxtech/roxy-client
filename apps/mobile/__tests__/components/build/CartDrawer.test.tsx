import React from 'react';
import { render } from '@testing-library/react-native';
import { CartDrawer } from '../../../components/build/CartDrawer';
import type { CartItem, Product } from '../../../types/marketplace';

const product: Product = {
  id: 'prod-1', business_id: 'biz-1', name: 'Candle', description: null,
  base_price_cents: 999, category: 'beauty', status: 'approved',
  is_active: true, has_variants: false, rejection_reason: null,
  created_at: '', updated_at: '',
};

const cartItem: CartItem = {
  id: 'ci-1', cart_id: 'cart-1', product_id: 'prod-1', variant_id: null,
  quantity: 2, added_at: '', product,
};

const mockStoreState = {
  cartItems: { 'biz-1': [cartItem] } as Record<string, CartItem[]>,
  removeFromCart: jest.fn(),
  updateQuantity: jest.fn(),
  getCartTotal: jest.fn(() => 1998),
  getCartCount: jest.fn(() => 2),
  businessCurrency: jest.fn(() => 'usd'),
  fetchBusinessCurrency: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../../../store/marketplaceStore', () => ({
  useMarketplaceStore: () => mockStoreState,
}));

function renderDrawer() {
  return render(
    <CartDrawer
      businessId="biz-1"
      businessName="NaaxTech"
      visible
      onClose={jest.fn()}
      onCheckout={jest.fn()}
    />
  );
}

describe('CartDrawer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoreState.cartItems = { 'biz-1': [cartItem] };
    mockStoreState.getCartTotal.mockReturnValue(1998);
    mockStoreState.getCartCount.mockReturnValue(2);
    mockStoreState.businessCurrency.mockReturnValue('usd');
  });

  /**
   * Same contract as the checkout sheet: the seller's `businesses.currency` is what
   * Stripe is handed, so it is the only currency the cart may quote.
   */
  it('prices the cart in the seller currency, not USD', () => {
    mockStoreState.businessCurrency.mockReturnValue('php');
    const utils = renderDrawer();

    expect(utils.getByText('₱9.99 each')).toBeTruthy();
    expect(utils.getByText('₱19.98')).toBeTruthy();
    expect(utils.queryByText('$9.99 each')).toBeNull();
  });

  it('shows an empty state rather than a bare total when the cart has nothing in it', () => {
    mockStoreState.cartItems = { 'biz-1': [] };
    mockStoreState.getCartTotal.mockReturnValue(0);
    mockStoreState.getCartCount.mockReturnValue(0);
    const utils = renderDrawer();

    expect(utils.getByText('Your cart is empty')).toBeTruthy();
    expect(utils.getByLabelText('Proceed to checkout')).toBeDisabled();
  });
});
