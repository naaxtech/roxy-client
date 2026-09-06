import { feedbackReporterName, feedbackReplyMailto } from '@/lib/feedbackReply';

describe('feedbackReporterName', () => {
  it('prefers the display name, then a username, then Member', () => {
    expect(feedbackReporterName('Jo', 'jo')).toBe('Jo');
    expect(feedbackReporterName(null, 'jo')).toBe('@jo');
    expect(feedbackReporterName('  ', null)).toBe('Member');
  });
});

describe('feedbackReplyMailto', () => {
  it('opens a reply addressed to the reporter with the report quoted', () => {
    const href = feedbackReplyMailto({
      email: 'jo@example.com',
      reporterName: 'Jo',
      reportedAt: '7 Sep 2026, 03:10 UTC',
      message: 'The Archive search is blank.',
      categoryLabel: 'Broken',
    });

    expect(href.startsWith('mailto:jo%40example.com?')).toBe(true);
    const parsed = new URL(href);
    expect(parsed.searchParams.get('subject')).toBe('Re: your Roxy report (Broken)');
    expect(parsed.searchParams.get('body')).toContain('Hi Jo,');
    expect(parsed.searchParams.get('body')).toContain('7 Sep 2026, 03:10 UTC');
    expect(parsed.searchParams.get('body')).toContain('The Archive search is blank.');
  });
});
