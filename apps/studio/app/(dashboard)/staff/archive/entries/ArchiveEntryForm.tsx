'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  ARCHIVE_DELETE_PHRASE,
  ARCHIVE_DELETE_REASON_MIN,
  ARCHIVE_MEDIA_TYPES,
  ARCHIVE_PHOTO_MAX,
  ARCHIVE_STATUSES,
  archiveDeleteErrorMessage,
  archivePhotoErrorMessage,
  archiveSaveErrorMessage,
  canSubmitArchiveDelete,
  type ArchiveMediaType,
  type ArchiveStatus,
} from '@/lib/archiveEntry';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export type ArchivePhotoItem = {
  id: string;
  url: string;
};

export type ArchiveEntryRecord = {
  id: string;
  slug: string;
  title: string;
  media_type: ArchiveMediaType;
  release_year: number | null;
  creator: string | null;
  length_label: string | null;
  summary: string | null;
  cover_url: string | null;
  cover_gradient: string | null;
  status: ArchiveStatus;
};

interface ArchiveEntryFormProps {
  entry?: ArchiveEntryRecord;
  photos?: ArchivePhotoItem[];
}

export function ArchiveEntryForm({ entry, photos: initialPhotos = [] }: ArchiveEntryFormProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [pending, startTransition] = useTransition();

  const [title, setTitle] = useState(entry?.title ?? '');
  const [mediaType, setMediaType] = useState<ArchiveMediaType>(entry?.media_type ?? 'film');
  const [year, setYear] = useState(entry?.release_year?.toString() ?? '');
  const [creator, setCreator] = useState(entry?.creator ?? '');
  const [lengthLabel, setLengthLabel] = useState(entry?.length_label ?? '');
  const [summary, setSummary] = useState(entry?.summary ?? '');
  const [coverUrl, setCoverUrl] = useState(entry?.cover_url ?? '');
  const [coverGradient, setCoverGradient] = useState(entry?.cover_gradient ?? '');
  const [status, setStatus] = useState<ArchiveStatus>(entry?.status ?? 'published');
  const [photos, setPhotos] = useState(initialPhotos);
  const [error, setError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [dangerOpen, setDangerOpen] = useState(false);
  const [typedTitle, setTypedTitle] = useState('');
  const [phrase, setPhrase] = useState('');
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const liveTitle = entry?.title ?? '';
  const deleteReady = entry
    ? canSubmitArchiveDelete({
        typedTitle,
        liveTitle,
        phrase,
        reason,
        acknowledged,
      })
    : false;

  async function uploadFile(file: File): Promise<string> {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      throw new Error('Only JPEG, PNG and WebP files are accepted.');
    }
    if (file.size > MAX_SIZE_BYTES) {
      throw new Error('File must be under 5 MB.');
    }
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from('archive-covers')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) throw new Error(uploadError.message);
    const { data } = supabase.storage.from('archive-covers').getPublicUrl(path);
    return data.publicUrl;
  }

  function save() {
    setError(null);
    setStatusNote(null);
    const parsedYear = year.trim() ? Number(year.trim()) : null;
    startTransition(async () => {
      const { data, error: rpcError } = await supabase.rpc('staff_save_archive_entry', {
        p_id: entry?.id ?? null,
        p_title: title.trim(),
        p_media_type: mediaType,
        p_release_year: Number.isInteger(parsedYear) ? parsedYear : null,
        p_creator: creator.trim() || null,
        p_length_label: lengthLabel.trim() || null,
        p_summary: summary.trim() || null,
        p_cover_url: coverUrl.trim() || null,
        p_cover_gradient: coverGradient.trim() || null,
        p_external_ids: {},
        p_status: status,
        p_slug: entry?.slug ?? null,
      });
      if (rpcError) {
        setError(archiveSaveErrorMessage(rpcError.message));
        return;
      }
      const id = (data as string | null) ?? entry?.id;
      setStatusNote(entry ? 'Saved.' : 'Published to the Archive.');
      if (!entry && id) {
        router.push(`/staff/archive/entries/${id}`);
        router.refresh();
        return;
      }
      router.refresh();
    });
  }

  async function handleCoverFile(file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    setUploading(true);
    try {
      const url = await uploadFile(file);
      setCoverUrl(url);
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : 'Could not upload that image.');
    } finally {
      setUploading(false);
    }
  }

  async function handleExtraFile(file: File | undefined) {
    if (!file || !entry) return;
    setPhotoError(null);
    if (photos.length >= ARCHIVE_PHOTO_MAX) {
      setPhotoError(`An entry can hold at most ${ARCHIVE_PHOTO_MAX} photos.`);
      return;
    }
    setUploading(true);
    try {
      const url = await uploadFile(file);
      const { data, error: rpcError } = await supabase.rpc('staff_add_archive_photo', {
        p_entry_id: entry.id,
        p_url: url,
      });
      if (rpcError) {
        setPhotoError(archivePhotoErrorMessage(rpcError.message));
        return;
      }
      setPhotos((current) => [...current, { id: data as string, url }]);
      if (!coverUrl.trim()) setCoverUrl(url);
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : 'Could not upload that image.');
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto(photo: ArchivePhotoItem) {
    if (!entry) return;
    setPhotoError(null);
    const { error: rpcError } = await supabase.rpc('staff_remove_archive_photo', {
      p_photo_id: photo.id,
    });
    if (rpcError) {
      setPhotoError(archivePhotoErrorMessage(rpcError.message));
      return;
    }
    setPhotos((current) => current.filter((item) => item.id !== photo.id));
    if (coverUrl === photo.url) {
      const next = photos.find((item) => item.id !== photo.id);
      setCoverUrl(next?.url ?? '');
    }
  }

  async function setAsCover(photo: ArchivePhotoItem) {
    if (!entry) return;
    setPhotoError(null);
    const { error: rpcError } = await supabase.rpc('staff_set_archive_cover', {
      p_entry_id: entry.id,
      p_photo_id: photo.id,
    });
    if (rpcError) {
      setPhotoError(archivePhotoErrorMessage(rpcError.message));
      return;
    }
    setCoverUrl(photo.url);
  }

  function destroy() {
    if (!entry || !deleteReady) return;
    setDeleteError(null);
    startTransition(async () => {
      const { error: rpcError } = await supabase.rpc('staff_delete_archive_entry', {
        p_id: entry.id,
        p_confirm_title: typedTitle,
        p_confirm_phrase: phrase,
        p_reason: reason.trim(),
      });
      if (rpcError) {
        setDeleteError(archiveDeleteErrorMessage(rpcError.message));
        return;
      }
      router.push('/staff/archive/entries');
      router.refresh();
    });
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="archive-title">Title</Label>
          <Input
            id="archive-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            required
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="archive-type">Media type</Label>
            <Select
              id="archive-type"
              value={mediaType}
              onChange={(event) => setMediaType(event.target.value as ArchiveMediaType)}
            >
              {ARCHIVE_MEDIA_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type === 'tv' ? 'TV' : type[0].toUpperCase() + type.slice(1)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="archive-year">Year</Label>
            <Input
              id="archive-year"
              inputMode="numeric"
              value={year}
              onChange={(event) => setYear(event.target.value)}
              placeholder="2019"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="archive-creator">Creator</Label>
            <Input
              id="archive-creator"
              value={creator}
              onChange={(event) => setCreator(event.target.value)}
              placeholder="Director, author, artist…"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="archive-length">Length</Label>
            <Input
              id="archive-length"
              value={lengthLabel}
              onChange={(event) => setLengthLabel(event.target.value)}
              placeholder="2h 2m · 848 pages · 12 tracks"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="archive-summary">Spoiler-free description</Label>
          <Textarea
            id="archive-summary"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            maxLength={400}
            rows={5}
          />
          <p className="text-xs text-muted-foreground">{summary.length}/400</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="archive-status">Status</Label>
          <Select
            id="archive-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as ArchiveStatus)}
          >
            {ARCHIVE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {value[0].toUpperCase() + value.slice(1)}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            Hidden is reversible and keeps the record. Delete, at the bottom, is not.
          </p>
        </div>

        <div className="space-y-3">
          <Label htmlFor="archive-cover-url">Cover photo</Label>
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverUrl}
              alt=""
              className="h-40 w-28 object-cover rounded-md border"
            />
          ) : null}
          <Input
            id="archive-cover-url"
            value={coverUrl}
            onChange={(event) => setCoverUrl(event.target.value)}
            placeholder="https://…"
          />
          <div className="space-y-2">
            <Label htmlFor="archive-cover-file">Upload a cover</Label>
            <Input
              id="archive-cover-file"
              type="file"
              accept={ACCEPTED_TYPES.join(',')}
              disabled={uploading}
              onChange={(event) => void handleCoverFile(event.target.files?.[0])}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="archive-gradient">Cover gradient (fallback)</Label>
            <Input
              id="archive-gradient"
              value={coverGradient}
              onChange={(event) => setCoverGradient(event.target.value)}
              placeholder="Optional colour token the app uses when there is no photo"
            />
          </div>
        </div>

        {error && (
          <div role="alert" className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}
        {statusNote && (
          <p className="text-sm text-muted-foreground" role="status">
            {statusNote}
          </p>
        )}

        <Button type="submit" disabled={pending || title.trim().length === 0}>
          {pending ? 'Saving…' : entry ? 'Save entry' : 'Add to Archive'}
        </Button>
      </form>

      {entry && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Photos</h2>
          <p className="text-sm text-muted-foreground">
            Extra stills. The cover above is what the app leads with. You can promote any
            still to the cover.
          </p>
          {photos.length > 0 && (
            <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {photos.map((photo) => (
                <li key={photo.id} className="border rounded-lg p-2 space-y-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.url} alt="" className="h-32 w-full object-cover rounded" />
                  <div className="flex flex-col gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void setAsCover(photo)}
                      disabled={coverUrl === photo.url}
                    >
                      {coverUrl === photo.url ? 'Cover' : 'Use as cover'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void removePhoto(photo)}
                    >
                      Remove still
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-2">
            <Label htmlFor="archive-extra-file">Add a still</Label>
            <Input
              id="archive-extra-file"
              type="file"
              accept={ACCEPTED_TYPES.join(',')}
              disabled={uploading || photos.length >= ARCHIVE_PHOTO_MAX}
              onChange={(event) => void handleExtraFile(event.target.files?.[0])}
            />
          </div>
          {photoError && (
            <div role="alert" className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3">
              <p className="text-sm text-destructive">{photoError}</p>
            </div>
          )}
        </section>
      )}

      {entry && (
        <section className="border border-destructive/40 rounded-lg p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-destructive">Permanently delete</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-prose">
              Prefer <span className="font-medium">Hidden</span> above. Delete erases this entry
              and every vote, review, content note and watchlist row attached to it. That cannot
              be undone.
            </p>
          </div>
          {!dangerOpen ? (
            <Button type="button" variant="outline" onClick={() => setDangerOpen(true)}>
              I need to permanently delete this entry
            </Button>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="archive-delete-title">
                  Type the title exactly: <span className="font-medium">{liveTitle}</span>
                </Label>
                <Input
                  id="archive-delete-title"
                  value={typedTitle}
                  onChange={(event) => setTypedTitle(event.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="archive-delete-phrase">
                  Type <span className="font-mono">{ARCHIVE_DELETE_PHRASE}</span>
                </Label>
                <Input
                  id="archive-delete-phrase"
                  value={phrase}
                  onChange={(event) => setPhrase(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="archive-delete-reason">
                  Why this has to go ({ARCHIVE_DELETE_REASON_MIN}+ characters)
                </Label>
                <Textarea
                  id="archive-delete-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={3}
                />
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                <span>
                  I understand this cannot be undone, and that votes, reviews and watchlists for
                  this entry will be gone.
                </span>
              </label>
              {deleteError && (
                <div role="alert" className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3">
                  <p className="text-sm text-destructive">{deleteError}</p>
                </div>
              )}
              <Button
                type="button"
                variant="destructive"
                disabled={!deleteReady || pending}
                onClick={() => destroy()}
              >
                Delete this entry forever
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
