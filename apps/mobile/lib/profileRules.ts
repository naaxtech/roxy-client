/**
 * Profile rules the client and the database share (PRO-04).
 *
 * The bio and display-name limits are enforced by 133's CHECKs and the
 * reserved-name trigger; these mirror them so she meets the rule as a
 * counter or a sentence, never as a refused write.
 */

/** What the bio box allows. The DB CHECK is 300 so an older client is not refused mid-sentence. */
export const BIO_MAX = 160;

/** Display name, trimmed. The DB CHECK allows 1..50; two characters is the useful floor. */
export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 50;

/**
 * Names nobody may rename themselves to: they read as staff or as Roxy herself.
 * Compared lowercase with every non-alphanumeric stripped, so "Roxy Team",
 * "r.o.x.y" and "ROXY_HQ" all match. Mirrors `profiles_guard_display_name` in
 * supabase/migrations/133 — keep the two lists identical.
 */
export const RESERVED_DISPLAY_NAMES = [
  'roxy', 'roxyteam', 'teamroxy', 'roxysupport', 'roxystaff', 'roxyofficial',
  'roxyhq', 'sister', 'support', 'admin', 'administrator', 'moderator', 'mod',
  'staff', 'official', 'thinqer', 'naaxtech',
] as const;

const normalise = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

export function validateDisplayName(raw: string): { value: string; error: string | null } {
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value.length < DISPLAY_NAME_MIN) {
    return { value, error: `Use at least ${DISPLAY_NAME_MIN} characters.` };
  }
  if (value.length > DISPLAY_NAME_MAX) {
    return { value, error: `Keep it to ${DISPLAY_NAME_MAX} characters or fewer.` };
  }
  if ((RESERVED_DISPLAY_NAMES as readonly string[]).includes(normalise(value))) {
    return { value, error: 'That name is reserved for the Roxy team. Pick another.' };
  }
  return { value, error: null };
}

/**
 * The avatar is always uploaded to the same path (`<uid>/avatar.jpg`, upsert),
 * so its public URL never changed and every `<Image>` and the CDN kept the old
 * photo. A version query makes each upload a new URL.
 */
export function withCacheBust(url: string, now: number = Date.now()): string {
  const base = url.replace(/([?&])v=\d+(&|$)/, (_m, p1: string, p2: string) => (p2 ? p1 : '')).replace(/[?&]$/, '');
  return `${base}${base.includes('?') ? '&' : '?'}v=${now}`;
}

export const AVATAR_MAX_BYTES = 10 * 1024 * 1024;

/** Why a picked file cannot be her photo, or null. Unknown size/type is allowed (web pickers omit them). */
export function avatarFileError(asset: { mimeType?: string | null; fileSize?: number | null }): string | null {
  if (asset.mimeType && !asset.mimeType.startsWith('image/')) {
    return 'That file is not a photo. Pick a JPG, PNG or HEIC image.';
  }
  if (typeof asset.fileSize === 'number' && asset.fileSize > AVATAR_MAX_BYTES) {
    return 'That photo is over 10 MB. Pick a smaller one.';
  }
  return null;
}
