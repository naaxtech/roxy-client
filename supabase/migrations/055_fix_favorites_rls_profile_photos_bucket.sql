-- Fix user_favorites SELECT RLS: was owner-only, breaks rendering on other users' profiles
-- Fix: profile-photos storage bucket for ProfilePhotoGrid (was incorrectly using avatars bucket)

-- 1. Fix user_favorites SELECT — allow any authenticated user to view any user's favourites
DROP POLICY IF EXISTS "user_favorites_select" ON public.user_favorites;
CREATE POLICY "user_favorites_select" ON public.user_favorites
  FOR SELECT TO authenticated USING (true);

-- 2. Create dedicated profile-photos storage bucket (separate from avatars)
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-photos', 'profile-photos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "profile_photos_storage_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'profile-photos');

CREATE POLICY "profile_photos_storage_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'profile-photos' AND
    auth.uid()::text = (storage.foldername(objects.name))[1]
  );

CREATE POLICY "profile_photos_storage_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'profile-photos' AND
    auth.uid()::text = (storage.foldername(objects.name))[1]
  );
