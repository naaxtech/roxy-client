import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { MessageReaction } from '../types';

type ReactionsMap = Record<string, MessageReaction[]>; // message_id → reactions

interface UseReactionsOptions {
  conversationId: string;
  messageIds: string[];
}

interface UseReactionsReturn {
  reactionsMap: ReactionsMap;
  addReaction: (messageId: string, emoji: string, userId: string) => Promise<void>;
  removeReaction: (messageId: string, emoji: string, userId: string) => Promise<void>;
}

export function useReactions({ conversationId, messageIds }: UseReactionsOptions): UseReactionsReturn {
  const [reactionsMap, setReactionsMap] = useState<ReactionsMap>({});
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Initial load — fetch all reactions for these messages.
  // Bug fix: this used to depend on [conversationId] only. messageIds is []
  // at mount (loadMessages in the chat screen resolves asynchronously), so
  // this effect fired once, saw messageIds.length === 0, and returned —
  // then never fired again once messageIds became non-empty, since
  // conversationId hadn't changed. Pre-existing reactions from a past
  // session were never fetched; only reactions added live during the
  // current mount (via the broadcast handlers below) ever showed up.
  // Depending on messageIds.length > 0 (not messageIds itself, which would
  // refetch on every single new message) re-triggers exactly once when the
  // messages actually arrive.
  const hasMessages = messageIds.length > 0;
  useEffect(() => {
    if (!hasMessages) return;
    void (async () => {
      const { data } = await supabase
        .from('message_reactions')
        .select('*')
        .in('message_id', messageIds);
      if (!data) return;
      const map: ReactionsMap = {};
      for (const r of data as MessageReaction[]) {
        if (!map[r.message_id]) map[r.message_id] = [];
        map[r.message_id].push(r);
      }
      setReactionsMap(map);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, hasMessages]);

  // Realtime via Broadcast on reactions:${conversationId}
  useEffect(() => {
    const channel = supabase
      .channel(`reactions:${conversationId}`)
      .on('broadcast', { event: 'reaction_added' }, ({ payload }: { payload: MessageReaction }) => {
        setReactionsMap((prev) => {
          const existing = prev[payload.message_id] ?? [];
          const alreadyHas = existing.some(
            (r) => r.user_id === payload.user_id && r.emoji === payload.emoji
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
              (r) => !(r.user_id === payload.user_id && r.emoji === payload.emoji)
            ),
          };
        });
      })
      .subscribe();

    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [conversationId]);

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
      .from('message_reactions')
      .insert(reaction)
      .select()
      .single();
    if (error || !inserted) {
      // Roll back the optimistic add — the write didn't actually happen.
      setReactionsMap((prev) => ({
        ...prev,
        [messageId]: (prev[messageId] ?? []).filter(
          (r) => !(r.user_id === userId && r.emoji === emoji)
        ),
      }));
      return;
    }
    // Broadcast to other participants via the already-subscribed channel —
    // supabase.channel(...) here would create a new, never-.subscribe()d
    // instance (same anti-pattern useTyping.ts already flags for itself).
    channelRef.current?.send({
      type: 'broadcast',
      event: 'reaction_added',
      payload: inserted,
    });
  }, []);

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
      .from('message_reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .eq('emoji', emoji);
    if (error) {
      // Roll back — the delete didn't actually happen, so don't tell the
      // other participant it did.
      if (removed) {
        const restored = removed;
        setReactionsMap((prev) => ({ ...prev, [messageId]: [...(prev[messageId] ?? []), restored] }));
      }
      return;
    }
    channelRef.current?.send({
      type: 'broadcast',
      event: 'reaction_removed',
      payload: { message_id: messageId, user_id: userId, emoji },
    });
  }, []);

  return { reactionsMap, addReaction, removeReaction };
}
