-- Undoes 113_staff_manage_archive_entries.sql.

drop function if exists public.staff_delete_archive_entry(uuid, text, text, text);
drop function if exists public.staff_set_archive_cover(uuid, uuid);
drop function if exists public.staff_remove_archive_photo(uuid);
drop function if exists public.staff_add_archive_photo(uuid, text);
drop function if exists public.staff_save_archive_entry(
  uuid, text, public.archive_media_type, integer, text, text, text, text, text, jsonb, public.archive_status, text
);
drop function if exists public.archive_slugify(text);

drop policy if exists archive_covers_read on storage.objects;
drop policy if exists archive_covers_insert on storage.objects;
drop policy if exists archive_covers_update on storage.objects;
drop policy if exists archive_covers_delete on storage.objects;

drop policy if exists aep_read_published on public.archive_entry_photos;
drop table if exists public.archive_entry_photos;

drop policy if exists aec_read_staff on public.archive_entry_changes;
drop table if exists public.archive_entry_changes;
