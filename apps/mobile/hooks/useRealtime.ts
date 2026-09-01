import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from '../lib/supabase';
import { freshChannel } from '../lib/realtimeChannel';
import { logError, logBreadcrumb } from '../lib/errorLogger';
import { Message } from '../types';

/**
 * Where a message she wrote actually is.
 *
 * `'sent'` means the server handed back a row id. It never means "the request
 * came back". A PostgREST write answers 200 for zero rows, and this app has
 * already shipped the other version once: `safetyStore.submitReport` told women
 * "Report submitted 💜" over a write that never happened. `settleSend` below is
 * the executable form of that lesson — there is no path to `'sent'` that does
 * not go through a returned id.
 */
export type DeliveryStatus = 'sending' | 'sent' | 'failed';

export type ChatMessage = Message & { deliveryStatus?: DeliveryStatus };

/** What a PostgREST insert hands back. `data` is null on a zero-row write. */
export interface SendResult {
  data?: { id?: string | null } | null;
  error?: unknown;
}

interface UseRealtimeOptions {
  conversationId: string;
  initialMessages: Message[];
  currentUserId: string;
  /** Rows per scroll-back page. */
  pageSize?: number;
}

interface UseRealtimeReturn {
  messages: ChatMessage[];
  isSubscribed: boolean;
  appendMessage: (msg: Message) => void;
  replaceMessageId: (tempId: string, realId: string) => void;
  removeMessage: (id: string) => void;
  /** Put a message on screen as explicitly in-flight, never as delivered. */
  appendOptimistic: (msg: Message) => void;
  /** The only route to `'sent'`. Returns false and marks failed on any doubt. */
  settleSend: (tempId: string, result: SendResult) => boolean;
  failMessage: (id: string) => void;
  /** Flips a failed message back to sending and returns it so it can be resent. */
  retryMessage: (id: string) => ChatMessage | null;
  /** Fetch everything inserted since the newest row we hold. Returns the count added. */
  backfill: () => Promise<number>;
  /** Fetch one page older than the oldest row we hold. Returns the count added. */
  loadOlder: () => Promise<number>;
  hasMoreOlder: boolean;
  loadingOlder: boolean;
}

const DEFAULT_PAGE_SIZE = 50;

/**
 * A resume can span a long sleep, so the catch-up window is wider than a page.
 * Anything past this and the gap is better closed by a full reload, which the
 * screen already does on mount.
 */
const BACKFILL_LIMIT = 200;

const UNSETTLED: DeliveryStatus[] = ['sending', 'failed'];

const isUnsettled = (m: ChatMessage): boolean =>
  m.deliveryStatus !== undefined && UNSETTLED.includes(m.deliveryStatus);

/** A row that came from the server is, by definition, delivered. */
const stampServer = (m: Message): ChatMessage => ({
  ...m,
  deliveryStatus: (m as ChatMessage).deliveryStatus ?? 'sent',
});

function sortChronologically(list: ChatMessage[]): ChatMessage[] {
  return [...list].sort((a, b) => {
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    if (ta !== tb) return ta - tb;
    // Deterministic tiebreak so two rows written in the same microsecond do not
    // swap places between renders and make the list jump.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Merge server rows into what is on screen, keyed by id.
 *
 * Dedup by id is what makes an inclusive page boundary safe: `lte` on the
 * cursor can never lose the rows that share the oldest timestamp, and the row
 * that straddles the seam comes back exactly once.
 */
function mergeById(existing: ChatMessage[], incoming: Message[]): ChatMessage[] {
  if (incoming.length === 0) return existing;
  const byId = new Map(existing.map((m) => [m.id, m]));
  let added = 0;
  for (const row of incoming) {
    if (byId.has(row.id)) continue;
    byId.set(row.id, stampServer(row));
    added += 1;
  }
  if (added === 0) return existing;
  return sortChronologically([...byId.values()]);
}

function newestSettledAt(list: ChatMessage[]): string | null {
  let newest: string | null = null;
  for (const m of list) {
    if (isUnsettled(m)) continue;
    if (newest === null || new Date(m.created_at).getTime() > new Date(newest).getTime()) {
      newest = m.created_at;
    }
  }
  return newest;
}

function oldestSettledAt(list: ChatMessage[]): string | null {
  let oldest: string | null = null;
  for (const m of list) {
    if (isUnsettled(m)) continue;
    if (oldest === null || new Date(m.created_at).getTime() < new Date(oldest).getTime()) {
      oldest = m.created_at;
    }
  }
  return oldest;
}

export function useRealtime({
  conversationId,
  initialMessages,
  currentUserId,
  pageSize = DEFAULT_PAGE_SIZE,
}: UseRealtimeOptions): UseRealtimeReturn {
  const [messages, setMessages] = useState<ChatMessage[]>(() => initialMessages.map(stampServer));
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [resumeToken, setResumeToken] = useState(0);

  // Callbacks fired by a socket event, a timer or an AppState change read the
  // transcript from here rather than from a closure, which would be a render
  // old by the time the event lands.
  const messagesRef = useRef<ChatMessage[]>(messages);
  const hasMoreOlderRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState ?? 'active');

  const applyMessages = useCallback((updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    setMessages((prev) => {
      const next = updater(prev);
      messagesRef.current = next;
      return next;
    });
  }, []);

  // Sync whenever the parent loads/reloads (dep on reference, not conversationId).
  // Anything still in flight or failed is carried across: a message that did not
  // send must keep saying so, not vanish on the next refresh.
  useEffect(() => {
    applyMessages((prev) => {
      const unsettled = prev.filter(isUnsettled);
      const base = initialMessages.map(stampServer);
      return unsettled.length === 0 ? base : sortChronologically([...base, ...unsettled]);
    });
    hasMoreOlderRef.current = true;
    setHasMoreOlder(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessages]);

  useEffect(() => {
    hasMoreOlderRef.current = true;
    setHasMoreOlder(true);
  }, [conversationId]);

  const appendMessage = useCallback(
    (msg: Message) => {
      applyMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, stampServer(msg)];
      });
    },
    [applyMessages],
  );

  const appendOptimistic = useCallback(
    (msg: Message) => {
      applyMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, { ...msg, deliveryStatus: 'sending' as const }];
      });
    },
    [applyMessages],
  );

  const replaceMessageId = useCallback(
    (tempId: string, realId: string) => {
      applyMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, id: realId, deliveryStatus: 'sent' } : m)),
      );
    },
    [applyMessages],
  );

  const removeMessage = useCallback(
    (id: string) => {
      applyMessages((prev) => prev.filter((m) => m.id !== id));
    },
    [applyMessages],
  );

  const failMessage = useCallback(
    (id: string) => {
      applyMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, deliveryStatus: 'failed' } : m)),
      );
    },
    [applyMessages],
  );

  const settleSend = useCallback(
    (tempId: string, result: SendResult): boolean => {
      const realId = result?.data?.id;
      if (result?.error || !realId) {
        failMessage(tempId);
        logError(
          result?.error ?? new Error('message insert returned no row'),
          'useRealtime_settleSend',
        );
        return false;
      }
      applyMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, id: realId, deliveryStatus: 'sent' } : m)),
      );
      return true;
    },
    [applyMessages, failMessage],
  );

  const retryMessage = useCallback(
    (id: string): ChatMessage | null => {
      const found = messagesRef.current.find((m) => m.id === id);
      if (!found) return null;
      const retried: ChatMessage = { ...found, deliveryStatus: 'sending' };
      applyMessages((prev) => prev.map((m) => (m.id === id ? retried : m)));
      return retried;
    },
    [applyMessages],
  );

  /**
   * Close the gap a dropped socket leaves behind.
   *
   * Postgres Changes has no replay: a channel that re-subscribes resumes from
   * "now", so every message sent while the phone slept is lost and she never
   * learns it existed. The only way to know is to ask.
   */
  const backfill = useCallback(async (): Promise<number> => {
    if (!conversationId) return 0;
    const cursor = newestSettledAt(messagesRef.current);
    try {
      const base = supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId);
      const { data, error } = await (cursor
        ? base.gt('created_at', cursor).order('created_at', { ascending: true }).limit(BACKFILL_LIMIT)
        : base.order('created_at', { ascending: false }).limit(pageSize));
      if (error) {
        logError(error, 'useRealtime_backfill');
        return 0;
      }
      const rows = (data ?? []) as Message[];
      if (rows.length === 0) return 0;
      const chronological = cursor ? rows : [...rows].reverse();
      const known = new Set(messagesRef.current.map((m) => m.id));
      const added = chronological.filter((r) => !known.has(r.id)).length;
      applyMessages((prev) => mergeById(prev, chronological));
      if (added > 0) logBreadcrumb('chat_backfill', { added: String(added) });
      return added;
    } catch (e) {
      logError(e, 'useRealtime_backfill');
      return 0;
    }
  }, [conversationId, pageSize, applyMessages]);

  /**
   * One page further back.
   *
   * The cursor is inclusive (`lte`) on purpose. Strict `lt` silently drops
   * every row sharing the boundary timestamp; inclusive plus dedup-by-id in
   * `mergeById` can only ever re-see a row, never lose one. Termination is
   * therefore keyed on "this page added nothing new", not on the row count.
   */
  const loadOlder = useCallback(async (): Promise<number> => {
    if (!conversationId || loadingOlderRef.current || !hasMoreOlderRef.current) return 0;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const cursor = oldestSettledAt(messagesRef.current);
      const base = supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId);
      const scoped = cursor ? base.lte('created_at', cursor) : base;
      const { data, error } = await scoped
        .order('created_at', { ascending: false })
        .limit(pageSize);
      if (error) {
        logError(error, 'useRealtime_loadOlder');
        return 0;
      }
      const rows = (data ?? []) as Message[];
      const known = new Set(messagesRef.current.map((m) => m.id));
      const added = rows.filter((r) => !known.has(r.id)).length;
      if (rows.length < pageSize || added === 0) {
        hasMoreOlderRef.current = false;
        setHasMoreOlder(false);
      }
      if (added === 0) return 0;
      const chronological = [...rows].reverse();
      applyMessages((prev) => mergeById(prev, chronological));
      return added;
    } catch (e) {
      logError(e, 'useRealtime_loadOlder');
      return 0;
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [conversationId, pageSize, applyMessages]);

  // Subscription. Both listeners are filtered to this one conversation — never
  // a table-wide listener (CLAUDE.md §18). `freshChannel` tears down any stale
  // channel on the same topic first: `supabase.channel()` hands back the CACHED
  // instance, and `.on()` on an already-subscribed channel throws, which on a
  // resume re-subscribe would take the whole screen down.
  useEffect(() => {
    if (!conversationId) return;
    const isResume = resumeToken > 0;

    const channel = freshChannel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const msg = payload.new as Message;
          // Skip own INSERTs — already handled optimistically via appendOptimistic
          // + settleSend. Without this, the Realtime event races with the id swap
          // and creates a duplicate.
          if (msg.sender_id === currentUserId) return;
          appendMessage(msg);
        },
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
          applyMessages((prev) =>
            prev.map((m) => (m.id === updated.id ? { ...m, is_read: updated.is_read } : m)),
          );
        },
      )
      .subscribe((status) => {
        const subscribed = status === 'SUBSCRIBED';
        setIsSubscribed(subscribed);
        // Backfill AFTER the new subscription is live, not before: anything
        // inserted between the query and the join would otherwise fall through
        // the gap between the two.
        if (subscribed && isResume) void backfill();
      });

    return () => {
      void supabase.removeChannel(channel);
      setIsSubscribed(false);
    };
  }, [conversationId, currentUserId, resumeToken, appendMessage, applyMessages, backfill]);

  // A sleeping phone drops the socket. On resume, re-subscribe (bumping the
  // token re-runs the effect above) and immediately ask for what was missed —
  // the subscribe callback asks a second time once the join lands, so a resume
  // that never reconnects still catches up and one that does has no gap.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (next !== 'active' || prev === 'active') return;
      logBreadcrumb('chat_realtime_resume');
      setResumeToken((t) => t + 1);
      void backfill();
    });
    return () => sub.remove();
  }, [backfill]);

  return {
    messages,
    isSubscribed,
    appendMessage,
    replaceMessageId,
    removeMessage,
    appendOptimistic,
    settleSend,
    failMessage,
    retryMessage,
    backfill,
    loadOlder,
    hasMoreOlder,
    loadingOlder,
  };
}
