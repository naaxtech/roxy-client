import { isCoreAccount, resolveHostCommunities } from '@/lib/hostScope';

describe('isCoreAccount', () => {
  it('is true only for the core staff role', () => {
    expect(isCoreAccount('core')).toBe(true);
    expect(isCoreAccount('staff')).toBe(false);
    expect(isCoreAccount(null)).toBe(false);
    expect(isCoreAccount(undefined)).toBe(false);
  });
});

describe('resolveHostCommunities', () => {
  const london = {
    id: 'c-london',
    name: 'London',
    description: 'HQ',
    member_count: 12,
  };
  const archive = {
    id: 'c-archive',
    name: 'Archive',
    description: null,
    member_count: 3,
  };

  it('gives Roxy core every community as admin, even with no memberships', () => {
    const communities = resolveHostCommunities({
      isCore: true,
      allCommunities: [london, archive],
      memberships: [],
    });

    expect(communities).toEqual([
      {
        id: 'c-archive',
        name: 'Archive',
        callerRole: 'admin',
        description: null,
        memberCount: 3,
      },
      {
        id: 'c-london',
        name: 'London',
        callerRole: 'admin',
        description: 'HQ',
        memberCount: 12,
      },
    ]);
  });

  it('keeps staff and hosts scoped to the communities they actually run', () => {
    const communities = resolveHostCommunities({
      isCore: false,
      allCommunities: [london, archive],
      memberships: [
        {
          community_id: 'c-london',
          role: 'border_patrol',
          communities: { id: 'c-london', name: 'London', description: 'HQ', member_count: 12 },
        },
        {
          community_id: 'c-ghost',
          role: 'admin',
          communities: null,
        },
      ],
    });

    expect(communities).toEqual([
      {
        id: 'c-london',
        name: 'London',
        callerRole: 'border_patrol',
        description: 'HQ',
        memberCount: 12,
      },
    ]);
  });
});
