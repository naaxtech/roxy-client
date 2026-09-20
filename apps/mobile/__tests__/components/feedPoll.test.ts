import { parsePoll, pollShare, pollVoteTotal } from '../../components/feed/poll';
import type { PollOption } from '../../components/feed/poll';

describe('parsePoll', () => {
  it('splits a seeded poll into its question and its bulleted options', () => {
    const parsed = parsePoll(
      'What should our next event be? 🗳️\n• 🎬 Film night\n• 🥾 Day hike\n• 🍹 Rooftop social',
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.question).toBe('What should our next event be? 🗳️');
    expect(parsed?.options.map((o) => o.label)).toEqual([
      '🎬 Film night', '🥾 Day hike', '🍹 Rooftop social',
    ]);
  });

  it('accepts dash, asterisk and numbered option markers', () => {
    expect(parsePoll('Coffee?\n- Yes\n- No')?.options).toHaveLength(2);
    expect(parsePoll('Coffee?\n* Yes\n* No')?.options).toHaveLength(2);
    expect(parsePoll('Coffee?\n1. Yes\n2. No')?.options).toHaveLength(2);
    expect(parsePoll('Coffee?\n1) Yes\n2) No')?.options).toHaveLength(2);
  });

  it('keeps the whole preamble as the question when it runs to several lines', () => {
    const parsed = parsePoll('Big decision.\nHelp us pick.\n• A\n• B');

    expect(parsed?.question).toBe('Big decision.\nHelp us pick.');
  });

  it('gives each option a stable positional key, because votes land in a jsonb map', () => {
    expect(parsePoll('Q\n• A\n• B')?.options.map((o) => o.key)).toEqual(['poll:0', 'poll:1']);
  });

  it('refuses a poll with fewer than two options rather than rendering a one-horse race', () => {
    expect(parsePoll('Just a thought, no options here')).toBeNull();
    expect(parsePoll('Q\n• Only one')).toBeNull();
  });

  it('refuses a poll with no question above the options', () => {
    expect(parsePoll('• A\n• B')).toBeNull();
  });

  it('drops blank and marker-only lines instead of emitting empty options', () => {
    const parsed = parsePoll('Q\n• A\n•\n\n• B');

    expect(parsed?.options.map((o) => o.label)).toEqual(['A', 'B']);
  });

  it('caps the option list so a pathological post cannot render a hundred rows', () => {
    const many = ['Q', ...Array.from({ length: 30 }, (_, i) => `• opt ${i}`)].join('\n');

    expect(parsePoll(many)?.options).toHaveLength(10);
  });
});

describe('poll tallies', () => {
  const options: PollOption[] = [
    { key: 'poll:0', label: 'A' },
    { key: 'poll:1', label: 'B' },
  ];

  it('totals only the keys that belong to this poll', () => {
    // reaction_counts is shared with emoji reactions, so a stray key must not
    // be counted as a vote.
    expect(pollVoteTotal({ 'poll:0': 3, 'poll:1': 1, '🔥': 40 }, options)).toBe(4);
  });

  it('reports a zero total for a poll nobody has voted in', () => {
    expect(pollVoteTotal({}, options)).toBe(0);
  });

  it('ignores negative or non-numeric counts rather than propagating NaN', () => {
    const counts = { 'poll:0': -5, 'poll:1': Number.NaN } as unknown as Record<string, number>;

    expect(pollVoteTotal(counts, options)).toBe(0);
    expect(pollShare(counts, options[0], 0)).toBe(0);
  });

  it('returns a 0..1 share of the total', () => {
    expect(pollShare({ 'poll:0': 3, 'poll:1': 1 }, options[0], 4)).toBe(0.75);
    expect(pollShare({ 'poll:0': 3, 'poll:1': 1 }, options[1], 4)).toBe(0.25);
  });

  it('returns 0 rather than dividing by zero before the first vote', () => {
    expect(pollShare({}, options[0], 0)).toBe(0);
  });
});
