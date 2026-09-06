'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { DailyCall } from '@daily-co/daily-js';
import { createClient } from '@/lib/supabase/client';
import { invokeFunction } from '@/lib/supabase/invokeFunction';
import { acquireCallObject, releaseCallObject } from '@/lib/daily/callObject';
import { Button } from '@/components/ui/button';

type RoomInfo = {
  room_name: string;
  room_type: 'video' | 'audio';
  is_host: boolean;
};

function friendlyJoinError(message: string | null, status?: number): string {
  if (status === 404) return 'This room no longer exists.';
  if (status === 409) return 'This room has not started yet. Go back and click "Go Live" first.';
  if (status === 410) return 'This room has ended.';
  if (status === 403) return "You don't have access to this room.";
  // 503 is the one thing only an operator can fix: join-community-room returns
  // it when DAILY_API_KEY is unset. Say so plainly rather than blaming the network.
  if (status === 503) return 'Live rooms are not configured yet. Set DAILY_API_KEY on the Supabase project.';
  if (status === 502) return 'The video service is unreachable right now. Try again in a moment.';
  if (message && /network|fetch|failed to fetch/i.test(message)) {
    return 'Network error — check your connection and try again.';
  }
  return message ?? 'Could not join room. Please try again.';
}

/** Pull a message out of whatever Daily / the runtime threw, without assuming a shape. */
function dailyErrorMessage(e: unknown): string | null {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (typeof e === 'object' && e !== null && 'errorMsg' in e) {
    const msg = (e as { errorMsg: unknown }).errorMsg;
    if (typeof msg === 'string') return msg;
  }
  return null;
}

/**
 * Turn a Daily connection failure into copy that names which distinguishable
 * thing went wrong. "Please try again" is only correct when retrying might
 * actually help — a full room, an ended room and a duplicate call object are
 * three different problems and used to render as one sentence.
 */
function connectErrorCopy(message: string | null): string {
  const reason = (message ?? '').toLowerCase();

  if (reason.includes('duplicate') && reason.includes('instance')) {
    return 'A previous call is still shutting down. Reload the page and rejoin.';
  }
  if (reason.includes('full') || reason.includes('max-participants')) {
    return 'This room is full — it has hit its participant limit.';
  }
  if (
    reason.includes('expired') || reason.includes('ended') ||
    reason.includes('not found') || reason.includes('does not exist') ||
    reason.includes('no longer')
  ) {
    return 'This room has already ended.';
  }
  if (reason.includes('permission') || reason.includes('denied') || reason.includes('not-allowed')) {
    return 'Camera and microphone access is blocked. Allow them in your browser settings and rejoin.';
  }
  if (reason.includes('network') || reason.includes('fetch') || reason.includes('connection')) {
    return 'Could not reach the video service. Check your connection and try again.';
  }
  return message ?? 'Could not join the room.';
}

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

  const callRef = useRef<DailyCall | null>(null);
  const [roomInfo, setRoomInfo]       = useState<RoomInfo | null>(null);
  const [participants, setParticipants] = useState<Map<string, ParticipantState>>(new Map());
  const [micOn, setMicOn]             = useState(true);
  const [camOn, setCamOn]             = useState(true);
  const [status, setStatus]           = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [error, setError]             = useState<string | null>(null);
  const [ending, setEnding]           = useState(false);
  const [leaving, setLeaving]         = useState(false);
  // Non-fatal errors from in-call host actions (kick/mute/end) — surfaced as a
  // dismissible inline banner, distinct from the fatal join/connect `error` above.
  const [actionError, setActionError] = useState<string | null>(null);


  const isHostRef = useRef(false);
  /** Last headcount successfully written, so repeat events don't re-write it. */
  const lastSyncedCount = useRef<number | null>(null);

  const syncCountToDb = useCallback(async (callObject: DailyCall) => {
    if (!isHostRef.current || !roomId) return;

    // `participant-updated` fires ~10x/second (every mic/camera track change),
    // and it used to drive one manage-room invocation each — a sustained flood
    // of edge-function calls per host for a number that had not moved. Only an
    // actual change in headcount is worth a write.
    const count = Object.keys(callObject.participants()).length;
    if (count === lastSyncedCount.current) return;
    lastSyncedCount.current = count;

    const supabase = createClient();
    const { error } = await invokeFunction(supabase, 'manage-room', {
      action: 'sync-count', room_id: roomId, count,
    });
    if (error) {
      // Let the next change retry, and tell the host the list is stale rather
      // than leaving them with a number they think is live. The call itself is
      // unaffected, so this is the dismissible banner, not the fatal screen.
      lastSyncedCount.current = null;
      setActionError('The participant count on the Rooms list may be out of date.');
    }
  }, [roomId]);

  const refreshParticipants = useCallback((callObject: DailyCall) => {
    const all = callObject.participants();
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
    void syncCountToDb(callObject);
  }, [syncCountToDb]);

  useEffect(() => {
    if (!roomId) {
      setError('Invalid room link.');
      setStatus('error');
      return;
    }

    let callObject: DailyCall | null = null;
    let cancelled = false;

    (async () => {
      try {
        const supabase = createClient();
        const { data: info, error: joinErr, status: joinStatus } = await invokeFunction<{
          room_url: string;
          room_name: string;
          room_type: 'video' | 'audio';
          is_host: boolean;
          token: string | null;
        }>(supabase, 'join-community-room', { room_id: roomId });

        if (joinErr || !info?.room_url) {
          setError(friendlyJoinError(joinErr, joinStatus));
          setStatus('error');
          return;
        }

        setRoomInfo({
          room_name: info.room_name,
          room_type: info.room_type,
          is_host:   info.is_host,
        });
        isHostRef.current = info.is_host;

        // One call object per page, serialised against any teardown still in
        // flight. Constructing a second over a live one throws, and that throw
        // was reaching the user as a bare "Failed to join room".
        callObject = await acquireCallObject();
        if (cancelled) {
          releaseCallObject(callObject);
          return;
        }
        callRef.current = callObject;

        const call = callObject;
        call.on('joined-meeting',          () => { setStatus('connected'); refreshParticipants(call); });
        call.on('participant-joined',      () => refreshParticipants(call));
        call.on('participant-left',        () => refreshParticipants(call));
        call.on('participant-updated',     () => refreshParticipants(call));
        // Was 'meeting-session-stopped', which is not a DailyEvent in any
        // released daily-js — the listener silently never fired, so a host
        // ending the room left everyone else sitting in a dead call. 'left-meeting'
        // is the real signal (ejected, room deleted, or room expired).
        // src: https://docs.daily.co/reference/daily-js/events/meeting-events · daily-js 0.89.1 · 2026-08-02
        call.on('left-meeting', () => {
          // Ignore the leave WE caused by unmounting; only a leave that happens
          // while this screen is live means the room actually went away.
          if (cancelled) return;
          router.push('/rooms');
        });

        call.on('error', (e) => {
          setError(connectErrorCopy(e?.errorMsg ?? null));
          setStatus('error');
        });

        await call.join({
          url: info.room_url,
          ...(info.token ? { token: info.token } : {}),
        });
      } catch (e: unknown) {
        if (cancelled) return;
        setError(connectErrorCopy(dailyErrorMessage(e)));
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      callRef.current = null;
      releaseCallObject(callObject);
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

  // Mute is a client-side-only Daily.co call, not an edge function — the meeting
  // token minted by join-community-room grants `is_owner: true` to hosts/mods,
  // which authorizes updateParticipant() on remote participants directly via
  // the Daily SDK (same as apps/mobile's DailyProvider.muteParticipant). There's
  // nothing to await, but it can throw synchronously if the session is gone.
  const handleMuteAll = () => {
    try {
      const all = (callRef.current?.participants() ?? {}) as Record<string, any>;
      for (const p of Object.values(all)) {
        if (!p.local) callRef.current?.updateParticipant(p.session_id, { setAudio: false });
      }
    } catch {
      setActionError('Could not mute all participants. Try again.');
    }
  };

  const handleMute = (sessionId: string) => {
    try {
      callRef.current?.updateParticipant(sessionId, { setAudio: false });
    } catch {
      setActionError('Could not mute that participant. Try again.');
    }
  };

  const handleKick = async (sessionId: string) => {
    if (!confirm('Remove this participant from the room?')) return;
    setActionError(null);
    const supabase = createClient();
    const { error } = await invokeFunction(supabase, 'kick-participant', {
      room_id: roomId,
      session_id: sessionId,
    });
    if (error) setActionError(`Could not remove participant: ${error}`);
  };

  const handleEndRoom = async () => {
    if (!confirm('End this room for everyone?')) return;
    setEnding(true);
    setActionError(null);
    const supabase = createClient();
    const { error } = await invokeFunction(supabase, 'manage-room', { action: 'close', room_id: roomId });
    if (error) {
      setActionError(`Could not end the room: ${error}`);
      setEnding(false);
      return;
    }
    await callRef.current?.leave().catch(() => {});
    router.push('/rooms');
  };

  const handleLeave = async () => {
    setLeaving(true);
    await callRef.current?.leave().catch(() => {});
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
            disabled={leaving}
          >
            {leaving ? 'Leaving…' : '← Back'}
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

      {/* Inline banner for non-fatal host-action failures (kick/mute/end) */}
      {actionError && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 bg-red-950/60 border-b border-red-900/50 shrink-0">
          <p className="text-xs text-red-300">{actionError}</p>
          <button
            onClick={() => setActionError(null)}
            className="text-xs text-red-300/70 hover:text-red-200 underline underline-offset-2 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

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
          disabled={leaving}
          title="Leave room"
          className="w-11 h-11 rounded-full bg-zinc-700 hover:bg-zinc-600 flex items-center justify-center text-xl transition-colors disabled:opacity-50"
        >
          {leaving ? '⏳' : '🚪'}
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
