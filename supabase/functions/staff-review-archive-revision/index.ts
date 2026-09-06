// supabase/functions/staff-review-archive-revision/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

/**
 * Staff decides a pending WLW Archive revision (create or edit).
 *
 * This is the only path that ever writes to `archive_entries` for a
 * member-proposed change -- 096_archive_rls.sql gives that table no
 * INSERT/UPDATE policy for `authenticated` at all, on purpose.
 *
 * SELF-DECISION GUARD. 071_invite_gate_scoring.sql's own comment on
 * `_apply_decision` / `decide_application` is the reason this exists: an
 * earlier draft of that RPC let the applicant decide their own application,
 * so any user could approve themselves by calling it directly. The split
 * there was schema-level (a SECURITY DEFINER function nothing but the public
 * wrapper can reach); here it is enforced in the function body, because
 * `archive_revisions` has no schema-level equivalent to call through.
 *
 * IDEMPOTENT. A second call against an already-decided revision is a no-op
 * that reports what the row actually holds -- it never re-applies a patch or
 * flips a decision, even to the same one, because two staff racing the same
 * queue must not double-apply or silently overwrite each other's call.
 *
 * `patch` IS NOT TRUSTED CONTENT. `archive_revisions_insert_approved` (096)
 * lets any approved member insert a revision row directly through PostgREST,
 * bypassing archive-submit-entry/archive-submit-edit entirely -- so `patch`
 * here is validated against the same whitelist and constraints those
 * functions apply at submission, not assumed safe because "an edge function
 * wrote it".
 */

// ── Patch validation ─────────────────────────────────────────────────────────
// Same whitelist and constraints as archive-submit-entry / archive-submit-edit
// (095_archive_core.sql's CHECKs). Duplicated rather than imported from a
// shared module because this task's scope is these three function files plus
// submit-report -- not a new _shared/archive.ts.

const MEDIA_TYPES = ['film', 'tv', 'book', 'comic', 'music'];

const EDITABLE_FIELDS = [
  'title',
  'media_type',
  'release_year',
  'creator',
  'length_label',
  'summary',
  'cover_url',
  'cover_gradient',
  'external_ids',
] as const;

type EditableField = (typeof EDITABLE_FIELDS)[number];

function validateField(field: EditableField, value: unknown): string | null {
  switch (field) {
    case 'title':
      if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 200) {
        return 'patch.title must be 1-200 characters';
      }
      return null;
    case 'media_type':
      if (typeof value !== 'string' || !MEDIA_TYPES.includes(value)) {
        return `patch.media_type must be one of: ${MEDIA_TYPES.join(', ')}`;
      }
      return null;
    case 'release_year':
      if (value === null) return null;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1800 || value > 2200) {
        return 'patch.release_year must be an integer between 1800 and 2200, or null';
      }
      return null;
    case 'creator':
    case 'length_label':
    case 'cover_url':
    case 'cover_gradient':
      if (value === null) return null;
      if (typeof value !== 'string' || value.length > 300) {
        return `patch.${field} must be a string under 300 characters, or null`;
      }
      return null;
    case 'summary':
      if (value === null) return null;
      if (typeof value !== 'string' || value.length > 400) {
        return 'patch.summary must be a string of 400 characters or fewer, or null';
      }
      return null;
    case 'external_ids':
      if (value === null) return null;
      if (typeof value !== 'object' || Array.isArray(value)) {
        return 'patch.external_ids must be a plain object';
      }
      return null;
    default:
      return null;
  }
}

type PatchResult = { fields: Record<string, unknown> } | { error: string };

/**
 * Whitelists and validates a revision's `patch` before it ever reaches an
 * UPDATE/INSERT statement. Rejects the whole patch on the first problem
 * rather than silently dropping the bad key -- a partially-applied patch that
 * looks like it succeeded is the exact class of bug this codebase has already
 * shipped once (`block_user`'s dead column).
 */
function applyPatch(patch: unknown): PatchResult {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return { error: 'Revision patch is not a valid object' };
  }
  const raw = patch as Record<string, unknown>;
  const fields: Record<string, unknown> = {};

  for (const key of Object.keys(raw)) {
    if (!(EDITABLE_FIELDS as readonly string[]).includes(key)) {
      return { error: `Revision patch contains an unrecognised field: ${key}` };
    }
    const field = key as EditableField;
    const err = validateField(field, raw[field]);
    if (err) return { error: err };
    fields[field] = raw[field];
  }

  return { fields };
}

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base.length > 0 ? base : 'entry';
}

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);
  const { userId } = auth;

  let body: { revision_id?: string; decision?: string; review_note?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }
  const { revision_id, decision, review_note } = body;
  if (!revision_id || !decision) return errorResponse('Missing revision_id or decision', 400);
  if (decision !== 'approved' && decision !== 'rejected' && decision !== 'reverted') {
    return errorResponse("decision must be 'approved', 'rejected' or 'reverted'", 400);
  }

  const supabase = getSupabaseClient();

  // Verify staff -- copied exactly from staff-approve-business/index.ts.
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_staff')
    .eq('id', userId)
    .single();
  if (!profile?.is_staff) return errorResponse('Staff access required', 403);

  const { data: revision, error: revisionErr } = await supabase
    .from('archive_revisions')
    .select('id, entry_id, submitted_by, patch, prev, kind, status, reviewed_by, reviewed_at, review_note')
    .eq('id', revision_id)
    .maybeSingle();
  if (revisionErr) return errorResponse(revisionErr.message, 500);
  if (!revision) return errorResponse('Revision not found', 404);

  // A mod may not decide her own submission. See header -- 071's lesson.
  if (revision.submitted_by === userId) {
    return errorResponse('You may not decide your own submission', 403);
  }


  // ── Revert an applied revision ────────────────────────────────────────────
  //
  // Deliberately ABOVE the idempotency guard below, which returns early for
  // any non-pending revision: a revert acts on an APPROVED one, so it would
  // otherwise be answered "already decided" and do nothing.
  //
  // 'reverted' is its own status (migration 100) rather than a reuse of
  // 'rejected'. A revision that was live and then undone is a different history
  // from one that was never applied, and this table is the Archive's audit
  // trail — collapsing the two would erase the fact that members saw the change.
  //
  // The restore runs `prev` back through the SAME whitelist as `patch`. `prev`
  // was captured by whatever wrote the revision — which, because
  // archive_revisions_insert_approved (096) lets any approved member insert one
  // directly through RLS, is not necessarily our own submit function. It is
  // untrusted for exactly the reason `patch` is.
  if (decision === 'reverted') {
    if (revision.status === 'reverted') {
      return successResponse({
        revision_id: revision.id,
        already_decided: true,
        decision: 'reverted',
        entry_id: revision.entry_id,
      });
    }
    if (revision.status !== 'approved') {
      return errorResponse(
        `Only an approved revision can be reverted; this one is ${revision.status}`,
        400
      );
    }
    if (!revision.entry_id) {
      return errorResponse('This revision has no entry to revert', 400);
    }
    if (revision.kind === 'create') {
      // Undoing a create is not a restore — there is no earlier state to put
      // back. Hiding the entry is the honest inverse, and it keeps the row and
      // any votes cast on it rather than deleting a member's work.
      const { data: hidden, error: hideErr } = await supabase
        .from('archive_entries')
        // published_at must be cleared with the status. archive_published_has_date
        // is CHECK ((status = 'published') = (published_at IS NOT NULL)), so
        // hiding a published entry while leaving its date violated the
        // constraint and 500'd — a moderator could not pull back an entry that
        // turned out to be abusive, and it stayed live.
        .update({ status: 'hidden', published_at: null, updated_at: new Date().toISOString() })
        .eq('id', revision.entry_id)
        .select('id')
        .single();
      if (hideErr || !hidden) {
        return errorResponse(hideErr?.message ?? 'Could not hide the created entry', 500);
      }
    } else {
      const restored = applyPatch(revision.prev);
      if ('error' in restored) return errorResponse(restored.error, 400);

      const { data: reverted, error: revErr } = await supabase
        .from('archive_entries')
        .update({ ...restored.fields, updated_at: new Date().toISOString() })
        .eq('id', revision.entry_id)
        .select('id')
        .single();
      if (revErr || !reverted) {
        return errorResponse(revErr?.message ?? 'Could not restore the previous values', 500);
      }
    }

    const { data: updatedRev, error: updErr } = await supabase
      .from('archive_revisions')
      .update({
        status: 'reverted',
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        review_note: review_note ?? null,
      })
      .eq('id', revision_id)
      .eq('status', 'approved') // guard against a concurrent revert
      .select('id')
      .single();
    if (updErr || !updatedRev) {
      return errorResponse(
        updErr?.message ?? 'Revision was changed by someone else just now',
        409
      );
    }

    return successResponse({
      revision_id: revision.id,
      already_decided: false,
      decision: 'reverted',
      entry_id: revision.entry_id,
    });
  }

  // Idempotent no-op: report the standing decision, change nothing.
  if (revision.status !== 'pending') {
    return successResponse({
      revision_id: revision.id,
      already_decided: true,
      decision: revision.status,
      entry_id: revision.entry_id,
      reviewed_by: revision.reviewed_by,
      reviewed_at: revision.reviewed_at,
      review_note: revision.review_note,
    });
  }

  if (decision === 'rejected') {
    const { data: updated, error: updErr } = await supabase
      .from('archive_revisions')
      .update({
        status: 'rejected',
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        review_note: review_note ?? null,
      })
      .eq('id', revision_id)
      .eq('status', 'pending') // second guard against a concurrent decision
      .select('id')
      .single();
    if (updErr || !updated) {
      return errorResponse(updErr?.message ?? 'Revision was decided by someone else just now', 409);
    }

    // A rejected create leaves its placeholder entry with nowhere to go --
    // without this it sits in 'pending' forever, invisible to everyone but
    // staff and absent from every queue that only looks at revisions.
    if (revision.kind === 'create' && revision.entry_id) {
      await supabase
        .from('archive_entries')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('id', revision.entry_id)
        .eq('status', 'pending');
    }

    return successResponse({
      revision_id: revision.id,
      already_decided: false,
      decision: 'rejected',
      entry_id: revision.entry_id,
    });
  }

  // decision === 'approved'
  const applied = applyPatch(revision.patch);
  if ('error' in applied) return errorResponse(applied.error, 422);

  let targetEntryId = revision.entry_id as string | null;

  if (targetEntryId) {
    // Normal path: archive-submit-entry (create) or archive-submit-edit
    // (edit) already created/located the row this revision targets.
    const { data: entry, error: entryErr } = await supabase
      .from('archive_entries')
      .select('id, status')
      .eq('id', targetEntryId)
      .maybeSingle();
    if (entryErr) return errorResponse(entryErr.message, 500);
    if (!entry) return errorResponse('Target entry not found', 404);

    const update: Record<string, unknown> = { ...applied.fields, updated_at: new Date().toISOString() };
    if (entry.status !== 'published') {
      update.status = 'published';
      update.published_at = new Date().toISOString();
    }

    const { data: updatedEntry, error: updEntryErr } = await supabase
      .from('archive_entries')
      .update(update)
      .eq('id', targetEntryId)
      .select('id')
      .single();
    if (updEntryErr || !updatedEntry) {
      return errorResponse(updEntryErr?.message ?? 'Could not publish the entry', 500);
    }
  } else {
    // Defensive path: a create revision inserted directly through
    // archive_revisions_insert_approved (096) with no backing entry -- see
    // header. Build the entry now from the (validated) patch.
    if (revision.kind !== 'create') {
      return errorResponse('Edit revision has no target entry', 500);
    }
    if (typeof applied.fields.title !== 'string' || typeof applied.fields.media_type !== 'string') {
      return errorResponse('Revision patch is missing title or media_type', 422);
    }

    const { data: newEntry, error: insErr } = await supabase
      .from('archive_entries')
      .insert({
        ...applied.fields,
        slug: `${slugify(applied.fields.title as string)}-${crypto.randomUUID().slice(0, 6)}`,
        status: 'published',
        published_at: new Date().toISOString(),
        created_by: revision.submitted_by,
      })
      .select('id')
      .single();
    if (insErr || !newEntry) {
      return errorResponse(insErr?.message ?? 'Could not create the entry', 500);
    }
    targetEntryId = newEntry.id as string;
  }

  const { data: updatedRevision, error: updRevErr } = await supabase
    .from('archive_revisions')
    .update({
      entry_id: targetEntryId,
      status: 'approved',
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      review_note: review_note ?? null,
    })
    .eq('id', revision_id)
    .eq('status', 'pending') // second guard against a concurrent decision
    .select('id')
    .single();
  if (updRevErr || !updatedRevision) {
    return errorResponse(
      updRevErr?.message ?? 'Revision was decided by someone else just now',
      409
    );
  }

  return successResponse({
    revision_id: revision.id,
    already_decided: false,
    decision: 'approved',
    entry_id: targetEntryId,
  });
});
