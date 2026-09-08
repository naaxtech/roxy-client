'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

const MAX_TAG = 24;

/**
 * Set or clear a member's editorial tag.
 *
 * Written straight through RLS rather than through an edge function: the action
 * is one column on one row, and migration 121 already expresses "staff only"
 * exactly — a policy for the row, the column withheld from the member grant,
 * and `profiles_guard_staff_tag` for the case a grant cannot express. A
 * service-role route here would put this screen outside the policy everything
 * else is checked against, which is the reasoning migration 100 wrote down.
 *
 * Provenance is NOT sent. The trigger stamps `staff_tag_set_by` from
 * `auth.uid()` and overwrites anything a caller supplies, so a client cannot
 * credit the tag to somebody else.
 */
export async function setMemberTag(memberId: string, rawTag: string): Promise<void> {
  const tag = rawTag.trim();
  if (tag.length > MAX_TAG) {
    // Checked here so she gets a sentence rather than a constraint violation.
    throw new Error(`Keep the tag to ${MAX_TAG} characters or fewer.`);
  }
  if (tag.length > 0 && tag.length < 2) {
    throw new Error('A tag needs at least two characters.');
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    // Empty clears it. A tag is editorial, so removing one has to be as easy
    // as adding one.
    .update({ staff_tag: tag.length === 0 ? null : tag })
    .eq('id', memberId)
    .select('id');

  if (error) throw new Error(error.message);
  // PostgREST answers 200 for an update that matched no rows. Without this a
  // non-staff caller — or a wrong id — would land here as a silent success and
  // the screen would report a tag that was never written.
  if (!data || data.length === 0) {
    throw new Error('That member could not be tagged. Staff only.');
  }

  revalidatePath('/staff/member-tags');
}
