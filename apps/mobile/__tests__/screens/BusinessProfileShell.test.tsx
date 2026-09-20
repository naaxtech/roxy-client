import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'b1' }),
}));
jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));
jest.mock('../../components/build/BusinessPhotoGallery', () => ({ BusinessPhotoGallery: () => null }));
jest.mock('../../components/build/CartDrawer', () => ({ CartDrawer: () => null }));
jest.mock('../../components/build/CheckoutSheet', () => ({ CheckoutSheet: () => null }));
jest.mock('../../components/build/OrderConfirmationSheet', () => ({ OrderConfirmationSheet: () => null }));

const business = {
  id: 'b1',
  name: 'Sappho Books',
  description: 'Queer books, shipped with care.',
  logo_url: null,
  category: 'books',
  location_city: 'London',
  website_url: 'https://example.com',
  instagram_handle: 'sappho',
  is_verified: true,
  can_sell: true,
  stripe_account_id: 'acct_test',
  is_wlw_owned: true,
};

jest.mock('../../store/authStore', () => ({
  useAuthStore: (sel?: (s: { user: { id: string } }) => unknown) => {
    const state = { user: { id: 'u1' } };
    return sel ? sel(state) : state;
  },
}));
jest.mock('../../store/buildStore', () => ({
  useBuildStore: (sel?: (s: {
    businesses: typeof business[];
    bookmarkedBusinessIds: Set<string>;
    toggleBookmark: () => void;
  }) => unknown) => {
    const state = {
      businesses: [business],
      bookmarkedBusinessIds: new Set<string>(),
      toggleBookmark: jest.fn(),
    };
    return sel ? sel(state) : state;
  },
}));
jest.mock('../../store/marketplaceStore', () => ({
  useMarketplaceStore: (sel?: (s: {
    productsByBusiness: Record<string, never[]>;
    loadingProducts: Record<string, boolean>;
    fetchProducts: () => void;
    getCartCount: () => number;
    getCartTotal: () => number;
    businessCurrency: () => string;
  }) => unknown) => {
    const state = {
      productsByBusiness: { b1: [] },
      loadingProducts: {},
      fetchProducts: jest.fn(),
      getCartCount: () => 0,
      getCartTotal: () => 0,
      businessCurrency: () => 'GBP',
    };
    return sel ? sel(state) : state;
  },
}));

const thenable = (data: unknown) => {
  const chain: Record<string, unknown> = {};
  const next = () => chain;
  chain.select = next;
  chain.eq = next;
  chain.order = () => Promise.resolve({ data, error: null });
  chain.single = () => Promise.resolve({ data, error: null });
  return chain;
};

jest.mock('../../lib/supabase', () => ({
  supabase: { from: jest.fn(() => thenable([])) },
}));

import BusinessStorefrontScreen from '../../app/business/[id]';

describe('business storefront on the unified shell', () => {
  it('draws the seller variant of ProfileShell', async () => {
    const { getByTestId, getByText } = render(<BusinessStorefrontScreen />);
    await waitFor(() => expect(getByTestId('profile-shell')).toBeTruthy());
    expect(getByText('Sappho Books')).toBeTruthy();
    expect(getByTestId('profile-tab-shop')).toBeTruthy();
    expect(getByTestId('bookmark-btn')).toBeTruthy();
  });
});
