import { create } from 'zustand';
import { supabase, callEdgeFunction } from '../lib/supabase';
import { logError } from '../lib/errorLogger';
import { DEFAULT_CURRENCY } from '../lib/currency';
import type {
  ProductWithVariants, CartItem, OrderWithItems, ShippingAddress, CheckoutLine,
} from '../types/marketplace';

/**
 * Explicit column list — every name here exists in the live schema (migration
 * 032_marketplace_orders.sql). Keeping it explicit means a renamed column fails
 * loudly at the query with a PostgREST 400 instead of silently rendering
 * `undefined` in the orders UI.
 */
const ORDER_SELECT = `
  id, buyer_id, business_id, status,
  shipping_name, shipping_line1, shipping_line2, shipping_city,
  shipping_state, shipping_postal_code, shipping_country,
  currency, subtotal_cents, shipping_cost_cents, tax_cents, total_cents,
  tracking_number, shipped_at, delivered_at, cancelled_at, cancellation_reason,
  created_at,
  order_items (
    id, order_id, product_id, variant_id, product_name, variant_label,
    unit_price_cents, quantity, line_total_cents, created_at
  ),
  order_events ( id, order_id, event, note, metadata, actor_type, created_at )
`;

/** Result of asking the server to open a payment. Never throws at the call site. */
export type CheckoutStart =
  | {
      ok: true;
      clientSecret: string;
      /**
       * The intent now holding this basket's stock, so an abandoned checkout can hand it
       * straight back. Null when the deployed create-product-order predates returning it —
       * the server's own hold sweep is then the only reaper, never a wrong release.
       */
      paymentIntentId: string | null;
    }
  | { ok: false; message: string };

const GENERIC_CHECKOUT_ERROR = "We couldn't start this payment. Please try again.";

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

  /**
   * businessId -> ISO code from `businesses.currency` (migration 031).
   *
   * Sellers price in their own currency and create-product-order opens the PaymentIntent
   * in it, so this is the only currency any marketplace surface may quote. Hardcoding USD
   * shows a Philippine seller's ₱1,200 candle as $1,200 — off by a factor of 55 and
   * charged in a currency the buyer never agreed to.
   */
  currencyByBusiness: Record<string, string>;
  fetchBusinessCurrency: (businessId: string) => Promise<void>;
  businessCurrency: (businessId: string) => string;

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
  ordersError: string | null;
  fetchOrders: () => Promise<void>;
  /** Newest order id this buyer has with a business, or null if they have none yet. */
  latestOrderId: (businessId: string) => Promise<string | null>;
  /** Waits for the order the Stripe webhook writes after payment. null = not visible yet. */
  awaitNewOrderId: (businessId: string, previousId: string | null) => Promise<string | null>;

  // Checkout
  checkoutLoading: boolean;
  /**
   * Tells the server the buyer walked away, so the stock the intent is holding goes back
   * on the shelf now rather than when the server's hold window expires. Best-effort
   * cleanup — it never surfaces to a buyer who has already left the screen.
   */
  releaseCheckout: (paymentIntentId: string) => Promise<void>;
  createOrder: (businessId: string, shipping: ShippingAddress, idempotencyKey: string) => Promise<CheckoutStart>;
  buyNow: (
    businessId: string,
    product: ProductWithVariants,
    variantId: string | null,
    quantity: number,
    shipping: ShippingAddress,
    idempotencyKey: string
  ) => Promise<CheckoutStart>;
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Mirrors the basket into the `carts` / `cart_items` rows the deployed
 * create-product-order function reads. That function takes a `cart_id` and
 * re-derives prices, stock and product approval from the cart server-side — the
 * client never gets to name a price — so the cart row is the contract, not an
 * implementation detail we can skip.
 *
 * One cart per buyer+business is enforced by UNIQUE (buyer_id, business_id), so a
 * Buy Now replaces the server-side rows for that business. The local Zustand cart
 * is untouched, and the Stripe webhook deletes the cart_items once payment lands.
 *
 * Both tables are RLS-scoped to `buyer_id = auth.uid()` (migration 033), so this
 * runs as the signed-in buyer with no elevated key.
 */
async function syncServerCart(userId: string, businessId: string, lines: CheckoutLine[]): Promise<string> {
  const { data: existing, error: findErr } = await supabase
    .from('carts')
    .select('id, expires_at')
    .eq('buyer_id', userId)
    .eq('business_id', businessId)
    .maybeSingle();
  if (findErr) throw new Error(`cart lookup failed: ${findErr.message}`);

  let cartId = existing?.id as string | undefined;

  // An expired cart is rejected by the edge function. Drop it (cart_items cascade)
  // and let the DB default set a fresh TTL rather than hardcoding the window here.
  if (existing && new Date(existing.expires_at as string).getTime() <= Date.now()) {
    const { error: delErr } = await supabase.from('carts').delete().eq('id', existing.id);
    if (delErr) throw new Error(`expired cart cleanup failed: ${delErr.message}`);
    cartId = undefined;
  }

  if (!cartId) {
    const { data: created, error: insertErr } = await supabase
      .from('carts')
      .insert({ buyer_id: userId, business_id: businessId })
      .select('id')
      .single();
    if (insertErr || !created) throw new Error(`cart create failed: ${insertErr?.message ?? 'no row returned'}`);
    cartId = created.id as string;
  }

  const { error: clearErr } = await supabase.from('cart_items').delete().eq('cart_id', cartId);
  if (clearErr) throw new Error(`cart clear failed: ${clearErr.message}`);

  const { error: itemsErr } = await supabase.from('cart_items').insert(
    lines.map((line) => ({
      cart_id: cartId,
      product_id: line.product_id,
      variant_id: line.variant_id,
      quantity: line.quantity,
    }))
  );
  if (itemsErr) throw new Error(`cart items write failed: ${itemsErr.message}`);

  return cartId;
}

async function startCheckout(
  businessId: string,
  lines: CheckoutLine[],
  shipping: ShippingAddress,
  idempotencyKey: string
): Promise<CheckoutStart> {
  if (lines.length === 0) return { ok: false, message: 'Your basket is empty.' };
  if (lines.some((line) => line.quantity <= 0)) return { ok: false, message: 'Every item needs a quantity of at least 1.' };

  const userId = await currentUserId();
  if (!userId) return { ok: false, message: 'Please sign in again to finish this purchase.' };

  let cartId: string;
  try {
    cartId = await syncServerCart(userId, businessId, lines);
  } catch (e) {
    logError(e, 'marketplace_syncServerCart');
    return { ok: false, message: "We couldn't prepare your order. Please try again." };
  }

  const res = await callEdgeFunction<{ client_secret: string; payment_intent_id?: string }>('create-product-order', {
    cart_id: cartId,
    shipping_address: {
      name: shipping.name,
      line1: shipping.line1,
      line2: shipping.line2?.trim() ? shipping.line2.trim() : undefined,
      city: shipping.city,
      state: shipping.state,
      postal_code: shipping.postal_code,
      country: shipping.country,
    },
    idempotency_key: idempotencyKey,
  });

  if (!res.data?.client_secret) {
    // 4xx bodies are written for the buyer ("… is out of stock", "Cart has expired").
    // 5xx bodies can name server config, so those never reach the screen.
    const buyerSafe = res.status !== undefined && res.status < 500 ? res.error : null;
    if (!buyerSafe) logError(new Error(res.error ?? 'create-product-order returned no client_secret'), 'marketplace_startCheckout');
    return { ok: false, message: buyerSafe ?? GENERIC_CHECKOUT_ERROR };
  }

  return {
    ok: true,
    clientSecret: res.data.client_secret,
    paymentIntentId: typeof res.data.payment_intent_id === 'string' ? res.data.payment_intent_id : null,
  };
}

export const useMarketplaceStore = create<MarketplaceStore>((set, get) => ({
  productsByBusiness: {},
  loadingProducts: {},
  currencyByBusiness: {},
  cartItems: {},
  cartIds: {},
  orders: [],
  loadingOrders: false,
  ordersError: null,
  checkoutLoading: false,

  fetchProducts: async (businessId: string) => {
    if (get().loadingProducts[businessId]) return;
    // Warmed alongside the catalogue so prices render in the seller's currency on first
    // paint instead of flipping symbol once the business row lands.
    void get().fetchBusinessCurrency(businessId);
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

  fetchBusinessCurrency: async (businessId) => {
    const { data, error } = await supabase
      .from('businesses')
      .select('currency')
      .eq('id', businessId)
      .maybeSingle();

    if (error) {
      // Whatever is already known stays put. A stale-but-real currency beats dropping
      // back to the placeholder and repricing a seller's whole catalogue mid-session.
      logError(error, 'marketplace_fetchBusinessCurrency');
      return;
    }

    const currency = data?.currency;
    if (typeof currency !== 'string' || currency.length === 0) return;
    set(s => ({ currencyByBusiness: { ...s.currencyByBusiness, [businessId]: currency } }));
  },

  businessCurrency: (businessId) => get().currencyByBusiness[businessId] ?? DEFAULT_CURRENCY,

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

  /**
   * Reads the buyer's own order rows directly. RLS policy `orders_select`
   * (migration 032) also grants a seller read access to orders placed WITH their
   * business, so the explicit buyer_id filter is what keeps "My Orders" to what
   * this user bought rather than what they sold.
   */
  fetchOrders: async () => {
    set({ loadingOrders: true, ordersError: null });
    try {
      const userId = await currentUserId();
      if (!userId) {
        set({ orders: [], ordersError: null });
        return;
      }

      const { data, error } = await supabase
        .from('orders')
        .select(ORDER_SELECT)
        .eq('buyer_id', userId)
        .order('created_at', { ascending: false });

      if (error) {
        logError(error, 'marketplace_fetchOrders');
        set({ ordersError: "We couldn't load your orders. Pull to try again." });
        return;
      }

      set({ orders: (data ?? []) as unknown as OrderWithItems[], ordersError: null });
    } finally {
      set({ loadingOrders: false });
    }
  },

  latestOrderId: async (businessId) => {
    const userId = await currentUserId();
    if (!userId) return null;
    const { data, error } = await supabase
      .from('orders')
      .select('id')
      .eq('buyer_id', userId)
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) {
      logError(error, 'marketplace_latestOrderId');
      return null;
    }
    return (data?.[0]?.id as string | undefined) ?? null;
  },

  /**
   * create-product-order only opens the PaymentIntent; the order row is written by
   * stripe-product-webhook once Stripe confirms payment, a beat after the payment
   * sheet closes. Poll for a NEW newest-order id rather than a timestamp window so
   * device clock skew can never hide the order. null means "not visible yet" — it
   * never means the payment failed.
   */
  awaitNewOrderId: async (businessId, previousId) => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const latest = await get().latestOrderId(businessId);
      if (latest && latest !== previousId) return latest;
      await delay(1000);
    }
    return null;
  },

  releaseCheckout: async (paymentIntentId) => {
    const res = await callEdgeFunction<{ released: boolean }>('create-product-order', {
      release_payment_intent_id: paymentIntentId,
    });
    if (!res.data) {
      // Nothing to tell the buyer — they have already left the sheet. The server's hold
      // sweep is the backstop, so a failure here delays the release rather than losing it.
      logError(new Error(res.error ?? 'create-product-order did not confirm the release'), 'marketplace_releaseCheckout');
    }
  },

  createOrder: async (businessId, shipping, idempotencyKey) => {
    set({ checkoutLoading: true });
    try {
      const lines: CheckoutLine[] = (get().cartItems[businessId] ?? []).map(i => ({
        product_id: i.product_id,
        variant_id: i.variant_id,
        quantity: i.quantity,
      }));
      return await startCheckout(businessId, lines, shipping, idempotencyKey);
    } finally {
      set({ checkoutLoading: false });
    }
  },

  buyNow: async (businessId, product, variantId, quantity, shipping, idempotencyKey) => {
    set({ checkoutLoading: true });
    try {
      const lines: CheckoutLine[] = [{ product_id: product.id, variant_id: variantId, quantity }];
      return await startCheckout(businessId, lines, shipping, idempotencyKey);
    } finally {
      set({ checkoutLoading: false });
    }
  },
}));
