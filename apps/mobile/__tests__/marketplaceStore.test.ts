import { useMarketplaceStore } from '../store/marketplaceStore';

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
    functions: {
      invoke: jest.fn().mockResolvedValue({ data: { orders: [] }, error: null }),
    },
  },
}));

describe('marketplaceStore', () => {
  beforeEach(() => {
    useMarketplaceStore.setState({
      cartItems: {},
      cartIds: {},
      productsByBusiness: {},
      loadingProducts: {},
      orders: [],
      loadingOrders: false,
      checkoutLoading: false,
    });
  });

  it('addToCart adds item to empty cart', async () => {
    const product = {
      id: 'p1', business_id: 'b1', name: 'Test Tee', description: null,
      base_price_cents: 2500, category: 'apparel' as const, status: 'approved' as const,
      is_active: true, has_variants: false, rejection_reason: null,
      created_at: '', updated_at: '',
      product_variants: [], product_photos: [],
    };
    await useMarketplaceStore.getState().addToCart('b1', product, null, 1);
    const items = useMarketplaceStore.getState().cartItems['b1'];
    expect(items).toHaveLength(1);
    expect(items[0].product_id).toBe('p1');
    expect(items[0].quantity).toBe(1);
  });

  it('addToCart merges duplicate product+variant', async () => {
    const product = {
      id: 'p1', business_id: 'b1', name: 'Test Tee', description: null,
      base_price_cents: 2500, category: 'apparel' as const, status: 'approved' as const,
      is_active: true, has_variants: false, rejection_reason: null,
      created_at: '', updated_at: '',
      product_variants: [], product_photos: [],
    };
    await useMarketplaceStore.getState().addToCart('b1', product, null, 1);
    await useMarketplaceStore.getState().addToCart('b1', product, null, 2);
    const items = useMarketplaceStore.getState().cartItems['b1'];
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(3);
  });

  it('removeFromCart removes item', async () => {
    const product = {
      id: 'p1', business_id: 'b1', name: 'Test Tee', description: null,
      base_price_cents: 2500, category: 'apparel' as const, status: 'approved' as const,
      is_active: true, has_variants: false, rejection_reason: null,
      created_at: '', updated_at: '',
      product_variants: [], product_photos: [],
    };
    await useMarketplaceStore.getState().addToCart('b1', product, null, 1);
    const itemId = useMarketplaceStore.getState().cartItems['b1'][0].id;
    useMarketplaceStore.getState().removeFromCart('b1', itemId);
    expect(useMarketplaceStore.getState().cartItems['b1']).toHaveLength(0);
  });

  it('getCartTotal returns correct sum', async () => {
    const product = {
      id: 'p1', business_id: 'b1', name: 'Test Tee', description: null,
      base_price_cents: 2500, category: 'apparel' as const, status: 'approved' as const,
      is_active: true, has_variants: false, rejection_reason: null,
      created_at: '', updated_at: '',
      product_variants: [], product_photos: [],
    };
    await useMarketplaceStore.getState().addToCart('b1', product, null, 3);
    expect(useMarketplaceStore.getState().getCartTotal('b1')).toBe(7500);
  });

  it('clearCart empties the cart', async () => {
    const product = {
      id: 'p1', business_id: 'b1', name: 'Test Tee', description: null,
      base_price_cents: 2500, category: 'apparel' as const, status: 'approved' as const,
      is_active: true, has_variants: false, rejection_reason: null,
      created_at: '', updated_at: '',
      product_variants: [], product_photos: [],
    };
    await useMarketplaceStore.getState().addToCart('b1', product, null, 2);
    useMarketplaceStore.getState().clearCart('b1');
    expect(useMarketplaceStore.getState().cartItems['b1']).toHaveLength(0);
  });
});
