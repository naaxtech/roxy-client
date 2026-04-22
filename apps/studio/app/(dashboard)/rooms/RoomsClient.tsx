'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RoomModal } from './RoomModal';

interface Room {
  id: string;
  name: string;
  description: string | null;
  room_type: 'video' | 'audio';
  status: 'idle' | 'live' | 'scheduled' | 'closed';
  participant_count: number;
  max_participants: number | null;
  scheduled_at: string | null;
  started_at: string | null;
  community_id: string;
  community_name: string;
}

interface Community { id: string; name: string }

interface RoomsClientProps {
  rooms: Room[];
  communities: Community[];
}

function formatDuration(startedAt: string): string {
  const mins = Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function minutesUntil(scheduledAt: string): number {
  return Math.floor((new Date(scheduledAt).getTime() - Date.now()) / 60000);
}

export function RoomsClient({ rooms: initialRooms, communities }: RoomsClientProps) {
  const router = useRouter();
  const [rooms, setRooms] = useState<Room[]>(initialRooms);
  const [showModal, setShowModal] = useState(false);
  const [editRoom, setEditRoom] = useState<Room | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Tick every 30s to re-evaluate T-15 banner and duration labels
  useEffect(() => {
    const interval = setInterval(() => setRooms(r => [...r]), 30000);
    return () => clearInterval(interval);
  }, []);

  const imminentRoom = rooms.find(
    r => r.status === 'scheduled' &&
         r.scheduled_at != null &&
         minutesUntil(r.scheduled_at) <= 15 &&
         minutesUntil(r.scheduled_at) >= 0
  );

  const goLive = async (roomId: string) => {
    setLoadingId(roomId);
    setError(null);
    const supabase = createClient();
    const { data: res } = await supabase.functions.invoke('manage-room', {
      body: { action: 'open', room_id: roomId },
    });
    setLoadingId(null);
    if (res?.data?.room_id || res?.data?.already_live) {
      router.push(`/rooms/${roomId}`);
    } else {
      setError('Failed to go live. Please try again.');
    }
  };

  const endRoom = async (roomId: string) => {
    if (!confirm('End this room for all participants?')) return;
    setLoadingId(roomId);
    const supabase = createClient();
    await supabase.functions.invoke('manage-room', {
      body: { action: 'close', room_id: roomId },
    });
    setLoadingId(null);
    setRooms(prev => prev.map(r => r.id === roomId ? { ...r, status: 'closed' } : r));
  };

  const activeRooms = rooms.filter(r => r.status !== 'closed');
  const closedRooms = rooms.filter(r => r.status === 'closed');

  return (
    <div className="space-y-6">
      {/* T-15 min banner */}
      {imminentRoom && (
        <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
          <p className="text-sm font-medium text-primary">
            <span className="font-bold">{imminentRoom.name}</span>{' '}
            starts in {minutesUntil(imminentRoom.scheduled_at!)} min
          </p>
          <Button
            size="sm"
            onClick={() => goLive(imminentRoom.id)}
            disabled={loadingId === imminentRoom.id}
          >
            {loadingId === imminentRoom.id ? 'Starting…' : 'Go Live Now'}
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Rooms</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Create and manage audio and video rooms for your communities.
          </p>
        </div>
        <Button onClick={() => { setEditRoom(null); setShowModal(true); }}>
          + Create Room
        </Button>
      </div>

      {/* Active rooms */}
      {activeRooms.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground text-sm">No active rooms.</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Create a room to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {activeRooms.map(room => {
            const isLive      = room.status === 'live';
            const isScheduled = room.status === 'scheduled';
            const minsUntil   = isScheduled && room.scheduled_at ? minutesUntil(room.scheduled_at) : null;
            const showGoLive  = room.status === 'idle' || (isScheduled && minsUntil !== null && minsUntil <= 15);

            return (
              <div
                key={room.id}
                className="flex items-center gap-4 rounded-lg border bg-card px-4 py-3"
              >
                {/* Status dot */}
                <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                  isLive      ? 'bg-green-500 animate-pulse' :
                  isScheduled ? 'bg-yellow-400' :
                                'bg-muted-foreground/30'
                }`} />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">{room.name}</span>
                    <Badge variant={isLive ? 'default' : 'secondary'} className="text-[10px] shrink-0">
                      {room.room_type === 'video' ? '🎥' : '🎤'}{' '}
                      {isLive ? 'LIVE' : isScheduled ? 'SCHEDULED' : 'IDLE'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {room.community_name}
                    {isLive && room.started_at && ` · ${formatDuration(room.started_at)}`}
                    {isScheduled && room.scheduled_at && (
                      ` · ${new Date(room.scheduled_at).toLocaleString('en-US', {
                        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                      })}`
                    )}
                  </p>
                </div>

                {/* Participant ratio */}
                {isLive && (
                  <span className="text-xs font-mono text-muted-foreground tabular-nums shrink-0">
                    {room.participant_count}{room.max_participants != null ? ` / ${room.max_participants}` : ''}
                  </span>
                )}
                {isScheduled && room.max_participants != null && (
                  <span className="text-xs font-mono text-muted-foreground shrink-0">
                    — / {room.max_participants}
                  </span>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {isLive && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => router.push(`/rooms/${room.id}`)}
                      >
                        Enter
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => endRoom(room.id)}
                        disabled={loadingId === room.id}
                      >
                        {loadingId === room.id ? '…' : 'End'}
                      </Button>
                    </>
                  )}
                  {showGoLive && (
                    <Button
                      size="sm"
                      onClick={() => goLive(room.id)}
                      disabled={loadingId === room.id}
                    >
                      {loadingId === room.id ? 'Starting…' : 'Go Live'}
                    </Button>
                  )}
                  {!isLive && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setEditRoom(room); setShowModal(true); }}
                    >
                      Edit
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Past rooms */}
      {closedRooms.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground select-none">
            Past rooms ({closedRooms.length})
          </summary>
          <div className="mt-2 space-y-2">
            {closedRooms.map(room => (
              <div
                key={room.id}
                className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-2 opacity-60"
              >
                <span className="h-2 w-2 rounded-full bg-muted-foreground/30 shrink-0" />
                <span className="text-sm truncate flex-1">{room.name}</span>
                <span className="text-xs text-muted-foreground">{room.community_name}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Create / Edit modal */}
      {showModal && (
        <RoomModal
          communities={communities}
          onClose={() => { setShowModal(false); setEditRoom(null); }}
          onCreated={() => router.refresh()}
          editRoom={editRoom ? {
            id:              editRoom.id,
            name:            editRoom.name,
            description:     editRoom.description,
            room_type:       editRoom.room_type,
            community_id:    editRoom.community_id,
            scheduled_at:    editRoom.scheduled_at,
            max_participants: editRoom.max_participants,
          } : undefined}
        />
      )}
    </div>
  );
}
