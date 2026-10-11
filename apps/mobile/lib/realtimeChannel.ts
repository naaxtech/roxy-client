import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

/**
 * Realtime channels that survive a quick leave-and-return (CHAT-08).
 *
 * `supabase.channel(topic)` hands back the CACHED channel while one with that
 * topic is still registered — and `removeChannel()` is asynchronous: the
 * channel stays registered until the server acknowledges the leave. Re-entering
 * a chat (or resuming the app) inside that window got the dying channel back;
 * `.on()` either threw or bound to a channel that was about to close, and the
 * screen went quietly deaf.
 *
 *  - postgres_changes: the topic name is only a label (the filter does the
 *    routing), so every subscription gets a UNIQUE topic. No cache hit is
 *    possible, so nothing can be reused mid-teardown.
 *  - broadcast (typing, reactions): the topic IS the room — every member has
 *    to join the same name. Those wait for any stale channel on the topic to
 *    finish leaving before joining again, and join PRIVATE: migration 132's
 *    realtime.messages policies admit members of the thread only (CHAT-15).
 */

let sequence = 0;

/** `base` plus a per-process unique suffix. */
export function uniqueTopic(base: string): string {
  sequence += 1;
  return `${base}:${Date.now().toString(36)}-${sequence}`;
}

/** A brand-new channel for postgres_changes. Never a cached one. */
export function freshChannel(topic: string): RealtimeChannel {
  return supabase.channel(uniqueTopic(topic));
}

function registeredOn(topic: string): RealtimeChannel[] {
  const all = (supabase.getChannels?.() ?? []) as RealtimeChannel[];
  return all.filter((ch) => ch.topic === `realtime:${topic}`);
}

/**
 * Join a shared, private broadcast room once any stale channel on it is gone.
 *
 * `setup` receives the new channel to bind handlers on and subscribe. Returns a
 * close function; calling it before the join happened cancels the join.
 * When nothing stale is registered the join is synchronous.
 */
export function openBroadcastChannel(
  topic: string,
  setup: (channel: RealtimeChannel) => void,
): () => void {
  let closed = false;
  let channel: RealtimeChannel | null = null;

  const join = () => {
    if (closed) return;
    channel = supabase.channel(topic, { config: { private: true, broadcast: { self: false } } });
    setup(channel);
  };

  const stale = registeredOn(topic);
  if (stale.length === 0) {
    join();
  } else {
    void Promise.all(
      stale.map((ch) => Promise.resolve(supabase.removeChannel(ch)).catch(() => 'error')),
    ).then(join);
  }

  return () => {
    closed = true;
    if (channel) void Promise.resolve(supabase.removeChannel(channel)).catch(() => {});
    channel = null;
  };
}

/**
 * Private topic names, as authorised by realtime_conversation_topic_ok()
 * (DMs/groups: conv:) and realtime_channel_topic_ok() (community channels:
 * chan:, CHAT-17). Both are members-only on the server.
 */
export type RealtimeScope = 'conversation' | 'channel';
const prefix = (scope: RealtimeScope) => (scope === 'channel' ? 'chan' : 'conv');
export const typingTopic = (id: string, scope: RealtimeScope = 'conversation') => `${prefix(scope)}:${id}:typing`;
export const reactionsTopic = (id: string, scope: RealtimeScope = 'conversation') => `${prefix(scope)}:${id}:reactions`;
