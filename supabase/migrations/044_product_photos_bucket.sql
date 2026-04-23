-- supabase/migrations/044_product_photos_bucket.sql
-- Create product-photos storage bucket + RLS
-- Update photo limit trigger from 5 → 4

-- Bucket (public read)
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-photos', 'product-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Public read
CREATE POLICY "product_photos_read_public" ON storage.objects
  FOR SELECT USING (bucket_id = 'product-photos');

-- Business owner upload — path must be {business_id}/{product_id}/filename
-- Use objects.name to avoid ambiguity with businesses.name in the JOIN
CREATE POLICY "product_photos_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'product-photos' AND
    EXISTS (
      SELECT 1 FROM public.businesses b
      JOIN public.products p ON p.business_id = b.id
      WHERE b.owner_id = auth.uid()
        AND b.id::text = (storage.foldername(objects.name))[1]
        AND p.id::text = (storage.foldername(objects.name))[2]
    )
  );

-- Business owner delete
CREATE POLICY "product_photos_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'product-photos' AND
    EXISTS (
      SELECT 1 FROM public.businesses b
      JOIN public.products p ON p.business_id = b.id
      WHERE b.owner_id = auth.uid()
        AND b.id::text = (storage.foldername(objects.name))[1]
        AND p.id::text = (storage.foldername(objects.name))[2]
    )
  );

-- Update photo limit: 5 → 4
CREATE OR REPLACE FUNCTION public.check_product_photo_limit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT COUNT(*) FROM public.product_photos WHERE product_id = NEW.product_id) >= 4 THEN
    RAISE EXCEPTION 'Maximum 4 photos per product';
  END IF;
  RETURN NEW;
END $$;
