import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ProductDetailSheet } from '../components/build/ProductDetailSheet';
import type { ProductWithVariants } from '../types/marketplace';

jest.mock('../store/marketplaceStore', () => ({
  useMarketplaceStore: () => ({
    cartItems: {},
    getCartTotal: jest.fn(() => 0),
    createOrder: jest.fn(),
    clearCart: jest.fn(),
    buyNow: jest.fn(),
  }),
}));

jest.mock('@stripe/stripe-react-native', () => ({
  useStripe: () => ({
    initPaymentSheet: jest.fn(),
    presentPaymentSheet: jest.fn(),
  }),
}));

const baseProduct: ProductWithVariants = {
  id: 'p1',
  business_id: 'b1',
  name: 'Test Candle',
  description: 'A lovely candle',
  base_price_cents: 2499,
  category: 'beauty',
  status: 'approved',
  is_active: true,
  has_variants: false,
  rejection_reason: null,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  product_variants: [],
  product_photos: [],
};

const productWithPhotos: ProductWithVariants = {
  ...baseProduct,
  product_photos: [
    { id: 'ph1', product_id: 'p1', url: 'https://example.com/1.jpg', alt_text: null, position: 0, created_at: '' },
    { id: 'ph2', product_id: 'p1', url: 'https://example.com/2.jpg', alt_text: null, position: 1, created_at: '' },
    { id: 'ph3', product_id: 'p1', url: 'https://example.com/3.jpg', alt_text: null, position: 2, created_at: '' },
  ],
};

const defaultProps = {
  product: baseProduct,
  businessId: 'b1',
  businessName: 'Test Biz',
  visible: true,
  onClose: jest.fn(),
  onAddToCart: jest.fn(),
};

describe('ProductDetailSheet', () => {
  it('renders product name and price', () => {
    const { getByText } = render(<ProductDetailSheet {...defaultProps} />);
    expect(getByText('Test Candle')).toBeTruthy();
    expect(getByText('$24.99')).toBeTruthy();
  });

  it('shows category placeholder when no photos', () => {
    const { getByText } = render(<ProductDetailSheet {...defaultProps} />);
    // category 'beauty' → 'B'
    expect(getByText('B')).toBeTruthy();
  });

  it('shows dot indicators when product has multiple photos', () => {
    const { getAllByTestId } = render(
      <ProductDetailSheet {...defaultProps} product={productWithPhotos} />
    );
    expect(getAllByTestId('photo-dot')).toHaveLength(3);
  });

  it('does not show dots when product has only one photo', () => {
    const singlePhoto = {
      ...productWithPhotos,
      product_photos: [productWithPhotos.product_photos[0]],
    };
    const { queryAllByTestId } = render(
      <ProductDetailSheet {...defaultProps} product={singlePhoto} />
    );
    expect(queryAllByTestId('photo-dot')).toHaveLength(0);
  });

  it('calls onAddToCart with correct args when Add to Cart is pressed', () => {
    const onAddToCart = jest.fn();
    const { getByText } = render(
      <ProductDetailSheet {...defaultProps} onAddToCart={onAddToCart} />
    );
    fireEvent.press(getByText('Add to Cart'));
    expect(onAddToCart).toHaveBeenCalledWith(null, 1);
  });

  it('shows Buy Now button', () => {
    const { getByText } = render(<ProductDetailSheet {...defaultProps} />);
    expect(getByText('Buy Now')).toBeTruthy();
  });
});
