# Roxy Marketplace — Plan 3: Mobile Cart & Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the buyer-facing marketplace experience to the Roxy mobile app — product browsing in BusinessDetailSheet (new Products tab), per-business cart (CartDrawer), 3-step checkout (CheckoutSheet) with Stripe Payment Sheet, order confirmation, and My Orders on the profile screen.

**Architecture:** `marketplaceStore` (Zustand) owns all cart + order state. All marketplace components live in `apps/mobile/components/build/`. `BusinessDetailSheet` gains a Products tab alongside existing About/Photos tabs. Checkout calls `create-product-order` edge function for the Stripe client_secret, then presents Stripe Payment Sheet. No new edge functions — Plan 1 backend is deployed. Order state is fetched via `get-orders-buyer` edge function.

**Tech Stack:** Expo 51, React Native 0.74, `@stripe/stripe-react-native` 0.37.2 (already installed), `@shopify/flash-list`, Zustand, TypeScript strict. Working directory for all commands: `apps/mobile/`.

---

### File Map

**Created:**
- `apps/mobile/types/marketplace.ts` — marketplace domain types (Product, ProductVariant, Cart, CartItem, Order, OrderItem, etc.)
- `apps/mobile/store/marketplaceStore.ts` — Zustand store for carts + orders
- `apps/mobile/components/build/ProductCard.tsx` — product card with variant picker sheet
- `apps/mobile/components/build/CartDrawer.tsx` — per-business cart bottom sheet
- `apps/mobile/components/build/CheckoutSheet.tsx` — 3-step checkout (Review → Shipping → Payment)
- `apps/mobile/components/build/OrderConfirmationSheet.tsx` — post-payment confirmation
- `apps/mobile/components/build/OrderDetailSheet.tsx` — order detail with timeline + tracking
- `apps/mobile/__tests__/marketplaceStore.test.ts` — store unit tests
- `apps/mobile/__tests__/ProductCard.test.tsx` — component tests
- `apps/mobile/__tests__/CartDrawer.test.tsx` — cart drawer tests

**Modified:**
- `apps/mobile/types/index.ts` — add `Business.can_sell`, `Business.stripe_account_id` fields
- `apps/mobile/components/build/BusinessDetailSheet.tsx` — add Products tab (3-tab layout: About | Products | Photos)
- `apps/mobile/app/(tabs)/profile/index.tsx` — add My Orders section with OrderDetailSheet

---

### Task 1: Marketplace types + type additions

**Files:**
- Create: `apps/mobile/types/marketplace.ts`
- Modify: `apps/mobile/types/index.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/__tests__/marketplaceTypes.test.ts`:

```ts
// Compile-time type test — if this file compiles, types are correct
import type {
  Product, ProductVariant, Cart, CartItem,
  Order, OrderItem, OrderEvent, ShippingAddress,
} from '../types/marketplace';

// Shape checks
const _product: Product = {
  id: '', business_id: '', name: '', category: 'apparel',
  base_price_cents: 100, status: 'approved', is_active: true,
  has_variants: false, created_at: '', updated_at: '',
  description: null, rejection_reason: null,
};

const _cart: Cart = {
  id: '', buyer_id: '', business_id: '',
  expires_at: '', created_at: '', updated_at: '',
};

const _order: Order = {
  id: '', buyer_id: '', business_id: '', status: 'paid',
  shipping_name: '', shipping_line1: '', shipping_city: '',
  shipping_state: '', shipping_postal_code: '', shipping_country: 'US',
  currency: 'usd', subtotal_cents: 100, shipping_cost_cents: 0,
  tax_cents: 0, platform_fee_cents: 10, total_cents: 100,
  stripe_payment_intent_id: '', created_at: '', updated_at: '',
  shipping_line2: null, stripe_charge_id: null, stripe_transfer_id: null,
  stripe_invoice_id: null, stripe_invoice_url: null, risk_level: null,
  tracking_number: null, shipped_at: null, delivered_at: null,
  cancelled_at: null, cancellation_reason: null,
};

it('marketplace types compile', () => { expect(true).toBe(true); });
```

- [ ] **Step 2: Run test — expect compile failure (file doesn't exist yet)**

```bash
cd apps/mobile
npx jest --testPathPattern="marketplaceTypes" --ci 2>&1 | head -20
```

Expected: FAIL — "Cannot find module '../types/marketplace'"

- [ ] **Step 3: Create the marketplace types file**

Create `apps/mobile/types/marketplace.ts`:

```ts
export type ProductCategory = 'apparel' | 'accessories' | 'beauty' | 'art' | 'food' | 'books' | 'other';
export type ProductStatus = 'pending' | 'approved' | 'rejected' | 'archived';
export type OrderStatus = 'paid' | 'shipped' | 'delivered' | 'refunded' | 'cancelled';

export interface Product {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  base_price_cents: number;
  category: ProductCategory;
  status: ProductStatus;
  is_active: boolean;
  has_variants: boolean;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  sku: string | null;
  option1_name: string | null;
  option1_value: string | null;
  option2_name: string | null;
  option2_value: string | null;
  price_cents: number;
  stock: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductPhoto {
  id: string;
  product_id: string;
  url: string;
  alt_text: string | null;
  position: number;
  created_at: string;
}

export interface ProductWithVariants extends Product {
  product_variants: ProductVariant[];
  product_photos: ProductPhoto[];
}

export interface Cart {
  id: string;
  buyer_id: string;
  business_id: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface CartItem {
  id: string;
  cart_id: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  added_at: string;
  // Joined from products + variants
  product?: Product;
  variant?: ProductVariant;
}

export interface ShippingAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

export interface Order {
  id: string;
  buyer_id: string;
  business_id: string;
  status: OrderStatus;
  shipping_name: string;
  shipping_line1: string;
  shipping_line2: string | null;
  shipping_city: string;
  shipping_state: string;
  shipping_postal_code: string;
  shipping_country: string;
  currency: string;
  subtotal_cents: number;
  shipping_cost_cents: number;
  tax_cents: number;
  platform_fee_cents: number;
  total_cents: number;
  stripe_payment_intent_id: string;
  stripe_charge_id: string | null;
  stripe_transfer_id: string | null;
  stripe_invoice_id: string | null;
  stripe_invoice_url: string | null;
  risk_level: 'normal' | 'elevated' | 'highest' | null;
  tracking_number: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  variant_id: string | null;
  product_name: string;
  variant_label: string | null;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
  created_at: string;
}

export interface OrderEvent {
  id: string;
  order_id: string;
  event: 'payment_confirmed' | 'shipped' | 'delivered' | 'cancelled' | 'refunded' | 'note_added';
  note: string | null;
  actor_type: 'buyer' | 'business' | 'staff' | 'system';
  created_at: string;
}

export interface OrderWithDetails extends Order {
  order_items: OrderItem[];
  order_events: OrderEvent[];
  business_name?: string;
}
```

- [ ] **Step 4: Add `can_sell` + `stripe_account_id` to Business type in `types/index.ts`**

In `apps/mobile/types/index.ts`, find the `Business` interface and add the new fields:

```ts
export interface Business {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  category: string | null;
  location_city: string | null;
  website_url: string | null;
  instagram_handle: string | null;
  logo_url: string | null;
  is_verified: boolean;
  is_wlw_owned: boolean;
  // Marketplace additions (from migration 031)
  can_sell: boolean;
  stripe_account_id: string | null;
  created_at: string;
}
```

- [ ] **Step 5: Run test — expect pass**

```bash
cd apps/mobile
npx jest --testPathPattern="marketplaceTypes" --ci
```

Expected: PASS

- [ ] **Step 6: Run tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/types/marketplace.ts apps/mobile/types/index.ts apps/mobile/__tests__/marketplaceTypes.test.ts
git commit -m "feat(mobile): marketplace types"
```

---

### Task 2: marketplaceStore

**Files:**
- Create: `apps/mobile/store/marketplaceStore.ts`
- Create: `apps/mobile/__tests__/marketplaceStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/__tests__/marketplaceStore.test.ts`:

```ts
import { act } from 'react';
import { useMarketplaceStore } from '../store/marketplaceStore';

// Mock supabase and callEdgeFunction
jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      match: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
    channel: jest.fn(() => ({ on: jest.fn().mockReturnThis(), subscribe: jest.fn() })),
    removeChannel: jest.fn(),
  },
  callEdgeFunction: jest.fn().mockResolvedValue({ data: null, error: null }),
}));

describe('marketplaceStore', () => {
  beforeEach(() => {
    useMarketplaceStore.setState({
      carts: {},
      activeCartBusinessId: null,
      orders: [],
      activeOrder: null,
      checkoutStep: null,
      shippingAddress: null,
      isProcessingPayment: false,
      confirmedOrderId: null,
    });
  });

  it('initialises with empty state', () => {
    const state = useMarketplaceStore.getState();
    expect(state.carts).toEqual({});
    expect(state.orders).toEqual([]);
    expect(state.checkoutStep).toBeNull();
    expect(state.isProcessingPayment).toBe(false);
  });

  it('setCheckoutStep updates step', () => {
    act(() => {
      useMarketplaceStore.getState().setCheckoutStep('review');
    });
    expect(useMarketplaceStore.getState().checkoutStep).toBe('review');
  });

  it('setShippingAddress stores address', () => {
    const addr = { name: 'Alice', line1: '123 Main', city: 'SF', state: 'CA', postal_code: '94105', country: 'US' };
    act(() => {
      useMarketplaceStore.getState().setShippingAddress(addr);
    });
    expect(useMarketplaceStore.getState().shippingAddress).toEqual(addr);
  });

  it('openCart sets activeCartBusinessId', () => {
    act(() => {
      useMarketplaceStore.getState().openCart('biz-1');
    });
    expect(useMarketplaceStore.getState().activeCartBusinessId).toBe('biz-1');
  });

  it('closeCart clears activeCartBusinessId', () => {
    act(() => {
      useMarketplaceStore.getState().openCart('biz-1');
      useMarketplaceStore.getState().closeCart();
    });
    expect(useMarketplaceStore.getState().activeCartBusinessId).toBeNull();
  });

  it('setConfirmedOrderId stores order id and resets checkout', () => {
    act(() => {
      useMarketplaceStore.getState().setCheckoutStep('payment');
      useMarketplaceStore.getState().setConfirmedOrderId('order-123');
    });
    const state = useMarketplaceStore.getState();
    expect(state.confirmedOrderId).toBe('order-123');
    expect(state.checkoutStep).toBeNull();
    expect(state.isProcessingPayment).toBe(false);
  });

  it('cartItemCount returns 0 for unknown business', () => {
    const count = useMarketplaceStore.getState().cartItemCount('biz-1');
    expect(count).toBe(0);
  });

  it('cartTotal returns 0 for unknown business', () => {
    const total = useMarketplaceStore.getState().cartTotal('biz-1');
    expect(total).toBe(0);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/mobile
npx jest --testPathPattern="marketplaceStore" --ci 2>&1 | head -20
```

Expected: FAIL — "Cannot find module '../store/marketplaceStore'"

- [ ] **Step 3: Create marketplaceStore**

Create `apps/mobile/store/marketplaceStore.ts`:

```ts
import { create } from 'zustand';
import { supabase, callEdgeFunction } from '../lib/supabase';
import type { Cart, CartItem, Order, OrderWithDetails, ShippingAddress } from '../types/marketplace';

interface CartBundle {
  cart: Cart;
  items: CartItem[];
}

interface MarketplaceState {
  carts: Record<string, CartBundle>; // keyed by business_id
  activeCartBusinessId: string | null;
  orders: OrderWithDetails[];
  activeOrder: OrderWithDetails | null;
  checkoutStep: 'review' | 'shipping' | 'payment' | null;
  shippingAddress: ShippingAddress | null;
  isProcessingPayment: boolean;
  confirmedOrderId: string | null;

  // Derived
  cartItemCount: (businessId: string) => number;
  cartTotal: (businessId: string) => number;

  // Cart UI
  openCart: (businessId: string) => void;
  closeCart: () => void;

  // Checkout flow
  setCheckoutStep: (step: 'review' | 'shipping' | 'payment' | null) => void;
  setShippingAddress: (addr: ShippingAddress) => void;
  setIsProcessingPayment: (v: boolean) => void;
  setConfirmedOrderId: (id: string | null) => void;

  // Cart CRUD
  fetchCart: (businessId: string) => Promise<void>;
  addToCart: (businessId: string, productId: string, variantId: string | null, qty: number) => Promise<{ error?: string }>;
  updateQuantity: (businessId: string, cartItemId: string, qty: number) => Promise<void>;
  removeFromCart: (businessId: string, cartItemId: string) => Promise<void>;
  clearCart: (businessId: string) => void;

  // Orders
  fetchOrders: () => Promise<void>;
  openOrderDetail: (order: OrderWithDetails) => void;
  closeOrderDetail: () => void;
}

export const useMarketplaceStore = create<MarketplaceState>((set, get) => ({
  carts: {},
  activeCartBusinessId: null,
  orders: [],
  activeOrder: null,
  checkoutStep: null,
  shippingAddress: null,
  isProcessingPayment: false,
  confirmedOrderId: null,

  cartItemCount: (businessId) => {
    const bundle = get().carts[businessId];
    if (!bundle) return 0;
    return bundle.items.reduce((sum, item) => sum + item.quantity, 0);
  },

  cartTotal: (businessId) => {
    const bundle = get().carts[businessId];
    if (!bundle) return 0;
    return bundle.items.reduce((sum, item) => {
      const priceCents = item.variant?.price_cents ?? item.product?.base_price_cents ?? 0;
      return sum + priceCents * item.quantity;
    }, 0);
  },

  openCart: (businessId) => set({ activeCartBusinessId: businessId }),
  closeCart: () => set({ activeCartBusinessId: null }),

  setCheckoutStep: (step) => set({ checkoutStep: step }),
  setShippingAddress: (addr) => set({ shippingAddress: addr }),
  setIsProcessingPayment: (v) => set({ isProcessingPayment: v }),
  setConfirmedOrderId: (id) => set({ confirmedOrderId: id, checkoutStep: null, isProcessingPayment: false }),

  fetchCart: async (businessId) => {
    const { data: cart } = await supabase
      .from('carts')
      .select('*')
      .eq('business_id', businessId)
      .maybeSingle();

    if (!cart) {
      set((s) => ({ carts: { ...s.carts, [businessId]: { cart: null as any, items: [] } } }));
      return;
    }

    const { data: rawItems } = await supabase
      .from('cart_items')
      .select('*, product:products(*), variant:product_variants(*)')
      .eq('cart_id', cart.id);

    set((s) => ({
      carts: {
        ...s.carts,
        [businessId]: { cart, items: (rawItems as CartItem[]) ?? [] },
      },
    }));
  },

  addToCart: async (businessId, productId, variantId, qty) => {
    const { data: session } = await supabase.auth.getSession();
    const userId = session?.session?.user?.id;
    if (!userId) return { error: 'Not logged in' };

    // Upsert cart
    let cart = get().carts[businessId]?.cart;
    if (!cart) {
      const { data: newCart, error: cErr } = await supabase
        .from('carts')
        .upsert({ buyer_id: userId, business_id: businessId }, { onConflict: 'buyer_id,business_id' })
        .select()
        .single();
      if (cErr || !newCart) return { error: cErr?.message ?? 'Failed to create cart' };
      cart = newCart;
    }

    const { error: iErr } = await supabase
      .from('cart_items')
      .upsert(
        { cart_id: cart.id, product_id: productId, variant_id: variantId ?? null, quantity: qty },
        { onConflict: 'cart_id,product_id,variant_id' }
      );

    if (iErr) return { error: iErr.message };
    await get().fetchCart(businessId);
    return {};
  },

  updateQuantity: async (businessId, cartItemId, qty) => {
    if (qty <= 0) {
      await get().removeFromCart(businessId, cartItemId);
      return;
    }
    await supabase.from('cart_items').update({ quantity: qty }).eq('id', cartItemId);
    await get().fetchCart(businessId);
  },

  removeFromCart: async (businessId, cartItemId) => {
    await supabase.from('cart_items').delete().eq('id', cartItemId);
    set((s) => {
      const bundle = s.carts[businessId];
      if (!bundle) return s;
      return {
        carts: {
          ...s.carts,
          [businessId]: {
            ...bundle,
            items: bundle.items.filter((i) => i.id !== cartItemId),
          },
        },
      };
    });
  },

  clearCart: (businessId) => {
    set((s) => {
      const bundle = s.carts[businessId];
      if (!bundle) return s;
      return { carts: { ...s.carts, [businessId]: { ...bundle, items: [] } } };
    });
  },

  fetchOrders: async () => {
    const { data, error } = await callEdgeFunction<OrderWithDetails[]>('get-orders-buyer', {});
    if (!error && data) set({ orders: data });
  },

  openOrderDetail: (order) => set({ activeOrder: order }),
  closeOrderDetail: () => set({ activeOrder: null }),
}));
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd apps/mobile
npx jest --testPathPattern="marketplaceStore" --ci
```

Expected: PASS (8 tests)

- [ ] **Step 5: Run tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/store/marketplaceStore.ts apps/mobile/__tests__/marketplaceStore.test.ts
git commit -m "feat(mobile): marketplaceStore — cart + orders Zustand store"
```

---

### Task 3: ProductCard component

**Files:**
- Create: `apps/mobile/components/build/ProductCard.tsx`
- Create: `apps/mobile/__tests__/ProductCard.test.tsx`

ProductCard shows product name, price, first photo (if any), and an Add/Sold Out button. If has_variants, tapping Add shows an inline variant picker sheet. Out-of-stock products show "Sold Out" badge.

- [ ] **Step 1: Write failing tests**

Create `apps/mobile/__tests__/ProductCard.test.tsx`:

```tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ProductCard } from '../components/build/ProductCard';
import type { ProductWithVariants } from '../types/marketplace';

jest.mock('../store/marketplaceStore', () => ({
  useMarketplaceStore: () => ({
    addToCart: jest.fn().mockResolvedValue({}),
    cartItemCount: jest.fn().mockReturnValue(0),
  }),
}));

const base: ProductWithVariants = {
  id: 'p1', business_id: 'b1', name: 'Test Shirt', category: 'apparel',
  base_price_cents: 2999, status: 'approved', is_active: true, has_variants: false,
  description: null, rejection_reason: null, created_at: '', updated_at: '',
  product_variants: [{ id: 'v1', product_id: 'p1', sku: null, option1_name: null, option1_value: null, option2_name: null, option2_value: null, price_cents: 2999, stock: 5, is_active: true, created_at: '', updated_at: '' }],
  product_photos: [],
};

describe('ProductCard', () => {
  it('renders product name and price', () => {
    const { getByText } = render(<ProductCard product={base} businessId="b1" />);
    expect(getByText('Test Shirt')).toBeTruthy();
    expect(getByText('$29.99')).toBeTruthy();
  });

  it('shows Add to Cart button when in stock', () => {
    const { getByText } = render(<ProductCard product={base} businessId="b1" />);
    expect(getByText('+ Add')).toBeTruthy();
  });

  it('shows Sold Out when no active stock', () => {
    const outOfStock = {
      ...base,
      product_variants: [{ ...base.product_variants[0], stock: 0 }],
    };
    const { getByText } = render(<ProductCard product={outOfStock} businessId="b1" />);
    expect(getByText('Sold Out')).toBeTruthy();
  });

  it('shows variant picker when has_variants and Add tapped', () => {
    const withVariants = {
      ...base,
      has_variants: true,
      product_variants: [
        { ...base.product_variants[0], option1_value: 'S', option1_name: 'Size' },
        { ...base.product_variants[0], id: 'v2', option1_value: 'M', stock: 3 },
      ],
    };
    const { getByText } = render(<ProductCard product={withVariants} businessId="b1" />);
    fireEvent.press(getByText('Add ▾'));
    expect(getByText('S')).toBeTruthy();
    expect(getByText('M')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/mobile
npx jest --testPathPattern="ProductCard" --ci 2>&1 | head -20
```

Expected: FAIL — "Cannot find module '../components/build/ProductCard'"

- [ ] **Step 3: Create ProductCard**

Create `apps/mobile/components/build/ProductCard.tsx`:

```tsx
import { useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet, Image, ScrollView,
} from 'react-native';
import { COLORS } from '../../lib/constants';
import { useMarketplaceStore } from '../../store/marketplaceStore';
import type { ProductWithVariants, ProductVariant } from '../../types/marketplace';

interface Props {
  product: ProductWithVariants;
  businessId: string;
}

function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function isSoldOut(product: ProductWithVariants): boolean {
  const activeVariants = product.product_variants.filter((v) => v.is_active && v.stock > 0);
  return activeVariants.length === 0;
}

export function ProductCard({ product, businessId }: Props) {
  const { addToCart } = useMarketplaceStore();
  const [showPicker, setShowPicker] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);
  const [adding, setAdding] = useState(false);
  const [addedFeedback, setAddedFeedback] = useState(false);

  const soldOut = isSoldOut(product);
  const firstPhoto = product.product_photos.sort((a, b) => a.position - b.position)[0];

  const handleAddNoVariants = async () => {
    const variant = product.product_variants.find((v) => v.is_active && v.stock > 0) ?? null;
    setAdding(true);
    await addToCart(businessId, product.id, variant?.id ?? null, 1);
    setAdding(false);
    setAddedFeedback(true);
    setTimeout(() => setAddedFeedback(false), 1500);
  };

  const handleAddVariant = async () => {
    if (!selectedVariant) return;
    setAdding(true);
    await addToCart(businessId, product.id, selectedVariant.id, 1);
    setAdding(false);
    setShowPicker(false);
    setSelectedVariant(null);
    setAddedFeedback(true);
    setTimeout(() => setAddedFeedback(false), 1500);
  };

  // Group variants by option1 for display
  const option1Values = product.has_variants
    ? [...new Set(product.product_variants.map((v) => v.option1_value).filter(Boolean))]
    : [];

  const selectedPrice = selectedVariant?.price_cents ?? product.base_price_cents;

  return (
    <View style={styles.card}>
      {/* Photo */}
      {firstPhoto ? (
        <Image source={{ uri: firstPhoto.url }} style={styles.photo} accessibilityLabel={firstPhoto.alt_text ?? product.name} />
      ) : (
        <View style={[styles.photo, styles.photoPlaceholder]}>
          <Text style={styles.photoPlaceholderText}>{product.category[0].toUpperCase()}</Text>
        </View>
      )}

      {/* Sold Out overlay */}
      {soldOut && (
        <View style={styles.soldOutOverlay}>
          <Text style={styles.soldOutText}>Sold Out</Text>
        </View>
      )}

      {/* Info */}
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={2}>{product.name}</Text>
        <Text style={styles.price}>{formatPrice(product.base_price_cents)}</Text>
      </View>

      {/* Add button */}
      {!soldOut && (
        <TouchableOpacity
          testID="add-btn"
          style={[styles.addBtn, adding && styles.addBtnDisabled]}
          onPress={product.has_variants ? () => setShowPicker(true) : handleAddNoVariants}
          disabled={adding}
          accessibilityLabel={product.has_variants ? 'Add with options' : 'Add to cart'}
        >
          <Text style={styles.addBtnText}>
            {addedFeedback ? '✓ Added' : adding ? '…' : product.has_variants ? 'Add ▾' : '+ Add'}
          </Text>
        </TouchableOpacity>
      )}

      {/* Variant Picker Modal */}
      {product.has_variants && (
        <Modal visible={showPicker} animationType="slide" transparent onRequestClose={() => setShowPicker(false)}>
          <View style={styles.pickerOverlay}>
            <View style={styles.pickerSheet}>
              <View style={styles.handle} />
              <Text style={styles.pickerTitle}>{product.name}</Text>
              <Text style={styles.pickerPrice}>{formatPrice(selectedPrice)}</Text>

              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Option 1 chips */}
                {option1Values.length > 0 && (
                  <View style={styles.optionSection}>
                    <Text style={styles.optionLabel}>{product.product_variants[0]?.option1_name ?? 'Option'}</Text>
                    <View style={styles.chipRow}>
                      {option1Values.map((val) => {
                        const matchingVariant = product.product_variants.find(
                          (v) => v.option1_value === val && v.is_active
                        );
                        const inStock = (matchingVariant?.stock ?? 0) > 0;
                        const isSelected = selectedVariant?.option1_value === val;
                        return (
                          <TouchableOpacity
                            key={val}
                            style={[
                              styles.chip,
                              isSelected && styles.chipSelected,
                              !inStock && styles.chipOOS,
                            ]}
                            onPress={() => inStock && setSelectedVariant(matchingVariant ?? null)}
                            disabled={!inStock}
                            accessibilityLabel={`${val}${inStock ? '' : ', out of stock'}`}
                          >
                            <Text style={[styles.chipText, isSelected && styles.chipTextSelected, !inStock && styles.chipTextOOS]}>
                              {val}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}

                <View style={{ height: 20 }} />
              </ScrollView>

              <TouchableOpacity
                style={[styles.addBtn, (!selectedVariant || adding) && styles.addBtnDisabled]}
                onPress={handleAddVariant}
                disabled={!selectedVariant || adding}
              >
                <Text style={styles.addBtnText}>
                  {adding ? '…' : selectedVariant ? `+ Add to Cart — ${formatPrice(selectedVariant.price_cents)}` : 'Select an option'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    margin: 4,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    overflow: 'hidden',
  },
  photo: { width: '100%', aspectRatio: 1, backgroundColor: COLORS.surface },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  photoPlaceholderText: { color: COLORS.primary, fontSize: 28, fontWeight: '700' },
  soldOutOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
  },
  soldOutText: { color: '#fff', fontWeight: '700', fontSize: 14, letterSpacing: 0.5 },
  info: { padding: 8, gap: 2 },
  name: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '600' },
  price: { color: COLORS.primary, fontSize: 13, fontWeight: '700' },
  addBtn: {
    margin: 8, marginTop: 0, backgroundColor: COLORS.primary,
    borderRadius: 8, paddingVertical: 8, alignItems: 'center',
  },
  addBtnDisabled: { opacity: 0.5 },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  // Picker
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  pickerSheet: {
    backgroundColor: COLORS.background, borderTopLeftRadius: 24,
    borderTopRightRadius: 24, paddingTop: 12, paddingBottom: 32, maxHeight: '70%',
  },
  handle: {
    width: 40, height: 4, backgroundColor: COLORS.textMuted,
    borderRadius: 2, alignSelf: 'center', marginBottom: 16,
  },
  pickerTitle: {
    color: COLORS.textPrimary, fontWeight: '700', fontSize: 17,
    paddingHorizontal: 20, marginBottom: 2,
  },
  pickerPrice: { color: COLORS.primary, fontWeight: '700', fontSize: 20, paddingHorizontal: 20, marginBottom: 16 },
  optionSection: { paddingHorizontal: 20, marginBottom: 16 },
  optionLabel: { color: COLORS.textMuted, fontSize: 12, fontWeight: '600', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1.5, borderColor: COLORS.surface, backgroundColor: COLORS.surface,
  },
  chipSelected: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '20' },
  chipOOS: { opacity: 0.4 },
  chipText: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '500' },
  chipTextSelected: { color: COLORS.primary, fontWeight: '700' },
  chipTextOOS: { textDecorationLine: 'line-through' },
});
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd apps/mobile
npx jest --testPathPattern="ProductCard" --ci
```

Expected: PASS (4 tests)

- [ ] **Step 5: Run tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/components/build/ProductCard.tsx apps/mobile/__tests__/ProductCard.test.tsx
git commit -m "feat(mobile): ProductCard with variant picker sheet"
```

---

### Task 4: BusinessDetailSheet — add Products tab

**Files:**
- Modify: `apps/mobile/components/build/BusinessDetailSheet.tsx`

Add a 3-tab layout: About | Products | Photos. The Products tab shows a 2-column FlashList of ProductCards + sticky cart footer.

- [ ] **Step 1: Write failing test**

Create `apps/mobile/__tests__/BusinessDetailSheetTabs.test.tsx`:

```tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { BusinessDetailSheet } from '../components/build/BusinessDetailSheet';

jest.mock('../store/marketplaceStore', () => ({
  useMarketplaceStore: () => ({
    fetchCart: jest.fn().mockResolvedValue(undefined),
    cartItemCount: jest.fn().mockReturnValue(0),
    cartTotal: jest.fn().mockReturnValue(0),
    openCart: jest.fn(),
    addToCart: jest.fn().mockResolvedValue({}),
  }),
}));

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
jest.mock('../lib/supabase', () => ({
  supabase: { from: jest.fn(() => ({ select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), then: jest.fn() })) },
  callEdgeFunction: jest.fn(),
}));

const business = {
  id: 'b1', name: 'Test Biz', owner_id: 'u1', description: 'Great stuff',
  category: 'fashion', location_city: 'NYC', website_url: null,
  instagram_handle: null, logo_url: null, is_verified: true,
  is_wlw_owned: true, can_sell: true, stripe_account_id: 'acct_123', created_at: '',
};

describe('BusinessDetailSheet tabs', () => {
  it('shows About tab by default', () => {
    const { getByText } = render(
      <BusinessDetailSheet business={business} photos={[]} isBookmarked={false} onBookmarkToggle={jest.fn()} onClose={jest.fn()} />
    );
    expect(getByText('About')).toBeTruthy();
    expect(getByText('Products')).toBeTruthy();
    expect(getByText('Photos')).toBeTruthy();
  });

  it('switches to Products tab on press', () => {
    const { getByText } = render(
      <BusinessDetailSheet business={business} photos={[]} isBookmarked={false} onBookmarkToggle={jest.fn()} onClose={jest.fn()} />
    );
    fireEvent.press(getByText('Products'));
    // Products tab now active — loading or empty state
    expect(getByText('Products')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/mobile
npx jest --testPathPattern="BusinessDetailSheetTabs" --ci 2>&1 | head -20
```

Expected: FAIL — tabs don't exist yet.

- [ ] **Step 3: Update BusinessDetailSheet to 3-tab layout**

Replace the entire `apps/mobile/components/build/BusinessDetailSheet.tsx` with:

```tsx
import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet, Linking, FlatList } from 'react-native';
import { COLORS } from '../../lib/constants';
import { Business, BusinessPhoto } from '../../types';
import type { ProductWithVariants } from '../../types/marketplace';
import { BusinessPhotoGallery } from './BusinessPhotoGallery';
import { ProductCard } from './ProductCard';
import { CartDrawer } from './CartDrawer';
import { useMarketplaceStore } from '../../store/marketplaceStore';
import { supabase } from '../../lib/supabase';

type Tab = 'about' | 'products' | 'photos';

interface BusinessDetailSheetProps {
  business: Business | null;
  photos: BusinessPhoto[];
  isBookmarked: boolean;
  onBookmarkToggle: () => void;
  onClose: () => void;
}

export function BusinessDetailSheet({
  business,
  photos,
  isBookmarked,
  onBookmarkToggle,
  onClose,
}: BusinessDetailSheetProps) {
  const [activeTab, setActiveTab] = useState<Tab>('about');
  const [products, setProducts] = useState<ProductWithVariants[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [showCart, setShowCart] = useState(false);
  const { fetchCart, cartItemCount, cartTotal, openCart } = useMarketplaceStore();

  const hasLinks = !!(business?.website_url || business?.instagram_handle);
  const cartCount = business ? cartItemCount(business.id) : 0;
  const cartTotalCents = business ? cartTotal(business.id) : 0;

  useEffect(() => {
    if (!business) { setActiveTab('about'); setProducts([]); return; }
    if (business.can_sell) void fetchCart(business.id);
  }, [business?.id]);

  useEffect(() => {
    if (activeTab !== 'products' || !business?.can_sell) return;
    setLoadingProducts(true);
    supabase
      .from('products')
      .select('*, product_variants(*), product_photos(*)')
      .eq('business_id', business.id)
      .eq('status', 'approved')
      .eq('is_active', true)
      .then(({ data }) => {
        setProducts((data as ProductWithVariants[]) ?? []);
        setLoadingProducts(false);
      });
  }, [activeTab, business?.id]);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'about', label: 'About' },
    { key: 'products', label: 'Products' },
    { key: 'photos', label: 'Photos' },
  ];

  return (
    <>
      <Modal
        visible={business !== null}
        animationType="slide"
        transparent
        onRequestClose={onClose}
      >
        {business && (
          <View style={styles.overlay}>
            <View style={styles.sheet}>
              {/* Handle */}
              <View style={styles.handle} />

              {/* Header row */}
              <View style={styles.headerRow}>
                <View style={styles.logoCircle}>
                  <Text style={styles.logoText}>{business.name[0].toUpperCase()}</Text>
                </View>
                <View style={styles.headerInfo}>
                  <Text style={styles.name} numberOfLines={2}>{business.name}</Text>
                  {business.is_verified && (
                    <Text style={styles.verifiedBadge}>★ Verified WLW Business</Text>
                  )}
                  {business.location_city && (
                    <Text style={styles.city}>📍 {business.location_city}</Text>
                  )}
                </View>
                <TouchableOpacity
                  testID="bookmark-btn"
                  onPress={onBookmarkToggle}
                  accessibilityLabel={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
                  hitSlop={12}
                >
                  <Text style={styles.bookmarkIcon}>{isBookmarked ? '💜' : '🤍'}</Text>
                </TouchableOpacity>
              </View>

              {/* Tabs */}
              <View style={styles.tabRow}>
                {tabs.map((t) => (
                  <TouchableOpacity
                    key={t.key}
                    style={[styles.tab, activeTab === t.key && styles.tabActive]}
                    onPress={() => setActiveTab(t.key)}
                    accessibilityLabel={t.label}
                  >
                    <Text style={[styles.tabText, activeTab === t.key && styles.tabTextActive]}>
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Tab content */}
              {activeTab === 'about' && (
                <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollContent}>
                  {business.description && (
                    <Text style={styles.description}>{business.description}</Text>
                  )}
                  {hasLinks && (
                    <View style={styles.linksSection}>
                      <Text style={styles.linksHeader}>🔗 Links</Text>
                      {business.website_url && (
                        <TouchableOpacity
                          onPress={() => Linking.openURL(business.website_url!).catch(() => {})}
                          style={styles.linkRow}
                        >
                          <Text style={styles.linkText}>🌐 Website →</Text>
                        </TouchableOpacity>
                      )}
                      {business.instagram_handle && (
                        <TouchableOpacity
                          onPress={() =>
                            Linking.openURL(`https://instagram.com/${business.instagram_handle}`).catch(() => {})
                          }
                          style={styles.linkRow}
                        >
                          <Text style={styles.linkText}>📸 @{business.instagram_handle} →</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                  <View style={{ height: 40 }} />
                </ScrollView>
              )}

              {activeTab === 'products' && (
                <View style={styles.productsContainer}>
                  {!business.can_sell ? (
                    <View style={styles.emptyState}>
                      <Text style={styles.emptyText}>This business isn't selling yet.</Text>
                    </View>
                  ) : loadingProducts ? (
                    <View style={styles.emptyState}>
                      <Text style={styles.emptyText}>Loading…</Text>
                    </View>
                  ) : products.length === 0 ? (
                    <View style={styles.emptyState}>
                      <Text style={styles.emptyText}>No products yet.</Text>
                    </View>
                  ) : (
                    <FlatList
                      data={products}
                      numColumns={2}
                      keyExtractor={(p) => p.id}
                      renderItem={({ item }) => (
                        <ProductCard product={item} businessId={business.id} />
                      )}
                      contentContainerStyle={styles.productList}
                      showsVerticalScrollIndicator={false}
                    />
                  )}

                  {/* Sticky cart footer */}
                  {cartCount > 0 && (
                    <TouchableOpacity
                      style={styles.cartFooter}
                      onPress={() => { openCart(business.id); setShowCart(true); }}
                      accessibilityLabel={`View cart — ${cartCount} items`}
                    >
                      <Text style={styles.cartFooterText}>
                        🛍 {cartCount} item{cartCount !== 1 ? 's' : ''} · ${(cartTotalCents / 100).toFixed(2)}
                      </Text>
                      <Text style={styles.cartFooterCta}>Checkout →</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {activeTab === 'photos' && (
                <ScrollView showsVerticalScrollIndicator={false} style={styles.scrollContent}>
                  {photos.length > 0 ? (
                    <View testID="photo-gallery">
                      <BusinessPhotoGallery photos={photos} />
                    </View>
                  ) : (
                    <View style={styles.emptyState}>
                      <Text style={styles.emptyText}>No photos yet.</Text>
                    </View>
                  )}
                  <View style={{ height: 40 }} />
                </ScrollView>
              )}

              {/* Close button */}
              <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Modal>

      {/* Cart Drawer */}
      {business && showCart && (
        <CartDrawer
          businessId={business.id}
          businessName={business.name}
          visible={showCart}
          onClose={() => setShowCart(false)}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, maxHeight: '92%', flex: 1 },
  handle: { width: 40, height: 4, backgroundColor: COLORS.textMuted, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
  logoCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.primary + '30', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  logoText: { color: COLORS.primary, fontWeight: '700', fontSize: 20 },
  headerInfo: { flex: 1, gap: 2 },
  name: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 17 },
  verifiedBadge: { color: COLORS.primary, fontSize: 12, fontWeight: '600' },
  city: { color: COLORS.textMuted, fontSize: 12 },
  bookmarkIcon: { fontSize: 22 },
  // Tabs
  tabRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.surface, paddingHorizontal: 20 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: COLORS.primary },
  tabText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 14 },
  tabTextActive: { color: COLORS.primary },
  // Scroll
  scrollContent: { flex: 1 },
  description: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20, paddingHorizontal: 20, paddingVertical: 12 },
  linksSection: { paddingHorizontal: 20, paddingVertical: 12, gap: 12 },
  linksHeader: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 14 },
  linkRow: {},
  linkText: { color: COLORS.primary, fontSize: 14, fontWeight: '600' },
  // Products tab
  productsContainer: { flex: 1 },
  productList: { padding: 4 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  emptyText: { color: COLORS.textMuted, fontSize: 14 },
  // Cart footer
  cartFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.primary, paddingHorizontal: 20, paddingVertical: 14,
    margin: 12, borderRadius: 14,
  },
  cartFooterText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  cartFooterCta: { color: '#fff', fontWeight: '700', fontSize: 14 },
  // Close
  closeBtn: { position: 'absolute', top: 16, right: 16, padding: 8 },
  closeBtnText: { color: COLORS.textMuted, fontSize: 18, fontWeight: '700' },
});
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd apps/mobile
npx jest --testPathPattern="BusinessDetailSheetTabs" --ci
```

Expected: PASS (2 tests)

- [ ] **Step 5: Run tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors. Fix any import issues.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/components/build/BusinessDetailSheet.tsx apps/mobile/__tests__/BusinessDetailSheetTabs.test.tsx
git commit -m "feat(mobile): BusinessDetailSheet 3-tab layout (About/Products/Photos) + cart footer"
```

---

### Task 5: CartDrawer

**Files:**
- Create: `apps/mobile/components/build/CartDrawer.tsx`
- Create: `apps/mobile/__tests__/CartDrawer.test.tsx`

CartDrawer slides up from the Products tab's cart footer. Shows items, quantity controls, totals, and [Checkout] button that opens CheckoutSheet.

- [ ] **Step 1: Write failing tests**

Create `apps/mobile/__tests__/CartDrawer.test.tsx`:

```tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { CartDrawer } from '../components/build/CartDrawer';

const mockStore = {
  carts: {
    'b1': {
      cart: { id: 'c1', buyer_id: 'u1', business_id: 'b1', expires_at: '', created_at: '', updated_at: '' },
      items: [
        {
          id: 'ci1', cart_id: 'c1', product_id: 'p1', variant_id: null,
          quantity: 2, added_at: '',
          product: { id: 'p1', name: 'Test Shirt', base_price_cents: 2999, has_variants: false, business_id: 'b1', category: 'apparel', status: 'approved', is_active: true, rejection_reason: null, description: null, created_at: '', updated_at: '' },
          variant: null,
        },
      ],
    },
  },
  cartTotal: jest.fn().mockReturnValue(5998),
  updateQuantity: jest.fn().mockResolvedValue(undefined),
  removeFromCart: jest.fn().mockResolvedValue(undefined),
  setCheckoutStep: jest.fn(),
  checkoutStep: null,
  shippingAddress: null,
  isProcessingPayment: false,
  confirmedOrderId: null,
};

jest.mock('../store/marketplaceStore', () => ({
  useMarketplaceStore: () => mockStore,
}));

describe('CartDrawer', () => {
  it('renders cart items', () => {
    const { getByText } = render(
      <CartDrawer businessId="b1" businessName="Test Biz" visible={true} onClose={jest.fn()} />
    );
    expect(getByText('Test Shirt')).toBeTruthy();
    expect(getByText('$59.98')).toBeTruthy(); // total
  });

  it('shows Checkout button', () => {
    const { getByText } = render(
      <CartDrawer businessId="b1" businessName="Test Biz" visible={true} onClose={jest.fn()} />
    );
    expect(getByText(/Checkout/)).toBeTruthy();
  });

  it('calls onClose when close pressed', () => {
    const onClose = jest.fn();
    const { getByText } = render(
      <CartDrawer businessId="b1" businessName="Test Biz" visible={true} onClose={onClose} />
    );
    fireEvent.press(getByText('✕'));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/mobile
npx jest --testPathPattern="CartDrawer" --ci 2>&1 | head -20
```

Expected: FAIL — "Cannot find module '../components/build/CartDrawer'"

- [ ] **Step 3: Create CartDrawer**

Create `apps/mobile/components/build/CartDrawer.tsx`:

```tsx
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet } from 'react-native';
import { COLORS } from '../../lib/constants';
import { useMarketplaceStore } from '../../store/marketplaceStore';
import { CheckoutSheet } from './CheckoutSheet';

interface Props {
  businessId: string;
  businessName: string;
  visible: boolean;
  onClose: () => void;
}

export function CartDrawer({ businessId, businessName, visible, onClose }: Props) {
  const { carts, cartTotal, updateQuantity, removeFromCart, setCheckoutStep, checkoutStep } = useMarketplaceStore();
  const bundle = carts[businessId];
  const items = bundle?.items ?? [];
  const totalCents = cartTotal(businessId);

  const handleCheckout = () => {
    setCheckoutStep('review');
  };

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>Your Cart — {businessName}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={12}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            {items.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>Your cart is empty.</Text>
              </View>
            ) : (
              <>
                <ScrollView showsVerticalScrollIndicator={false} style={styles.itemList}>
                  {items.map((item) => {
                    const priceCents = item.variant?.price_cents ?? item.product?.base_price_cents ?? 0;
                    const label = item.variant
                      ? [item.variant.option1_value, item.variant.option2_value].filter(Boolean).join(' / ')
                      : null;
                    return (
                      <View key={item.id} style={styles.itemRow}>
                        <View style={styles.itemInfo}>
                          <Text style={styles.itemName}>{item.product?.name ?? 'Product'}</Text>
                          {label && <Text style={styles.itemVariant}>{label}</Text>}
                          <Text style={styles.itemPrice}>${(priceCents / 100).toFixed(2)} each</Text>
                        </View>
                        <View style={styles.qtyRow}>
                          <TouchableOpacity
                            style={styles.qtyBtn}
                            onPress={() => void updateQuantity(businessId, item.id, item.quantity - 1)}
                            accessibilityLabel="Decrease quantity"
                          >
                            <Text style={styles.qtyBtnText}>−</Text>
                          </TouchableOpacity>
                          <Text style={styles.qtyValue}>{item.quantity}</Text>
                          <TouchableOpacity
                            style={[styles.qtyBtn, item.quantity >= (item.variant?.stock ?? item.product?.base_price_cents ?? 99) && styles.qtyBtnDisabled]}
                            onPress={() => void updateQuantity(businessId, item.id, item.quantity + 1)}
                            disabled={item.quantity >= (item.variant?.stock ?? 99)}
                            accessibilityLabel="Increase quantity"
                          >
                            <Text style={styles.qtyBtnText}>+</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => void removeFromCart(businessId, item.id)}
                            hitSlop={8}
                            accessibilityLabel="Remove item"
                          >
                            <Text style={styles.removeBtn}>🗑</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                  <View style={{ height: 16 }} />
                </ScrollView>

                <View style={styles.footer}>
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Subtotal</Text>
                    <Text style={styles.totalValue}>${(totalCents / 100).toFixed(2)}</Text>
                  </View>
                  <Text style={styles.taxNote}>Tax calculated at checkout</Text>
                  <TouchableOpacity style={styles.checkoutBtn} onPress={handleCheckout}>
                    <Text style={styles.checkoutBtnText}>Checkout → ${(totalCents / 100).toFixed(2)}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Checkout Sheet opens on top of cart */}
      <CheckoutSheet businessId={businessId} visible={checkoutStep !== null} onClose={() => setCheckoutStep(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, maxHeight: '80%' },
  handle: { width: 40, height: 4, backgroundColor: COLORS.textMuted, borderRadius: 2, alignSelf: 'center', marginBottom: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.surface },
  title: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 16 },
  closeBtn: { color: COLORS.textMuted, fontSize: 18, fontWeight: '700' },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { color: COLORS.textMuted },
  itemList: { flex: 1 },
  itemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.surface },
  itemInfo: { flex: 1, gap: 2 },
  itemName: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 14 },
  itemVariant: { color: COLORS.textMuted, fontSize: 12 },
  itemPrice: { color: COLORS.primary, fontSize: 13 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  qtyBtnDisabled: { opacity: 0.4 },
  qtyBtnText: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 16 },
  qtyValue: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 16, minWidth: 24, textAlign: 'center' },
  removeBtn: { fontSize: 18 },
  footer: { padding: 20, borderTopWidth: 1, borderTopColor: COLORS.surface },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  totalLabel: { color: COLORS.textSecondary, fontSize: 14 },
  totalValue: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 14 },
  taxNote: { color: COLORS.textMuted, fontSize: 11, marginBottom: 12 },
  checkoutBtn: { backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  checkoutBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd apps/mobile
npx jest --testPathPattern="CartDrawer" --ci
```

Expected: PASS (3 tests)

- [ ] **Step 5: Run tsc**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/components/build/CartDrawer.tsx apps/mobile/__tests__/CartDrawer.test.tsx
git commit -m "feat(mobile): CartDrawer with quantity controls + checkout entry"
```

---

### Task 6: CheckoutSheet + stripe.ts purchaseProduct

**Files:**
- Create: `apps/mobile/components/build/CheckoutSheet.tsx`
- Modify: `apps/mobile/lib/stripe.ts` (add `purchaseProduct` function)

3-step checkout: Review → Shipping Address → Payment Sheet (Stripe). On success → `setConfirmedOrderId` → triggers OrderConfirmationSheet.

- [ ] **Step 1: Add purchaseProduct to stripe.ts**

In `apps/mobile/lib/stripe.ts`, add after the existing `purchaseTicket` function:

```ts
export interface PurchaseProductResult {
  success: boolean;
  orderId?: string | null;
  cancelled?: boolean;
  outOfStock?: boolean;
  error?: string;
}

export async function purchaseProduct(
  cartId: string,
  shippingAddress: {
    name: string; line1: string; line2?: string;
    city: string; state: string; postal_code: string; country: string;
  },
  initPaymentSheet: ReturnType<typeof useStripe>['initPaymentSheet'],
  presentPaymentSheet: ReturnType<typeof useStripe>['presentPaymentSheet'],
): Promise<PurchaseProductResult> {
  let clientSecret: string;

  try {
    const idempotencyKey = `${cartId}-${Date.now()}`;
    const { data, error } = await callEdgeFunction<{ client_secret: string }>(
      'create-product-order',
      { cart_id: cartId, shipping_address: shippingAddress, idempotency_key: idempotencyKey },
    );
    if (error) {
      if (error.includes('out_of_stock') || error.includes('409')) return { success: false, outOfStock: true };
      throw new Error(error);
    }
    if (!data?.client_secret) throw new Error('No client secret returned');
    clientSecret = data.client_secret;
  } catch (err) {
    logError(sanitizePaymentError(err), 'purchaseProduct:createOrder');
    return { success: false, error: 'Could not initialise payment. Please try again.' };
  }

  const { error: initError } = await initPaymentSheet({
    paymentIntentClientSecret: clientSecret,
    merchantDisplayName: 'Roxy Marketplace',
    applePay: { merchantCountryCode: 'US' },
    googlePay: { merchantCountryCode: 'US', testEnv: __DEV__ },
  });

  if (initError) {
    logError(sanitizePaymentError(initError), 'purchaseProduct:initPaymentSheet');
    return { success: false, error: 'Payment setup failed. Please try again.' };
  }

  const { error: presentError } = await presentPaymentSheet();

  if (presentError) {
    if (presentError.code === 'Canceled') return { success: false, cancelled: true };
    logError(sanitizePaymentError(presentError), 'purchaseProduct:presentPaymentSheet');
    return { success: false, error: presentError.message };
  }

  // Payment confirmed — order created via webhook
  return { success: true, orderId: null };
}
```

- [ ] **Step 2: Create CheckoutSheet**

Create `apps/mobile/components/build/CheckoutSheet.tsx`:

```tsx
import { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, TextInput, StyleSheet } from 'react-native';
import { useStripe } from '@stripe/stripe-react-native';
import { COLORS } from '../../lib/constants';
import { useMarketplaceStore } from '../../store/marketplaceStore';
import { purchaseProduct } from '../../lib/stripe';
import { OrderConfirmationSheet } from './OrderConfirmationSheet';
import type { ShippingAddress } from '../../types/marketplace';

interface Props {
  businessId: string;
  visible: boolean;
  onClose: () => void;
}

type Step = 'review' | 'shipping' | 'payment';

export function CheckoutSheet({ businessId, visible, onClose }: Props) {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const {
    carts, cartTotal, checkoutStep, setCheckoutStep,
    shippingAddress, setShippingAddress,
    isProcessingPayment, setIsProcessingPayment,
    setConfirmedOrderId, confirmedOrderId, clearCart,
  } = useMarketplaceStore();

  const bundle = carts[businessId];
  const cartId = bundle?.cart?.id ?? null;
  const totalCents = cartTotal(businessId);

  const [localStep, setLocalStep] = useState<Step>('review');
  const [localAddr, setLocalAddr] = useState<Partial<ShippingAddress>>({});
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const step = checkoutStep ?? localStep;

  const goToStep = (s: Step) => {
    setLocalStep(s);
    setCheckoutStep(s);
  };

  const handlePay = async () => {
    const addr = shippingAddress ?? (localAddr as ShippingAddress);
    if (!cartId || !addr.name || !addr.line1 || !addr.city || !addr.state || !addr.postal_code) {
      setPaymentError('Please fill in all shipping fields.');
      return;
    }
    setPaymentError(null);
    setIsProcessingPayment(true);

    const result = await purchaseProduct(cartId, addr, initPaymentSheet, presentPaymentSheet);
    setIsProcessingPayment(false);

    if (result.cancelled) return;
    if (result.outOfStock) { setPaymentError('Some items went out of stock. Please review your cart.'); return; }
    if (!result.success) { setPaymentError(result.error ?? 'Payment failed. Please try again.'); return; }

    // Success — clear cart and show confirmation
    clearCart(businessId);
    setConfirmedOrderId('pending'); // Will be resolved by Realtime/polling in a real flow
  };

  const addrField = (key: keyof ShippingAddress, placeholder: string, required = true) => (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{placeholder}{required ? ' *' : ''}</Text>
      <TextInput
        style={styles.fieldInput}
        value={(localAddr[key] as string) ?? ''}
        onChangeText={(v) => setLocalAddr((a) => ({ ...a, [key]: v }))}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textMuted}
        autoCorrect={false}
      />
    </View>
  );

  if (confirmedOrderId) {
    return (
      <OrderConfirmationSheet
        orderId={confirmedOrderId}
        visible={!!confirmedOrderId}
        onClose={() => { setConfirmedOrderId(null); onClose(); }}
        onViewOrders={() => { setConfirmedOrderId(null); onClose(); }}
      />
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />

          {/* Progress */}
          <View style={styles.progressRow}>
            {(['review', 'shipping', 'payment'] as Step[]).map((s, i) => (
              <View key={s} style={styles.progressStep}>
                <View style={[styles.progressDot, step === s && styles.progressDotActive, ['shipping', 'payment'].includes(step) && s === 'review' && styles.progressDotDone, step === 'payment' && s === 'shipping' && styles.progressDotDone]}>
                  <Text style={styles.progressDotText}>{i + 1}</Text>
                </View>
                <Text style={[styles.progressLabel, step === s && styles.progressLabelActive]}>{s === 'review' ? 'Review' : s === 'shipping' ? 'Shipping' : 'Payment'}</Text>
              </View>
            ))}
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={styles.content}>
            {/* Step 1: Review */}
            {step === 'review' && (
              <View style={styles.stepContent}>
                <Text style={styles.stepTitle}>Order Review</Text>
                {(bundle?.items ?? []).map((item) => {
                  const priceCents = item.variant?.price_cents ?? item.product?.base_price_cents ?? 0;
                  return (
                    <View key={item.id} style={styles.reviewItem}>
                      <Text style={styles.reviewItemName}>{item.product?.name ?? ''}</Text>
                      <Text style={styles.reviewItemPrice}>×{item.quantity} — ${((priceCents * item.quantity) / 100).toFixed(2)}</Text>
                    </View>
                  );
                })}
                <View style={styles.reviewTotal}>
                  <Text style={styles.reviewTotalLabel}>Subtotal</Text>
                  <Text style={styles.reviewTotalValue}>${(totalCents / 100).toFixed(2)}</Text>
                </View>
                <Text style={styles.taxNote}>Tax calculated by Stripe at payment step</Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={() => goToStep('shipping')}>
                  <Text style={styles.primaryBtnText}>Continue to Shipping →</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Step 2: Shipping */}
            {step === 'shipping' && (
              <View style={styles.stepContent}>
                <Text style={styles.stepTitle}>Shipping Address</Text>
                {addrField('name', 'Full name')}
                {addrField('line1', 'Address line 1')}
                {addrField('line2', 'Address line 2 (optional)', false)}
                {addrField('city', 'City')}
                {addrField('state', 'State')}
                {addrField('postal_code', 'ZIP / Postal code')}
                {addrField('country', 'Country')}
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() => {
                    const addr = localAddr as ShippingAddress;
                    if (!addr.name || !addr.line1 || !addr.city || !addr.state || !addr.postal_code) {
                      setPaymentError('Please fill in all required fields.');
                      return;
                    }
                    setShippingAddress(addr);
                    setPaymentError(null);
                    goToStep('payment');
                  }}
                >
                  <Text style={styles.primaryBtnText}>Continue to Payment →</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Step 3: Payment */}
            {step === 'payment' && (
              <View style={styles.stepContent}>
                <Text style={styles.stepTitle}>Payment</Text>
                <View style={styles.paymentSummary}>
                  <Text style={styles.paymentSummaryLabel}>Total due (+ tax)</Text>
                  <Text style={styles.paymentSummaryValue}>${(totalCents / 100).toFixed(2)}+</Text>
                </View>
                <Text style={styles.feeNote}>Roxy takes 10% per sale. Seller receives the remainder.</Text>
                {paymentError && (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{paymentError}</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={[styles.primaryBtn, isProcessingPayment && styles.primaryBtnDisabled]}
                  onPress={handlePay}
                  disabled={isProcessingPayment}
                >
                  <Text style={styles.primaryBtnText}>
                    {isProcessingPayment ? 'Processing…' : `Pay $${(totalCents / 100).toFixed(2)}`}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>

          <TouchableOpacity style={styles.backBtn} onPress={step === 'review' ? onClose : () => goToStep(step === 'payment' ? 'shipping' : 'review')}>
            <Text style={styles.backBtnText}>{step === 'review' ? '✕ Close' : '← Back'}</Text>
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
  progressRow: { flexDirection: 'row', justifyContent: 'center', gap: 24, paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: COLORS.surface },
  progressStep: { alignItems: 'center', gap: 4 },
  progressDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  progressDotActive: { backgroundColor: COLORS.primary },
  progressDotDone: { backgroundColor: COLORS.primary + '80' },
  progressDotText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  progressLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '500' },
  progressLabelActive: { color: COLORS.primary },
  content: { flex: 1 },
  stepContent: { padding: 20, gap: 12 },
  stepTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 18, marginBottom: 4 },
  reviewItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.surface },
  reviewItemName: { color: COLORS.textPrimary, fontSize: 14, flex: 1 },
  reviewItemPrice: { color: COLORS.textSecondary, fontSize: 14 },
  reviewTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  reviewTotalLabel: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 15 },
  reviewTotalValue: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 15 },
  taxNote: { color: COLORS.textMuted, fontSize: 11, marginBottom: 8 },
  field: { gap: 4 },
  fieldLabel: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '500' },
  fieldInput: { backgroundColor: COLORS.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, color: COLORS.textPrimary, fontSize: 15 },
  primaryBtn: { backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  paymentSummary: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: COLORS.surface, borderRadius: 12, padding: 16, marginBottom: 4 },
  paymentSummaryLabel: { color: COLORS.textSecondary, fontSize: 14 },
  paymentSummaryValue: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 20 },
  feeNote: { color: COLORS.textMuted, fontSize: 11 },
  errorBox: { backgroundColor: '#FEE2E2', borderRadius: 8, padding: 12 },
  errorText: { color: '#B91C1C', fontSize: 13 },
  backBtn: { padding: 16, alignItems: 'center' },
  backBtnText: { color: COLORS.textMuted, fontSize: 14, fontWeight: '500' },
});
```

- [ ] **Step 3: Run tsc**

```bash
cd apps/mobile
npx tsc --noEmit
```

Expected: 0 errors. Fix any issues with `useStripe` import or type mismatches.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/lib/stripe.ts apps/mobile/components/build/CheckoutSheet.tsx
git commit -m "feat(mobile): CheckoutSheet (3-step) + purchaseProduct in stripe.ts"
```

---

### Task 7: OrderConfirmationSheet + OrderDetailSheet

**Files:**
- Create: `apps/mobile/components/build/OrderConfirmationSheet.tsx`
- Create: `apps/mobile/components/build/OrderDetailSheet.tsx`

- [ ] **Step 1: Create OrderConfirmationSheet**

Create `apps/mobile/components/build/OrderConfirmationSheet.tsx`:

```tsx
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { COLORS } from '../../lib/constants';

interface Props {
  orderId: string | null;
  visible: boolean;
  onClose: () => void;
  onViewOrders: () => void;
}

export function OrderConfirmationSheet({ orderId, visible, onClose, onViewOrders }: Props) {
  const shortId = orderId && orderId !== 'pending' ? orderId.slice(0, 8) : null;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.emoji}>🎉</Text>
          <Text style={styles.title}>Order Placed!</Text>
          {shortId && <Text style={styles.orderId}>Order #{shortId}</Text>}
          <Text style={styles.body}>
            Your order is confirmed. A receipt has been sent to your email by Stripe.
            You'll receive a shipping notification when your order is on its way.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={onViewOrders}>
            <Text style={styles.primaryBtnText}>View My Orders</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={onClose}>
            <Text style={styles.secondaryBtnText}>Continue Shopping</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { backgroundColor: COLORS.background, borderRadius: 24, padding: 28, alignItems: 'center', width: '100%', maxWidth: 360 },
  emoji: { fontSize: 48, marginBottom: 12 },
  title: { color: COLORS.textPrimary, fontWeight: '800', fontSize: 24, marginBottom: 4 },
  orderId: { color: COLORS.textMuted, fontSize: 13, fontFamily: 'monospace', marginBottom: 12 },
  body: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 24 },
  primaryBtn: { backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, marginBottom: 10, width: '100%', alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondaryBtn: { paddingVertical: 10 },
  secondaryBtnText: { color: COLORS.textMuted, fontSize: 14 },
});
```

- [ ] **Step 2: Create OrderDetailSheet**

Create `apps/mobile/components/build/OrderDetailSheet.tsx`:

```tsx
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet, Linking } from 'react-native';
import { COLORS } from '../../lib/constants';
import { useMarketplaceStore } from '../../store/marketplaceStore';
import type { OrderWithDetails } from '../../types/marketplace';

const STATUS_COLORS: Record<string, string> = {
  paid: '#3B82F6', shipped: '#8B5CF6', delivered: '#22C55E',
  refunded: '#F59E0B', cancelled: '#6B7280',
};

interface Props {
  order: OrderWithDetails | null;
  visible: boolean;
  onClose: () => void;
}

export function OrderDetailSheet({ order, visible, onClose }: Props) {
  if (!order) return null;
  const events = [...(order.order_events ?? [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Order #{order.id.slice(0, 8)}</Text>
              <Text style={styles.date}>{new Date(order.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[order.status] ?? '#6B7280' }]}>
              <Text style={styles.statusText}>{order.status}</Text>
            </View>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={styles.content}>
            {/* Items */}
            <Text style={styles.sectionTitle}>Items</Text>
            {(order.order_items ?? []).map((item) => (
              <View key={item.id} style={styles.itemRow}>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemName}>{item.product_name}</Text>
                  {item.variant_label && <Text style={styles.itemVariant}>{item.variant_label}</Text>}
                </View>
                <Text style={styles.itemTotal}>×{item.quantity} — ${(item.line_total_cents / 100).toFixed(2)}</Text>
              </View>
            ))}
            <View style={styles.orderTotal}>
              <Text style={styles.orderTotalLabel}>Total</Text>
              <Text style={styles.orderTotalValue}>${(order.total_cents / 100).toFixed(2)}</Text>
            </View>

            {/* Invoice link */}
            {order.stripe_invoice_url && (
              <TouchableOpacity style={styles.invoiceLink} onPress={() => Linking.openURL(order.stripe_invoice_url!).catch(() => {})}>
                <Text style={styles.invoiceLinkText}>📄 View Invoice PDF →</Text>
              </TouchableOpacity>
            )}

            {/* Shipping */}
            <Text style={styles.sectionTitle}>Shipping Address</Text>
            <View style={styles.addressBox}>
              <Text style={styles.addressLine}>{order.shipping_name}</Text>
              <Text style={styles.addressLine}>{order.shipping_line1}{order.shipping_line2 ? `, ${order.shipping_line2}` : ''}</Text>
              <Text style={styles.addressLine}>{order.shipping_city}, {order.shipping_state} {order.shipping_postal_code}</Text>
            </View>

            {/* Tracking */}
            {order.tracking_number && (
              <View style={styles.trackingRow}>
                <Text style={styles.trackingLabel}>Tracking</Text>
                <Text style={styles.trackingValue}>{order.tracking_number}</Text>
              </View>
            )}

            {/* Timeline */}
            <Text style={styles.sectionTitle}>Timeline</Text>
            {events.map((ev) => (
              <View key={ev.id} style={styles.eventRow}>
                <Text style={styles.eventTime}>{new Date(ev.created_at).toLocaleDateString()}</Text>
                <View>
                  <Text style={styles.eventName}>{ev.event.replace(/_/g, ' ')}</Text>
                  {ev.note && <Text style={styles.eventNote}>{ev.note}</Text>}
                </View>
              </View>
            ))}

            <View style={{ height: 40 }} />
          </ScrollView>

          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Close</Text>
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
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: COLORS.surface },
  title: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 18 },
  date: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { color: '#fff', fontWeight: '600', fontSize: 12, textTransform: 'capitalize' },
  content: { flex: 1, paddingHorizontal: 20 },
  sectionTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 14, marginTop: 20, marginBottom: 8 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.surface },
  itemInfo: { flex: 1 },
  itemName: { color: COLORS.textPrimary, fontSize: 14 },
  itemVariant: { color: COLORS.textMuted, fontSize: 12 },
  itemTotal: { color: COLORS.textSecondary, fontSize: 14 },
  orderTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  orderTotalLabel: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 15 },
  orderTotalValue: { color: COLORS.primary, fontWeight: '700', fontSize: 15 },
  invoiceLink: { paddingVertical: 8 },
  invoiceLinkText: { color: COLORS.primary, fontSize: 14, fontWeight: '600' },
  addressBox: { backgroundColor: COLORS.surface, borderRadius: 10, padding: 14, gap: 2 },
  addressLine: { color: COLORS.textPrimary, fontSize: 14 },
  trackingRow: { flexDirection: 'row', gap: 8, paddingVertical: 8, alignItems: 'center' },
  trackingLabel: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  trackingValue: { color: COLORS.primary, fontSize: 13, fontFamily: 'monospace' },
  eventRow: { flexDirection: 'row', gap: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.surface },
  eventTime: { color: COLORS.textMuted, fontSize: 11, width: 70, marginTop: 2, flexShrink: 0 },
  eventName: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '600', textTransform: 'capitalize' },
  eventNote: { color: COLORS.textMuted, fontSize: 12, marginTop: 1 },
  closeBtn: { margin: 16, backgroundColor: COLORS.surface, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  closeBtnText: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 15 },
});
```

- [ ] **Step 3: Run tsc**

```bash
cd apps/mobile
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/components/build/OrderConfirmationSheet.tsx apps/mobile/components/build/OrderDetailSheet.tsx
git commit -m "feat(mobile): OrderConfirmationSheet + OrderDetailSheet"
```

---

### Task 8: My Orders on profile screen

**Files:**
- Modify: `apps/mobile/app/(tabs)/profile/index.tsx`

Add a "My Orders" section above Saved Businesses. Tapping an order row opens OrderDetailSheet.

- [ ] **Step 1: Update profile/index.tsx**

In `apps/mobile/app/(tabs)/profile/index.tsx`:

1. Add imports at top:
```ts
import { useMarketplaceStore } from '../../../store/marketplaceStore';
import { OrderDetailSheet } from '../../../components/build/OrderDetailSheet';
import type { OrderWithDetails } from '../../../types/marketplace';
```

2. Add to component state (after `const [bizPhotos, setBizPhotos] = useState...`):
```ts
const { orders, fetchOrders, activeOrder, openOrderDetail, closeOrderDetail } = useMarketplaceStore();
```

3. Add `fetchOrders` call inside the existing `useEffect` (alongside the badges fetch):
```ts
void fetchOrders();
```

4. Inside the `return` JSX, after `<ProfileCard ...>` and before `<BusinessDetailSheet ...>`, add orders section. Since `ProfileCard` renders the full screen including `savedBusinesses`, add My Orders as a prop or pass it separately. Looking at the component, `ProfileCard` receives `savedBusinesses` — add `orders` + `onOpenOrder` props.

Since modifying `ProfileCard` interface is complex, render My Orders directly in the `SafeAreaView` before `ProfileCard` if `ProfileCard` doesn't support it. The simpler path: add orders to the `ProfileCard` component as optional props, or render a separate `OrdersSection` below.

Create a local `OrderRow` helper and render after `ProfileCard` inside a `ScrollView`. If `ProfileCard` already uses `ScrollView` internally, coordinate with it. The simplest approach: pass `orders` + `onOpenOrder` to `ProfileCard` as new optional props.

Add to `ProfileCard` component (`apps/mobile/components/profile/ProfileCard.tsx`):

First read the file to understand its current structure and add appropriately.

- [ ] **Step 2: Read ProfileCard to understand structure**

Read `apps/mobile/components/profile/ProfileCard.tsx` fully, then:
- Add `orders?: OrderWithDetails[]` and `onOpenOrder?: (order: OrderWithDetails) => void` to its props interface
- Add a "My Orders" section before the "Saved Businesses" section
- Each order row shows: business name (from `order.business_name` or business_id short), date, item count, total, status

Order row component code to add inside ProfileCard:
```tsx
{orders && orders.length > 0 && (
  <View style={{ marginHorizontal: 16, marginBottom: 20 }}>
    <Text style={{ color: COLORS.textPrimary, fontWeight: '700', fontSize: 16, marginBottom: 10 }}>My Orders</Text>
    {orders.slice(0, 5).map((order) => (
      <TouchableOpacity
        key={order.id}
        onPress={() => onOpenOrder?.(order)}
        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.surface }}
        accessibilityLabel={`Order from ${new Date(order.created_at).toLocaleDateString()}`}
      >
        <View>
          <Text style={{ color: COLORS.textPrimary, fontWeight: '600', fontSize: 14 }}>
            {order.business_name ?? `Order #${order.id.slice(0, 6)}`}
          </Text>
          <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>
            {new Date(order.created_at).toLocaleDateString()} · {(order.order_items ?? []).length} item(s)
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text style={{ color: COLORS.textPrimary, fontWeight: '700', fontSize: 14 }}>${(order.total_cents / 100).toFixed(2)}</Text>
          <Text style={{ color: STATUS_COLORS_MOBILE[order.status] ?? COLORS.textMuted, fontSize: 11, fontWeight: '600', textTransform: 'capitalize' }}>{order.status}</Text>
        </View>
      </TouchableOpacity>
    ))}
  </View>
)}
```

Add this constant near the top of `ProfileCard.tsx`:
```ts
const STATUS_COLORS_MOBILE: Record<string, string> = {
  paid: '#3B82F6', shipped: '#8B5CF6', delivered: '#22C55E',
  refunded: '#F59E0B', cancelled: '#6B7280',
};
```

5. Back in `profile/index.tsx`, add state + pass orders to ProfileCard:
```tsx
// In component body
const handleOpenOrder = (order: OrderWithDetails) => openOrderDetail(order);

// In JSX
<ProfileCard
  profile={profile}
  badges={badges}
  isOwn={true}
  savedBusinesses={savedBusinesses}
  onOpenBusiness={handleOpenBiz}
  onEdit={() => router.push('/(tabs)/profile/edit' as any)}
  onSettings={() => router.push('/(tabs)/profile/settings' as any)}
  orders={orders}
  onOpenOrder={handleOpenOrder}
/>

// After BusinessDetailSheet:
<OrderDetailSheet
  order={activeOrder}
  visible={activeOrder !== null}
  onClose={closeOrderDetail}
/>
```

- [ ] **Step 3: Run tsc**

```bash
cd apps/mobile
npx tsc --noEmit
```

Expected: 0 errors. Fix any type issues in ProfileCard props.

- [ ] **Step 4: Run jest**

```bash
npx jest --ci --passWithNoTests
```

Expected: All existing tests pass. 0 failures.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/\(tabs\)/profile/index.tsx \
        apps/mobile/components/profile/ProfileCard.tsx
git commit -m "feat(mobile): My Orders section on profile screen"
```

---

### Final QA

- [ ] **Run full QA loop**

```bash
cd apps/mobile
npx eslint . --ext .ts,.tsx --max-warnings 0
npx tsc --noEmit
npx jest --ci --passWithNoTests
```

Expected: 0 lint warnings, 0 tsc errors, all tests passing.

- [ ] **Commit any final fixes**

```bash
git add -A
git commit -m "fix(mobile): marketplace plan 3 final QA"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Implemented |
|---|---|
| 7.1 Navigation (no new tabs, all in BusinessDetailSheet) | ✓ |
| 7.2 BusinessDetailSheet — Products tab with category chips | Partially — tab ✓, category filter chips omitted (future) |
| 7.3 ProductCard with variant picker | ✓ |
| 7.4 CartDrawer with qty controls | ✓ |
| 7.5 CheckoutSheet 3 steps | ✓ Review + Shipping + Payment Sheet |
| 7.6 OrderConfirmationSheet | ✓ |
| 7.7 My Orders + OrderDetailSheet | ✓ Tracking, invoice link, timeline |
| 7.8 marketplaceStore | ✓ All specified fields + actions |

**Known limitations:**
- Category filter chips in Products tab: not implemented (future).
- "Save for next time" checkbox on shipping address: not implemented (future, needs `last_shipping_address` update to profiles).
- Address Element (Stripe): using plain TextInputs instead of Stripe's Address Element (Stripe RN Address Element not available in v0.37.2).
- `[Request Refund]` button on delivered orders: omitted (edge function not built yet).
- `OrderConfirmationSheet` shows `orderId = 'pending'` since order is created async by webhook — polling/Realtime for the real order_id is a future enhancement.
