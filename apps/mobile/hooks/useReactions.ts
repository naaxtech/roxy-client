import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { openBroadcastChannel, reactionsTopic, type RealtimeScope } from '../lib/realtimeChannel';
import { MessageReaction } from '../types';

type ReactionsMap = Record<string, MessageReaction[]>; // message_id → reactions

interface UseReactionsOptions {
  /** The conversation id, or the community channel id when scope is 'channel'. */
  conversationId: string;
  /** 'channel' = community channel (CHAT-17): community_channel_reactions + chan: topic. */
  scope?: RealtimeScope;
  messageIds: string[];
}

interface UseReactionsReturn {
  reactionsMap: ReactionsMap;
  addReaction: (messageId: string, emoji: string, userId: string) => Promise<void>;
  removeReaction: (messageId: string, emoji: string, userId: string) => Promise<void>;
}

/**
 * Reactions on chat messages.
 *
 * Writes go to `message_reactions` (RLS: only on a message she can read —
 * CHAT-15). Other phones hear about them on the PRIVATE broadcast topic
 * `conv:<id>:reactions`, which migration 132 admits members of the thread to
 * and nobody else; the old public `reactions:<id>` topic let anyone with a
 * conversation id broadcast fake reactions into it.
 */
export function useReactions({ conversationId, scope = 'conversation', messageIds }: UseReactionsOptions): UseReactionsReturn {
  const table = scope === 'channel' ? 'community_channel_reactions' : 'message_reactions';
  const [reactionsMap, setReactionsMap] = useState<ReactionsMap>({});
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Initial load — fetch all reactions for these messages.
  // Bug fix: this used to depend on [conversationId] only. messageIds is []
  // at mount (loadMessages in the chat screen resolves asynchronously), so
  // this effect fired once, saw messageIds.length === 0, and returned —
  // then never fired again once messageIds became non-empty, since
  // conversationId hadn't changed. Depending on the COUNT (not messageIds
  // itself, which is a new array every render) refetches when an older page
  // or a new message adds rows.
  const idCount = messageIds.length;
  useEffect(() => {
    if (idCount === 0) return;
    const ids = messageIds.filter((id) => !id.startsWith('roxy-'));
    if (ids.length === 0) return;
    void (async () => {
      // A failed read (offline, an old mock) leaves the chips as they were;
      // it must never surface as an unhandled rejection on the chat screen.
      let data: unknown[] | null = null;
      try {
        ({ data } = await supabase
          .from(table)
          .select('*')
          .in('message_id', ids));
      } catch {
        return;
      }
      if (!data) return;
      const map: ReactionsMap = {};
      for (const r of data as MessageReaction[]) {
        if (!map[r.message_id]) map[r.message_id] = [];
        map[r.message_id].push(r);
      }
      setReactionsMap(map);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, table, idCount > 0, Math.floor(idCount / 25)]);

  // Realtime via private Broadcast on conv:<id>:reactions
  useEffect(() => {
    if (!conversationId) return undefined;
    const close = openBroadcastChannel(reactionsTopic(conversationId, scope), (channel) => {
      channelRef.current = channel;
      channel
        .on('broadcast', { event: 'reaction_added' }, ({ payload }: { payload: MessageReaction }) => {
          setReactionsMap((prev) => {
            const existing = prev[payload.message_id] ?? [];
            const alreadyHas = existing.some(
              (r) => r.user_id === payload.user_id && r.emoji === payload.emoji,
            );
            if (alreadyHas) return prev;
            return { ...prev, [payload.message_id]: [...existing, payload] };
          });
        })
        .on('broadcast', { event: 'reaction_removed' }, ({ payload }: { payload: { message_id: string; user_id: string; emoji: string } }) => {
          setReactionsMap((prev) => {
            const existing = prev[payload.message_id] ?? [];
            return {
              ...prev,
              [payload.message_id]: existing.filter(
                (r) => !(r.user_id === payload.user_id && r.emoji === payload.emoji),
              ),
            };
          });
        })
        .subscribe();
    });

    return () => {
      channelRef.current = null;
      close();
    };
  }, [conversationId, scope]);

  const addReaction = useCallback(async (messageId: string, emoji: string, userId: string) => {
    const reaction = { message_id: messageId, user_id: userId, emoji };
    // Optimistic update
    const optimistic: MessageReaction = {
      ...reaction,
      id: `tmp-${Date.now()}`,
      created_at: new Date().toISOString(),
    };
    setReactionsMap((prev) => {
      const existing = prev[messageId] ?? [];
      if (existing.some((r) => r.user_id === userId && r.emoji === emoji)) return prev;
      return { ...prev, [messageId]: [...existing, optimistic] };
    });
    // DB insert
    const { data: inserted, error } = await supabase
      .from(table)
      .insert(reaction)
      .select()
      .single();
    if (error || !inserted) {
      // Roll back the optimistic add — the write didn't actually happen.
      setReactionsMap((prev) => ({
        ...prev,
        [messageId]: (prev[messageId] ?? []).filter(
          (r) => !(r.user_id === userId && r.emoji === emoji),
        ),
      }));
      return;
    }
    // Broadcast to other members via the already-subscribed channel —
    // supabase.channel(...) here would create a new, never-.subscribe()d
    // instance (same anti-pattern useTyping.ts already flags for itself).
    void channelRef.current?.send({
      type: 'broadcast',
      event: 'reaction_added',
      payload: inserted,
    });
  }, [table]);

  const removeReaction = useCallback(async (messageId: string, emoji: string, userId: string) => {
    // Capture the exact removed reaction (if any) via the updater so a
    // rollback doesn't depend on a possibly-stale outer `reactionsMap`.
    let removed: MessageReaction | undefined;
    setReactionsMap((prev) => {
      const existing = prev[messageId] ?? [];
      removed = existing.find((r) => r.user_id === userId && r.emoji === emoji);
      return {
        ...prev,
        [messageId]: existing.filter((r) => !(r.user_id === userId && r.emoji === emoji)),
      };
    });
    // DB delete
    const { error } = await supabase
      .from(table)
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .eq('emoji', emoji);
    if (error) {
      // Roll back — the delete didn't actually happen, so don't tell the
      // other members it did.
      if (removed) {
        const restored = removed;
        setReactionsMap((prev) => ({ ...prev, [messageId]: [...(prev[messageId] ?? []), restored] }));
      }
      return;
    }
    void channelRef.current?.send({
      type: 'broadcast',
      event: 'reaction_removed',
      payload: { message_id: messageId, user_id: userId, emoji },
    });
  }, [table]);

  return { reactionsMap, addReaction, removeReaction };
}
