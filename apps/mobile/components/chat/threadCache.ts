import type { Message } from '../../types';

/**
 * In-session memory of the newest page of each DM / group thread (motion
 * spec F7: a second visit shows content in the first frame, no loader).
 *
 * Memory only, never persisted: decision P2 keeps Messages out of any
 * cold-start cache, and nothing private is written to disk. Keyed by the
 * signed-in member; a different member signing in wipes it. Only rows the
 * server holds are kept (a message still sending or failed lives in the
 * thread's own state, not here). Bounded: newest page per thread, at most
 * THREAD_CACHE_MAX_THREADS threads, least recently written dropped first.
 */
export const THREAD_CACHE_MAX_THREADS = 20;
const DEFAULT_PAGE = 50;

type Row = Message & { deliveryStatus?: 'sending' | 'sent' | 'failed' };

let owner: string | null = null;
const pages = new Map<string, Message[]>();

export function readThreadPage(me: string, conversationId: string): Message[] | null {
  if (!me || owner !== me) return null;
  return pages.get(conversationId) ?? null;
}

export function writeThreadPage(
  me: string,
  conversationId: string,
  rows: readonly Row[],
  pageSize: number = DEFAULT_PAGE,
): void {
  if (!me || !conversationId) return;
  if (owner !== me) {
    pages.clear();
    owner = me;
  }
  const settled = rows.filter((m) => m.deliveryStatus !== 'sending' && m.deliveryStatus !== 'failed');
  // Re-insert so Map order is least → most recently written.
  pages.delete(conversationId);
  pages.set(conversationId, settled.slice(-pageSize));
  while (pages.size > THREAD_CACHE_MAX_THREADS) {
    const oldest = pages.keys().next().value;
    if (oldest === undefined) break;
    pages.delete(oldest);
  }
}

export function clearThreadCache(): void {
  pages.clear();
  owner = null;
}
