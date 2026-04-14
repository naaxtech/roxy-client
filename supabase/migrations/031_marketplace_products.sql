-- supabase/migrations/031_marketplace_products.sql

-- businesses additions
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS currency             text        NOT NULL DEFAULT 'usd',
  ADD COLUMN IF NOT EXISTS stripe_account_id    text,
  ADD COLUMN IF NOT EXISTS stripe_onboarded_at  timestamptz,
  ADD COLUMN IF NOT EXISTS can_sell             boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payout_schedule_set  boolean     NOT NULL DEFAULT false;

-- profiles additions
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id     text,
  ADD COLUMN IF NOT EXISTS last_shipping_address  jsonb;

-- products
CREATE TABLE public.products (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name              text        NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  description       text        CHECK (length(description) <= 2000),
  base_price_cents  integer     NOT NULL CHECK (base_price_cents > 0),
  category          text        NOT NULL CHECK (category IN (
                                  'apparel','accessories','beauty',
                                  'art','food','books','other'
                                )),
  status            text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','approved','rejected','archived')),
  is_active         boolean     NOT NULL DEFAULT true,
  has_variants      boolean     NOT NULL DEFAULT false,
  rejection_reason  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- product_variants
CREATE TABLE public.product_variants (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     uuid        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sku            text,
  option1_name   text,
  option1_value  text,
  option2_name   text,
  option2_value  text,
  price_cents    integer     NOT NULL CHECK (price_cents > 0),
  stock          integer     NOT NULL DEFAULT 0 CHECK (stock >= 0),
  is_active      boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, option1_value, option2_value)
);

-- product_photos
CREATE TABLE public.product_photos (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  url         text        NOT NULL,
  alt_text    text,
  position    integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.products        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_photos   ENABLE ROW LEVEL SECURITY;

-- products: approved visible to all; owner sees all statuses
CREATE POLICY "products_select_approved" ON public.products
  FOR SELECT TO authenticated
  USING (
    (status = 'approved' AND is_active = true)
    OR business_id IN (
      SELECT id FROM public.businesses WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY "products_insert" ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
  );

CREATE POLICY "products_update" ON public.products
  FOR UPDATE TO authenticated
  USING (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
  );

CREATE POLICY "products_delete" ON public.products
  FOR DELETE TO authenticated
  USING (
    business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
  );

-- variants: readable if product is readable
CREATE POLICY "variants_select" ON public.product_variants
  FOR SELECT TO authenticated USING (
    product_id IN (SELECT id FROM public.products WHERE
      (status = 'approved' AND is_active = true)
      OR business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
    )
  );

CREATE POLICY "variants_write" ON public.product_variants
  FOR ALL TO authenticated
  USING (
    product_id IN (
      SELECT p.id FROM public.products p
      JOIN public.businesses b ON b.id = p.business_id
      WHERE b.owner_id = auth.uid()
    )
  );

-- photos: same as variants
CREATE POLICY "photos_select" ON public.product_photos
  FOR SELECT TO authenticated USING (
    product_id IN (SELECT id FROM public.products WHERE
      (status = 'approved' AND is_active = true)
      OR business_id IN (SELECT id FROM public.businesses WHERE owner_id = auth.uid())
    )
  );

CREATE POLICY "photos_write" ON public.product_photos
  FOR ALL TO authenticated
  USING (
    product_id IN (
      SELECT p.id FROM public.products p
      JOIN public.businesses b ON b.id = p.business_id
      WHERE b.owner_id = auth.uid()
    )
  );

-- updated_at trigger function (reuse if exists)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_product_variants_updated_at
  BEFORE UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- max 5 photos per product
CREATE OR REPLACE FUNCTION public.check_product_photo_limit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT COUNT(*) FROM public.product_photos WHERE product_id = NEW.product_id) >= 5 THEN
    RAISE EXCEPTION 'Maximum 5 photos per product';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_product_photo_limit
  BEFORE INSERT ON public.product_photos
  FOR EACH ROW EXECUTE FUNCTION public.check_product_photo_limit();

-- Stock decrement — returns true if successful, false if insufficient stock
CREATE OR REPLACE FUNCTION public.decrement_variant_stock(p_variant_id uuid, p_qty integer)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE updated_rows integer;
BEGIN
  UPDATE public.product_variants
    SET stock = stock - p_qty
    WHERE id = p_variant_id AND stock >= p_qty AND is_active = true;
  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows > 0;
END $$;

CREATE OR REPLACE FUNCTION public.increment_variant_stock(p_variant_id uuid, p_qty integer)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.product_variants SET stock = stock + p_qty WHERE id = p_variant_id;
END $$;

-- indexes
CREATE INDEX idx_products_business   ON public.products(business_id);
CREATE INDEX idx_products_browsable  ON public.products(business_id, is_active)
                                     WHERE status = 'approved';
CREATE INDEX idx_variants_product    ON public.product_variants(product_id);
