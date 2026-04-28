-- supabase/migrations/043_staff_product_select.sql
-- Allow staff accounts to SELECT all products regardless of status
-- (needed for the /staff/products approval queue in Studio)

CREATE POLICY "products_select_staff" ON public.products
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_staff = true
    )
  );

-- Also allow staff to UPDATE any product (for approve/reject via edge function)
-- The edge function already runs with service role, but belt-and-suspenders for direct queries
CREATE POLICY "products_update_staff" ON public.products
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_staff = true
    )
  );
