import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { callEdgeFunction } from '../../lib/supabase';
import { logError } from '../../lib/errorLogger';
import type { RailStatus } from './Rail';

export type LiveRoomRow = {
  id: string;
  name: string;
  participant_count: number;
  community_name: string | null;
  room_type: 'video' | 'audio';
};

export type EventRow = {
  id: string;
  title: string;
  starts_at: string;
  event_type: 'online' | 'in_person' | 'hybrid';
  location_text: string | null;
  is_paid: boolean;
  price_cents: number | null;
  community_name: string | null;
};

export type GameRow = {
  id: string;
  name: string;
  short_description: string;
  category: string;
  publisher_type: 'roxy' | 'community';
  url: string | null;
};

export type ImpactRow = {
  id: string;
  title: string;
  category: string;
  supporter_count: number;
  status: string;
};

export type SupportRow = {
  id: string;
  title: string;
  vote_count: number;
  type: 'planned' | 'pitched';
};

/**
 * One loader per rail, each with its own status.
 *
 * Deliberately not a single `Promise.all` behind one status flag: seven rails
 * sharing one spinner means a slow `feature-vote` edge function holds up the
 * events rail that already has its data, and one failure blanks a screen where
 * six of seven things worked. Each rail loads, fails and retries on its own.
 */
type Rail<T> = { rows: T[]; status: RailStatus; reload: () => void };

function useRail<T>(loader: () => Promise<T[] | null>, deps: unknown[]): Rail<T> {
  const [rows, setRows] = useState<T[]>([]);
  const [status, setStatus] = useState<RailStatus>('loading');

  const run = useCallback(async () => {
    setStatus('loading');
    const result = await loader();
    // State before logging, always — a throwing logger must never leave a rail
    // spinning. See `lib/errorLogger.ts`.
    if (result === null) { setStatus('error'); return; }
    setRows(result);
    setStatus('ready');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { void run(); }, [run]);

  return { rows, status, reload: () => void run() };
}

export function useLiveRooms(): Rail<LiveRoomRow> {
  return useRail<LiveRoomRow>(async () => {
    const { data, error } = await supabase
      .from('community_rooms')
      .select('id, name, participant_count, room_type, communities(name)')
      .eq('is_active', true)
      .eq('status', 'live')
      .order('participant_count', { ascending: false })
      .limit(10);
    if (error) { logError(error, 'discover.liveRooms'); return null; }
    return (data ?? []).map((r) => {
      const raw = r as unknown as {
        id: string; name: string; participant_count: number | null;
        room_type: 'video' | 'audio'; communities: { name: string } | null;
      };
      return {
        id: raw.id,
        name: raw.name,
        participant_count: raw.participant_count ?? 0,
        room_type: raw.room_type,
        community_name: raw.communities?.name ?? null,
      };
    });
  }, []);
}

export function useEvents(): Rail<EventRow> {
  return useRail<EventRow>(async () => {
    const { data, error } = await supabase
      .from('events')
      .select('id, title, starts_at, event_type, location_text, is_paid, price_cents, communities(name)')
      .eq('status', 'active')
      .gte('starts_at', new Date().toISOString())
      .order('starts_at')
      .limit(20);
    if (error) { logError(error, 'discover.events'); return null; }
    return (data ?? []).map((r) => {
      const raw = r as unknown as {
        id: string; title: string; starts_at: string;
        event_type: 'online' | 'in_person' | 'hybrid' | null;
        location_text: string | null; is_paid: boolean | null;
        price_cents: number | null; communities: { name: string } | null;
      };
      return {
        id: raw.id,
        title: raw.title,
        starts_at: raw.starts_at,
        // The column is NOT NULL with a default, but a null here would silently
        // drop the event from both filters — so an unknown type is in-person,
        // the answer that keeps it visible.
        event_type: raw.event_type ?? 'in_person',
        location_text: raw.location_text,
        is_paid: raw.is_paid ?? false,
        price_cents: raw.price_cents,
        community_name: raw.communities?.name ?? null,
      };
    });
  }, []);
}

export function useGames(): Rail<GameRow> {
  return useRail<GameRow>(async () => {
    const { data, error } = await supabase
      .from('games')
      .select('id, name, short_description, category, publisher_type, url')
      .eq('publisher_type', 'roxy')
      .order('name')
      .limit(12);
    if (error) { logError(error, 'discover.games'); return null; }
    return (data ?? []) as GameRow[];
  }, []);
}

export function useImpact(): Rail<ImpactRow> {
  return useRail<ImpactRow>(async () => {
    const { data, error } = await supabase
      .from('impact_projects')
      .select('id, title, category, supporter_count, status')
      .order('status')
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) { logError(error, 'discover.impact'); return null; }
    return (data ?? []) as ImpactRow[];
  }, []);
}

export function useSupport(): Rail<SupportRow> {
  return useRail<SupportRow>(async () => {
    const { data, error } = await callEdgeFunction<{ features: SupportRow[] }>(
      'feature-vote',
      { action: 'list' },
    );
    // callEdgeFunction returns {data, error} and never throws — checking the
    // envelope is the only way to know this failed.
    if (error || !data) { logError(new Error(error ?? 'no features'), 'discover.support'); return null; }
    return data.features ?? [];
  }, []);
}
