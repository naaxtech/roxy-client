-- 059: room banners — community admins upload a banner image for their room
-- cards. Public read; writes only by admins/moderators of the community that
-- owns the path prefix (<community_id>/...). Retry-safe throughout.

ALTER TABLE public.community_rooms ADD COLUMN IF NOT EXISTS banner_url text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('room-banners', 'room-banners', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "room_banners_read" ON storage.objects;
CREATE POLICY "room_banners_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'room-banners');

DROP POLICY IF EXISTS "room_banners_insert" ON storage.objects;
CREATE POLICY "room_banners_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'room-banners'
    AND EXISTS (
      SELECT 1 FROM public.community_members cm
      WHERE cm.community_id::text = (storage.foldername(name))[1]
        AND cm.user_id = auth.uid()
        AND cm.role IN ('admin', 'moderator')
    )
  );

DROP POLICY IF EXISTS "room_banners_update" ON storage.objects;
CREATE POLICY "room_banners_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'room-banners'
    AND EXISTS (
      SELECT 1 FROM public.community_members cm
      WHERE cm.community_id::text = (storage.foldername(name))[1]
        AND cm.user_id = auth.uid()
        AND cm.role IN ('admin', 'moderator')
    )
  );

DROP POLICY IF EXISTS "room_banners_delete" ON storage.objects;
CREATE POLICY "room_banners_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'room-banners'
    AND EXISTS (
      SELECT 1 FROM public.community_members cm
      WHERE cm.community_id::text = (storage.foldername(name))[1]
        AND cm.user_id = auth.uid()
        AND cm.role IN ('admin', 'moderator')
    )
  );
