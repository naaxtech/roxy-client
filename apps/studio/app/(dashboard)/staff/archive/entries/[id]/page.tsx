import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isMissingTable } from '@/lib/schema-availability';
import { ArchiveEntryForm, type ArchiveEntryRecord, type ArchivePhotoItem } from '../ArchiveEntryForm';
import type { ArchiveMediaType, ArchiveStatus } from '@/lib/archiveEntry';

export const dynamic = 'force-dynamic';

export default async function EditArchiveEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) notFound();

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_staff')
    .eq('id', userId)
    .single();
  if (!profile?.is_staff) notFound();

  const { data: entry, error } = await supabase
    .from('archive_entries')
    .select(
      'id, slug, title, media_type, release_year, creator, length_label, summary, cover_url, cover_gradient, status',
    )
    .eq('id', id)
    .maybeSingle();

  if (isMissingTable(error) || !entry) notFound();

  const photos = await supabase
    .from('archive_entry_photos')
    .select('id, url')
    .eq('entry_id', id)
    .order('position', { ascending: true });

  const record = entry as ArchiveEntryRecord;
  const photoRows = (isMissingTable(photos.error) ? [] : (photos.data ?? [])) as ArchivePhotoItem[];

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/staff/archive/entries" className="hover:underline">
            Archive entries
          </Link>
        </p>
        <h1 className="text-2xl font-bold mt-1">{record.title}</h1>
        <p className="text-muted-foreground mt-1 max-w-prose">
          Edit every field. Hide if you only need it off the app. Delete only when the row
          itself should not exist.
        </p>
        <p className="text-xs text-muted-foreground mt-2 font-mono">{record.slug}</p>
      </div>
      <ArchiveEntryForm
        entry={{
          ...record,
          media_type: record.media_type as ArchiveMediaType,
          status: record.status as ArchiveStatus,
        }}
        photos={photoRows}
      />
    </div>
  );
}
