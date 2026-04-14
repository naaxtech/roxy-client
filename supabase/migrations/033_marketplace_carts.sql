-- supabase/migrations/033_marketplace_carts.sql

CREATE TABLE public.carts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id     uuid        NOT NULL REFERENCES public.profiles(id),
  business_id  uuid        NOT NULL REFERENCES public.businesses(id),
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (buyer_id, business_id)
);

CREATE TABLE public.cart_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id     uuid        NOT NULL REFERENCES public.carts(id) ON DELETE CASCADE,
  product_id  uuid        NOT NULL REFERENCES public.products(id),
  variant_id  uuid        REFERENCES public.product_variants(id),
  quantity    integer     NOT NULL DEFAULT 1 CHECK (quantity > 0),
  added_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cart_id, product_id, variant_id)
);

ALTER TABLE public.carts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "carts_owner" ON public.carts
  FOR ALL TO authenticated USING (buyer_id = auth.uid());

CREATE POLICY "cart_items_owner" ON public.cart_items
  FOR ALL TO authenticated
  USING (cart_id IN (SELECT id FROM public.carts WHERE buyer_id = auth.uid()));

CREATE TRIGGER trg_carts_updated_at
  BEFORE UPDATE ON public.carts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_cart_items_cart ON public.cart_items(cart_id);
CREATE INDEX idx_carts_buyer_biz ON public.carts(buyer_id, business_id);
