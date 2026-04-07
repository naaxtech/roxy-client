import { formatDuration, buildCalendarUrl } from '../../lib/eventUtils';

describe('formatDuration', () => {
  it('returns null when endsAt is null', () => {
    expect(formatDuration('2026-04-12T19:00:00Z', null)).toBeNull();
  });

  it('returns whole hours only when no leftover minutes', () => {
    expect(formatDuration('2026-04-12T19:00:00Z', '2026-04-12T21:00:00Z')).toBe('2h');
  });

  it('returns hours and minutes for non-round durations', () => {
    expect(formatDuration('2026-04-12T19:00:00Z', '2026-04-12T20:30:00Z')).toBe('1h 30min');
  });

  it('returns minutes-only for sub-hour sessions', () => {
    expect(formatDuration('2026-04-12T19:00:00Z', '2026-04-12T19:45:00Z')).toBe('45 min');
  });

  it('returns null when end is before start', () => {
    expect(formatDuration('2026-04-12T19:00:00Z', '2026-04-12T18:00:00Z')).toBeNull();
  });
});

describe('buildCalendarUrl', () => {
  it('includes event title encoded in URL', () => {
    const url = buildCalendarUrl({
      title: 'WLW Social Mixer',
      startsAt: '2026-04-12T19:00:00Z',
      endsAt: '2026-04-12T21:00:00Z',
      locationText: null,
      communityName: null,
    });
    expect(url).toContain('calendar.google.com');
    expect(url).toContain('WLW');
  });

  it('falls back to starts_at + 1 hour when endsAt is null', () => {
    const url = buildCalendarUrl({
      title: 'Test',
      startsAt: '2026-04-12T19:00:00Z',
      endsAt: null,
      locationText: null,
      communityName: null,
    });
    // 19:00 + 1h = 20:00 UTC
    expect(url).toContain('20260412T200000Z');
  });

  it('includes location when provided', () => {
    const url = buildCalendarUrl({
      title: 'Test',
      startsAt: '2026-04-12T19:00:00Z',
      endsAt: null,
      locationText: 'The Garden Bar',
      communityName: null,
    });
    expect(url).toContain('Garden');
  });

  it('includes community name in details', () => {
    const url = buildCalendarUrl({
      title: 'Test',
      startsAt: '2026-04-12T19:00:00Z',
      endsAt: null,
      locationText: null,
      communityName: 'Queer Manila',
    });
    expect(url).toContain('Queer');
  });
});
