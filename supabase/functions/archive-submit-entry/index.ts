// supabase/functions/archive-submit-entry/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { consumeRateLimit } from '../_shared/rateLimit.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

/**
 * Propose a new WLW Archive entry.
 *
 * 096_archive_rls.sql gives `archive_entries` no INSERT policy for
 * `authenticated` at all -- every write to it goes through an edge function on
 * the service role, because a member-maintained catalogue members can write
 * straight into is not moderated, whatever the UI says. This function is that
 * door for creation: it inserts the entry itself (status='pending', invisible
 * to anyone but staff -- see archive_entries_select_published) and the
 * archive_revisions row (kind='create') that is what the staff review queue
 * actually works off of. staff-review-archive-revision is what publishes it.
 *
 * GATE: `profiles.vetting_status IN ('approved','unvetted')`, matching
 * `is_approved_member()` (072_invite_gate_enforcement.sql) and
 * archive_revisions_insert_approved (096). 'unvetted' is the grandfathered
 * population from before the invite gate existed and MUST be allowed -- 072's
 * own comment warns that narrowing this to 'approved' alone locks out every
 * pre-gate account in production. This function re-checks it directly rather
 * than calling the is_approved_member() RPC because the service-role client
 * has no `auth.uid()` -- there is no session for that SQL function to read.
 */

const MEDIA_TYPES = ['film', 'tv', 'book', 'comic', 'music'];

/** archive_entries columns a member may propose. Server-managed columns
 *  (id, slug, status, created_by, published_at, counts, has_score, search_tsv,
 *  timestamps) are never in this list. */
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
type EntryPatch = Partial<Record<EditableField, unknown>>;

/**
 * Validates one field against the same constraints as the CHECKs in
 * 095_archive_core.sql. Returns an error string, or null when the value is
 * acceptable.
 */
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
      if (value === null || value === undefined) return null;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1800 || value > 2200) {
        return 'release_year must be an integer between 1800 and 2200';
      }
      return null;
    }
    case 'creator':
    case 'length_label':
    case 'cover_url':
    case 'cover_gradient': {
      if (value === null || value === undefined) return null;
      if (typeof value !== 'string' || value.length > 300) {
        return `${field} must be a string under 300 characters`;
      }
      return null;
    }
    case 'summary': {
      if (value === null || value === undefined) return null;
      if (typeof value !== 'string' || value.length > 400) {
        return 'summary must be a string of 400 characters or fewer';
      }
      return null;
    }
    case 'external_ids': {
      if (value === null || value === undefined) return null;
      if (typeof value !== 'object' || Array.isArray(value)) {
        return 'external_ids must be a plain object';
      }
      return null;
    }
    default:
      return null;
  }
}

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics (e.g. Amelie -> amelie)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base.length > 0 ? base : 'entry';
}

function randomSuffix(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 6);
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

  if (typeof body.title !== 'string' || typeof body.media_type !== 'string') {
    return errorResponse('title and media_type are required', 400);
  }

  // title and media_type are NOT NULL on archive_entries and already
  // confirmed present above -- this loop just picks up whichever of the
  // remaining optional fields the caller sent.
  const proposed: EntryPatch = {};
  for (const field of EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      proposed[field] = body[field];
    }
  }

  for (const field of EDITABLE_FIELDS) {
    if (proposed[field] === undefined) continue;
    const err = validateField(field, proposed[field]);
    if (err) return errorResponse(err, 400);
  }

  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

  // Content submission, not a safety report -- a limiter outage should not
  // let unlimited entries through, so this denies on failure rather than
  // allowing (contrast submit-report's deliberate 'allow').
  const { allowed } = await consumeRateLimit({
    userId,
    fnName: 'archive-submit-entry',
    maxCount: 5,
    windowType: 'daily',
    onLimiterFailure: 'deny',
  });
  if (!allowed) return errorResponse('Rate limit exceeded', 429);

  if (DEV_MOCK) {
    return successResponse({
      entry_id: 'mock-entry-id',
      revision_id: 'mock-revision-id',
      slug: slugify(String(proposed.title)),
      status: 'pending',
      mock: true,
    });
  }

  const supabase = getSupabaseClient();

  // Gate. See header -- 'unvetted' must stay in this list.
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('vetting_status')
    .eq('id', userId)
    .single();
  if (profileErr || !profile) return errorResponse('Profile not found', 404);
  if (!['approved', 'unvetted'].includes(profile.vetting_status)) {
    return errorResponse('Approved membership required to add to the Archive', 403);
  }

  const insertRow = {
    title: proposed.title as string,
    media_type: proposed.media_type as string,
    release_year: proposed.release_year ?? null,
    creator: proposed.creator ?? null,
    length_label: proposed.length_label ?? null,
    summary: proposed.summary ?? null,
    cover_url: proposed.cover_url ?? null,
    cover_gradient: proposed.cover_gradient ?? null,
    external_ids: proposed.external_ids ?? {},
    status: 'pending' as const,
    created_by: userId,
  };

  const baseSlug = slugify(insertRow.title);
  let entryId: string | null = null;
  let finalSlug = baseSlug;

  for (let attempt = 0; attempt < 4 && entryId === null; attempt++) {
    const candidateSlug = attempt === 0 ? baseSlug : `${baseSlug}-${randomSuffix()}`;
    const { data, error } = await supabase
      .from('archive_entries')
      .insert({ ...insertRow, slug: candidateSlug })
      .select('id')
      .single();

    if (!error && data) {
      entryId = data.id as string;
      finalSlug = candidateSlug;
      break;
    }
    // 23505 = unique_violation. Any other error is not a slug collision --
    // retrying it would just fail the same way again.
    if (error && error.code !== '23505') {
      return errorResponse(error.message, 500);
    }
  }

  if (entryId === null) {
    return errorResponse('Could not generate a unique slug for this entry', 500);
  }

  const { data: revision, error: revisionErr } = await supabase
    .from('archive_revisions')
    .insert({
      entry_id: entryId,
      submitted_by: userId,
      patch: proposed,
      prev: null, // nothing existed before a create
      kind: 'create',
    })
    .select('id')
    .single();

  if (revisionErr || !revision) {
    // The entry row now exists with no revision behind it -- an orphaned
    // pending row a mod cannot act on. Mark it rejected rather than leaving it
    // silently stuck in the queue with nothing to review.
    await supabase.from('archive_entries').update({ status: 'rejected' }).eq('id', entryId);
    return errorResponse(revisionErr?.message ?? 'Could not record the submission', 500);
  }

  // NOTIFY MODS: no push/email path exists in scope for this. notifications.type
  // is a closed CHECK (057_notifications.sql: 'friend_request'|'friend_accept'
  // |'community_event') and email_queue.email_type/recipient_type are equally
  // closed (072) -- widening either is a migration outside this task's scope
  // (099 is archive_report_reasons only). This mirrors 072's own
  // 'application_received' email_type: reserved in the CHECK, never wired to an
  // actual send. Staff currently find pending work by querying
  // archive_revisions WHERE status='pending' (idx_archive_revisions_queue,
  // 095) or archive_entries WHERE status='pending', both already visible to
  // them under is_roxy_staff() (096). A real push/email notification is a
  // follow-up that needs a schema change first.

  return successResponse({
    entry_id: entryId,
    slug: finalSlug,
    revision_id: revision.id,
    status: 'pending',
  });
});
