import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';

interface UseTypingOptions {
  conversationId: string;
  currentUserId: string;
  partnerName: string;
}

interface UseTypingReturn {
  partnerIsTyping: boolean;
  sendTyping: () => void;
  stopTyping: () => void;
}

/** How long a "typing" broadcast stands before it expires on its own. */
const STALE_AFTER_MS = 2500;
/** How often a keystroke stream is allowed to put a broadcast on the wire. */
const THROTTLE_MS = 1500;

type TypingPayload = { user_id: string; typing?: boolean };

/**
 * The typing indicator, and the four ways it used to get stuck.
 *
 * A stuck "typing…" is worse than no indicator at all: it says someone is
 * mid-sentence to you when they have closed the app, and she waits for a reply
 * that was never being written. The 2500ms expiry was the only thing clearing
 * it, so every case below left the indicator lit for as long as the screen
 * stayed open:
 *
 *  - **No stop signal.** The sender broadcast only "I am typing". Putting the
 *    phone down, or sending the message, said nothing — the indicator simply
 *    aged out. `typing: false` is now an explicit event, and `stopTyping()`
 *    is the caller's way to send it on submit or on blur.
 *  - **Switching threads carried it across.** `partnerIsTyping` is React state
 *    keyed to nothing; changing `conversationId` tore down the old channel — so
 *    no clear event could ever arrive for it — while the flag stayed true. It
 *    is reset when the conversation changes.
 *  - **Backgrounding.** Her app going to sleep left the other side watching a
 *    frozen indicator. Background now clears her own view AND tells the other
 *    side she stopped, because she has.
 *  - **Returning to the foreground reused a dead socket.** A phone that slept
 *    long enough has a closed connection; the old channel object stays in the
 *    ref looking healthy and every later broadcast goes nowhere. Coming back
 *    tears the channel down and subscribes a fresh one.
 *
 * Broadcast, not Postgres Changes — typing is ephemeral and must never be a
 * row (CLAUDE.md §18).
 */
export function useTyping({
  conversationId,
  currentUserId,
  partnerName: _partnerName,
}: UseTypingOptions): UseTypingReturn {
  const [partnerIsTyping, setPartnerIsTyping] = useState(false);
  // Bumped when the app returns to the foreground, which re-runs the effect and
  // therefore replaces the channel. A socket that slept is not a socket.
  const [subscribeKey, setSubscribeKey] = useState(0);

  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const releaseThrottle = useCallback(() => {
    if (throttleRef.current) clearTimeout(throttleRef.current);
    throttleRef.current = null;
  }, []);

  const broadcast = useCallback((typing: boolean) => {
    // The already-subscribed channel from the ref, never a fresh
    // supabase.channel() — a new instance is unsubscribed and drops the send.
    if (!channelRef.current) return;
    void channelRef.current.send({
      type: 'broadcast',
      event: 'typing',
      payload: { user_id: currentUserId, typing },
    });
  }, [currentUserId]);

  useEffect(() => {
    // Leaving a thread must not carry its indicator into the next one. The old
    // channel is gone with the old conversation, so no clear event can ever
    // arrive to turn this off by itself.
    setPartnerIsTyping(false);

    const channel = supabase.channel(`typing:${conversationId}`);
    channelRef.current = channel;

    channel
      .on('broadcast', { event: 'typing' }, ({ payload }: { payload: TypingPayload }) => {
        if (payload.user_id === currentUserId) return;

        // An explicit stop clears immediately. Absent flag means "typing",
        // which keeps an older client that never sends the field working.
        if (payload.typing === false) {
          if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
          clearTimerRef.current = null;
          setPartnerIsTyping(false);
          return;
        }

        setPartnerIsTyping(true);
        if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
        clearTimerRef.current = setTimeout(() => setPartnerIsTyping(false), STALE_AFTER_MS);
      })
      .subscribe();

    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      if (throttleRef.current) clearTimeout(throttleRef.current);
      clearTimerRef.current = null;
      throttleRef.current = null;
    };
  }, [conversationId, currentUserId, subscribeKey]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        // Re-subscribe rather than trusting a socket that slept.
        setSubscribeKey((k) => k + 1);
        return;
      }
      // background or inactive: she has stopped, so say so and stop showing
      // the other side as mid-sentence.
      broadcast(false);
      releaseThrottle();
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
      setPartnerIsTyping(false);
    });
    return () => sub.remove();
  }, [broadcast, releaseThrottle]);

  const sendTyping = useCallback(() => {
    if (throttleRef.current) return;
    broadcast(true);
    throttleRef.current = setTimeout(() => { throttleRef.current = null; }, THROTTLE_MS);
  }, [broadcast]);

  /**
   * Say she stopped — on submit, on blur, on leaving the screen.
   *
   * It also releases the throttle. Without that, stopping and starting again
   * inside the 1500ms window would swallow the next keystroke's broadcast, and
   * the other side would see nothing until the throttle happened to expire.
   */
  const stopTyping = useCallback(() => {
    releaseThrottle();
    broadcast(false);
  }, [broadcast, releaseThrottle]);

  return { partnerIsTyping, sendTyping, stopTyping };
}
