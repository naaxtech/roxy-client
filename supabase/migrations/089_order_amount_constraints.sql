-- ============================================================
-- 089_order_amount_constraints.sql
--
-- Defence in depth for a hole that was closed in the application layer today.
--
-- ── WHAT HAPPENED ───────────────────────────────────────────────────────────
-- `create-product-order` accepted `shipping_cost_cents` off the request body,
-- type-checked it (`typeof === 'number'`) and never range-checked it. The
-- subtotal is server-derived from cart rows and the platform fee is computed
-- from the subtotal alone, so both stayed correct -- but
--
--     totalCents = subtotalCents + shippingCostCents
--
-- went straight into `paymentIntents.create({ amount: totalCents,
-- application_fee_amount: platformFeeCents })`. At subtotal 10000 and shipping
-- -8000 that is amount 2000, fee 1000, and Stripe accepts it because
-- `application_fee_amount <= amount` holds. She pays 20.00 for a 100.00 item
-- and the seller ships it, netting 10.00 after the fee.
--
-- Worse, `stripe-product-webhook` read the value back out of PaymentIntent
-- metadata and inserted it verbatim, so the row landed internally consistent --
-- subtotal 10000, shipping -8000, generated total 2000 -- and nothing alerted.
--
-- The field is now gone from the request shape entirely rather than clamped: an
-- unused field a client can still set is one somebody re-wires later.
--
-- ── WHY A CONSTRAINT AS WELL ────────────────────────────────────────────────
-- The application fix is the real one; this is the backstop that survives the
-- next author. 032:19 already carried a comment asserting these columns are
-- "populated from Stripe webhook, never client-computed" -- which was false by
-- construction, since they never came from Stripe at all. They were values WE
-- wrote into metadata, and Stripe stores metadata verbatim and attests to
-- nothing about it. A comment cannot enforce a range; a CHECK can.
--
-- ── SAFE TO VALIDATE OUTRIGHT ───────────────────────────────────────────────
-- Checked against production before writing this: `orders` holds ZERO rows, and
-- zero rows violate either predicate. The hole was never exploited, because
-- checkout has never successfully completed an order in this product's history
-- (the client posted a request shape the function never accepted -- see the
-- 2026-08-05 marketplace work). So no NOT VALID / reconcile / VALIDATE dance is
-- needed. If this migration is ever replayed against a database that DOES hold
-- offending rows, they are exploited or corrupt financial records: add the
-- constraints NOT VALID, reconcile the rows deliberately (refund, void or
-- annotate -- never UPDATE them into compliance), then VALIDATE CONSTRAINT.
--
-- ── WHY THE TOTAL CHECK NAMES THE BASE COLUMNS ──────────────────────────────
-- `total_cents` is `GENERATED ALWAYS AS (subtotal_cents + shipping_cost_cents +
-- tax_cents) STORED` (032:24). Writing `CHECK (total_cents > 0)` would be
-- semantically identical, but Postgres 17's documentation does not state whether
-- a CHECK may reference a generated column -- the generated-column restrictions
-- cover the *generation* expression, and the CHECK docs say only "columns of the
-- current row" without addressing generated ones. Naming the three base columns
-- needs no ruling and means the same thing.
--
-- `tax_cents` gets its own floor while we are here. It is webhook-populated from
-- Stripe's own charge object so it is not client-reachable today, but the same
-- was believed of shipping_cost_cents.
-- ============================================================

ALTER TABLE public.orders
  ADD CONSTRAINT orders_shipping_cost_cents_nonneg
    CHECK (shipping_cost_cents >= 0),
  ADD CONSTRAINT orders_tax_cents_nonneg
    CHECK (tax_cents >= 0),
  ADD CONSTRAINT orders_total_cents_positive
    CHECK (subtotal_cents + shipping_cost_cents + tax_cents > 0);

COMMENT ON CONSTRAINT orders_shipping_cost_cents_nonneg ON public.orders IS
  'A negative shipping cost reduced the amount charged: total = subtotal + shipping went straight to Stripe, and application_fee_amount <= amount still held, so a buyer could name her own price. Closed in create-product-order by removing the field from the request shape (2026-08-07); this is the backstop.';

COMMENT ON CONSTRAINT orders_total_cents_positive ON public.orders IS
  'Names the three base columns rather than the generated total_cents, because PG17 does not document whether a CHECK may reference a generated column. Same predicate, no ruling needed.';
