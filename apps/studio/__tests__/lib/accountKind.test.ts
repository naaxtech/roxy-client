import { accountKindLabel, resolveAccountKind } from '@/lib/accountKind';

describe('resolveAccountKind', () => {
  it('names core, staff, pending, community owner, and member', () => {
    expect(resolveAccountKind({ staff_role: 'core', is_staff: true })).toBe('core');
    expect(resolveAccountKind({ staff_role: 'staff', is_staff: true })).toBe('staff');
    expect(resolveAccountKind({ vetting_status: 'pending' })).toBe('pending');
    expect(resolveAccountKind({ vetting_status: 'rejected' })).toBe('pending');
    expect(resolveAccountKind({ vetting_status: 'approved', is_community_owner: true })).toBe(
      'communityOwner',
    );
    expect(resolveAccountKind({ vetting_status: 'approved' })).toBe('member');
  });
});

describe('accountKindLabel', () => {
  it('is a sentence a host can read on the invite list', () => {
    expect(accountKindLabel('core')).toBe('Roxy core');
    expect(accountKindLabel('pending')).toBe('Pending applicant');
    expect(accountKindLabel('member')).toBe('Member');
    expect(accountKindLabel('communityOwner')).toBe('Community owner');
    expect(accountKindLabel('staff')).toBe('Staff');
  });
});
