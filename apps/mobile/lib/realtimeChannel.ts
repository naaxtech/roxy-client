import { supabase } from './supabase';

/**
 * supabase.channel(topic) returns the CACHED channel when one with the same
 * topic already exists — and calling .on() on an already-subscribed channel
 * throws ("cannot add postgres_changes callbacks after subscribe()"), which
 * crashes the whole component tree on remount. Always create screen-level
 * channels through this helper: it tears down any stale channel with the
 * same topic first, so effects are remount-safe.
 */
export function freshChannel(topic: string) {
  for (const ch of supabase.getChannels()) {
    if (ch.topic === `realtime:${topic}`) {
      void supabase.removeChannel(ch);
    }
  }
  return supabase.channel(topic);
}
