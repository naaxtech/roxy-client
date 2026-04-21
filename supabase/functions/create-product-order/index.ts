// supabase/functions/create-product-order/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import Stripe from 'npm:stripe@14';

const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const auth = verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);
  const { userId } = auth;

  let body: {
    cart_id: string;
    shipping_address: {
      name: string;
      line1: string;
      line2?: string;
      city: string;
      state: string;
      postal_code: string;
      country: string;
    };
    idempotency_key: string;
    shipping_cost_cents?: number;
  };

  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { cart_id, shipping_address, idempotency_key, shipping_cost_cents = 0 } = body;

  if (!cart_id || !shipping_address || !idempotency_key) {
    return errorResponse('Missing required fields: cart_id, shipping_address, idempotency_key', 400);
  }

  if (DEV_MOCK) {
    return successResponse({ client_secret: 'pi_mock_secret_test', order_id: 'mock-order-id' });
  }

  const supabase = getSupabaseClient();
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) return errorResponse('STRIPE_SECRET_KEY not set', 500);
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient() });

  // 1. Load cart + items + products + variants
  const { data: cart, error: cartErr } = await supabase
    .from('carts')
    .select(`
      id, buyer_id, business_id, expires_at,
      cart_items (
        id, quantity,
        product:products ( id, name, status, is_active, has_variants, base_price_cents, business_id ),
        variant:product_variants ( id, price_cents, stock, is_active, option1_name, option1_value, option2_name, option2_value )
      ),
      business:businesses ( id, stripe_account_id, can_sell, payout_schedule_set, currency )
    `)
    .eq('id', cart_id)
    .eq('buyer_id', userId)
    .maybeSingle();

  if (cartErr || !cart) return errorResponse('Cart not found', 404);
  if (new Date(cart.expires_at) < new Date()) return errorResponse('Cart has expired', 400);
  if (!cart.cart_items || cart.cart_items.length === 0) return errorResponse('Cart is empty', 400);

  const business = cart.business as any;
  if (!business.can_sell) return errorResponse('Business is not approved to sell', 403);
  if (!business.stripe_account_id) return errorResponse('Business has no Stripe account', 403);
  if (!business.payout_schedule_set) return errorResponse('Business payout schedule not configured', 403);

  // 2. Validate all products
  for (const item of cart.cart_items as any[]) {
    const product = item.product;
    if (!product) return errorResponse(`Product not found for cart item ${item.id}`, 400);
    if (product.status !== 'approved') return errorResponse(`Product "${product.name}" is not approved`, 400);
    if (!product.is_active) return errorResponse(`Product "${product.name}" is not active`, 400);
    if (product.has_variants && !item.variant) return errorResponse(`Variant required for "${product.name}"`, 400);
    if (item.variant && !item.variant.is_active) return errorResponse(`Selected variant is not available`, 400);
  }

  // 3. Atomic stock decrement (FOR UPDATE)
  const stockUpdates: Array<{ variantId: string; qty: number }> = [];
  for (const item of cart.cart_items as any[]) {
    if (!item.variant) continue;
    const { data: updated, error: stockErr } = await supabase.rpc('decrement_variant_stock', {
      p_variant_id: item.variant.id,
      p_qty: item.quantity,
    });
    if (stockErr || !updated) {
      // Rollback already decremented stock
      for (const prev of stockUpdates) {
        await supabase.rpc('increment_variant_stock', { p_variant_id: prev.variantId, p_qty: prev.qty });
      }
      return errorResponse(`"${item.product.name}" is out of stock`, 409);
    }
    stockUpdates.push({ variantId: item.variant.id, qty: item.quantity });
  }

  // 4. Ensure Stripe Customer for buyer
  let stripeCustomerId = (
    await supabase.from('profiles').select('stripe_customer_id').eq('id', userId).single()
  ).data?.stripe_customer_id;

  if (!stripeCustomerId) {
    // Get buyer email from auth.users
    const { data: { user } } = await supabase.auth.admin.getUserById(userId);
    const customer = await stripe.customers.create({
      email: user?.email,
      metadata: { roxy_user_id: userId },
    });
    stripeCustomerId = customer.id;
    await supabase.from('profiles').update({ stripe_customer_id: stripeCustomerId }).eq('id', userId);
  }

  // 5. Calculate totals
  const items = cart.cart_items as any[];
  const subtotalCents = items.reduce((sum: number, item: any) => {
    const price = item.variant ? item.variant.price_cents : item.product.base_price_cents;
    return sum + price * item.quantity;
  }, 0);

  const { data: settings } = await supabase.from('marketplace_settings').select('product_fee_percent').single();
  const feePercent = Number(settings?.product_fee_percent ?? 10);
  const platformFeeCents = Math.floor(subtotalCents * (feePercent / 100));
  const totalCents = subtotalCents + shipping_cost_cents;

  // 6. Build items metadata for webhook (price snapshots)
  const itemsMeta = items.map((item: any) => ({
    product_id: item.product.id,
    variant_id: item.variant?.id ?? null,
    product_name: item.product.name,
    variant_label: item.variant
      ? [item.variant.option1_value, item.variant.option2_value].filter(Boolean).join(' / ')
      : null,
    unit_price_cents: item.variant ? item.variant.price_cents : item.product.base_price_cents,
    quantity: item.quantity,
  }));

  // 7. Create PaymentIntent
  let paymentIntent: Stripe.PaymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: totalCents,
        currency: business.currency ?? 'usd',
        customer: stripeCustomerId,
        application_fee_amount: platformFeeCents,
        transfer_data: { destination: business.stripe_account_id },
        on_behalf_of: business.stripe_account_id,
        automatic_payment_methods: { enabled: true },
        metadata: {
          buyer_id: userId,
          business_id: business.id,
          cart_id: cart_id,
          idempotency_key,
          items_json: JSON.stringify(itemsMeta),
          subtotal_cents: String(subtotalCents),
          shipping_cost_cents: String(shipping_cost_cents),
          platform_fee_cents: String(platformFeeCents),
          shipping_name: shipping_address.name,
          shipping_line1: shipping_address.line1,
          shipping_line2: shipping_address.line2 ?? '',
          shipping_city: shipping_address.city,
          shipping_state: shipping_address.state,
          shipping_postal_code: shipping_address.postal_code,
          shipping_country: shipping_address.country,
        },
      },
      { idempotencyKey: idempotency_key }
    );
  } catch (err) {
    // Rollback all stock decrements on Stripe failure
    for (const s of stockUpdates) {
      await supabase.rpc('increment_variant_stock', { p_variant_id: s.variantId, p_qty: s.qty });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(`Stripe error: ${msg}`, 500);
  }

  return successResponse({ client_secret: paymentIntent.client_secret });
});
