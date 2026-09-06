-- ============================================================
-- Verification for 090_cart_variant_integrity.sql
--
-- Run against the Roxy project AFTER `npx supabase db push`:
--   psql "$ROXY_DB_URL" -f supabase/tests/090_cart_variant_integrity_check.sql
--
-- Part 1 is fixture-free and reads pg_catalog directly, because a migration FILE
--        is not an APPLIED migration. Its centrepiece is `confmatchtype`: a
--        composite FK that exists but was written MATCH FULL breaks every
--        variantless product in the marketplace, and one written with its column
--        pairs transposed is syntactically fine and semantically meaningless.
--        Neither is visible to a test that only asks "does the constraint exist".
-- Part 2 is behavioural and is built around REFUSALS. Every phase proving
--        something still works is paired with one proving the matching thing is
--        rejected -- a suite that only walked the happy path would pass unchanged
--        against the wide-open table this migration exists to close.
--
-- SAFETY. Part 2 runs inside BEGIN ... ROLLBACK and creates only throwaway rows
-- (one business, two products, two variants, one cart). It needs one active,
-- non-ghost profile and finds one itself, skipping Part 2 with a NOTICE if the
-- database has none -- so this is runnable on an empty database forever. Nothing
-- is left behind on either path.
-- ============================================================

\set ON_ERROR_STOP on

-- ── Part 1a: the referenced key exists ──────────────────────────────────────
DO $$
DECLARE
  c record;
BEGIN
  SELECT contype, conkey INTO c
  FROM pg_constraint
  WHERE conrelid = 'public.product_variants'::regclass
    AND conname  = 'product_variants_product_id_id_key';

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'MISSING public.product_variants.product_variants_product_id_id_key -- 090 is not applied. Without it neither composite foreign key below can exist at all';
  END IF;

  IF c.contype <> 'u' THEN
    RAISE EXCEPTION
      'product_variants_product_id_id_key is contype %, expected u (UNIQUE). A foreign key may only reference a unique or primary key',
      c.contype;
  END IF;

  RAISE NOTICE 'PASS: product_variants carries the composite unique key';
END;
$$;

-- ── Part 1b: THE assertion. Both composite FKs, correctly shaped. ───────────
--
-- Three things are checked per constraint and all three are load-bearing:
--   confmatchtype = 's'  MATCH SIMPLE. Under 'f' (MATCH FULL) a row with
--                        product_id NOT NULL and variant_id NULL is a partial
--                        match and is REJECTED -- that is the normal shape of
--                        every variantless product, so MATCH FULL would break
--                        the majority of this marketplace's checkout.
--   convalidated         An unvalidated constraint still guards new writes but
--                        says nothing about what is already stored.
--   column pairing       product_id must reference product_id and variant_id
--                        must reference id. Transposed, the FK is still legal
--                        SQL and enforces nonsense.
DO $$
DECLARE
  item      text;
  tbl       text;
  con       text;
  c         record;
  local_col text;
  ref_col   text;
  i         int;
  pairs     text := '';
BEGIN
  FOREACH item IN ARRAY ARRAY[
    'cart_items:cart_items_variant_matches_product',
    'order_items:order_items_variant_matches_product'
  ] LOOP
    tbl := split_part(item, ':', 1);
    con := split_part(item, ':', 2);

    SELECT contype, confmatchtype, convalidated, conkey, confkey, conrelid, confrelid
      INTO c
    FROM pg_constraint
    WHERE conrelid = ('public.' || tbl)::regclass AND conname = con;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'MISSING public.%.% -- 090 is not applied. A buyer can pair any product_id with any variant_id and be charged the variant''s price',
        tbl, con;
    END IF;

    IF c.contype <> 'f' THEN
      RAISE EXCEPTION '%.% is contype %, expected f (FOREIGN KEY)', tbl, con, c.contype;
    END IF;

    IF c.confmatchtype <> 's' THEN
      RAISE EXCEPTION
        'BREAKS VARIANTLESS CHECKOUT: %.% is confmatchtype %, expected s (MATCH SIMPLE). Under MATCH FULL a NULL variant_id beside a NOT NULL product_id is refused, so every product without variants becomes unbuyable',
        tbl, con, c.confmatchtype;
    END IF;

    IF NOT c.convalidated THEN
      RAISE EXCEPTION
        'NOT VALIDATED: %.% was added NOT VALID and never validated. New rows are guarded but existing rows were never checked -- run VALIDATE CONSTRAINT, and if it fails, reconcile those rows deliberately',
        tbl, con;
    END IF;

    IF array_length(c.conkey, 1) <> 2 OR array_length(c.confkey, 1) <> 2 THEN
      RAISE EXCEPTION '%.% is not a two-column foreign key', tbl, con;
    END IF;

    -- Walk the pairs and rebuild them as text, so a transposition is impossible
    -- to miss and the failure message names what was actually found.
    pairs := '';
    FOR i IN 1..2 LOOP
      SELECT attname INTO local_col
      FROM pg_attribute WHERE attrelid = c.conrelid AND attnum = c.conkey[i];

      SELECT attname INTO ref_col
      FROM pg_attribute WHERE attrelid = c.confrelid AND attnum = c.confkey[i];

      pairs := pairs || local_col || '->' || ref_col || ' ';
    END LOOP;

    IF position('product_id->product_id' in pairs) = 0
       OR position('variant_id->id' in pairs) = 0 THEN
      RAISE EXCEPTION
        'WRONG COLUMN PAIRING on %.%: found "%". Expected product_id->product_id and variant_id->id. Anything else is a legal foreign key that proves nothing about whether the variant belongs to the product',
        tbl, con, pairs;
    END IF;

    RAISE NOTICE 'PASS: %.% is a validated MATCH SIMPLE composite FK (%)', tbl, con, pairs;
  END LOOP;
END;
$$;

-- ── Part 1c: the foreign keys are indexed on the referencing side ───────────
-- Referential integrity scans the referencing table whenever a product_variants
-- row is deleted. Neither table had a usable index before 090.
DO $$
DECLARE
  item text;
BEGIN
  FOREACH item IN ARRAY ARRAY[
    'idx_cart_items_product_variant',
    'idx_order_items_product_variant'
  ] LOOP
    IF to_regclass('public.' || item) IS NULL THEN
      RAISE EXCEPTION
        'MISSING INDEX public.% -- deleting a product variant sequential-scans the referencing table', item;
    END IF;
  END LOOP;

  RAISE NOTICE 'PASS: both new foreign keys are indexed';
END;
$$;

-- ── Part 1d: the cart_items policy actually gained a WITH CHECK ─────────────
-- The old policy had none, so FOR ALL fell back to USING for INSERT/UPDATE:
-- cart ownership and nothing else. That is what let a buyer put another
-- seller's product in her basket and pay THIS seller for it.
DO $$
DECLARE
  p record;
BEGIN
  SELECT roles, qual, with_check INTO p
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'cart_items' AND policyname = 'cart_items_owner';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MISSING POLICY public.cart_items.cart_items_owner';
  END IF;

  IF NOT (p.roles = '{authenticated}') THEN
    RAISE EXCEPTION 'POLICY cart_items_owner is scoped to %, expected {authenticated}', p.roles;
  END IF;

  IF p.with_check IS NULL THEN
    RAISE EXCEPTION
      'cart_items_owner has no WITH CHECK -- 090 section 5 is not applied. FOR ALL falls back to USING for writes, so a buyer may insert a line for a product belonging to any other seller';
  END IF;

  IF position('business_id' in p.with_check) = 0 THEN
    RAISE EXCEPTION
      'cart_items_owner WITH CHECK does not mention business_id: %. The clause exists but is not the seller check', p.with_check;
  END IF;

  RAISE NOTICE 'PASS: cart_items_owner carries a business-scoped WITH CHECK';
END;
$$;

-- ── Part 1e: no violating rows survive anywhere ────────────────────────────
-- Belt and braces over convalidated: proves the predicate against live data.
DO $$
DECLARE
  n_cart  int;
  n_order int;
BEGIN
  SELECT count(*) INTO n_cart
  FROM public.cart_items ci JOIN public.product_variants v ON v.id = ci.variant_id
  WHERE ci.variant_id IS NOT NULL AND v.product_id <> ci.product_id;

  SELECT count(*) INTO n_order
  FROM public.order_items oi JOIN public.product_variants v ON v.id = oi.variant_id
  WHERE oi.variant_id IS NOT NULL AND oi.product_id IS NOT NULL AND v.product_id <> oi.product_id;

  IF n_cart <> 0 THEN
    RAISE EXCEPTION 'EXPLOITABLE: % cart_items row(s) still pair a variant with a foreign product', n_cart;
  END IF;

  IF n_order <> 0 THEN
    RAISE EXCEPTION
      'MONEY ALREADY TAKEN: % order_items row(s) pair a variant with a foreign product. These are real orders placed at a price the seller never set -- refund, void or annotate them; do NOT UPDATE them into compliance',
      n_order;
  END IF;

  RAISE NOTICE 'PASS: no mismatched pair exists in cart_items or order_items';
END;
$$;

-- ── Part 2: behaviour, on fixtures ─────────────────────────────────────────

BEGIN;

DO $$
DECLARE
  v_user  uuid;
  v_biz   uuid;
  v_biz2  uuid;
  v_coat  uuid;
  v_ring  uuid;
  v_vcoat uuid;
  v_vring uuid;
  v_cart  uuid;
BEGIN
  CREATE TEMP TABLE t090 (
    ready        boolean NOT NULL,
    user_id      uuid,
    business_id  uuid,
    business2_id uuid,
    coat         uuid,
    keyring      uuid,
    coat_variant uuid,
    ring_variant uuid,
    cart_id      uuid
  ) ON COMMIT DROP;

  SELECT id INTO v_user
  FROM public.profiles
  WHERE is_active = true AND is_ghost = false
  ORDER BY created_at
  LIMIT 1;

  IF v_user IS NULL THEN
    INSERT INTO t090 VALUES (false, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    RAISE NOTICE 'SKIP: Part 2 needs one active, non-ghost profile. Part 1 still ran.';
    RETURN;
  END IF;

  INSERT INTO public.businesses (owner_id, name, category)
  VALUES (v_user, '090 check seller', 'retail') RETURNING id INTO v_biz;

  INSERT INTO public.businesses (owner_id, name, category)
  VALUES (v_user, '090 check other seller', 'retail') RETURNING id INTO v_biz2;

  -- The expensive item, and the cheap one whose variant is the decoy.
  INSERT INTO public.products (business_id, name, base_price_cents, category, status, is_active, has_variants)
  VALUES (v_biz, '090 coat', 1000000, 'apparel', 'approved', true, true)
  RETURNING id INTO v_coat;

  INSERT INTO public.products (business_id, name, base_price_cents, category, status, is_active, has_variants)
  VALUES (v_biz, '090 keyring', 100, 'accessories', 'approved', true, true)
  RETURNING id INTO v_ring;

  INSERT INTO public.product_variants (product_id, price_cents, stock, is_active, option1_name, option1_value)
  VALUES (v_coat, 1200000, 5, true, 'Size', 'M') RETURNING id INTO v_vcoat;

  -- Real, active, in stock, priced at one cent -- and attached to the keyring.
  INSERT INTO public.product_variants (product_id, price_cents, stock, is_active, option1_name, option1_value)
  VALUES (v_ring, 1, 999, true, 'Colour', 'Brass') RETURNING id INTO v_vring;

  INSERT INTO public.carts (buyer_id, business_id)
  VALUES (v_user, v_biz)
  ON CONFLICT (buyer_id, business_id) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_cart;

  INSERT INTO t090 VALUES (true, v_user, v_biz, v_biz2, v_coat, v_ring, v_vcoat, v_vring, v_cart);
  RAISE NOTICE 'Fixtures ready: cart=% coat=% decoy_variant=%', v_cart, v_coat, v_vring;
END;
$$;

-- Phase A -- THE EXPLOIT. Pairing the coat with the keyring's one-cent variant
-- must be refused by the database itself, as the owner role, with RLS out of the
-- picture entirely. This is the write that used to succeed and then price a
-- 10,000.00 coat at 0.01.
DO $$
DECLARE
  f      record;
  landed boolean := false;
BEGIN
  SELECT * INTO f FROM t090;
  IF NOT f.ready THEN RETURN; END IF;

  BEGIN
    INSERT INTO public.cart_items (cart_id, product_id, variant_id, quantity)
    VALUES (f.cart_id, f.coat, f.ring_variant, 1);
    landed := true;
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  IF landed THEN
    RAISE EXCEPTION
      'EXPLOITABLE: cart_items accepted the coat paired with the keyring''s variant. create-product-order prices the line off the variant, so this cart checks out at 0.01 and the decoy absorbs the stock decrement';
  END IF;

  RAISE NOTICE 'PASS: a variant belonging to another product cannot enter a cart';
END;
$$;

-- Phase B -- THE POSITIVE that stops Phase A being satisfied by a constraint
-- that simply forbids variants. The coat's OWN variant must go in.
DO $$
DECLARE
  f record;
  n int;
BEGIN
  SELECT * INTO f FROM t090;
  IF NOT f.ready THEN RETURN; END IF;

  INSERT INTO public.cart_items (cart_id, product_id, variant_id, quantity)
  VALUES (f.cart_id, f.coat, f.coat_variant, 1);

  SELECT count(*) INTO n
  FROM public.cart_items
  WHERE cart_id = f.cart_id AND product_id = f.coat AND variant_id = f.coat_variant;

  IF n <> 1 THEN
    RAISE EXCEPTION 'OVER-RESTRICTED: a product''s own variant was refused -- no variant product can be bought at all';
  END IF;

  RAISE NOTICE 'PASS: a product''s own variant is still accepted';
END;
$$;

-- Phase C -- MATCH SIMPLE, asserted behaviourally rather than only from the
-- catalog. A variantless line is the normal shape for most of this marketplace
-- and MATCH FULL would reject every one of them.
DO $$
DECLARE
  f record;
  n int;
BEGIN
  SELECT * INTO f FROM t090;
  IF NOT f.ready THEN RETURN; END IF;

  INSERT INTO public.cart_items (cart_id, product_id, variant_id, quantity)
  VALUES (f.cart_id, f.keyring, NULL, 2);

  SELECT count(*) INTO n
  FROM public.cart_items
  WHERE cart_id = f.cart_id AND product_id = f.keyring AND variant_id IS NULL;

  IF n <> 1 THEN
    RAISE EXCEPTION
      'BROKEN: a NULL variant_id was refused. The composite FK was written MATCH FULL -- every product without variants is now unbuyable';
  END IF;

  RAISE NOTICE 'PASS: a variantless line still inserts (MATCH SIMPLE holds)';
END;
$$;

-- Phase D -- the same refusal on order_items, where a violation means the money
-- is already taken. stripe-product-webhook inserts these straight from
-- PaymentIntent metadata and does not check the result.
DO $$
DECLARE
  f      record;
  v_ord  uuid;
  landed boolean := false;
BEGIN
  SELECT * INTO f FROM t090;
  IF NOT f.ready THEN RETURN; END IF;

  INSERT INTO public.orders (
    buyer_id, business_id, shipping_name, shipping_line1, shipping_city,
    shipping_state, shipping_postal_code, subtotal_cents, platform_fee_cents,
    stripe_payment_intent_id
  ) VALUES (
    f.user_id, f.business_id, 'A Buyer', '1 Test Street', 'Manila',
    'NCR', '1000', 1000000, 100000, 'pi_090_check_fixture'
  ) RETURNING id INTO v_ord;

  BEGIN
    INSERT INTO public.order_items (order_id, product_id, variant_id, product_name, unit_price_cents, quantity)
    VALUES (v_ord, f.coat, f.ring_variant, '090 coat', 1, 1);
    landed := true;
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  IF landed THEN
    RAISE EXCEPTION
      'EXPLOITABLE: order_items recorded the coat against the keyring''s variant. A paid order can be written at a price its seller never set';
  END IF;

  -- And the honest line still lands, or the webhook writes orders with no contents.
  INSERT INTO public.order_items (order_id, product_id, variant_id, product_name, unit_price_cents, quantity)
  VALUES (v_ord, f.coat, f.coat_variant, '090 coat', 1200000, 1);

  RAISE NOTICE 'PASS: order_items refuses a foreign variant and accepts the real one';
END;
$$;

-- Phase E -- THE RLS NEGATIVE for the sibling hole. As the buyer herself, a line
-- for a product belonging to a DIFFERENT seller must be refused by WITH CHECK.
-- A cart is pinned to one seller and the PaymentIntent destination is that
-- seller's Stripe account, so an unchecked line pays the wrong seller.
DO $$
DECLARE
  f       record;
  v_other uuid;
  landed  boolean := false;
BEGIN
  SELECT * INTO f FROM t090;
  IF NOT f.ready THEN RETURN; END IF;

  INSERT INTO public.products (business_id, name, base_price_cents, category, status, is_active, has_variants)
  VALUES (f.business2_id, '090 other seller product', 5000, 'art', 'approved', true, false)
  RETURNING id INTO v_other;

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', f.user_id, 'role', 'authenticated')::text, true);

  BEGIN
    INSERT INTO public.cart_items (cart_id, product_id, variant_id, quantity)
    VALUES (f.cart_id, v_other, NULL, 1);
    landed := true;
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  EXECUTE 'RESET ROLE';

  IF landed THEN
    RAISE EXCEPTION
      'EXPLOITABLE: a buyer inserted another seller''s product into this seller''s cart. transfer_data.destination comes from the CART''s business, so she pays this seller for goods its owner never listed';
  END IF;

  RAISE NOTICE 'PASS: a foreign seller''s product cannot enter this cart';
END;
$$;

-- Phase F -- THE RLS POSITIVE. We did not over-restrict: the buyer must still be
-- able to fill her own basket, or syncServerCart fails and nobody checks out.
DO $$
DECLARE
  f record;
  n int;
BEGIN
  SELECT * INTO f FROM t090;
  IF NOT f.ready THEN RETURN; END IF;

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', f.user_id, 'role', 'authenticated')::text, true);

  DELETE FROM public.cart_items WHERE cart_id = f.cart_id AND product_id = f.keyring;

  INSERT INTO public.cart_items (cart_id, product_id, variant_id, quantity)
  VALUES (f.cart_id, f.keyring, f.ring_variant, 3);

  SELECT count(*) INTO n FROM public.cart_items WHERE cart_id = f.cart_id;

  EXECUTE 'RESET ROLE';

  IF n < 1 THEN
    RAISE EXCEPTION
      'OVER-RESTRICTED: the buyer cannot write or read her own cart. syncServerCart throws and checkout is dead for everyone';
  END IF;

  RAISE NOTICE 'PASS: the buyer still fills and reads her own basket (% lines)', n;
END;
$$;

ROLLBACK;

\echo '090 verification complete -- every DO block above must have printed PASS or SKIP'
