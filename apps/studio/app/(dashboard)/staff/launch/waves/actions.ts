'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { assertStaffAction } from '@/lib/staff-guard';
import { validateWave, type WaveForm } from '@/lib/inviteWaves';

export type WaveResult =
  | {
      ok: true;
      communityName: string;
      label: string;
      codes: { code: string; expiresAt: string | null }[];
    }
  | { ok: false; error: string };

/**
 * Mint one launch wave: N single-use codes, one label, one expiry.
 *
 * Same minting path as /invites (InviteCodesClient): an insert into
 * invite_codes under the caller's own session, `code` left to the column
 * DEFAULT generate_invite_code(), `is_review_code` never sent. The insert
 * policy decides who may mint (core under 112; any staff under gate's 130).
 * All N rows go in ONE statement, so a refusal creates nothing — never half a
 * wave. A unique-code collision (23505, astronomically rare) is retried once
 * as a whole, then reported.
 */
export async function createInviteWave(form: WaveForm): Promise<WaveResult> {
  const viewer = await assertStaffAction();
  const input = validateWave(form);
  if (!input.ok) return input;

  const supabase = await createClient();
  const lookup = supabase.from('communities').select('id, name');
  const { data: community, error: communityError } = await (input.communityId
    ? lookup.eq('id', input.communityId)
    : lookup.eq('slug', 'roxy-official')
  ).maybeSingle();
  if (communityError) return { ok: false, error: 'Could not look up that community. Nothing was created.' };
  if (!community) return { ok: false, error: 'That community could not be found. Nothing was created.' };

  const c = community as { id: string; name: string };
  const rows = Array.from({ length: input.count }, () => ({
    community_id: c.id,
    created_by: viewer.userId,
    label: input.label,
    max_uses: 1,
    expires_at: input.expiresAt,
  }));

  const insert = () => supabase.from('invite_codes').insert(rows).select('code, expires_at');
  let res = await insert();
  if (res.error?.code === '23505') res = await insert();

  if (res.error) {
    if (res.error.code === '42501' || /row-level security/i.test(res.error.message ?? '')) {
      return {
        ok: false,
        error:
          'Roxy refused that batch: this database only lets core staff (or that community’s admins) mint codes. Nothing was created.',
      };
    }
    if (res.error.code === '23514') {
      return { ok: false, error: 'A code did not fit the rules (label ≤ 80 characters). Nothing was created.' };
    }
    return { ok: false, error: 'Could not create the wave. Nothing was created — try again.' };
  }

  const data = (res.data ?? []) as { code: string; expires_at: string | null }[];
  revalidatePath('/staff/launch/waves');
  revalidatePath('/invites');
  return {
    ok: true,
    communityName: c.name,
    label: input.label,
    codes: data.map((d) => ({ code: d.code, expiresAt: d.expires_at })),
  };
}
