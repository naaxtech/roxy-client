'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createClient } from '@/lib/supabase/client';

interface Community { id: string; name: string }

interface RoomModalProps {
  communities: Community[];
  onClose: () => void;
  onCreated: (roomId: string) => void;
  editRoom?: {
    id: string;
    name: string;
    description: string | null;
    room_type: 'video' | 'audio';
    community_id: string;
    scheduled_at: string | null;
    max_participants: number | null;
    banner_url?: string | null;
  };
}

export function RoomModal({ communities, onClose, onCreated, editRoom }: RoomModalProps) {
  const isEdit = !!editRoom;

  const [name, setName]         = useState(editRoom?.name ?? '');
  const [description, setDesc]  = useState(editRoom?.description ?? '');
  const [roomType, setRoomType] = useState<'video' | 'audio'>(editRoom?.room_type ?? 'video');
  const [communityId, setCommunityId] = useState(editRoom?.community_id ?? communities[0]?.id ?? '');
  const [scheduleEnabled, setScheduleEnabled] = useState(!!editRoom?.scheduled_at);
  const [scheduledAt, setScheduledAt] = useState(
    editRoom?.scheduled_at
      ? new Date(editRoom.scheduled_at).toISOString().slice(0, 16)
      : ''
  );
  const [maxParticipants, setMaxParticipants] = useState(
    editRoom?.max_participants?.toString() ?? ''
  );
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(editRoom?.banner_url ?? null);

  const handleBannerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (file && file.size > 3 * 1024 * 1024) {
      setError('Banner must be under 3MB');
      return;
    }
    setError(null);
    setBannerFile(file);
    setBannerPreview(file ? URL.createObjectURL(file) : editRoom?.banner_url ?? null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required'); return; }
    if (!communityId)  { setError('Select a community'); return; }

    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { data: res } = await supabase.functions.invoke('manage-room', {
      body: {
        action:           isEdit ? 'update' : 'create',
        room_id:          isEdit ? editRoom!.id : undefined,
        community_id:     isEdit ? undefined : communityId,
        name:             name.trim(),
        description:      description.trim() || null,
        room_type:        roomType,
        scheduled_at:     scheduleEnabled && scheduledAt
                            ? new Date(scheduledAt).toISOString()
                            : null,
        max_participants: maxParticipants ? parseInt(maxParticipants, 10) : null,
      },
    });

    const roomId = res?.data?.room_id ?? editRoom?.id;
    if (!roomId && !res?.data?.updated) {
      setLoading(false);
      setError('Failed to save room. Please try again.');
      return;
    }

    // Banner upload — path is <community_id>/<room_id> so the storage RLS
    // (migration 059) can verify admin/moderator membership.
    const finalRoomId = roomId ?? editRoom!.id;
    const bannerCommunityId = isEdit ? editRoom!.community_id : communityId;
    if (bannerFile && bannerCommunityId) {
      const path = `${bannerCommunityId}/${finalRoomId}`;
      const { error: uploadError } = await supabase.storage
        .from('room-banners')
        .upload(path, bannerFile, { upsert: true, contentType: bannerFile.type });
      if (uploadError) {
        setLoading(false);
        setError(`Room saved, but the banner upload failed: ${uploadError.message}`);
        return;
      }
      const { data: pub } = supabase.storage.from('room-banners').getPublicUrl(path);
      const { error: updateError } = await supabase
        .from('community_rooms')
        .update({ banner_url: `${pub.publicUrl}?v=${Date.now()}` })
        .eq('id', finalRoomId);
      if (updateError) {
        setLoading(false);
        setError('Room saved, but the banner could not be attached. Try again.');
        return;
      }
    }

    setLoading(false);
    onCreated(finalRoomId);
    onClose();
  };

  const modal = (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        className="bg-card border rounded-xl p-6 w-full max-w-md space-y-4 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">{isEdit ? 'Edit Room' : 'Create Room'}</h2>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="space-y-1.5">
          <Label htmlFor="room-name">Room name</Label>
          <Input id="room-name" value={name} onChange={e => setName(e.target.value)} required />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="room-desc">Description (optional)</Label>
          <Textarea
            id="room-desc"
            value={description}
            onChange={e => setDesc(e.target.value)}
            rows={2}
            className="resize-none"
          />
        </div>

        {!isEdit && (
          <div className="space-y-1.5">
            <Label htmlFor="community">Community</Label>
            <select
              id="community"
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
              value={communityId}
              onChange={e => setCommunityId(e.target.value)}
            >
              {communities.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Room type</Label>
          <div className="flex gap-3">
            {(['video', 'audio'] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setRoomType(t)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  roomType === t
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/50'
                }`}
              >
                {t === 'video' ? '🎥 Video' : '🎤 Audio'}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="schedule"
              checked={scheduleEnabled}
              onChange={e => setScheduleEnabled(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="schedule">Schedule for later</Label>
          </div>
          {scheduleEnabled && (
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
            />
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="room-banner">Card banner (optional — shown on the room card in the app)</Label>
          {bannerPreview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={bannerPreview}
              alt="Room banner preview"
              className="h-24 w-full rounded-lg object-cover border"
            />
          )}
          <Input
            id="room-banner"
            type="file"
            accept="image/*"
            onChange={handleBannerChange}
            className="cursor-pointer"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cap">Capacity (optional — blank = no limit)</Label>
          <Input
            id="cap"
            type="number"
            min="2"
            max="150"
            placeholder="e.g. 20"
            value={maxParticipants}
            onChange={e => setMaxParticipants(e.target.value)}
          />
        </div>

        <div className="flex gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button type="submit" disabled={loading} className="flex-1">
            {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Room'}
          </Button>
        </div>
      </form>
    </div>
  );

  return createPortal(modal, document.body);
}
