// supabase/functions/archive-submit-edit/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { consumeRateLimit } from '../_shared/rateLimit.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

/**
 * Propose an edit to an existing, published WLW Archive entry.
 *
 * Never mutates `archive_entries` -- 096_archive_rls.sql gives that table no
 * UPDATE policy for `authenticated` at all, and this function does not use
 * one either. It only ever writes a new `archive_revisions` row (kind='edit').
 * staff-review-archive-revision is the only path that ever writes to
 * archive_entries.
 *
 * The diff happens HERE, server-side, against the row this function itself
 * just read -- not against whatever the caller claims the row looked like.
 * `patch` is only the fields that actually differ from the live row; `prev` is
 * the live row's values for exactly those fields, at the moment this was
 * proposed. Together they are what makes a revert possible later and a stale
 * patch (the entry changed again before a mod got to this one) detectable --
 * see 095_archive_core.sql's header on `archive_revisions`.
 *
 * GATE: same as archive-submit-entry -- `profiles.vetting_status IN
 * ('approved','unvetted')`, matching `is_approved_member()` (072) and
 * archive_revisions_insert_approved (096). 'unvetted' is the grandfathered
 * population and MUST stay in this list.
 */

const MEDIA_TYPES = ['film', 'tv', 'book', 'comic', 'music'];

/** Same whitelist as archive-submit-entry -- server-managed columns (id,
 *  slug, status, created_by, published_at, counts, has_score, search_tsv,
 *  timestamps) are never editable through this path. */
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
    case 'title': {
      if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > 200) {
        return 'title must be 1-200 characters';
      }
      return null;
    }
    case 'media_type': {
      if (typeof value !== 'string' || !MEDIA_TYPES.includes(value)) {
        return `media_type must be one of: ${MEDIA_TYPES.join(', ')}`;
      }
      return null;
    }
    case 'release_year': {
      if (value === null) return null;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1800 || value > 2200) {
        return 'release_year must be an integer between 1800 and 2200, or null to clear it';
      }
      return null;
    }
    case 'creator':
    case 'length_label':
    case 'cover_url':
    case 'cover_gradient': {
      if (value === null) return null;
      if (typeof value !== 'string' || value.length > 300) {
        return `${field} must be a string under 300 characters, or null to clear it`;
      }
      return null;
    }
    case 'summary': {
      if (value === null) return null;
      if (typeof value !== 'string' || value.length > 400) {
        return 'summary must be a string of 400 characters or fewer, or null to clear it';
      }
      return null;
    }
    case 'external_ids': {
      if (value === null) return null;
      if (typeof value !== 'object' || Array.isArray(value)) {
        return 'external_ids must be a plain object';
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * True when two proposed field values are the same, for the purpose of
 * deciding whether an edit actually changes anything. JSON.stringify is
 * sufficient here: every editable field is either a primitive or the flat
 * `external_ids` object, never an array or a value where key order could
 * legitimately differ in meaning.
 */
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);
  const { userId } = auth;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  const entryId = body.entry_id;
  const fieldsRaw = body.fields;
  if (typeof entryId !== 'string' || entryId.length === 0) {
    return errorResponse('entry_id is required', 400);
  }
  if (typeof fieldsRaw !== 'object' || fieldsRaw === null || Array.isArray(fieldsRaw)) {
    return errorResponse('fields must be an object of proposed changes', 400);
  }
  const submitted = fieldsRaw as Record<string, unknown>;

  const submittedKeys = Object.keys(submitted).filter((k) =>
    (EDITABLE_FIELDS as readonly string[]).includes(k)
  ) as EditableField[];
  if (submittedKeys.length === 0) {
    return errorResponse(`fields must include at least one of: ${EDITABLE_FIELDS.join(', ')}`, 400);
  }

  for (const field of submittedKeys) {
    const err = validateField(field, submitted[field]);
    if (err) return errorResponse(err, 400);
  }

  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

  const { allowed } = await consumeRateLimit({
    userId,
    fnName: 'archive-submit-edit',
    maxCount: 15,
    windowType: 'daily',
    onLimiterFailure: 'deny',
  });
  if (!allowed) return errorResponse('Rate limit exceeded', 429);

  if (DEV_MOCK) {
    return successResponse({ revision_id: 'mock-revision-id', entry_id: entryId, mock: true });
  }

  const supabase = getSupabaseClient();

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('vetting_status')
    .eq('id', userId)
    .single();
  if (profileErr || !profile) return errorResponse('Profile not found', 404);
  if (!['approved', 'unvetted'].includes(profile.vetting_status)) {
    return errorResponse('Approved membership required to suggest an edit', 403);
  }

  const { data: entry, error: entryErr } = await supabase
    .from('archive_entries')
    .select([...EDITABLE_FIELDS, 'id', 'status'].join(', '))
    .eq('id', entryId)
    .maybeSingle();
  if (entryErr) return errorResponse(entryErr.message, 500);
  if (!entry) return errorResponse('Entry not found', 404);
  // Only a published row is a stable target: a pending row already has its
  // own create-revision in flight, and rejected/hidden rows are not part of
  // the live catalogue for a member to be looking at in the first place.
  if ((entry as { status: string }).status !== 'published') {
    return errorResponse('Only published entries can be edited', 409);
  }

  const current = entry as Record<EditableField, unknown> & { id: string; status: string };

  const patch: Partial<Record<EditableField, unknown>> = {};
  const prev: Partial<Record<EditableField, unknown>> = {};
  for (const field of submittedKeys) {
    const proposedValue = submitted[field] ?? null;
    const currentValue = current[field] ?? null;
    if (!sameValue(proposedValue, currentValue)) {
      patch[field] = proposedValue;
      prev[field] = currentValue;
    }
  }

  if (Object.keys(patch).length === 0) {
    return errorResponse('No changes to propose -- every field matches the current entry', 400);
  }

  const { data: revision, error: revisionErr } = await supabase
    .from('archive_revisions')
    .insert({
      entry_id: entryId,
      submitted_by: userId,
      patch,
      prev,
      kind: 'edit',
    })
    .select('id')
    .single();

  if (revisionErr || !revision) {
    return errorResponse(revisionErr?.message ?? 'Could not record the proposed edit', 500);
  }

  // NOTIFY MODS: same gap as archive-submit-entry -- see that file's header.
  // No in-scope table accepts a new notification type; the pending queue
  // (idx_archive_revisions_queue, 095) is what staff currently poll.

  return successResponse({
    revision_id: revision.id,
    entry_id: entryId,
    patch,
  });
});
