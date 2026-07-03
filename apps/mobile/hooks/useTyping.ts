import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

interface UseTypingOptions {
  conversationId: string;
  currentUserId: string;
  partnerName: string;
}

interface UseTypingReturn {
  partnerIsTyping: boolean;
  sendTyping: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useTyping({ conversationId, currentUserId, partnerName }: UseTypingOptions): UseTypingReturn {
  const [partnerIsTyping, setPartnerIsTyping] = useState(false);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    // Capture the channel object BEFORE chaining .on().subscribe() so that
    // channelRef.current holds the RealtimeChannel, not the return of subscribe().
    const channel = supabase.channel(`typing:${conversationId}`);
    channelRef.current = channel;

    channel
      .on('broadcast', { event: 'typing' }, ({ payload }: { payload: { user_id: string } }) => {
        if (payload.user_id === currentUserId) return;
        setPartnerIsTyping(true);
        if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
        clearTimerRef.current = setTimeout(() => setPartnerIsTyping(false), 2500);
      })
      .subscribe();

    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      if (throttleRef.current) clearTimeout(throttleRef.current);
    };
  }, [conversationId, currentUserId]);

  const sendTyping = useCallback(() => {
    if (throttleRef.current || !channelRef.current) return;
    // Use the already-subscribed channel ref — NOT supabase.channel() which creates a new
    // unsubscribed instance and silently drops the broadcast.
    void channelRef.current.send({
      type: 'broadcast',
      event: 'typing',
      payload: { user_id: currentUserId },
    });
    throttleRef.current = setTimeout(() => { throttleRef.current = null; }, 1500);
  }, [currentUserId]);

  return { partnerIsTyping, sendTyping };
}
