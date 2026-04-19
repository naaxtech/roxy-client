-- 038_seed_products_and_naaxtech.sql
-- 1. Seed mock products into existing seed businesses
-- 2. Create / register naaxtech.official@gmail.com as a business owner

-- ── 1. Seed products for the three seed businesses ────────────────────────────

DO $$
DECLARE
  biz_lavender    uuid;
  biz_wildflower  uuid;
  biz_queerly     uuid;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p6 uuid;
BEGIN
  -- Find seed businesses by name (created in migration 006 + dev_seed)
  SELECT id INTO biz_lavender   FROM public.businesses WHERE name = 'Lavender Books'     LIMIT 1;
  SELECT id INTO biz_wildflower FROM public.businesses WHERE name = 'Wildflower Studio'  LIMIT 1;
  SELECT id INTO biz_queerly    FROM public.businesses WHERE name = 'Queerly Coaching'   LIMIT 1;

  -- Mark them as can_sell (products visible in marketplace)
  UPDATE public.businesses SET can_sell = true
  WHERE name IN ('Lavender Books', 'Wildflower Studio', 'Queerly Coaching');

  -- ── Lavender Books products ──────────────────────────────────────────────────
  IF biz_lavender IS NOT NULL THEN

    -- Product 1: Tote Bag
    INSERT INTO public.products (id, business_id, name, description, base_price_cents, category, status, is_active, has_variants)
    VALUES (gen_random_uuid(), biz_lavender, 'Lavender Books Tote Bag',
      'Heavy-duty canvas tote with our iconic lavender sprig print. Perfect for carrying your stack.',
      1800, 'accessories', 'approved', true, true)
    ON CONFLICT DO NOTHING
    RETURNING id INTO p1;

    IF p1 IS NOT NULL THEN
      INSERT INTO public.product_variants (product_id, sku, option1_name, option1_value, price_cents, stock)
      VALUES
        (p1, 'LB-TOTE-NAT', 'Colour', 'Natural', 1800, 20),
        (p1, 'LB-TOTE-BLK', 'Colour', 'Black',   1800, 15)
      ON CONFLICT DO NOTHING;
    END IF;

    -- Product 2: Queer Women Writers Anthology
    INSERT INTO public.products (id, business_id, name, description, base_price_cents, category, status, is_active, has_variants)
    VALUES (gen_random_uuid(), biz_lavender, 'Queer Women Writers Anthology Vol. 1',
      'A curated collection of short stories by WLW authors. Paperback, 240 pages. Signed first edition available.',
      1400, 'books', 'approved', true, false)
    ON CONFLICT DO NOTHING;

    -- Product 3: Enamel Pin Set
    INSERT INTO public.products (id, business_id, name, description, base_price_cents, category, status, is_active, has_variants)
    VALUES (gen_random_uuid(), biz_lavender, 'Pride Enamel Pin Set (3-pack)',
      'Three hard enamel pins celebrating WLW love. Rainbow, double-venus, and lavender sprig. Gold plating.',
      1200, 'accessories', 'approved', true, false)
    ON CONFLICT DO NOTHING;

  END IF;

  -- ── Wildflower Studio products ───────────────────────────────────────────────
  IF biz_wildflower IS NOT NULL THEN

    -- Product 4: Portrait Session
    INSERT INTO public.products (id, business_id, name, description, base_price_cents, category, status, is_active, has_variants)
    VALUES (gen_random_uuid(), biz_wildflower, 'Couples Portrait Session',
      '1-hour outdoor portrait session for couples. 30 edited digital images delivered within 7 days. Manchester & surrounds.',
      18000, 'art', 'approved', true, false)
    ON CONFLICT DO NOTHING;

    -- Product 5: Zine
    INSERT INTO public.products (id, business_id, name, description, base_price_cents, category, status, is_active, has_variants)
    VALUES (gen_random_uuid(), biz_wildflower, 'Wildflower Photo Zine — "Us"',
      'A5 risograph-printed photo zine featuring queer couples in the north of England. Edition of 100.',
      1600, 'art', 'approved', true, false)
    ON CONFLICT DO NOTHING;

  END IF;

  -- ── Queerly Coaching products ────────────────────────────────────────────────
  IF biz_queerly IS NOT NULL THEN

    -- Product 6: Coaching Session
    INSERT INTO public.products (id, business_id, name, description, base_price_cents, category, status, is_active, has_variants)
    VALUES (gen_random_uuid(), biz_queerly, '1-on-1 Coaching Session (60 min)',
      'One-to-one video coaching session focused on career clarity, identity, and confidence for LGBTQ+ professionals. Zoom link sent on booking.',
      9500, 'other', 'approved', true, true)
    ON CONFLICT DO NOTHING
    RETURNING id INTO p6;

    IF p6 IS NOT NULL THEN
      INSERT INTO public.product_variants (product_id, sku, option1_name, option1_value, price_cents, stock)
      VALUES
        (p6, 'QC-INTRO',    'Type', 'Intro call (30 min) — Free',  0,    10),
        (p6, 'QC-STANDARD', 'Type', 'Standard (60 min)',            9500, 50),
        (p6, 'QC-DEEP',     'Type', 'Deep dive (90 min)',           13500, 20)
      ON CONFLICT DO NOTHING;
    END IF;

  END IF;
END $$;

-- ── 2. naaxtech.official@gmail.com — register as business owner ───────────────
-- This creates a "NaaxTech" business linked to the user's profile (if it exists).
-- If the user hasn't signed up yet, this will silently skip (no-op).

DO $$
DECLARE
  v_user_id uuid;
  v_biz_id  uuid;
BEGIN
  -- Find the user by email in auth.users
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = 'naaxtech.official@gmail.com'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'naaxtech.official@gmail.com not found in auth.users — skipping business creation.';
    RETURN;
  END IF;

  -- Only proceed if the profile exists (profile is created during onboarding)
  -- If no profile yet, the user needs to complete onboarding first
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id) THEN
    RAISE NOTICE 'naaxtech: auth user found but no profile yet — will be set up as business on next login/onboarding.';
    -- Store a flag so the app knows to auto-create a business after onboarding
    -- For now, we skip. Run this migration again after the user completes onboarding.
    RETURN;
  END IF;

  -- Check if this user already owns a business
  SELECT id INTO v_biz_id FROM public.businesses WHERE owner_id = v_user_id LIMIT 1;

  IF v_biz_id IS NOT NULL THEN
    -- Already has a business — make sure can_sell is on and it's verified
    UPDATE public.businesses
    SET can_sell = true, is_verified = true
    WHERE id = v_biz_id;
    RAISE NOTICE 'naaxtech: updated existing business % to can_sell=true, is_verified=true', v_biz_id;
  ELSE
    -- Create a new business for this user
    INSERT INTO public.businesses (
      owner_id, name, description, category,
      location_city, is_wlw_owned, is_verified, can_sell
    )
    VALUES (
      v_user_id,
      'NaaxTech',
      'Technology solutions and digital products for the WLW community.',
      'other',
      'Remote',
      true,
      true,
      true
    )
    RETURNING id INTO v_biz_id;
    RAISE NOTICE 'naaxtech: created business % for user %', v_biz_id, v_user_id;
  END IF;
END $$;
