import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { openBroadcastChannel, typingTopic, type RealtimeScope } from '../lib/realtimeChannel';

interface UseTypingOptions {
  /** The conversation id, or the community channel id when scope is 'channel'. */
  conversationId: string;
  /** 'channel' = community channel typing on chan:<id>:typing (CHAT-17). */
  scope?: RealtimeScope;
  currentUserId: string;
  /** Kept for call-site compatibility (DM header name). */
  partnerName: string;
  /** Her own display name, sent so a group can say WHO is typing. */
  selfName?: string;
}

interface UseTypingReturn {
  /** Anyone else typing right now. */
  partnerIsTyping: boolean;
  /** Names of everyone else typing (groups), in the order they started. */
  typingNames: string[];
  sendTyping: () => void;
  stopTyping: () => void;
}

/** How long a "typing" broadcast stands before it expires on its own. */
const STALE_AFTER_MS = 2500;
/** How often a keystroke stream is allowed to put a broadcast on the wire. */
const THROTTLE_MS = 1500;

type TypingPayload = { user_id: string; typing?: boolean; name?: string };

/**
 * The typing indicator, and the four ways it used to get stuck.
 *
 * A stuck "typing…" is worse than no indicator at all: it says someone is
 * mid-sentence to you when they have closed the app, and she waits for a reply
 * that was never being written. The 2500ms expiry was the only thing clearing
 * it, so every case below left the indicator lit for as long as the screen
 * stayed open:
 *
 *  - **No stop signal.** The sender broadcast only "I am typing". `typing:
 *    false` is now an explicit event, and `stopTyping()` sends it on submit or
 *    on blur.
 *  - **Switching threads carried it across.** The typers are reset when the
 *    conversation changes.
 *  - **Backgrounding.** Background clears her own view AND tells the other
 *    side she stopped, because she has.
 *  - **Returning to the foreground reused a dead socket.** Coming back tears
 *    the channel down and joins a fresh one — after the old one has finished
 *    leaving (CHAT-08), or the client hands back the dying cached channel.
 *
 * Private topic `conv:<id>:typing` (CHAT-15): migration 132 admits members of
 * the thread only. Broadcast, not Postgres Changes — typing is ephemeral and
 * must never be a row (CLAUDE.md §18). Each typer has her own expiry, so in a
 * group one woman stopping does not hide another who is still writing.
 */
export function useTyping({
  conversationId,
  scope = 'conversation',
  currentUserId,
  partnerName: _partnerName,
  selfName,
}: UseTypingOptions): UseTypingReturn {
  const [typers, setTypers] = useState<{ id: string; name: string }[]>([]);
  // Bumped when the app returns to the foreground, which re-runs the effect and
  // therefore replaces the channel. A socket that slept is not a socket.
  const [subscribeKey, setSubscribeKey] = useState(0);

  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const selfNameRef = useRef(selfName);
  selfNameRef.current = selfName;

  const releaseThrottle = useCallback(() => {
    if (throttleRef.current) clearTimeout(throttleRef.current);
    throttleRef.current = null;
  }, []);

  const clearAllTypers = useCallback(() => {
    for (const t of timersRef.current.values()) clearTimeout(t);
    timersRef.current.clear();
    setTypers([]);
  }, []);

  const dropTyper = useCallback((id: string) => {
    const t = timersRef.current.get(id);
    if (t) clearTimeout(t);
    timersRef.current.delete(id);
    setTypers((prev) => (prev.some((x) => x.id === id) ? prev.filter((x) => x.id !== id) : prev));
  }, []);

  const broadcast = useCallback((typing: boolean) => {
    // The already-subscribed channel from the ref, never a fresh
    // supabase.channel() — a new instance is unsubscribed and drops the send.
    if (!channelRef.current) return;
    const payload: TypingPayload = { user_id: currentUserId, typing };
    if (typing && selfNameRef.current) payload.name = selfNameRef.current;
    void channelRef.current.send({ type: 'broadcast', event: 'typing', payload });
  }, [currentUserId]);

  useEffect(() => {
    // Leaving a thread must not carry its indicator into the next one.
    clearAllTypers();
    if (!conversationId) return undefined;

    const close = openBroadcastChannel(typingTopic(conversationId, scope), (channel) => {
      channelRef.current = channel;
      channel
        .on('broadcast', { event: 'typing' }, ({ payload }: { payload: TypingPayload }) => {
          if (!payload?.user_id || payload.user_id === currentUserId) return;

          // An explicit stop clears immediately. Absent flag means "typing",
          // which keeps an older client that never sends the field working.
          if (payload.typing === false) {
            dropTyper(payload.user_id);
            return;
          }

          const id = payload.user_id;
          const name = payload.name || 'Someone';
          setTypers((prev) => (prev.some((x) => x.id === id)
            ? prev.map((x) => (x.id === id ? { id, name } : x))
            : [...prev, { id, name }]));
          const old = timersRef.current.get(id);
          if (old) clearTimeout(old);
          timersRef.current.set(id, setTimeout(() => dropTyper(id), STALE_AFTER_MS));
        })
        .subscribe();
    });

    return () => {
      channelRef.current = null;
      close();
      for (const t of timersRef.current.values()) clearTimeout(t);
      timersRef.current.clear();
      if (throttleRef.current) clearTimeout(throttleRef.current);
      throttleRef.current = null;
    };
  }, [conversationId, scope, currentUserId, subscribeKey, clearAllTypers, dropTyper]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        // Re-subscribe rather than trusting a socket that slept.
        setSubscribeKey((k) => k + 1);
        return;
      }
      // background or inactive: she has stopped, so say so and stop showing
      // anyone as mid-sentence.
      broadcast(false);
      releaseThrottle();
      clearAllTypers();
    });
    return () => sub.remove();
  }, [broadcast, releaseThrottle, clearAllTypers]);

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

  return {
    partnerIsTyping: typers.length > 0,
    typingNames: typers.map((t) => t.name),
    sendTyping,
    stopTyping,
  };
}
