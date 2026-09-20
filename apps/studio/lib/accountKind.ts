export type AccountKind = 'core' | 'staff' | 'member' | 'communityOwner' | 'pending';

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  core: 'Roxy core',
  staff: 'Staff',
  member: 'Member',
  communityOwner: 'Community owner',
  pending: 'Pending applicant',
};

export function resolveAccountKind(profile: {
  staff_role?: string | null;
  is_staff?: boolean | null;
  is_community_owner?: boolean | null;
  vetting_status?: string | null;
} | null | undefined): AccountKind {
  if (profile?.staff_role === 'core') return 'core';
  if (profile?.staff_role === 'staff' || profile?.is_staff) return 'staff';
  if (profile?.vetting_status === 'pending' || profile?.vetting_status === 'rejected') {
    return 'pending';
  }
  if (profile?.is_community_owner) return 'communityOwner';
  return 'member';
}

export function accountKindLabel(kind: AccountKind): string {
  return ACCOUNT_KIND_LABEL[kind];
}
