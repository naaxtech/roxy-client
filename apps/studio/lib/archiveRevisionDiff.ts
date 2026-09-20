/**
 * The side-by-side diff for the Archive revision queue.
 *
 * `archive_revisions.patch` is what was proposed; `prev` is the row state at
 * proposal time (095_archive_core.sql). `prev` may be a wider snapshot than
 * what was actually changed — it can carry columns nobody touched, like
 * `vote_count` or `created_at`. Diffing on the UNION of patch and prev keys
 * would render every one of those untouched columns as a false "removed"
 * row, which is exactly the kind of lie this screen exists to prevent: a mod
 * approving what looks like a vote-count edit that was never proposed.
 *
 * So this only ever iterates `patch`'s own keys. `prev` is consulted purely
 * to answer "what did this field hold before" for a key that patch proposes
 * to change.
 */

export interface RevisionDiffRow {
  key: string;
  label: string;
  before: string;
  after: string;
  changed: boolean;
}

const EM_DASH = '—';

/** A patched field's value, rendered as a single readable string. */
export function formatDiffValue(value: unknown): string {
  if (value === null || value === undefined) return EM_DASH;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** `release_year` -> `Release year`. Patch keys are arbitrary column names, not copy. */
function humanizeKey(key: string): string {
  const words = key.split('_').filter(Boolean);
  if (words.length === 0) return key;
  return [words[0][0].toUpperCase() + words[0].slice(1), ...words.slice(1)].join(' ');
}

/**
 * Builds the diff rows for one revision.
 *
 * A `create` revision has no prior row (095's `archive_revision_edit_has_entry`
 * CHECK — `entry_id` is only nullable for `create`), so every proposed field is
 * shown as new regardless of what `prev` contains.
 */
export function buildRevisionDiff(
  patch: Record<string, unknown> | null | undefined,
  prev: Record<string, unknown> | null | undefined,
  kind: 'create' | 'edit',
): RevisionDiffRow[] {
  const patchObj = patch ?? {};
  const prevObj = kind === 'create' ? {} : (prev ?? {});

  return Object.keys(patchObj)
    .sort()
    .map((key) => {
      const beforeRaw = kind === 'create' ? undefined : prevObj[key];
      const afterRaw = patchObj[key];
      const before = formatDiffValue(beforeRaw);
      const after = formatDiffValue(afterRaw);
      return {
        key,
        label: humanizeKey(key),
        before,
        after,
        changed: kind === 'create' || before !== after,
      };
    });
}
