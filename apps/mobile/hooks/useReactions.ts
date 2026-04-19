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

  // Initial load — fetch all reactions for these messages
  useEffect(() => {
    if (messageIds.length === 0) return;
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
  }, [conversationId]); // re-fetch when conversation changes

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
    const { data: inserted } = await supabase
      .from('message_reactions')
      .insert(reaction)
      .select()
      .single();
    // Broadcast to other participants
    if (inserted) {
      await supabase.channel(`reactions:${conversationId}`).send({
        type: 'broadcast',
        event: 'reaction_added',
        payload: inserted,
      });
    }
  }, [conversationId]);

  const removeReaction = useCallback(async (messageId: string, emoji: string, userId: string) => {
    // Optimistic update
    setReactionsMap((prev) => ({
      ...prev,
      [messageId]: (prev[messageId] ?? []).filter(
        (r) => !(r.user_id === userId && r.emoji === emoji)
      ),
    }));
    // DB delete
    await supabase
      .from('message_reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .eq('emoji', emoji);
    // Broadcast
    await supabase.channel(`reactions:${conversationId}`).send({
      type: 'broadcast',
      event: 'reaction_removed',
      payload: { message_id: messageId, user_id: userId, emoji },
    });
  }, [conversationId]);

  return { reactionsMap, addReaction, removeReaction };
}
