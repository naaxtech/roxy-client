import { supabase, callEdgeFunction } from '../../lib/supabase';
import { logError } from '../../lib/errorLogger';

/**
 * The two writes the Archive composer sheets do DIRECTLY through RLS, rather
 * than through an edge function — reviews and content notes, mirroring
 * `archiveStore.ts`'s own split (vote / watchlist / note-agreement are all
 * direct writes; only entry create/edit go through a service-role function
 * because a member-maintained catalogue members can write straight into is
 * not moderated).
 *
 * Same discipline as `archiveStore.ts` throughout:
 *   - `currentUserId()` reads the LIVE session rather than a cached store
 *     value, because the RLS check is `author_id = auth.uid()` /
 *     `created_by = auth.uid()` and a stale id fails that check outright.
 *   - Every write ends in `.select().maybeSingle()` and treats a null `data`
 *     with no `error` as a failure. A PostgREST write answers 200 even when
 *     its policy filtered out every row it touched — `block_user` shipped
 *     that exact trap once already, telling a woman she was protected when
 *     nothing had actually happened.
 *   - Never throws. Same `{ data, error }` shape as `callEdgeFunction`, so a
 *     composer screen has one handling pattern for both an edge-function
 *     submit and a direct-RLS one.
 */

export type ActionResult<T> = { data: T | null; error: string | null };

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

const SIGN_IN_AGAIN = 'Please sign in again to continue.';
const GENERIC_REVIEW_ERROR = "We couldn't publish your review. Please try again.";
const GENERIC_NOTE_ERROR = "We couldn't add that note. Please try again.";
const NOTE_DUPLICATE_ERROR =
  'That note already exists for this title — agree with it instead of adding a duplicate.';
const APPROVED_ONLY_ERROR = 'Approved membership is required for this — try again once a mod has approved you.';

/**
 * Publish (or republish) her review.
 *
 * Upsert, not insert: `archive_reviews` has `UNIQUE (entry_id, author_id)`
 * and the composer's own footer copy says "Reviews are public and
 * editable" — resubmitting is how she fixes one, not a 23505 she has to
 * puzzle out.
 *
 * `noSpoilersAck` is a parameter, not a hardcoded `true`, so this function
 * stays honest about what it sends: the caller (the review sheet) is the
 * one place client-side that blocks submit on an unchecked box, and this
 * function must not silently paper over that being skipped.
 */
export async function submitReview(
  entryId: string,
  body: string,
  isRecommend: boolean,
  noSpoilersAck: boolean
): Promise<ActionResult<{ id: string }>> {
  const userId = await currentUserId();
  if (!userId) return { data: null, error: SIGN_IN_AGAIN };

  const { data, error } = await supabase
    .from('archive_reviews')
    .upsert(
      {
        entry_id: entryId,
        author_id: userId,
        body,
        is_recommend: isRecommend,
        no_spoilers_ack: noSpoilersAck,
      },
      { onConflict: 'entry_id,author_id' }
    )
    .select('id')
    .maybeSingle();

  if (error) {
    logError(error, 'archiveComposer.submitReview');
    if (error.code === '42501') return { data: null, error: APPROVED_ONLY_ERROR };
    return { data: null, error: GENERIC_REVIEW_ERROR };
  }
  if (!data) {
    // 200, zero rows written back — RLS's WITH CHECK silently filtered
    // rather than raising. Never keep an unconfirmed review.
    return { data: null, error: GENERIC_REVIEW_ERROR };
  }
  return { data: data as { id: string }, error: null };
}

/**
 * Add a content note.
 *
 * Plain insert, not upsert: `archive_content_notes` has
 * `UNIQUE (entry_id, label)` and a note is member-TAGGED, not member-owned —
 * there is no "her" row to update, only the community's. A duplicate label
 * means someone already tagged this; the answer is `archive_note_agreements`
 * (agree with the existing one), not a second row, so a 23505 here is
 * translated to that instruction rather than a generic failure.
 */
export async function submitContentNote(
  entryId: string,
  label: string
): Promise<ActionResult<{ id: string }>> {
  const userId = await currentUserId();
  if (!userId) return { data: null, error: SIGN_IN_AGAIN };

  const { data, error } = await supabase
    .from('archive_content_notes')
    .insert({ entry_id: entryId, label, created_by: userId })
    .select('id')
    .maybeSingle();

  if (error) {
    logError(error, 'archiveComposer.submitContentNote');
    if (error.code === '23505') return { data: null, error: NOTE_DUPLICATE_ERROR };
    if (error.code === '42501') return { data: null, error: APPROVED_ONLY_ERROR };
    return { data: null, error: GENERIC_NOTE_ERROR };
  }
  if (!data) {
    return { data: null, error: GENERIC_NOTE_ERROR };
  }
  return { data: data as { id: string }, error: null };
}

// ── The edge-function half ───────────────────────────────────────────────────
//
// Creating and editing an entry go through service-role functions rather than
// straight through RLS, because a member-maintained catalogue that members can
// write directly into is not moderated, whatever the UI says. 096 gives
// `archive_entries` no INSERT or UPDATE policy for `authenticated` at all.

const GENERIC_ENTRY_ERROR = "We couldn't send that entry to the mods. Please try again.";
const GENERIC_EDIT_ERROR = "We couldn't send that edit to the mods. Please try again.";
const EMPTY_EDIT_ERROR = 'Change something first — this edit is identical to the entry.';

/** The fields a member may propose. Mirrors the edge function's own whitelist. */
export type EntryDraft = {
  title: string;
  media_type: string;
  release_year?: number | null;
  creator?: string | null;
  length_label?: string | null;
  summary?: string | null;
};

/**
 * Propose a new entry. Lands as `archive_entries(status='pending')` plus a
 * `kind='create'` revision for the mod queue, credited to her.
 */
export async function submitEntry(draft: EntryDraft): Promise<ActionResult<{ entry_id: string }>> {
  const { data, error } = await callEdgeFunction<{ entry_id: string }>(
    'archive-submit-entry',
    draft as unknown as Record<string, unknown>
  );

  // `callEdgeFunction` returns `{data, error}` and NEVER throws, so a resolved
  // promise is not a success. A null payload with no error means the function
  // answered without creating anything — treated as failure rather than
  // reported to her as done.
  if (error) return { data: null, error };
  if (!data) return { data: null, error: GENERIC_ENTRY_ERROR };
  return { data, error: null };
}

/**
 * Propose an edit. The function diffs server-side against the live row, so what
 * is sent is a proposal rather than an assertion about the current state.
 */
export async function submitEdit(
  entryId: string,
  patch: Partial<EntryDraft>
): Promise<ActionResult<{ revision_id: string }>> {
  // An empty patch would queue a revision a mod has to open, read, and discover
  // proposes nothing. Refused here rather than spent as someone's attention.
  if (Object.keys(patch).length === 0) return { data: null, error: EMPTY_EDIT_ERROR };

  const { data, error } = await callEdgeFunction<{ revision_id: string }>(
    'archive-submit-edit',
    { entry_id: entryId, patch }
  );

  if (error) return { data: null, error };
  if (!data) return { data: null, error: GENERIC_EDIT_ERROR };
  return { data, error: null };
}
