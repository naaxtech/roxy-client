/**
 * Who may make what from the ＋ sheet.
 *
 * Everyone writes text / photo / video on their own profile. Events and
 * shop-tagged posts are community-account extras — the official grant on the
 * profile, not a leftover community folder. Approved sellers may also tag
 * a shop item on a post they already have the right to write.
 */

export function canCreateEvent(
  profile: { official_community_id?: string | null } | null | undefined,
): boolean {
  return typeof profile?.official_community_id === 'string'
    && profile.official_community_id.length > 0;
}

export function canTagShop(input: {
  official?: boolean;
  sellerApproved?: boolean;
}): boolean {
  return input.official === true || input.sellerApproved === true;
}

export function eventBlockedReason(canHost: boolean): string | null {
  return canHost ? null : 'Community accounts host events here. Everyone else uses Roxy Studio.';
}

export function shopPostBlockedReason(canTag: boolean): string | null {
  return canTag ? null : 'Community accounts and approved sellers can tag a shop item.';
}
