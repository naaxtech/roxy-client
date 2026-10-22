/**
 * In-session memory of event screens she opened (motion spec F7: a second
 * visit shows the poster in the first frame, no skeleton, no seal jump).
 *
 * Memory only, never persisted. Keyed by the signed-in member (her ticket
 * code is hers alone); another member signing in wipes it. Bounded to
 * EVENT_CACHE_MAX events, least recently written dropped first.
 */
export const EVENT_CACHE_MAX = 20;

export interface EventMemory<E> {
  event: E;
  ticketCode: string | null;
}

let owner: string | null = null;
const events = new Map<string, EventMemory<unknown>>();

export function readEventMemory<E>(me: string, eventId: string): EventMemory<E> | null {
  if (!me || owner !== me) return null;
  return (events.get(eventId) as EventMemory<E> | undefined) ?? null;
}

export function writeEventMemory<E>(me: string, eventId: string, memory: EventMemory<E>): void {
  if (!me || !eventId) return;
  if (owner !== me) {
    events.clear();
    owner = me;
  }
  events.delete(eventId);
  events.set(eventId, memory);
  while (events.size > EVENT_CACHE_MAX) {
    const oldest = events.keys().next().value;
    if (oldest === undefined) break;
    events.delete(oldest);
  }
}

export function clearEventCache(): void {
  events.clear();
  owner = null;
}
