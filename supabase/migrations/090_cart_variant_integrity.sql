-- ============================================================
-- 090_cart_variant_integrity.sql
--
-- The price exploit closed in 089 was closed at one door. This is the other one.
--
-- ── WHAT HAPPENED ───────────────────────────────────────────────────────────
-- 089 removed `shipping_cost_cents` from the request body, so a buyer could no
-- longer name a NUMBER. She could still name a ROW.
--
-- `cart_items` carries two INDEPENDENT foreign keys (033:16-17):
--
--     product_id  uuid NOT NULL REFERENCES public.products(id)
--     variant_id  uuid          REFERENCES public.product_variants(id)
--
-- Each is valid on its own and NOTHING tied them to each other -- no CHECK, no
-- trigger, no composite FK, across migrations 001-089. And the RLS policy
-- authorises the CART, not its contents:
--
--     USING (cart_id IN (SELECT id FROM public.carts WHERE buyer_id = auth.uid()))
--
-- `marketplaceStore.syncServerCart` writes those rows from the client under the
-- anon key, so any signed-in buyer could POST straight to PostgREST:
--
--     {cart_id: <hers>, product_id: <the 10,000.00 coat>,
--      variant_id: <any active variant priced at 1>, quantity: 1}
--
-- ...then check out normally. `create-product-order` embedded the variant WITHOUT
-- `product_id`, so it could not have compared the two even in principle, and
-- priced the line off `variant.price_cents`. Subtotal 1, fee 0, intent amount 1.
-- She paid 0.01, the order showed the coat's name and her shipping address, and
-- the seller shipped it.
--
-- Worse than a one-off: `decrement_variant_stock` ran against the DECOY variant,
-- so the coat's stock never moved and the same attack repeated indefinitely.
--
-- A sibling hole on the same rows: `products.business_id` was fetched by the
-- checkout and never compared to `carts.business_id`. A cart is pinned to one
-- seller by UNIQUE (buyer_id, business_id) and `transfer_data.destination` is
-- that seller's Stripe account -- so a foreign product in the basket paid the
-- wrong seller for goods its actual owner never agreed to sell.
--
-- ── THE SAME DEFECT, ONE TABLE UP ───────────────────────────────────────────
-- `cart_items` is not the only FOR ALL policy in this feature written without a
-- WITH CHECK. `carts` carries the identical shape (033:26-27):
--
--     CREATE POLICY "carts_owner" ON public.carts
--       FOR ALL TO authenticated USING (buyer_id = auth.uid());
--
-- Postgres reuses USING as the WITH CHECK when none is given, so the only thing
-- ever asked of a write is "is this your cart" -- of the old row AND of the new
-- one. Section 5 below would therefore have been a gate rather than an
-- invariant. Fill cart C, pinned to seller A, with A's products; every line
-- passes the new cart_items check. Then:
--
--     PATCH /rest/v1/carts?id=eq.C   {"business_id": "<seller B>"}
--
-- The row is hers before the update and hers after it, so `carts_owner` permits
-- it, and the database now holds precisely the state the paragraph above says it
-- cannot: a basket pinned to B whose every line belongs to A. Nothing but
-- `checkout.ts` would stand between that and a payment routed to the wrong
-- Stripe account -- which is the same "the application layer is the only guard"
-- position this whole migration exists to get out of.
--
-- A WITH CHECK cannot close that on its own. It sees NEW and never OLD, and
-- "business_id did not change" is a statement about both rows. So section 6 does
-- two things: a WITH CHECK for what is expressible about the new row alone, and
-- a BEFORE UPDATE trigger for the part that needs the old one.
--
-- The same missing clause also left `expires_at` writable to any value the buyer
-- liked, which defeats the 7-day TTL (033:7) and the nightly purge (034:132)
-- that the EXISTING ROWS note below leans on to call cart rows disposable.
--
-- ── WHY A CONSTRAINT AND NOT ONLY THE APPLICATION FIX ───────────────────────
-- `create-product-order` now selects `product_id` on the variant embed and
-- refuses both mismatches (see `priceCart` in create-product-order/checkout.ts,
-- and its tests in apps/mobile/__tests__/createProductOrder.test.ts). That is the
-- fix that stops money moving. This migration is what stops the bad row EXISTING,
-- so the next author who writes a second query against `cart_items` -- or the next
-- edge function that prices one -- inherits the guarantee instead of having to
-- re-derive it. 089 made the same argument about a range; this one is about a join.
--
-- ── DEPLOY ORDER: FUNCTION FIRST, THEN THIS MIGRATION ───────────────────────
-- NOT interchangeable. `stripe-product-webhook` inserts `order_items` straight
-- from PaymentIntent metadata (that function, :151) and does not check the insert
-- result. If this migration lands while the OLD checkout is still deployed, an
-- exploit attempt would: open an intent, take the buyer's money, write the
-- `orders` row, and then have the `order_items` insert rejected by the new
-- constraint -- silently. Money taken, order row with no contents. Deploying the
-- function first means the input is refused with a clean 400 before any intent
-- opens, and this migration then only has to hold a line that is already held.
--
-- ── EXISTING ROWS ───────────────────────────────────────────────────────────
-- Two different classes of data, so two different treatments.
--
-- `cart_items` is transient: carts expire after 7 days (033:7), a pg_cron job
-- purges expired ones nightly (034:132), and the webhook deletes the rows once
-- payment lands. A mismatched row there is an abandoned basket that the fixed
-- checkout would now refuse anyway -- it is not a record of anything that
-- happened. Those rows are DELETED below so the constraint can be added
-- validated, rather than left NOT VALID with a follow-up nobody runs.
--
-- `order_items` is the opposite: it is a financial record. It is NOT cleaned.
-- 089 verified `orders` held zero rows, so there should be nothing to validate --
-- but if this migration FAILS on the order_items constraint, do not "fix" the
-- data. A violating row there means a real order was placed at a price the seller
-- never set. Add that one constraint NOT VALID, reconcile the affected orders
-- deliberately (refund, void or annotate -- never UPDATE them into compliance),
-- then VALIDATE CONSTRAINT. The failure is the alarm; let it fire.
--
-- `order_items_variant_requires_product` (also section 3) is the one constraint
-- in this file whose failure is REPAIRABLE rather than only reportable, and the
-- distinction matters because the sentence above says never to UPDATE a row into
-- compliance. A row that violates this one carries a variant and a NULL product,
-- and `product_variants.product_id` says exactly which product that variant
-- belongs to -- so the fix recovers a fact the row already implies rather than
-- inventing one:
--     UPDATE public.order_items oi SET product_id = v.product_id
--       FROM public.product_variants v
--      WHERE v.id = oi.variant_id AND oi.product_id IS NULL;
-- Run that, then re-run the ALTER. A row with BOTH columns NULL is untouched by
-- it and is legal under the constraint: that is a free-text line with no
-- catalogue entry behind it, which is not what this closes.
--
-- Written to be safe on an empty database and on a populated one, because this
-- was authored with no database access to check: every ALTER below is the plain
-- validating form, so on a clean table it succeeds silently and on a dirty one
-- it aborts the whole migration rather than half-applying. Nothing here degrades
-- to NOT VALID on its own -- that decision is a human's, taken after reading the
-- offending rows.
--
-- ── NOT RETRY-SAFE, AND THAT IS DELIBERATE ──────────────────────────────────
-- 088 documents the CREATE OR REPLACE / IF EXISTS convention this repo uses so a
-- migration can be re-run after a partial failure. This one cannot follow it:
-- ALTER TABLE ... ADD CONSTRAINT has no IF NOT EXISTS, so a second run raises
-- 42710 on the first constraint regardless of what else is written defensively.
-- Pretending otherwise with IF EXISTS on the drops alone would only make the
-- file LOOK re-runnable. If this aborts part-way, run the ROLLBACK recipe below
-- from the bottom up as far as it got, fix the cause, and apply it once more.
--
-- ── MATCH SIMPLE IS LOAD-BEARING -- DO NOT "TIGHTEN" IT TO MATCH FULL ──────
-- Both composite FKs below rely on the DEFAULT match semantics. Under MATCH
-- SIMPLE a row whose referenced columns are not ALL non-null satisfies the
-- constraint without being checked. That is exactly what a variantless product
-- needs: `cart_items.variant_id IS NULL` is the normal shape for the majority of
-- this marketplace's listings, and it must stay insertable.
--
-- MATCH FULL would reject every one of them (product_id NOT NULL + variant_id
-- NULL is a partial match, which MATCH FULL forbids) and break all variantless
-- checkout. The pair is only ever checked when the buyer actually chose a
-- variant, which is the only case where a mismatch is expressible.
-- src: https://www.postgresql.org/docs/17/ddl-constraints.html#DDL-CONSTRAINTS-FK
--
-- ── auth.uid() vs (SELECT auth.uid()) -- A DEPARTURE, ON THE RECORD ─────────
-- Checked before writing it: every policy in this repo through 089 uses a bare
-- `auth.uid()`. 086, 087 and 088 all do. The scalar-subquery form appears here
-- and nowhere else in the tree.
--
-- That is deliberate rather than a slip. Wrapped in a subquery the call is
-- evaluated once as an InitPlan instead of once per candidate row, and the two
-- policies this file rewrites are the ones on the checkout path. It is not a
-- reason to go and rewrite the other forty: a working policy edited for a
-- planner win is a security change with no security review behind it, and this
-- migration's blast radius is already carts and cart_items. New policies from
-- here on should use the wrapped form; existing ones stay as they are until
-- something else makes them worth touching.
-- src: https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
--
-- ── LOCKING ─────────────────────────────────────────────────────────────────
-- These tables are tiny (a pre-launch marketplace; `orders` held zero rows as of
-- 089), so the plain forms below are correct here and finish instantly. If this
-- ever has to run against a large table, the non-blocking recipe is:
--   CREATE UNIQUE INDEX CONCURRENTLY ... ;                    -- outside a txn
--   ALTER TABLE ... ADD CONSTRAINT ... UNIQUE USING INDEX ... ;
--   ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ... NOT VALID ;
--   ALTER TABLE ... VALIDATE CONSTRAINT ... ;                 -- SHARE UPDATE EXCLUSIVE
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- This repo keeps no supabase/downs/ directory. To undo, in this order -- the
-- trigger before the function it calls, and every constraint before the unique
-- key they all reference:
--   ALTER TABLE public.order_items DROP CONSTRAINT order_items_variant_requires_product;
--   ALTER TABLE public.order_items DROP CONSTRAINT order_items_variant_matches_product;
--   ALTER TABLE public.cart_items  DROP CONSTRAINT cart_items_variant_matches_product;
--   DROP INDEX public.idx_order_items_product_variant;
--   DROP INDEX public.idx_cart_items_product_variant;
--   ALTER TABLE public.product_variants DROP CONSTRAINT product_variants_product_id_id_key;
--   DROP TRIGGER trg_carts_freeze_pairing ON public.carts;
--   DROP FUNCTION public.carts_freeze_pairing();
--   DROP POLICY "carts_owner" ON public.carts;
--   CREATE POLICY "carts_owner" ON public.carts FOR ALL TO authenticated
--     USING (buyer_id = auth.uid());
--   DROP POLICY "cart_items_owner" ON public.cart_items;
--   CREATE POLICY "cart_items_owner" ON public.cart_items FOR ALL TO authenticated
--     USING (cart_id IN (SELECT id FROM public.carts WHERE buyer_id = auth.uid()));
--
-- Read the last four lines before running them. They restore 033 verbatim, which
-- means restoring two FOR ALL policies with no WITH CHECK -- i.e. re-opening
-- both holes this file closes, on a live marketplace. Roll back the constraints
-- if they are the problem and leave the policies alone unless the policies are.
-- The deleted cart_items rows are not recoverable and are not meant to be.
-- ============================================================

-- ── 1. The referenced key ───────────────────────────────────────────────────
-- `id` is already the primary key, so this can never find a duplicate and is
-- purely the target a composite foreign key is allowed to point at. Columns are
-- declared in the same order the FKs reference them, so nothing depends on
-- Postgres matching a unique constraint by column SET rather than by order.
ALTER TABLE public.product_variants
  ADD CONSTRAINT product_variants_product_id_id_key UNIQUE (product_id, id);

COMMENT ON CONSTRAINT product_variants_product_id_id_key ON public.product_variants IS
  'Audience: nobody queries this directly. It exists solely so cart_items and order_items can carry a composite FK proving a chosen variant belongs to the product being bought. Redundant as a uniqueness claim (id is already the PK) and that is fine.';

-- ── 2. Drop cart rows that the fixed checkout would already refuse ──────────
-- Transient basket data, not a record of anything. See the header.
DELETE FROM public.cart_items ci
  USING public.product_variants v
  WHERE ci.variant_id = v.id
    AND v.product_id <> ci.product_id;

-- ── 3. The constraint that makes the exploit unrepresentable ───────────────
ALTER TABLE public.cart_items
  ADD CONSTRAINT cart_items_variant_matches_product
    FOREIGN KEY (product_id, variant_id)
    REFERENCES public.product_variants (product_id, id);

COMMENT ON CONSTRAINT cart_items_variant_matches_product ON public.cart_items IS
  'Audience: authenticated buyers writing their own cart rows from the client. The cart_items_owner RLS policy authorises the CART, not its contents, so a buyer could pair any product_id with any variant_id and create-product-order priced the line off the variant -- 0.01 for a 10,000.00 item, with the decoy variant absorbing the stock decrement. MATCH SIMPLE is deliberate: variant_id IS NULL (a variantless product) is unchecked and must stay insertable. Never MATCH FULL.';

ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_variant_matches_product
    FOREIGN KEY (product_id, variant_id)
    REFERENCES public.product_variants (product_id, id);

COMMENT ON CONSTRAINT order_items_variant_matches_product ON public.order_items IS
  'Audience: the service-role writer in stripe-product-webhook, which inserts these rows verbatim from PaymentIntent metadata and does not check the insert result. Backstop only -- create-product-order must refuse a mismatched pair long before an intent opens, because a violation HERE means the money is already taken. MATCH SIMPLE leaves a partially-null pair unchecked, which is why order_items_variant_requires_product exists beside it.';

-- The composite FK above is a backstop with a hole in it, and the hole is a
-- NULL. `order_items.product_id` is nullable (032:47) where `cart_items` makes
-- it NOT NULL (033:16), and MATCH SIMPLE skips the check entirely unless every
-- referenced column is non-null. So the pair (NULL, <any variant at all>) is
-- never compared to anything -- it satisfies the constraint by not being looked
-- at. Calling that a backstop against a writer that does not check its insert
-- result, while leaving the one shape that writer could actually produce
-- unchecked, is a comment doing the work a constraint was supposed to do.
--
-- And it was reachable, not theoretical. Until the checkout rewrite the metadata
-- builder wrote, verbatim:
--
--     product_id: item.product?.id ?? null,     -- create-product-order/index.ts
--                                               -- :289 as of commit 6d3d958
--
-- stripe-product-webhook parses that same JSON and inserts it straight into
-- order_items (:154), so any line whose product embed failed to resolve landed
-- as a NULL product beside a live variant_id. The current checkout types
-- `product_id` as a required string and fills it from the product it verified
-- (checkout.ts:90, :236), which is the real fix; this is what stops the shape
-- being storable if a future writer regresses to the old one.
--
-- The CHECK ties the two columns' nullability together in the only direction
-- that means anything: a variant without a product is an order line naming a
-- price with nothing to attach it to, and it is exactly what the composite FK
-- cannot see. The reverse -- a product with no variant -- is the normal
-- variantless line and stays legal, as does (NULL, NULL), which is a free-text
-- historical line with no catalogue row behind it.
--
-- Consequence to know about before changing 032: if `product_id` is ever given
-- ON DELETE SET NULL, deleting a product would try to null it while leaving
-- variant_id set, and this CHECK will refuse the delete. That is the correct
-- outcome, but it will look like a puzzling FK error, so the fix then is to null
-- both columns together, not to drop this constraint.
--
-- `cart_items` needs no equivalent: product_id there is already NOT NULL.
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_variant_requires_product
    CHECK (variant_id IS NULL OR product_id IS NOT NULL);

COMMENT ON CONSTRAINT order_items_variant_requires_product ON public.order_items IS
  'Closes the MATCH SIMPLE hole in order_items_variant_matches_product: a partially-null pair is never checked by a composite FK, so (NULL product, real variant) walked straight past it -- and the pre-089 checkout emitted exactly that shape via `item.product?.id ?? null`. A variant with no product is an order line whose price has nothing to attach to. (NULL, NULL) stays legal (free-text line); (product, NULL) stays legal (variantless product).';

-- ── 4. Index the new foreign keys ──────────────────────────────────────────
-- Referential integrity scans the REFERENCING side whenever a product_variants
-- row is deleted or its key updated. Neither table had an index leading with
-- these columns: cart_items had (cart_id) and a unique (cart_id, product_id,
-- variant_id) whose leading column is wrong for this lookup; order_items had
-- (order_id) only. Without these, deleting a variant sequential-scans both.
CREATE INDEX idx_cart_items_product_variant
  ON public.cart_items (product_id, variant_id);

CREATE INDEX idx_order_items_product_variant
  ON public.order_items (product_id, variant_id);

-- ── 5. Close the sibling hole at the write layer too ───────────────────────
-- The composite FK cannot express "this product belongs to the cart's seller" --
-- that needs a join, so it goes in the policy that already governs these writes.
--
-- The previous policy had no WITH CHECK, so FOR ALL fell back to the USING
-- expression for INSERT/UPDATE: cart ownership and nothing else. A buyer could
-- therefore drop seller B's product into her seller-A cart and pay A for it.
--
-- USING is unchanged in meaning (it still authorises reads and deletes by cart
-- ownership) and is left as the SELECT/DELETE boundary. auth.uid() is wrapped in
-- a scalar subquery so the planner evaluates it once as an InitPlan instead of
-- once per row.
-- src: https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
--
-- The products lookup inside WITH CHECK runs as the buyer, so products RLS
-- (031: approved AND active, or her own business) applies -- which additionally
-- stops a pending or rejected listing being added to a basket at all.
DROP POLICY "cart_items_owner" ON public.cart_items;

CREATE POLICY "cart_items_owner" ON public.cart_items
  FOR ALL TO authenticated
  USING (
    cart_id IN (SELECT id FROM public.carts WHERE buyer_id = (SELECT auth.uid()))
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.carts c, public.products p
      WHERE c.id = cart_items.cart_id
        AND p.id = cart_items.product_id
        AND c.buyer_id = (SELECT auth.uid())
        AND p.business_id = c.business_id
    )
  );

COMMENT ON POLICY "cart_items_owner" ON public.cart_items IS
  'Audience: authenticated buyers, own cart only. USING governs read/delete by cart ownership. WITH CHECK additionally requires the product to belong to the cart''s business, because carts are UNIQUE (buyer_id, business_id) and the PaymentIntent destination is that business''s Stripe account -- an unchecked line paid the wrong seller. The variant/product pairing is enforced by cart_items_variant_matches_product, not here. Section 5 is only half the rule: without the carts_owner WITH CHECK and trg_carts_freeze_pairing (section 6) a buyer passes this check and then repoints the cart.';

-- ── 6. The parent table, or section 5 is a gate and not an invariant ────────
-- `carts` has the same defect section 5 just fixed on `cart_items`: FOR ALL with
-- no WITH CHECK, so USING is reused for writes and the only question asked of an
-- UPDATE is whether the cart is hers -- which it is, before and after. See the
-- header for the two-step bypass; the short version is that a cart full of
-- seller A's products can be re-pinned to seller B with one PATCH, and the
-- PaymentIntent destination follows the cart.
--
-- Two mechanisms because one is not enough, and the split is not arbitrary: a
-- WITH CHECK is evaluated against the NEW row only. It can say what a row must
-- look like; it cannot say what must not have changed. Everything expressible
-- about the new row alone goes in the policy, and the one rule that is a
-- statement about two rows goes in a trigger.
--
-- WITH CHECK, clause by clause:
--
--   buyer_id = (SELECT auth.uid())
--       Restates USING, deliberately. It is what USING was silently doing for
--       writes, and 088:372 makes the argument for writing it out: the moment
--       USING is widened for a read, an implicit WITH CHECK widens with it and
--       nobody notices. Making it explicit costs a line and removes the coupling.
--
--   expires_at <= now() + interval '7 days'
--       The TTL, which was writable to any value at all. `expires_at` gates
--       create-product-order (index.ts:187 refuses an expired cart) and is the
--       only thing the nightly purge (034:132) looks at, so a buyer could set it
--       to 2099 and keep a basket -- and a cart row -- alive forever. The ceiling
--       matches the column DEFAULT (033:7) exactly, so the client's plain
--       `insert({buyer_id, business_id})` passes with equality, and no code in
--       the tree writes the column at all: syncServerCart deletes an expired cart
--       and inserts a fresh one (marketplaceStore.ts:140-153), and no edge
--       function updates carts.
--
--       Residual, stated rather than hidden: this bounds the window at 7 days
--       from each write, not 7 days from creation, so a buyer who PATCHes daily
--       keeps her cart indefinitely. That is a sliding expiry, which is a normal
--       cart TTL and a retention question, not a security one -- every row in
--       that cart still satisfies every constraint above. Freezing it outright
--       would also freeze it for the service role and for any future "extend my
--       basket" feature, which is a bigger cost than the bytes.
--
-- Not in WITH CHECK, and worth knowing why: no clause requires the referenced
-- business to be visible or approved. The line-level check in section 5 already
-- runs the products lookup under the buyer's own RLS, so an unapproved seller's
-- goods cannot enter the cart regardless of what the empty cart points at, and
-- an empty cart pinned to a business is not a capability.
DROP POLICY "carts_owner" ON public.carts;

CREATE POLICY "carts_owner" ON public.carts
  FOR ALL TO authenticated
  USING (buyer_id = (SELECT auth.uid()))
  WITH CHECK (
    buyer_id = (SELECT auth.uid())
    AND expires_at <= now() + interval '7 days'
  );

COMMENT ON POLICY "carts_owner" ON public.carts IS
  'Audience: authenticated buyers, own cart only. 033 shipped this FOR ALL with no WITH CHECK, so writes were checked against the read rule: a buyer could UPDATE her own cart into any shape at all, including a far-future expires_at that outlives the nightly purge. The clause that a WITH CHECK CANNOT express -- business_id and buyer_id never change -- lives in trg_carts_freeze_pairing, because it is a statement about the old row.';

-- The half a WITH CHECK cannot reach.
--
-- WHY NOT "only once the cart has items", which is how this was first framed.
-- That version is racy and this one is not. Under READ COMMITTED, one
-- transaction can read an empty cart_items and repoint the cart while a second
-- reads the pre-update carts row and inserts a line that matches the OLD
-- business; both see a consistent world, both commit, and the mismatched pair
-- exists anyway. Closing that needs the trigger to lock the cart's item rows on
-- every update -- real cost and a real deadlock surface -- to permit an operation
-- nothing in the product performs.
--
-- Unconditional is also the truer statement. A cart IS its (buyer, business)
-- pair: UNIQUE (buyer_id, business_id) (033:10) means repointing one is not
-- editing a cart, it is asking for a different cart that may already exist.
-- syncServerCart creates and deletes carts and never updates one
-- (marketplaceStore.ts:127-170); no edge function updates one either. So this
-- forbids nothing that is done and nothing that has a reason to be done.
--
-- Applies to the service role too, which is the point of putting it in a trigger
-- rather than another policy. `stripe-product-webhook` holds the service key and
-- writes order rows from PaymentIntent metadata; if it ever grows a cart update,
-- it should hit this the same way the client does.
--
-- SECURITY INVOKER (the default) on purpose. The function reads no table -- only
-- OLD and NEW -- so there is nothing here for a caller's RLS to hide, and a
-- SECURITY DEFINER trigger that touches tables is how you get a policy that is
-- correct on paper and unusable in practice. No search_path pin for the same
-- reason: the body resolves no object names.
--
-- ERRCODE 23514 rather than the default P0001 so PostgREST answers 400 and not
-- 500, and so the verification script can catch it by class.
CREATE OR REPLACE FUNCTION public.carts_freeze_pairing()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.buyer_id IS DISTINCT FROM OLD.buyer_id THEN
    RAISE EXCEPTION 'carts.buyer_id is immutable (cart %)', OLD.id
      USING ERRCODE = 'check_violation',
            HINT = 'A cart belongs to the buyer it was created for. Create hers.';
  END IF;

  IF NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    RAISE EXCEPTION 'carts.business_id is immutable (cart %)', OLD.id
      USING ERRCODE = 'check_violation',
            HINT = 'The lines in this cart were checked against its current seller, and the payment destination follows it. Create a cart for the other seller.';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.carts_freeze_pairing() IS
  'Refuses any UPDATE that changes carts.buyer_id or carts.business_id. Exists because a WITH CHECK sees only the new row: cart_items_owner verifies each line against the cart''s business at INSERT, and without this the buyer simply moves the business afterwards. Unconditional rather than "only when the cart has items" -- the conditional form loses to a concurrent insert under READ COMMITTED.';

CREATE TRIGGER trg_carts_freeze_pairing
  BEFORE UPDATE ON public.carts
  FOR EACH ROW EXECUTE FUNCTION public.carts_freeze_pairing();

-- ============================================================
-- 7. A NAME FOR THE FAILURE THIS MIGRATION CAN NOW CAUSE
--
-- The composite FK above makes a mismatched (product_id, variant_id) pair
-- unrepresentable in order_items. That is the point -- but it means an
-- order_items INSERT can now be REFUSED where it previously succeeded, and the
-- one writer that does it is stripe-product-webhook, at a moment when the money
-- has already moved: the hold is marked sold, the charge is captured, the
-- transfer to the seller is made, and the orders row is written. A refusal there
-- leaves a paid order with no line items -- nothing for the seller to ship and
-- nothing for the dispute-evidence builder to describe.
--
-- The webhook now checks that insert and raises an alert instead of swallowing
-- it. `reconciliation_alerts.alert_type` is a closed CHECK, so the alert it
-- needs has to exist before the code can write one; a rejected insert followed
-- by a REJECTED ALERT ABOUT THE REJECTED INSERT would be the same defect one
-- level up.
--
-- Postgres has no ALTER ... MODIFY CHECK, so the constraint is dropped and
-- recreated with the full list. The five original values are reproduced exactly
-- from 034:75-81; adding a value must never silently drop one.
-- ============================================================

ALTER TABLE public.reconciliation_alerts
  DROP CONSTRAINT IF EXISTS reconciliation_alerts_alert_type_check;

ALTER TABLE public.reconciliation_alerts
  ADD CONSTRAINT reconciliation_alerts_alert_type_check
    CHECK (alert_type IN (
      'charge_not_in_db',
      'order_paid_no_charge',
      'refund_mismatch',
      'payout_mismatch',
      'transfer_missing',
      'order_items_missing'
    ));

COMMENT ON CONSTRAINT reconciliation_alerts_alert_type_check ON public.reconciliation_alerts IS
  'order_items_missing was added with the composite FK in 090: a paid order whose line items were refused needs a human, and it needs an alert type that the CHECK will actually accept.';
