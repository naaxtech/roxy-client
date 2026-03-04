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
}

export function useRealtime({
  conversationId,
  initialMessages,
}: UseRealtimeOptions): UseRealtimeReturn {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const appendMessage = (msg: Message) => {
    setMessages((prev) => {
      // Deduplicate by id
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
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
      .subscribe((status) => {
        setIsSubscribed(status === 'SUBSCRIBED');
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      setIsSubscribed(false);
    };
  }, [conversationId]);

  return { messages, isSubscribed, appendMessage };
}
