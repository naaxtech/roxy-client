import { studioSearchHits } from '@/lib/studioSearch';

describe('studioSearchHits', () => {
  it('hides staff pages from a host, and still includes Settings', () => {
    const hits = studioSearchHits('', { isStaff: false, isCore: false });
    expect(hits.some((hit) => hit.href === '/settings')).toBe(true);
    expect(hits.some((hit) => hit.href === '/staff/archive/entries')).toBe(false);
    expect(hits.some((hit) => hit.href === '/staff/team')).toBe(false);
    expect(hits.map((hit) => hit.section)).toEqual(
      expect.arrayContaining(['Host', 'Community', 'Live', 'Shop', 'Account']),
    );
  });

  it('shows staff pages, and Roxy team only for core', () => {
    const staff = studioSearchHits('', { isStaff: true, isCore: false });
    expect(staff.some((hit) => hit.href === '/staff/archive/entries')).toBe(true);
    expect(staff.some((hit) => hit.href === '/staff/team')).toBe(false);

    const core = studioSearchHits('', { isStaff: true, isCore: true });
    expect(core.some((hit) => hit.href === '/staff/team')).toBe(true);
  });

  it('matches label, section, or path', () => {
    const byLabel = studioSearchHits('entries', { isStaff: true, isCore: false });
    expect(byLabel.map((hit) => hit.href)).toContain('/staff/archive/entries');

    const bySection = studioSearchHits('archive', { isStaff: true, isCore: false });
    expect(bySection.every((hit) => hit.section === 'Archive' || /archive/i.test(hit.label + hit.href))).toBe(
      true,
    );
    expect(bySection.length).toBeGreaterThan(1);

    const byPath = studioSearchHits('community/members', { isStaff: false, isCore: false });
    expect(byPath.map((hit) => hit.href)).toEqual(['/community/members']);
  });
});
