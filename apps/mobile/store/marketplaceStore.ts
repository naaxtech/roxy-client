import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { ProductWithVariants, CartItem, OrderWithItems, ShippingAddress } from '../types/marketplace';

interface CartState {
  // businessId -> items
  cartItems: Record<string, CartItem[]>;
  cartIds: Record<string, string>; // businessId -> cartId
}

interface MarketplaceStore extends CartState {
  // Products
  productsByBusiness: Record<string, ProductWithVariants[]>;
  loadingProducts: Record<string, boolean>;
  fetchProducts: (businessId: string) => Promise<void>;

  // Cart operations
  addToCart: (businessId: string, product: ProductWithVariants, variantId: string | null, quantity: number) => Promise<void>;
  removeFromCart: (businessId: string, itemId: string) => void;
  updateQuantity: (businessId: string, itemId: string, quantity: number) => void;
  clearCart: (businessId: string) => void;
  getCartTotal: (businessId: string) => number;
  getCartCount: (businessId: string) => number;

  // Orders
  orders: OrderWithItems[];
  loadingOrders: boolean;
  fetchOrders: () => Promise<void>;

  // Checkout
  checkoutLoading: boolean;
  createOrder: (businessId: string, shipping: ShippingAddress) => Promise<{ clientSecret: string; orderId: string } | null>;
  confirmOrder: (orderId: string) => Promise<void>;
  buyNow: (
    businessId: string,
    product: ProductWithVariants,
    variantId: string | null,
    quantity: number,
    shipping: ShippingAddress
  ) => Promise<{ clientSecret: string; orderId: string } | null>;
}

export const useMarketplaceStore = create<MarketplaceStore>((set, get) => ({
  productsByBusiness: {},
  loadingProducts: {},
  cartItems: {},
  cartIds: {},
  orders: [],
  loadingOrders: false,
  checkoutLoading: false,

  fetchProducts: async (businessId: string) => {
    if (get().loadingProducts[businessId]) return;
    set(s => ({ loadingProducts: { ...s.loadingProducts, [businessId]: true } }));
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*, product_variants(*), product_photos(*)')
        .eq('business_id', businessId)
        .eq('status', 'approved')
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (!error && data) {
        set(s => ({ productsByBusiness: { ...s.productsByBusiness, [businessId]: data as ProductWithVariants[] } }));
      }
    } finally {
      set(s => ({ loadingProducts: { ...s.loadingProducts, [businessId]: false } }));
    }
  },

  addToCart: async (businessId, product, variantId, quantity) => {
    const variant = variantId
      ? product.product_variants.find(v => v.id === variantId)
      : null;

    const newItem: CartItem = {
      id: `local-${Date.now()}-${Math.random()}`,
      cart_id: get().cartIds[businessId] ?? '',
      product_id: product.id,
      variant_id: variantId,
      quantity,
      added_at: new Date().toISOString(),
      product,
      variant: variant ?? undefined,
    };

    set(s => {
      const existing = s.cartItems[businessId] ?? [];
      const existingIdx = existing.findIndex(
        i => i.product_id === product.id && i.variant_id === variantId
      );
      let updated: CartItem[];
      if (existingIdx >= 0) {
        updated = existing.map((item, i) =>
          i === existingIdx ? { ...item, quantity: item.quantity + quantity } : item
        );
      } else {
        updated = [...existing, newItem];
      }
      return { cartItems: { ...s.cartItems, [businessId]: updated } };
    });
  },

  removeFromCart: (businessId, itemId) => {
    set(s => ({
      cartItems: {
        ...s.cartItems,
        [businessId]: (s.cartItems[businessId] ?? []).filter(i => i.id !== itemId),
      },
    }));
  },

  updateQuantity: (businessId, itemId, quantity) => {
    if (quantity <= 0) { get().removeFromCart(businessId, itemId); return; }
    set(s => ({
      cartItems: {
        ...s.cartItems,
        [businessId]: (s.cartItems[businessId] ?? []).map(i =>
          i.id === itemId ? { ...i, quantity } : i
        ),
      },
    }));
  },

  clearCart: (businessId) => {
    set(s => ({
      cartItems: { ...s.cartItems, [businessId]: [] },
      cartIds: { ...s.cartIds, [businessId]: '' },
    }));
  },

  getCartTotal: (businessId) => {
    return (get().cartItems[businessId] ?? []).reduce((sum, item) => {
      const price = item.variant ? item.variant.price_cents : (item.product?.base_price_cents ?? 0);
      return sum + price * item.quantity;
    }, 0);
  },

  getCartCount: (businessId) => {
    return (get().cartItems[businessId] ?? []).reduce((sum, item) => sum + item.quantity, 0);
  },

  fetchOrders: async () => {
    set({ loadingOrders: true });
    try {
      const { data, error } = await supabase.functions.invoke('get-orders-buyer', { body: {} });
      if (!error && data?.orders) {
        set({ orders: data.orders as OrderWithItems[] });
      }
    } finally {
      set({ loadingOrders: false });
    }
  },

  createOrder: async (businessId, shipping) => {
    set({ checkoutLoading: true });
    try {
      const items = get().cartItems[businessId] ?? [];
      const { data, error } = await supabase.functions.invoke('create-product-order', {
        body: {
          business_id: businessId,
          items: items.map(i => ({
            product_id: i.product_id,
            variant_id: i.variant_id,
            quantity: i.quantity,
          })),
          shipping_address: {
            name: shipping.name,
            line1: shipping.line1,
            line2: shipping.line2 ?? null,
            city: shipping.city,
            state: shipping.state,
            postal_code: shipping.postal_code,
            country: shipping.country,
          },
        },
      });
      if (error || !data?.client_secret) return null;
      return { clientSecret: data.client_secret as string, orderId: data.order_id as string };
    } finally {
      set({ checkoutLoading: false });
    }
  },

  confirmOrder: async (_orderId) => {
    await get().fetchOrders();
  },

  buyNow: async (businessId, product, variantId, quantity, shipping) => {
    set({ checkoutLoading: true });
    try {
      const { data, error } = await supabase.functions.invoke('create-product-order', {
        body: {
          business_id: businessId,
          items: [{ product_id: product.id, variant_id: variantId, quantity }],
          shipping_address: {
            name: shipping.name,
            line1: shipping.line1,
            line2: shipping.line2 ?? null,
            city: shipping.city,
            state: shipping.state,
            postal_code: shipping.postal_code,
            country: shipping.country,
          },
        },
      });
      if (error || !data?.client_secret) return null;
      return { clientSecret: data.client_secret as string, orderId: data.order_id as string };
    } finally {
      set({ checkoutLoading: false });
    }
  },
}));
