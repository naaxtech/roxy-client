'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

type RoomInfo = {
  room_name: string;
  room_type: 'video' | 'audio';
  is_host: boolean;
};

type ParticipantState = {
  session_id: string;
  user_name: string;
  local: boolean;
  audio: boolean;
  video: boolean;
  is_owner: boolean;
  videoTrack: MediaStreamTrack | null;
};

// ── Participant tile ──────────────────────────────────────────────────────────
function ParticipantTile({
  participant,
  isHost,
  onKick,
  onMute,
}: {
  participant: ParticipantState;
  isHost: boolean;
  onKick: (sessionId: string) => void;
  onMute: (sessionId: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!videoRef.current || !participant.videoTrack) return;
    videoRef.current.srcObject = new MediaStream([participant.videoTrack]);
  }, [participant.videoTrack]);

  return (
    <div className="relative rounded-xl overflow-hidden bg-zinc-900 aspect-video group">
      {participant.videoTrack ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={participant.local}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
            <span className="text-2xl text-primary font-bold">
              {(participant.user_name || '?')[0].toUpperCase()}
            </span>
          </div>
        </div>
      )}

      {/* Name bar */}
      <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-black/60 flex items-center gap-1.5">
        {participant.is_owner && <span className="text-xs">👑</span>}
        {participant.local && (
          <span className="text-[10px] text-primary/80 font-semibold">You · </span>
        )}
        <span className="text-xs text-white font-medium truncate flex-1">
          {participant.user_name || 'Guest'}
        </span>
        {!participant.audio && <span className="text-[10px]">🔇</span>}
      </div>

      {/* Host controls — hover overlay */}
      {isHost && !participant.local && (
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
          <button
            onClick={() => onMute(participant.session_id)}
            className="rounded bg-black/70 px-2 py-1 text-[10px] text-white hover:bg-black/90"
          >
            Mute
          </button>
          <button
            onClick={() => onKick(participant.session_id)}
            className="rounded bg-red-800/80 px-2 py-1 text-[10px] text-white hover:bg-red-900"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

function gridClass(count: number): string {
  if (count <= 1) return 'grid-cols-1 max-w-2xl mx-auto';
  if (count <= 2) return 'grid-cols-2';
  if (count <= 4) return 'grid-cols-2';
  return 'grid-cols-3';
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function RoomSessionPage() {
  const { id: roomId } = useParams<{ id: string }>();
  const router = useRouter();

   
  const callRef = useRef<any>(null);
  const [roomInfo, setRoomInfo]       = useState<RoomInfo | null>(null);
  const [participants, setParticipants] = useState<Map<string, ParticipantState>>(new Map());
  const [micOn, setMicOn]             = useState(true);
  const [camOn, setCamOn]             = useState(true);
  const [status, setStatus]           = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [error, setError]             = useState<string | null>(null);
  const [ending, setEnding]           = useState(false);

   
  const refreshParticipants = useCallback((callObject: any) => {
    const all = callObject.participants() as Record<string, any>;
    const map = new Map<string, ParticipantState>();
    for (const p of Object.values(all)) {
      map.set(p.session_id, {
        session_id: p.session_id,
        user_name:  p.user_name ?? '',
        local:      p.local,
        audio:      p.audio,
        video:      p.video,
        is_owner:   p.owner ?? false,
        videoTrack: p.tracks?.video?.persistentTrack ?? null,
      });
    }
    setParticipants(new Map(map));
  }, []);

  useEffect(() => {
    if (!roomId) return;
     
    let callObject: any = null;

    (async () => {
      try {
        const supabase = createClient();
        const { data: res } = await supabase.functions.invoke('join-community-room', {
          body: { room_id: roomId },
        });

        const info = res?.data;
        if (!info?.room_url) {
          setError('Room is not live. Go back and click "Go Live" first.');
          setStatus('error');
          return;
        }

        setRoomInfo({
          room_name: info.room_name,
          room_type: info.room_type,
          is_host:   info.is_host,
        });

        // Lazy import — daily-js is browser-only
        const mod = await import('@daily-co/daily-js');
        const Daily = mod.default;
        callObject = Daily.createCallObject({
          audioSource: true,
          videoSource: info.room_type === 'video',
        });
        callRef.current = callObject;

        callObject.on('joined-meeting',         () => { setStatus('connected'); refreshParticipants(callObject); });
        callObject.on('participant-joined',      () => refreshParticipants(callObject));
        callObject.on('participant-left',        () => refreshParticipants(callObject));
        callObject.on('participant-updated',     () => refreshParticipants(callObject));
        callObject.on('meeting-session-stopped', () => router.push('/rooms'));
         
        callObject.on('error', (e: any) => {
          setError(e?.errorMsg ?? 'Connection error');
          setStatus('error');
        });

        await callObject.join({ url: info.room_url, token: info.token ?? undefined });
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to join room');
        setStatus('error');
      }
    })();

    return () => {
      callObject?.leave().catch(() => {});
      callObject?.destroy();
    };
  }, [roomId, refreshParticipants, router]);

  const toggleMic = () => {
    callRef.current?.setLocalAudio(!micOn);
    setMicOn(v => !v);
  };

  const toggleCam = () => {
    callRef.current?.setLocalVideo(!camOn);
    setCamOn(v => !v);
  };

  const handleMuteAll = () => {
     
    const all = (callRef.current?.participants() ?? {}) as Record<string, any>;
    for (const p of Object.values(all)) {
      if (!p.local) callRef.current?.updateParticipant(p.session_id, { setAudio: false });
    }
  };

  const handleMute = (sessionId: string) => {
    callRef.current?.updateParticipant(sessionId, { setAudio: false });
  };

  const handleKick = async (sessionId: string) => {
    if (!confirm('Remove this participant from the room?')) return;
    const supabase = createClient();
    await supabase.functions.invoke('kick-participant', {
      body: { room_id: roomId, session_id: sessionId },
    });
  };

  const handleEndRoom = async () => {
    if (!confirm('End this room for everyone?')) return;
    setEnding(true);
    const supabase = createClient();
    await supabase.functions.invoke('manage-room', {
      body: { action: 'close', room_id: roomId },
    });
    callRef.current?.leave().catch(() => {});
    router.push('/rooms');
  };

  const handleLeave = () => {
    callRef.current?.leave().catch(() => {});
    router.push('/rooms');
  };

  const participantList = Array.from(participants.values());
  const count = participantList.length;

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh] gap-4">
        <p className="text-destructive text-sm">{error ?? 'Could not join room.'}</p>
        <Button variant="outline" onClick={() => router.push('/rooms')}>
          ← Back to Rooms
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] bg-zinc-950 rounded-xl overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-900/80 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-zinc-400 hover:text-white"
            onClick={handleLeave}
          >
            ← Back
          </Button>
          <span className="text-white font-semibold text-sm">
            {roomInfo?.room_name ?? 'Connecting…'}
          </span>
          {status === 'connected' && (
            <span className="flex items-center gap-1.5 text-xs text-green-400 font-semibold">
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              LIVE
            </span>
          )}
        </div>
        <span className="text-xs text-zinc-500 font-mono">
          {count} participant{count !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Video grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {status === 'connecting' ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-zinc-500 animate-pulse text-sm">Joining room…</p>
          </div>
        ) : count === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-zinc-500 text-sm">Waiting for participants…</p>
          </div>
        ) : (
          <div className={`grid ${gridClass(count)} gap-3`}>
            {participantList.map(p => (
              <ParticipantTile
                key={p.session_id}
                participant={p}
                isHost={roomInfo?.is_host ?? false}
                onKick={handleKick}
                onMute={handleMute}
              />
            ))}
          </div>
        )}
      </div>

      {/* Control bar */}
      <div className="flex items-center justify-center gap-3 px-4 py-3 bg-zinc-900/80 border-t border-zinc-800 shrink-0">
        <button
          onClick={toggleMic}
          title={micOn ? 'Mute mic' : 'Unmute mic'}
          className={`w-11 h-11 rounded-full flex items-center justify-center text-xl transition-colors ${
            micOn ? 'bg-zinc-700 hover:bg-zinc-600' : 'bg-red-900/70 hover:bg-red-900'
          }`}
        >
          {micOn ? '🎤' : '🔇'}
        </button>

        {roomInfo?.room_type === 'video' && (
          <button
            onClick={toggleCam}
            title={camOn ? 'Turn camera off' : 'Turn camera on'}
            className={`w-11 h-11 rounded-full flex items-center justify-center text-xl transition-colors ${
              camOn ? 'bg-zinc-700 hover:bg-zinc-600' : 'bg-red-900/70 hover:bg-red-900'
            }`}
          >
            {camOn ? '📷' : '🚫'}
          </button>
        )}

        {roomInfo?.is_host && (
          <button
            onClick={handleMuteAll}
            title="Mute all participants"
            className="w-11 h-11 rounded-full bg-zinc-700 hover:bg-zinc-600 flex items-center justify-center text-lg transition-colors"
          >
            🔕
          </button>
        )}

        <button
          onClick={handleLeave}
          title="Leave room"
          className="w-11 h-11 rounded-full bg-zinc-700 hover:bg-zinc-600 flex items-center justify-center text-xl transition-colors"
        >
          🚪
        </button>

        {roomInfo?.is_host && (
          <button
            onClick={handleEndRoom}
            disabled={ending}
            className="rounded-full bg-red-700 hover:bg-red-800 px-5 h-11 text-sm font-semibold text-white transition-colors disabled:opacity-50"
          >
            {ending ? 'Ending…' : 'End Room'}
          </button>
        )}
      </div>
    </div>
  );
}
