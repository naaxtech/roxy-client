import { navGroupsFor, type NavGroupDef } from '@/components/AppSidebar';

export type StudioSearchHit = {
  href: string;
  label: string;
  section: string;
};

export function studioSearchHits(
  query: string,
  role: { isStaff: boolean; isCore: boolean },
): StudioSearchHit[] {
  const groups: NavGroupDef[] = navGroupsFor(role);
  const extra: StudioSearchHit[] = [{ href: '/settings', label: 'Settings', section: 'Account' }];
  const all: StudioSearchHit[] = [
    ...groups.flatMap((group) =>
      group.items.map((item) => ({ href: item.href, label: item.label, section: group.title })),
    ),
    ...extra,
  ];
  const needle = query.trim().toLowerCase();
  if (!needle) return all;
  return all.filter((hit) => {
    const haystack = `${hit.label} ${hit.section} ${hit.href}`.toLowerCase();
    return haystack.includes(needle);
  });
}
