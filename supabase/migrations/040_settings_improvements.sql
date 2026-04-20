-- supabase/migrations/040_settings_improvements.sql
-- Adds contact details + social fields to businesses.
-- Creates business-logos public storage bucket with owner-scoped RLS.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS contact_email  text,
  ADD COLUMN IF NOT EXISTS phone          text,
  ADD COLUMN IF NOT EXISTS tiktok_handle  text,
  ADD COLUMN IF NOT EXISTS facebook_url   text;

-- business-logos bucket (public read, owner write)
INSERT INTO storage.buckets (id, name, public)
VALUES ('business-logos', 'business-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Anyone can read logos (public CDN)
CREATE POLICY "business_logos_read_public"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'business-logos');

-- Authenticated user can upload/update to their own folder
CREATE POLICY "business_logos_upload_own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'business-logos' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "business_logos_update_own"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'business-logos' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "business_logos_delete_own"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'business-logos' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );
