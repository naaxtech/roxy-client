import {
  channelCountLabel,
  communityPreviewLine,
  filterInboxByQuery,
  inboxCommunityFromJoined,
} from '../../lib/inboxCommunities';

describe('inbox community rows', () => {
  it('labels channel count the way the prototype does', () => {
    expect(channelCountLabel(4)).toBe('4 CHANNELS');
    expect(channelCountLabel(0)).toBe('CHANNELS');
  });

  it('writes #channel · name: last line, not a member-count sentence', () => {
    expect(communityPreviewLine({
      slug: 'general',
      author: 'Tasha',
      body: 'I can do a cab-share from Soho',
    })).toBe('#general · Tasha: I can do a cab-share from Soho');
  });

  it('falls back to members when there is no last line yet', () => {
    const row = inboxCommunityFromJoined(
      { id: 'c1', name: 'WLW London', member_count: 1240 },
      { channelCount: 4, preview: '' },
    );
    expect(row.preview).toBe('1240 members · open channels');
    expect(row.channelCount).toBe(4);
  });

  it('keeps community chats in search, not only private names', () => {
    const communities = [
      { name: 'WLW London', preview: '#general · hi' },
      { name: 'Queer Nightlife LDN', preview: 'muted' },
    ];
    const hits = filterInboxByQuery(communities, 'london', (c) => `${c.name} ${c.preview}`);
    expect(hits.map((c) => c.name)).toEqual(['WLW London']);
  });
});
