// GDPR export assembler (PRO-03): her own rows, every one of them, and nothing else.
//
// Pure apart from the two injected readers, so the rules are unit-tested
// (gdprExport.test.ts) and the edge function (gdpr-export/index.ts) is only
// plumbing. The service-role client bypasses RLS, so scoping is enforced HERE:
// every section names the column that holds her id, and the reader is always
// called with an `eq` on it. A section that cannot name such a column does not
// belong in the export.
//
// What is deliberately NOT included (disclosed in `withheld`):
// - Messages she RECEIVED. Their words belong to the sender, and the sender's
//   own export carries them. Her copy of a conversation is readable in the app.
// - Internal safety assessments and the reviewer audit log (Art. 15(4):
//   releasing them would identify the reviewer).
// - Who she reported. A report row names another member; she gets the fact,
//   reason and status of her reports, not the reported person's id.

export type Filter = { col: string; op: 'eq'; value: string };

/** Reads one page (inclusive range) of `table`, newest first where a time column exists. */
export type PageFn = (
  table: string,
  columns: string,
  filters: Filter[],
  from: number,
  to: number,
) => Promise<{ data: Record<string, unknown>[] | null; error: { code?: string; message: string } | null }>;

/** The invite-gate record, from the export_gate_data RPC. */
export type GateFn = () => Promise<unknown>;

type Section = {
  /** Path in the output, dot-separated: 'archive.votes'. */
  key: string;
  table: string;
  /** Explicit list: never '*', so a new internal column never leaks by default. */
  columns: string;
  /** The column that holds HER id. */
  owner: string;
  /** One row (profile, settings) rather than a list. */
  single?: boolean;
};

export const EXPORT_SECTIONS: readonly Section[] = [
  {
    key: 'profile', table: 'profiles', owner: 'id', single: true,
    columns: 'id, username, display_name, bio, avatar_url, pronouns, identity_labels, interests, ' +
      'is_dating_mode, dating_looking_for, age_min_pref, age_max_pref, location_city, location_country, ' +
      'is_ghost, dm_permission, theme_preference, behavioural_consent, streak_count, gamification_points, ' +
      'vetting_status, admitted_at, created_at, updated_at',
  },
  { key: 'profile_photos', table: 'profile_photos', owner: 'user_id', columns: 'id, photo_url, sort_order, created_at' },
  { key: 'profile_prompts', table: 'profile_prompts', owner: 'user_id', columns: 'prompt_key, answer, updated_at' },
  {
    key: 'posts', table: 'posts', owner: 'author_id',
    columns: 'id, community_id, post_type, content, media_urls, video_url, video_thumbnail_url, post_tags, ' +
      'like_count, comment_count, created_at, updated_at, deleted_at',
  },
  { key: 'comments', table: 'comments', owner: 'author_id', columns: 'id, post_id, parent_id, content, media_url, gif_url, created_at, deleted_at' },
  { key: 'messages_sent', table: 'messages', owner: 'sender_id', columns: 'id, conversation_id, message_type, content, media_url, created_at' },
  { key: 'reactions.post_likes', table: 'post_likes', owner: 'user_id', columns: 'post_id, created_at' },
  { key: 'reactions.post_saves', table: 'post_saves', owner: 'user_id', columns: 'post_id, created_at' },
  { key: 'reactions.comment_likes', table: 'comment_likes', owner: 'user_id', columns: 'comment_id, created_at' },
  { key: 'hidden_posts', table: 'hidden_posts', owner: 'user_id', columns: 'post_id, reason, created_at' },
  { key: 'connections.following', table: 'follows', owner: 'follower_id', columns: 'followed_id, created_at' },
  { key: 'connections.followers', table: 'follows', owner: 'followed_id', columns: 'follower_id, created_at' },
  { key: 'connections.friend_requests_sent', table: 'friendships', owner: 'requester_id', columns: 'addressee_id, status, created_at' },
  { key: 'connections.friend_requests_received', table: 'friendships', owner: 'addressee_id', columns: 'requester_id, status, created_at' },
  { key: 'connections.muted', table: 'mutes', owner: 'user_id', columns: 'muted_user_id, created_at' },
  { key: 'communities', table: 'community_members', owner: 'user_id', columns: 'community_id, role, joined_at' },
  { key: 'archive.votes', table: 'archive_votes', owner: 'profile_id', columns: 'entry_id, stars, value, created_at, updated_at' },
  { key: 'archive.reviews', table: 'archive_reviews', owner: 'author_id', columns: 'id, entry_id, body, is_recommend, status, helpful_count, created_at, updated_at' },
  { key: 'archive.watchlist', table: 'archive_watchlist', owner: 'profile_id', columns: 'entry_id, created_at' },
  { key: 'archive.note_agreements', table: 'archive_note_agreements', owner: 'profile_id', columns: 'note_id, created_at' },
  { key: 'archive.notes_written', table: 'archive_content_notes', owner: 'created_by', columns: 'id, entry_id, label, status, created_at' },
  { key: 'archive.helpful_marks', table: 'archive_review_helpful', owner: 'profile_id', columns: 'review_id, created_at' },
  { key: 'archive.suggestions', table: 'archive_revisions', owner: 'submitted_by', columns: 'id, entry_id, kind, patch, status, review_note, created_at, reviewed_at' },
  { key: 'archive.shelf', table: 'archive_shelf', owner: 'profile_id', columns: 'slot, entry_id, updated_at' },
  {
    key: 'notification_settings', table: 'notification_settings', owner: 'user_id', single: true,
    columns: 'push_enabled, messages, friends, events, community_chats, activity, show_previews, quiet_start, quiet_end, timezone, updated_at',
  },
  { key: 'reports_made', table: 'reports', owner: 'reporter_id', columns: 'content_type, reason, detail, status, created_at' },
  { key: 'feedback', table: 'app_feedback', owner: 'user_id', columns: 'category, rating, message, created_at' },
];

const PAGE = 1000;
/** Postgres "undefined_table" / PostgREST "relation not in schema cache". */
const MISSING = new Set(['42P01', 'PGRST205']);

class ExportReadError extends Error {}

async function readAll(page: PageFn, s: Section, userId: string): Promise<Record<string, unknown>[] | 'missing'> {
  const out: Record<string, unknown>[] = [];
  const filters: Filter[] = [{ col: s.owner, op: 'eq', value: userId }];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(s.table, s.columns, filters, from, from + PAGE - 1);
    if (error) {
      if (error.code && MISSING.has(error.code)) return 'missing';
      // Never a silently partial file: the caller answers 500 and she retries.
      throw new ExportReadError(`${s.table}: ${error.message}`);
    }
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE || s.single) return out;
  }
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts.slice(0, -1)) {
    if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

/** Her complete export. Throws when any read fails (never a partial file). */
export async function assembleExport(
  userId: string,
  page: PageFn,
  gate: GateFn,
  now: Date = new Date(),
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {
    format: 'roxy-data-export/2',
    generated_at: now.toISOString(),
    user_id: userId,
  };
  const notAvailable: string[] = [];
  const summary: Record<string, number> = {};

  for (const s of EXPORT_SECTIONS) {
    const rows = await readAll(page, s, userId);
    if (rows === 'missing') {
      notAvailable.push(s.table);
      setPath(out, s.key, s.single ? null : []);
      continue;
    }
    setPath(out, s.key, s.single ? (rows[0] ?? null) : rows);
    if (!s.single) summary[s.key === 'messages_sent' ? 'messages' : s.key] = rows.length;
  }

  out.summary = summary;
  // The invite-gate record: legal name, answers, verification outcomes,
  // appeals, processors. None of it is visible anywhere in the app.
  out.membership = (await gate()) ?? null;
  out.withheld = [
    'internal_safety_assessment',
    'reviewer_access_log',
    'messages_received (the sender\'s words; readable in the app, and in the sender\'s own export)',
    'reported_member_ids (a report names another member)',
  ];
  if (notAvailable.length) out.not_available = notAvailable;
  return out;
}
