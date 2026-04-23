import { useMarketplaceStore } from '../store/marketplaceStore';
import type { ProductWithVariants, ShippingAddress } from '../types/marketplace';

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

  describe('buyNow', () => {
    it('calls create-product-order with single item and returns clientSecret + orderId', async () => {
      const mockInvoke = jest.fn().mockResolvedValue({
        data: { client_secret: 'secret_123', order_id: 'order_abc' },
        error: null,
      });
      const { supabase } = jest.requireMock('../lib/supabase');
      supabase.functions.invoke.mockImplementation(mockInvoke);

      const fakeProduct: ProductWithVariants = {
        id: 'prod-1', business_id: 'biz-1', name: 'Candle', description: null,
        base_price_cents: 999, category: 'beauty', status: 'approved',
        is_active: true, has_variants: false, rejection_reason: null,
        created_at: '', updated_at: '',
        product_variants: [], product_photos: [],
      };

      const shipping: ShippingAddress = {
        name: 'Test User', line1: '123 Main St', city: 'LA',
        state: 'CA', postal_code: '90001', country: 'US',
      };

      const result = await useMarketplaceStore.getState().buyNow('biz-1', fakeProduct, null, 2, shipping);

      expect(mockInvoke).toHaveBeenCalledWith('create-product-order', {
        body: {
          business_id: 'biz-1',
          items: [{ product_id: 'prod-1', variant_id: null, quantity: 2 }],
          shipping_address: {
            name: 'Test User', line1: '123 Main St', line2: null,
            city: 'LA', state: 'CA', postal_code: '90001', country: 'US',
          },
        },
      });
      expect(result).toEqual({ clientSecret: 'secret_123', orderId: 'order_abc' });
    });

    it('returns null when edge function errors', async () => {
      const { supabase } = jest.requireMock('../lib/supabase');
      supabase.functions.invoke.mockResolvedValue({ data: null, error: { message: 'fail' } });

      const fakeProduct: ProductWithVariants = {
        id: 'p', business_id: 'b', name: 'X', description: null,
        base_price_cents: 100, category: 'other', status: 'approved',
        is_active: true, has_variants: false, rejection_reason: null,
        created_at: '', updated_at: '',
        product_variants: [], product_photos: [],
      };
      const shipping: ShippingAddress = {
        name: 'A', line1: 'B', city: 'C', state: 'D', postal_code: 'E', country: 'US',
      };
      const result = await useMarketplaceStore.getState().buyNow('b', fakeProduct, null, 1, shipping);
      expect(result).toBeNull();
    });
  });
});
