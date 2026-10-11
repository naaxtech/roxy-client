import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { freshChannel } from '../lib/realtimeChannel';
import { logError } from '../lib/errorLogger';
import type { ThreadMember, ThreadMeta } from '../lib/chatThread';

type ConvRow = {
  id: string;
  conversation_type: ThreadMeta['type'];
  title: string | null;
  avatar_emoji: string | null;
  created_by: string | null;
  participant_ids: string[] | null;
};
type MemberRow = {
  user_id: string;
  role: ThreadMember['role'];
  status: ThreadMember['status'];
  joined_at: string;
  last_read_at: string | null;
  muted_until: string | null;
};
type ProfileRow = Pick<ThreadMember, 'id' | 'display_name' | 'username' | 'avatar_url' | 'last_seen_at'>;

/**
 * Who is in this thread, and in what state (migration 132's
 * conversation_members joined to profiles).
 *
 * RLS decides what comes back: a thread with a block in it, or one she was
 * never in, returns no conversation row — `unavailable`, never a spinner.
 * Reloads on any change to this thread's member rows or the group row
 * (rename, emoji), so removals, accepted requests and renames land live.
 */
export function useThreadMeta(conversationId: string, me: string) {
  const [meta, setMeta] = useState<ThreadMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!conversationId || !me) return;
    try {
      const [convRes, memberRes] = await Promise.all([
        supabase
          .from('conversations')
          .select('id, conversation_type, title, avatar_emoji, created_by, participant_ids')
          .eq('id', conversationId)
          .maybeSingle(),
        supabase
          .from('conversation_members')
          .select('user_id, role, status, joined_at, last_read_at, muted_until')
          .eq('conversation_id', conversationId),
      ]);
      const conv = convRes.data as ConvRow | null;
      if (!conv) {
        if (alive.current) { setMeta(null); setUnavailable(true); }
        return;
      }
      const rows = ((memberRes.data ?? []) as MemberRow[]).slice();
      // A legacy thread may predate its member rows: fall back to the array.
      if (rows.length === 0) {
        for (const id of conv.participant_ids ?? []) {
          rows.push({ user_id: id, role: 'member', status: 'active', joined_at: '1970-01-01T00:00:00Z', last_read_at: null, muted_until: null });
        }
      }
      const ids = [...new Set(rows.map((r) => r.user_id))];
      const profRes = ids.length
        ? await supabase.from('profiles').select('id, display_name, username, avatar_url, last_seen_at').in('id', ids)
        : { data: [] as ProfileRow[] };
      const byId = new Map(((profRes.data ?? []) as ProfileRow[]).map((p) => [p.id, p]));
      const toMember = (r: MemberRow): ThreadMember => {
        const p = byId.get(r.user_id);
        return {
          id: r.user_id,
          display_name: p?.display_name ?? null,
          username: p?.username ?? null,
          avatar_url: p?.avatar_url ?? null,
          last_seen_at: p?.last_seen_at ?? null,
          role: r.role,
          status: r.status,
          joined_at: r.joined_at,
          muted_until: r.muted_until,
          last_read_at: r.last_read_at,
        };
      };
      rows.sort((a, b) => a.joined_at.localeCompare(b.joined_at));
      const mine = rows.find((r) => r.user_id === me);
      if (!alive.current) return;
      setMeta({
        id: conv.id,
        type: conv.conversation_type,
        title: conv.title,
        emoji: conv.avatar_emoji,
        createdBy: conv.created_by,
        me: mine ? toMember(mine) : null,
        others: rows.filter((r) => r.user_id !== me).map(toMember),
      });
      setUnavailable(false);
    } catch (e) {
      logError(e, 'useThreadMeta.load');
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [conversationId, me]);

  useEffect(() => {
    alive.current = true;
    setMeta(null);
    setLoading(true);
    setUnavailable(false);
    void load();
    if (!conversationId) return () => { alive.current = false; };
    const channel = freshChannel(`thread:${conversationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversation_members', filter: `conversation_id=eq.${conversationId}` },
        () => { void load(); },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversations', filter: `id=eq.${conversationId}` },
        () => { void load(); },
      )
      .subscribe();
    return () => {
      alive.current = false;
      void supabase.removeChannel(channel);
    };
  }, [conversationId, load]);

  return { meta, loading, unavailable, reload: load };
}
