// The push dispatcher's I/O loop, with every dependency injected so it can be
// tested without a network or a database (pushDispatch.test.ts).
//
// One run:
//   1. claim due outbox rows (claim_push_batch: SKIP LOCKED, so overlapping runs
//      never double-send)
//   2. load the notifications, recipients' enabled devices, settings, mutes and
//      blocks in a handful of set queries (not per row)
//   3. decide per row: skip (cleared / read / muted / blocked / switched off / no device)
//      or build one Expo message per device (pushCore.buildMessage)
//   4. send in chunks of 100; classify each ticket; mark rows sent / retry with
//      backoff / failed; disable tokens Expo says are dead
//   5. check receipts for rows sent > 15 minutes ago (Expo's recommended wait)

import {
  backoffSeconds,
  buildMessage,
  chunk,
  classifyTicket,
  DEFAULT_PREFS,
  type ExpoMessage,
  type ExpoTicket,
  inQuietHours,
  type PushPrefs,
  type QueuedNotification,
} from './pushCore.ts';

export const MAX_ATTEMPTS = 6;

export type OutboxRow = { id: number; notification_id: string; user_id: string; attempts: number };

export type NotificationRow = {
  id: string;
  user_id: string;
  actor_id: string | null;
  type: string;
  title: string | null;
  body: string | null;
  link_path: string | null;
  read_at: string | null;
  /** Set when she cleared it from her inbox (137). Absent before 137 is applied. */
  archived_at?: string | null;
};

export type DeviceRow = { user_id: string; token: string };

export type SettingsRow = Partial<PushPrefs> & { user_id: string; quiet_start?: string | null; quiet_end?: string | null };

export type RowUpdate = {
  id: number;
  status: 'sent' | 'skipped' | 'failed' | 'pending';
  skip_reason?: string | null;
  last_error?: string | null;
  ticket_ids?: string[];
  next_attempt_at?: string;
  sent_at?: string;
};

export interface DispatchDeps {
  claim(limit: number): Promise<OutboxRow[]>;
  notifications(ids: string[]): Promise<NotificationRow[]>;
  devices(userIds: string[]): Promise<DeviceRow[]>;
  settings(userIds: string[]): Promise<SettingsRow[]>;
  /** Pairs (recipient, actor) where the recipient muted the actor. */
  mutedPairs(pairs: { user_id: string; actor_id: string }[]): Promise<Set<string>>;
  /** Pairs (recipient, actor) blocked in either direction. */
  blockedPairs(pairs: { user_id: string; actor_id: string }[]): Promise<Set<string>>;
  actorNames(actorIds: string[]): Promise<Map<string, string>>;
  sendToExpo(messages: ExpoMessage[]): Promise<ExpoTicket[]>;
  update(rows: RowUpdate[]): Promise<void>;
  disableTokens(tokens: string[], reason: string): Promise<void>;
  now(): Date;
}

export type DispatchSummary = { claimed: number; sent: number; skipped: number; retried: number; failed: number; deadTokens: number };

export const pairKey = (user_id: string, actor_id: string) => `${user_id}:${actor_id}`;

function prefsFor(row: SettingsRow | undefined): PushPrefs {
  if (!row) return DEFAULT_PREFS;
  return {
    push_enabled: row.push_enabled ?? DEFAULT_PREFS.push_enabled,
    messages: row.messages ?? DEFAULT_PREFS.messages,
    friends: row.friends ?? DEFAULT_PREFS.friends,
    events: row.events ?? DEFAULT_PREFS.events,
    community_chats: row.community_chats ?? DEFAULT_PREFS.community_chats,
    membership: row.membership ?? DEFAULT_PREFS.membership,
    show_previews: row.show_previews ?? DEFAULT_PREFS.show_previews,
    quiet_start: row.quiet_start ?? null,
    quiet_end: row.quiet_end ?? null,
    timezone: row.timezone ?? 'UTC',
  };
}

export async function dispatchOnce(deps: DispatchDeps, limit = 500): Promise<DispatchSummary> {
  const summary: DispatchSummary = { claimed: 0, sent: 0, skipped: 0, retried: 0, failed: 0, deadTokens: 0 };
  const claimed = await deps.claim(limit);
  summary.claimed = claimed.length;
  if (!claimed.length) return summary;

  const notes = new Map((await deps.notifications(claimed.map((r) => r.notification_id))).map((n) => [n.id, n]));
  const userIds = [...new Set(claimed.map((r) => r.user_id))];
  const [devices, settings] = await Promise.all([deps.devices(userIds), deps.settings(userIds)]);
  const devicesByUser = new Map<string, string[]>();
  for (const d of devices) devicesByUser.set(d.user_id, [...(devicesByUser.get(d.user_id) ?? []), d.token]);
  const settingsByUser = new Map(settings.map((s) => [s.user_id, s]));

  const pairs = [...notes.values()]
    .filter((n) => n.actor_id)
    .map((n) => ({ user_id: n.user_id, actor_id: n.actor_id as string }));
  const [muted, blocked, names] = await Promise.all([
    deps.mutedPairs(pairs),
    deps.blockedPairs(pairs),
    deps.actorNames([...new Set(pairs.map((p) => p.actor_id))]),
  ]);

  const updates: RowUpdate[] = [];
  const outgoing: { rowId: number; message: ExpoMessage }[] = [];
  const now = deps.now();

  for (const row of claimed) {
    const n = notes.get(row.notification_id);
    const skip = (reason: string) => {
      updates.push({ id: row.id, status: 'skipped', skip_reason: reason });
      summary.skipped++;
    };
    if (!n) { skip('notification-gone'); continue; }
    // Cleared before it went out (a retry, or a slow wake): she has already dealt with it.
    if (n.archived_at) { skip('archived'); continue; }
    if (n.read_at) { skip('already-read'); continue; }
    if (n.actor_id && blocked.has(pairKey(n.user_id, n.actor_id))) { skip('blocked'); continue; }
    if (n.actor_id && muted.has(pairKey(n.user_id, n.actor_id))) { skip('muted'); continue; }
    const tokens = devicesByUser.get(n.user_id) ?? [];
    if (!tokens.length) { skip('no-device'); continue; }

    const prefs = prefsFor(settingsByUser.get(n.user_id));
    const quiet = inQuietHours(prefs, now);
    const queued: QueuedNotification = { ...n, actor_name: n.actor_id ? names.get(n.actor_id) ?? null : null };
    const messages = tokens
      .map((t) => buildMessage(queued, prefs, t, quiet))
      .filter((m): m is ExpoMessage => m !== null);
    if (!messages.length) { skip('preference-off'); continue; }
    for (const message of messages) outgoing.push({ rowId: row.id, message });
  }

  // Send, then fold every device's ticket back onto its outbox row.
  const perRow = new Map<number, { tickets: string[]; retry: boolean; error: string | null }>();
  const dead: string[] = [];
  for (const batch of chunk(outgoing, 100)) {
    let tickets: ExpoTicket[];
    try {
      tickets = await deps.sendToExpo(batch.map((o) => o.message));
    } catch (e) {
      tickets = [];
      const msg = e instanceof Error ? e.message : String(e);
      for (const o of batch) {
        const s = perRow.get(o.rowId) ?? { tickets: [], retry: false, error: null };
        s.retry = true; s.error = msg.slice(0, 300);
        perRow.set(o.rowId, s);
      }
      continue;
    }
    batch.forEach((o, i) => {
      const s = perRow.get(o.rowId) ?? { tickets: [], retry: false, error: null };
      const outcome = classifyTicket(tickets[i]);
      if (outcome.kind === 'sent') s.tickets.push(outcome.ticketId);
      else if (outcome.kind === 'dead-token') dead.push(o.message.to);
      else if (outcome.kind === 'retry') { s.retry = true; s.error = tickets[i]?.details?.error ?? tickets[i]?.message ?? 'no ticket'; }
      else s.error = outcome.error;
      perRow.set(o.rowId, s);
    });
  }

  const attemptsById = new Map(claimed.map((r) => [r.id, r.attempts]));
  for (const [rowId, s] of perRow) {
    if (s.tickets.length) {
      // At least one of her devices took it: done. A second device that needs
      // a retry is not worth a duplicate on the first.
      updates.push({ id: rowId, status: 'sent', ticket_ids: s.tickets, sent_at: now.toISOString(), last_error: s.error });
      summary.sent++;
    } else if (s.retry && (attemptsById.get(rowId) ?? MAX_ATTEMPTS) < MAX_ATTEMPTS) {
      const wait = backoffSeconds(attemptsById.get(rowId) ?? 1);
      updates.push({ id: rowId, status: 'pending', last_error: s.error, next_attempt_at: new Date(now.getTime() + wait * 1000).toISOString() });
      summary.retried++;
    } else if (s.error === null && !s.retry) {
      // Every device was dead.
      updates.push({ id: rowId, status: 'skipped', skip_reason: 'no-live-device' });
      summary.skipped++;
    } else {
      updates.push({ id: rowId, status: 'failed', last_error: s.error });
      summary.failed++;
    }
  }

  if (dead.length) {
    await deps.disableTokens([...new Set(dead)], 'DeviceNotRegistered');
    summary.deadTokens = new Set(dead).size;
  }
  if (updates.length) await deps.update(updates);
  return summary;
}
