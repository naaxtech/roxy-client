import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { BusinessDetailSheet } from '../../../components/build/BusinessDetailSheet';
import { Business, BusinessPhoto } from '../../../types';

// Mock marketplaceStore — avoids supabase native module chain
jest.mock('../../../store/marketplaceStore', () => ({
  useMarketplaceStore: jest.fn(() => ({
    productsByBusiness: {},
    loadingProducts: {},
    fetchProducts: jest.fn(),
    addToCart: jest.fn(),
    getCartCount: jest.fn(() => 0),
    cartItems: {},
    removeFromCart: jest.fn(),
    updateQuantity: jest.fn(),
    getCartTotal: jest.fn(() => 0),
    checkoutLoading: false,
    createOrder: jest.fn().mockResolvedValue(null),
    clearCart: jest.fn(),
  })),
}));

const makeBusiness = (overrides: Partial<Business> = {}): Business => ({
  id: 'b1',
  owner_id: 'user-1',
  name: 'Lavender Books',
  description: 'A queer bookshop',
  category: 'retail',
  location_city: 'London',
  website_url: 'https://lavenderbooks.com',
  instagram_handle: 'lavenderbooks',
  logo_url: null,
  is_verified: true,
  is_wlw_owned: true,
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const _makePhoto = (id: string): BusinessPhoto => ({
  id,
  business_id: 'b1',
  url: `https://example.com/photo-${id}.jpg`,
  sort_order: 0,
  created_at: '2026-01-01T00:00:00Z',
});

describe('BusinessDetailSheet', () => {
  it('renders nothing when business is null', () => {
    const { queryByText } = render(
      <BusinessDetailSheet
        business={null}
        photos={[]}
        isBookmarked={false}
        onBookmarkToggle={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(queryByText('Lavender Books')).toBeNull();
  });

  it('renders business name and city', () => {
    const { getByText } = render(
      <BusinessDetailSheet
        business={makeBusiness()}
        photos={[]}
        isBookmarked={false}
        onBookmarkToggle={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(getByText('Lavender Books')).toBeTruthy();
    expect(getByText('📍 London')).toBeTruthy();
  });

  it('does not render gallery when on About tab (default)', () => {
    const { queryByTestId } = render(
      <BusinessDetailSheet
        business={makeBusiness()}
        photos={[_makePhoto('p1')]}
        isBookmarked={false}
        onBookmarkToggle={jest.fn()}
        onClose={jest.fn()}
      />
    );
    // Gallery is behind Photos tab — not visible on default About tab
    expect(queryByTestId('photo-gallery')).toBeNull();
  });

  it('does not render links section when all links are null', () => {
    const { queryByText } = render(
      <BusinessDetailSheet
        business={makeBusiness({ website_url: null, instagram_handle: null })}
        photos={[]}
        isBookmarked={false}
        onBookmarkToggle={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(queryByText('🔗 Links')).toBeNull();
  });

  it('calls onBookmarkToggle when bookmark button pressed', () => {
    const onBookmarkToggle = jest.fn();
    const { getByTestId } = render(
      <BusinessDetailSheet
        business={makeBusiness()}
        photos={[]}
        isBookmarked={false}
        onBookmarkToggle={onBookmarkToggle}
        onClose={jest.fn()}
      />
    );
    fireEvent.press(getByTestId('bookmark-btn'));
    expect(onBookmarkToggle).toHaveBeenCalled();
  });

  it('shows filled bookmark when isBookmarked is true', () => {
    const { getByTestId } = render(
      <BusinessDetailSheet
        business={makeBusiness()}
        photos={[]}
        isBookmarked={true}
        onBookmarkToggle={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(getByTestId('bookmark-btn').props.accessibilityLabel).toBe('Remove bookmark');
  });

  it('shows outline bookmark when isBookmarked is false', () => {
    const { getByTestId } = render(
      <BusinessDetailSheet
        business={makeBusiness()}
        photos={[]}
        isBookmarked={false}
        onBookmarkToggle={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(getByTestId('bookmark-btn').props.accessibilityLabel).toBe('Add bookmark');
  });

  it('renders tab bar with About, Products, Photos tabs', () => {
    const { getByText } = render(
      <BusinessDetailSheet
        business={makeBusiness()}
        photos={[]}
        isBookmarked={false}
        onBookmarkToggle={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(getByText('About')).toBeTruthy();
    expect(getByText('Products')).toBeTruthy();
    expect(getByText('Photos')).toBeTruthy();
  });
});
