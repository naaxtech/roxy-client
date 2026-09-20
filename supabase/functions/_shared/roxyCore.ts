/**
 * Roxy HQ. Core owns every community — they are not a member of each one.
 * Edge functions that still check community_members must treat core as admin.
 */
export async function isRoxyCore(
  supabase: { from: (table: string) => any },
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('profiles')
    .select('staff_role')
    .eq('id', userId)
    .maybeSingle();
  return data?.staff_role === 'core';
}
