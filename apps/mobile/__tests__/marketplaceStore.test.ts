import { useMarketplaceStore } from '../store/marketplaceStore';
import type { ProductWithVariants, ShippingAddress } from '../types/marketplace';

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    auth: { getSession: jest.fn() },
  },
  callEdgeFunction: jest.fn(),
}));

jest.mock('../lib/errorLogger', () => ({ logError: jest.fn() }));

const { supabase, callEdgeFunction } = jest.requireMock('../lib/supabase');

type QueryResult = { data: unknown; error: unknown };

/**
 * Chainable PostgREST stub. Awaitable at any point, like the real builder.
 * `maybeSingle` / `single` can answer differently from the list result so a cart
 * lookup and a cart insert on the same table can be told apart.
 */
function queryStub(
  opts: { result: QueryResult; maybeSingle?: QueryResult; single?: QueryResult },
  record?: (op: string, payload?: unknown) => void
) {
  const chain: Record<string, unknown> = {
    select: jest.fn(() => chain),
    insert: jest.fn((rows: unknown) => { record?.('insert', rows); return chain; }),
    delete: jest.fn(() => { record?.('delete'); return chain; }),
    eq: jest.fn((col: string, val: unknown) => { record?.(`eq:${col}`, val); return chain; }),
    order: jest.fn(() => chain),
    limit: jest.fn(() => Promise.resolve(opts.result)),
    maybeSingle: jest.fn(() => Promise.resolve(opts.maybeSingle ?? opts.result)),
    single: jest.fn(() => Promise.resolve(opts.single ?? opts.result)),
    then: (resolve: (v: QueryResult) => unknown) => Promise.resolve(opts.result).then(resolve),
  };
  return chain;
}

const HOUR = 60 * 60 * 1000;
const futureCart = (id: string): QueryResult => ({
  data: { id, expires_at: new Date(Date.now() + 24 * HOUR).toISOString() },
  error: null,
});

const signedIn = (userId = 'buyer-1') =>
  supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: userId } } } });

const signedOut = () => supabase.auth.getSession.mockResolvedValue({ data: { session: null } });

const product: ProductWithVariants = {
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

describe('marketplaceStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useMarketplaceStore.setState({
      cartItems: {},
      cartIds: {},
      productsByBusiness: {},
      loadingProducts: {},
      currencyByBusiness: {},
      orders: [],
      loadingOrders: false,
      ordersError: null,
      checkoutLoading: false,
    });
  });

  it('addToCart adds item to empty cart', async () => {
    await useMarketplaceStore.getState().addToCart('b1', product, null, 1);
    const items = useMarketplaceStore.getState().cartItems['b1'];
    expect(items).toHaveLength(1);
    expect(items[0].product_id).toBe('prod-1');
    expect(items[0].quantity).toBe(1);
  });

  it('addToCart merges duplicate product+variant', async () => {
    await useMarketplaceStore.getState().addToCart('b1', product, null, 1);
    await useMarketplaceStore.getState().addToCart('b1', product, null, 2);
    const items = useMarketplaceStore.getState().cartItems['b1'];
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(3);
  });

  it('removeFromCart removes item', async () => {
    await useMarketplaceStore.getState().addToCart('b1', product, null, 1);
    const itemId = useMarketplaceStore.getState().cartItems['b1'][0].id;
    useMarketplaceStore.getState().removeFromCart('b1', itemId);
    expect(useMarketplaceStore.getState().cartItems['b1']).toHaveLength(0);
  });

  it('getCartTotal returns correct sum', async () => {
    await useMarketplaceStore.getState().addToCart('b1', product, null, 3);
    expect(useMarketplaceStore.getState().getCartTotal('b1')).toBe(2997);
  });

  it('clearCart empties the cart', async () => {
    await useMarketplaceStore.getState().addToCart('b1', product, null, 2);
    useMarketplaceStore.getState().clearCart('b1');
    expect(useMarketplaceStore.getState().cartItems['b1']).toHaveLength(0);
  });

  /**
   * `businesses.currency` (migration 031, NOT NULL DEFAULT 'usd') is the currency
   * create-product-order hands Stripe when it opens the PaymentIntent. Anything the
   * client shows that disagrees with it quotes the buyer a price nobody will charge.
   */
  describe('seller currency', () => {
    it('reads the seller currency from the businesses row instead of assuming USD', async () => {
      supabase.from.mockImplementation((table: string) => {
        if (table !== 'businesses') throw new Error(`unexpected table ${table}`);
        return queryStub({ result: { data: { currency: 'php' }, error: null } });
      });

      await useMarketplaceStore.getState().fetchBusinessCurrency('biz-ph');

      expect(useMarketplaceStore.getState().businessCurrency('biz-ph')).toBe('php');
    });

    it('falls back to the schema default while the row is still loading', () => {
      expect(useMarketplaceStore.getState().businessCurrency('not-loaded-yet')).toBe('usd');
    });

    it('keeps the currency it already knows when a refetch fails', async () => {
      useMarketplaceStore.setState({ currencyByBusiness: { 'biz-ph': 'php' } });
      supabase.from.mockImplementation(() =>
        queryStub({ result: { data: null, error: { message: 'network down' } } })
      );

      await useMarketplaceStore.getState().fetchBusinessCurrency('biz-ph');

      expect(useMarketplaceStore.getState().businessCurrency('biz-ph')).toBe('php');
    });
  });

  describe('checkout', () => {
    // create-product-order takes { cart_id, shipping_address, idempotency_key } and
    // re-derives prices from the cart server-side. Sending { business_id, items }
    // was rejected with a 400 on every attempt — no payment could ever start.
    it('creates a cart, writes its items, and calls the edge function with cart_id', async () => {
      signedIn();
      const cartOps: [string, unknown][] = [];
      const itemOps: [string, unknown][] = [];
      supabase.from.mockImplementation((table: string) => {
        if (table === 'carts') {
          return queryStub(
            { result: { data: null, error: null }, single: { data: { id: 'cart-9' }, error: null } },
            (op, p) => cartOps.push([op, p])
          );
        }
        if (table === 'cart_items') {
          return queryStub({ result: { data: null, error: null } }, (op, p) => itemOps.push([op, p]));
        }
        throw new Error(`unexpected table ${table}`);
      });
      callEdgeFunction.mockResolvedValue({
        data: { client_secret: 'pi_1_secret_abc', payment_intent_id: 'pi_1' },
        error: null,
      });

      const result = await useMarketplaceStore
        .getState()
        .buyNow('biz-1', product, null, 2, shipping, 'idem-key-1');

      // The intent id comes back so an abandoned checkout can hand its stock hold back.
      expect(result).toEqual({ ok: true, clientSecret: 'pi_1_secret_abc', paymentIntentId: 'pi_1' });
      expect(callEdgeFunction).toHaveBeenCalledWith('create-product-order', {
        cart_id: 'cart-9',
        shipping_address: {
          name: 'Test User', line1: '123 Main St', line2: undefined,
          city: 'LA', state: 'CA', postal_code: '90001', country: 'US',
        },
        idempotency_key: 'idem-key-1',
      });
      // The basket reaches the server as cart_items rows, not as a client-priced list.
      expect(itemOps).toContainEqual([
        'insert',
        [{ cart_id: 'cart-9', product_id: 'prod-1', variant_id: null, quantity: 2 }],
      ]);
      expect(cartOps.some(([op]) => op === 'insert')).toBe(true);
    });

    it('reuses the buyer existing cart for that business', async () => {
      signedIn();
      const cartOps: [string, unknown][] = [];
      supabase.from.mockImplementation((table: string) =>
        table === 'carts'
          ? queryStub({ result: { data: null, error: null }, maybeSingle: futureCart('cart-live') }, (op, p) => cartOps.push([op, p]))
          : queryStub({ result: { data: null, error: null } })
      );
      callEdgeFunction.mockResolvedValue({ data: { client_secret: 'cs' }, error: null });

      await useMarketplaceStore.getState().buyNow('biz-1', product, null, 1, shipping, 'idem-reuse');

      // UNIQUE (buyer_id, business_id) — a second insert would fail, not create a cart.
      expect(cartOps.some(([op]) => op === 'insert')).toBe(false);
      expect(callEdgeFunction.mock.calls[0][1].cart_id).toBe('cart-live');
    });

    it('replaces an expired cart rather than sending one the server will reject', async () => {
      signedIn();
      const cartOps: [string, unknown][] = [];
      supabase.from.mockImplementation((table: string) =>
        table === 'carts'
          ? queryStub(
              {
                result: { data: null, error: null },
                maybeSingle: { data: { id: 'cart-stale', expires_at: new Date(Date.now() - HOUR).toISOString() }, error: null },
                single: { data: { id: 'cart-fresh' }, error: null },
              },
              (op, p) => cartOps.push([op, p])
            )
          : queryStub({ result: { data: null, error: null } })
      );
      callEdgeFunction.mockResolvedValue({ data: { client_secret: 'cs' }, error: null });

      await useMarketplaceStore.getState().buyNow('biz-1', product, null, 1, shipping, 'idem-exp');

      expect(cartOps.some(([op]) => op === 'delete')).toBe(true);
      expect(callEdgeFunction.mock.calls[0][1].cart_id).toBe('cart-fresh');
    });

    it('checks out the whole cart when no buy-now item is given', async () => {
      signedIn();
      const itemOps: [string, unknown][] = [];
      supabase.from.mockImplementation((table: string) =>
        table === 'carts'
          ? queryStub({ result: { data: null, error: null }, maybeSingle: futureCart('cart-3') })
          : queryStub({ result: { data: null, error: null } }, (op, p) => itemOps.push([op, p]))
      );
      callEdgeFunction.mockResolvedValue({ data: { client_secret: 'cs' }, error: null });

      await useMarketplaceStore.getState().addToCart('biz-1', product, null, 4);
      const result = await useMarketplaceStore.getState().createOrder('biz-1', shipping, 'idem-2');

      expect(result.ok).toBe(true);
      expect(itemOps).toContainEqual([
        'insert',
        [{ cart_id: 'cart-3', product_id: 'prod-1', variant_id: null, quantity: 4 }],
      ]);
    });

    // The client can ship before create-product-order is redeployed. A missing intent id
    // must mean "nothing to release", never a release call with `undefined` in it.
    it('reports no releasable intent when the server does not return one', async () => {
      signedIn();
      supabase.from.mockImplementation(() =>
        queryStub({ result: { data: null, error: null }, maybeSingle: futureCart('cart-1') })
      );
      callEdgeFunction.mockResolvedValue({ data: { client_secret: 'cs' }, error: null });

      const result = await useMarketplaceStore
        .getState()
        .buyNow('biz-1', product, null, 1, shipping, 'idem-old-server');

      expect(result).toEqual({ ok: true, clientSecret: 'cs', paymentIntentId: null });
    });

    it('asks the server to release the hold on an abandoned checkout', async () => {
      callEdgeFunction.mockResolvedValue({ data: { released: true }, error: null });

      await useMarketplaceStore.getState().releaseCheckout('pi_abandoned');

      expect(callEdgeFunction).toHaveBeenCalledWith('create-product-order', {
        release_payment_intent_id: 'pi_abandoned',
      });
    });

    it('passes a 4xx server message to the buyer', async () => {
      signedIn();
      supabase.from.mockImplementation(() => queryStub({ result: { data: null, error: null }, maybeSingle: futureCart('cart-1') }));
      callEdgeFunction.mockResolvedValue({ data: null, error: '"Candle" is out of stock', status: 409 });

      const result = await useMarketplaceStore
        .getState()
        .buyNow('biz-1', product, null, 1, shipping, 'idem-3');

      expect(result).toEqual({ ok: false, message: '"Candle" is out of stock' });
    });

    it('hides 5xx server detail behind a generic message', async () => {
      signedIn();
      supabase.from.mockImplementation(() => queryStub({ result: { data: null, error: null }, maybeSingle: futureCart('cart-1') }));
      callEdgeFunction.mockResolvedValue({ data: null, error: 'STRIPE_SECRET_KEY not set', status: 500 });

      const result = await useMarketplaceStore
        .getState()
        .buyNow('biz-1', product, null, 1, shipping, 'idem-4');

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).not.toContain('STRIPE_SECRET_KEY');
    });

    it('refuses to start a payment with an empty basket', async () => {
      signedIn();
      const result = await useMarketplaceStore.getState().createOrder('biz-1', shipping, 'idem-5');
      expect(result).toEqual({ ok: false, message: 'Your basket is empty.' });
      expect(callEdgeFunction).not.toHaveBeenCalled();
    });

    it('refuses to start a payment when signed out', async () => {
      signedOut();
      const result = await useMarketplaceStore
        .getState()
        .buyNow('biz-1', product, null, 1, shipping, 'idem-6');
      expect(result.ok).toBe(false);
      expect(callEdgeFunction).not.toHaveBeenCalled();
    });
  });

  describe('fetchOrders', () => {
    // get-orders-buyer answers { success, data: { orders } }; reading `.orders`
    // straight off that envelope was always undefined, so the list stayed empty.
    // The buyer's own rows are read directly under RLS instead.
    it('loads the buyer orders with their real column names', async () => {
      signedIn('buyer-7');
      const eqCalls: [string, unknown][] = [];
      supabase.from.mockImplementation(() =>
        queryStub(
          {
            result: {
              data: [{
                id: 'order-1', status: 'paid', currency: 'usd', total_cents: 2500,
                order_items: [{ id: 'oi-1', product_name: 'Candle', quantity: 1, line_total_cents: 2500 }],
                order_events: [{ id: 'oe-1', event: 'payment_confirmed', note: null }],
              }],
              error: null,
            },
          },
          (op, p) => { if (op.startsWith('eq:')) eqCalls.push([op, p]); }
        )
      );

      await useMarketplaceStore.getState().fetchOrders();

      const { orders, ordersError, loadingOrders } = useMarketplaceStore.getState();
      expect(orders).toHaveLength(1);
      expect(orders[0].order_items[0].line_total_cents).toBe(2500);
      expect(orders[0].order_events[0].event).toBe('payment_confirmed');
      expect(ordersError).toBeNull();
      expect(loadingOrders).toBe(false);
      // Sellers can read orders placed with their business — this filter keeps
      // "My Orders" to what the user bought.
      expect(eqCalls).toContainEqual(['eq:buyer_id', 'buyer-7']);
    });

    it('surfaces an error state instead of a silent empty list', async () => {
      signedIn();
      supabase.from.mockImplementation(() =>
        queryStub({ result: { data: null, error: { message: 'permission denied' } } })
      );

      await useMarketplaceStore.getState().fetchOrders();

      const { orders, ordersError } = useMarketplaceStore.getState();
      expect(orders).toEqual([]);
      expect(ordersError).toBeTruthy();
      expect(ordersError).not.toContain('permission denied');
    });
  });

  describe('awaitNewOrderId', () => {
    it('returns the order the webhook wrote once it appears', async () => {
      signedIn();
      supabase.from.mockImplementation(() => queryStub({ result: { data: [{ id: 'order-new' }], error: null } }));

      const id = await useMarketplaceStore.getState().awaitNewOrderId('biz-1', 'order-old');
      expect(id).toBe('order-new');
    });

    it('gives up with null (never a failure) when the order has not landed', async () => {
      jest.useFakeTimers();
      signedIn();
      supabase.from.mockImplementation(() => queryStub({ result: { data: [{ id: 'order-old' }], error: null } }));

      const pending = useMarketplaceStore.getState().awaitNewOrderId('biz-1', 'order-old');
      await jest.advanceTimersByTimeAsync(11_000);
      await expect(pending).resolves.toBeNull();
      jest.useRealTimers();
    });
  });
});
