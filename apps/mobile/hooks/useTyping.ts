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
    const channel = supabase
      .channel(`typing:${conversationId}`)
      .on('broadcast', { event: 'typing' }, ({ payload }: { payload: { user_id: string } }) => {
        if (payload.user_id === currentUserId) return;
        setPartnerIsTyping(true);
        if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
        clearTimerRef.current = setTimeout(() => setPartnerIsTyping(false), 2500);
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      if (throttleRef.current) clearTimeout(throttleRef.current);
    };
  }, [conversationId, currentUserId]);

  const sendTyping = useCallback(() => {
    if (throttleRef.current) return;
    void supabase.channel(`typing:${conversationId}`).send({
      type: 'broadcast',
      event: 'typing',
      payload: { user_id: currentUserId },
    });
    throttleRef.current = setTimeout(() => { throttleRef.current = null; }, 1500);
  }, [conversationId, currentUserId]);

  return { partnerIsTyping, sendTyping };
}
