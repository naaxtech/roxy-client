import { headerMetaFor, navGroupsFor } from '@/components/AppSidebar';

describe('navGroupsFor', () => {
  it('hides staff sections from a host', () => {
    const titles = navGroupsFor({ isStaff: false, isCore: false }).map((g) => g.title);
    expect(titles).toEqual(['Host', 'Community', 'Live', 'Shop']);
  });

  it('shows staff sections, and Roxy team only for core', () => {
    const staff = navGroupsFor({ isStaff: true, isCore: false });
    expect(staff.map((g) => g.title)).toEqual([
      'Host',
      'Community',
      'Live',
      'Shop',
      'Roxy',
      'Safety',
      'Archive',
      'Approvals',
      'Inbox',
      'Money',
    ]);
    expect(staff.find((g) => g.title === 'Roxy')?.items.map((i) => i.label)).toEqual([
      'Overview',
      'Launch access',
      'Launch waves',
      'Member tags',
    ]);

    const core = navGroupsFor({ isStaff: true, isCore: true });
    expect(core.find((g) => g.title === 'Roxy')?.items.map((i) => i.label)).toEqual([
      'Overview',
      'Launch access',
      'Launch waves',
      'Roxy team',
      'Member tags',
    ]);
    expect(headerMetaFor('/staff/launch/waves')).toEqual({ title: 'Launch waves', section: 'Roxy' });
    expect(headerMetaFor('/staff/launch')).toEqual({ title: 'Launch access', section: 'Roxy' });
  });

  it('puts the unified reports queue and member lookup under Safety for every staff role', () => {
    for (const isCore of [false, true]) {
      const safety = navGroupsFor({ isStaff: true, isCore }).find((g) => g.title === 'Safety');
      expect(safety?.items.map((i) => i.href)).toEqual(['/staff/reports', '/staff/members']);
    }
    expect(navGroupsFor({ isStaff: false, isCore: false }).find((g) => g.title === 'Safety')).toBeUndefined();
    expect(headerMetaFor('/staff/reports')).toEqual({ title: 'Reports', section: 'Safety' });
    expect(headerMetaFor('/staff/members/4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f')).toEqual({
      title: 'Members',
      section: 'Safety',
    });
  });
});

describe('headerMetaFor', () => {
  it('uses the section the item belongs to, including nested archive routes', () => {
    expect(headerMetaFor('/staff/feedback')).toEqual({ title: 'Feedback', section: 'Inbox' });
    expect(headerMetaFor('/staff/archive/entries/new')).toEqual({
      title: 'Entries',
      section: 'Archive',
    });
    expect(headerMetaFor('/community/members')).toEqual({ title: 'Members', section: 'Community' });
    expect(headerMetaFor('/settings')).toEqual({ title: 'Settings' });
  });
});
