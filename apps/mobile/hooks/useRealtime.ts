import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Message } from '../types';

interface UseRealtimeOptions {
  conversationId: string;
  initialMessages: Message[];
}

interface UseRealtimeReturn {
  messages: Message[];
  isSubscribed: boolean;
  appendMessage: (msg: Message) => void;
  replaceMessageId: (tempId: string, realId: string) => void;
  removeMessage: (id: string) => void;
}

export function useRealtime({
  conversationId,
  initialMessages,
}: UseRealtimeOptions): UseRealtimeReturn {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Sync messages whenever the parent loads/reloads them (dep on reference, not conversationId)
  useEffect(() => {
    setMessages(initialMessages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessages]);

  const appendMessage = (msg: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  };

  const replaceMessageId = (tempId: string, realId: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === tempId ? { ...m, id: realId } : m))
    );
  };

  const removeMessage = (id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  };

  useEffect(() => {
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          appendMessage(payload.new as Message);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          // Flip is_read so ✓ → ✓✓ updates in realtime when partner reads
          const updated = payload.new as Message;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === updated.id ? { ...m, is_read: updated.is_read } : m
            )
          );
        }
      )
      .subscribe((status) => {
        setIsSubscribed(status === 'SUBSCRIBED');
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      setIsSubscribed(false);
    };
  }, [conversationId]);

  return { messages, isSubscribed, appendMessage, replaceMessageId, removeMessage };
}
