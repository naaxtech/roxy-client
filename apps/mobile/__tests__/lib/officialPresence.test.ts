import { officialPresenceLine } from '../../lib/officialPresence';

const NOW = Date.parse('2026-09-07T04:00:00Z');

describe('officialPresenceLine', () => {
  it('says nobody is here when the list is empty or everyone is stale', () => {
    expect(officialPresenceLine([], NOW)).toBeNull();
    expect(officialPresenceLine([
      { display_name: 'Maya', last_seen_at: '2026-09-07T03:00:00Z' },
    ], NOW)).toBeNull();
  });

  it('names the women who are actually online, then the leftover count', () => {
    const line = officialPresenceLine([
      { display_name: 'Maya Lin', last_seen_at: '2026-09-07T03:59:00Z' },
      { display_name: 'Priya', last_seen_at: '2026-09-07T03:58:00Z' },
      { display_name: 'Tasha', last_seen_at: '2026-09-07T03:57:00Z' },
      { display_name: 'Elena', last_seen_at: '2026-09-07T03:56:00Z' },
    ], NOW);
    expect(line).toEqual({
      count: 4,
      label: '4 online now · Maya Lin, Priya, Tasha and others',
    });
  });

  it('does not invent a leftover when three or fewer are online', () => {
    const line = officialPresenceLine([
      { display_name: 'Maya', last_seen_at: '2026-09-07T03:59:00Z' },
    ], NOW);
    expect(line).toEqual({ count: 1, label: '1 online now · Maya' });
  });
});
