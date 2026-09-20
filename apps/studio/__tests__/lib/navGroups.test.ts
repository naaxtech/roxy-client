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
      'Archive',
      'Approvals',
      'Inbox',
      'Money',
    ]);
    expect(staff.find((g) => g.title === 'Roxy')?.items.map((i) => i.label)).toEqual([
      'Overview',
      'Launch access',
    ]);

    const core = navGroupsFor({ isStaff: true, isCore: true });
    expect(core.find((g) => g.title === 'Roxy')?.items.map((i) => i.label)).toEqual([
      'Overview',
      'Launch access',
      'Roxy team',
    ]);
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
