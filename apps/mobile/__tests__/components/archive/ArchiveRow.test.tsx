import { render, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ArchiveRow } from '../../../components/archive/ArchiveRow';
import type { ArchiveEntry } from '../../../lib/archive';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';
import { identityFor } from '../../../lib/theme';
import { COVER_WIDTH } from '../../../components/archive/archiveTokens';
import { useThemeStore } from '../../../store/themeStore';

jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, string | number>;

const hidden = { includeHiddenElements: true } as const;

const entry = (over: Partial<ArchiveEntry> = {}): ArchiveEntry => ({
  id: 'e1',
  slug: 'portrait-of-a-lady-on-fire',
  title: 'Portrait of a Lady on Fire',
  media_type: 'film',
  release_year: 2019,
  creator: 'Céline Sciamma',
  length_label: '2h 2m',
  summary: 'A painter and her subject, on an island, running out of days.',
  cover_url: null,
  cover_gradient: null,
  vote_count: 100,
  up_count: 96,
  review_count: 41,
  has_score: true,
  published_at: '2026-08-01T00:00:00Z',
  ...over,
});

afterEach(() => useThemeStore.setState({ theme: 'dark' }));

/**
 * v2 (design direction › Archive): a row is a 2:3 cover and words. The score
 * is said in words, the type sits in the meta line (no caps word over the art),
 * and rows are separated by space, not bordered cards.
 */
describe('ArchiveRow', () => {
  it('renders title, the type · year · creator line, blurb and review count', () => {
    const v = render(<ArchiveRow entry={entry()} onPress={jest.fn()} />);
    expect(v.getByText('Portrait of a Lady on Fire')).toBeTruthy();
    expect(v.getByText('Movies · 2019 · Céline Sciamma')).toBeTruthy();
    expect(v.getByText('A painter and her subject, on an island, running out of days.')).toBeTruthy();
    expect(v.getByText('41 reviews')).toBeTruthy();
  });

  it('says the score in words with its sample size, never a pill or a flower', () => {
    const v = render(<ArchiveRow entry={entry({ vote_count: 7, up_count: 6, star_sum: 31 })} onPress={jest.fn()} />);
    expect(v.getByText('4.4 from 7 members')).toBeTruthy();
    expect(v.queryByText('✿')).toBeNull();
  });

  it('says the recommend share in words when only thumbs exist', () => {
    const v = render(<ArchiveRow entry={entry()} onPress={jest.fn()} />);
    expect(v.getByText('96% from 100 members')).toBeTruthy();
  });

  it('says Not rated yet when nobody has rated it, and invites her to be first', () => {
    const v = render(<ArchiveRow entry={entry({ vote_count: 0, up_count: 0, has_score: false, review_count: 0 })} onPress={jest.fn()} />);
    expect(v.getByText('Not rated yet')).toBeTruthy();
    expect(v.queryByText('0%')).toBeNull();
    expect(v.getByText('Be the first to rate it')).toBeTruthy();
  });

  it('stops inviting once someone has rated it', () => {
    const v = render(<ArchiveRow entry={entry({ vote_count: 3, up_count: 2, has_score: false, review_count: 0 })} onPress={jest.fn()} />);
    expect(v.queryByText('Be the first to rate it')).toBeNull();
    expect(v.getByText('No reviews yet')).toBeTruthy();
  });

  it('shows at most the top two content notes', () => {
    const notes = [
      { id: 'a', label: 'grief', agreeCount: 30, agreed: false },
      { id: 'b', label: 'period racism', agreeCount: 20, agreed: false },
      { id: 'c', label: 'animal harm', agreeCount: 10, agreed: false },
    ];
    const v = render(<ArchiveRow entry={entry()} notes={notes} onPress={jest.fn()} />);
    expect(v.getByText('grief')).toBeTruthy();
    expect(v.getByText('period racism')).toBeTruthy();
    expect(v.queryByText('animal harm')).toBeNull();
  });

  it('drops a note nothing has agreed with yet', () => {
    const notes = [{ id: 'a', label: 'sole opinion', agreeCount: 1, agreed: false }];
    const v = render(<ArchiveRow entry={entry()} notes={notes} onPress={jest.fn()} />);
    expect(v.queryByText('sole opinion')).toBeNull();
  });

  it('survives an entry with no year, no creator and no blurb', () => {
    const bare = entry({ release_year: null, creator: null, summary: null });
    const v = render(<ArchiveRow entry={bare} onPress={jest.fn()} />);
    expect(v.getByText('Movies')).toBeTruthy();
    expect(v.getByText('Portrait of a Lady on Fire')).toBeTruthy();
  });

  it('names the media type in words in the meta line, not as a caps word on the art', () => {
    const v = render(<ArchiveRow entry={entry({ media_type: 'tv' })} onPress={jest.fn()} />);
    expect(v.getByText('Series · 2019 · Céline Sciamma')).toBeTruthy();
    expect(v.queryByText('TV')).toBeNull();
  });

  it('is one button, announced as a sentence, at the touch-target floor', () => {
    const v = render(<ArchiveRow entry={entry()} onPress={jest.fn()} testID="row" />);
    const row = v.getByTestId('row');
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityLabel).toContain('Portrait of a Lady on Fire');
    expect(row.props.accessibilityLabel).toContain('96% from 100 members');
    expect(flat(row).minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });

  it('calls back on press', () => {
    const onPress = jest.fn();
    const v = render(<ArchiveRow entry={entry()} onPress={onPress} testID="row" />);
    fireEvent.press(v.getByTestId('row'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is a row separated by space, not a bordered card', () => {
    const v = render(<ArchiveRow entry={entry()} onPress={jest.fn()} testID="row" />);
    const row = flat(v.getByTestId('row'));
    expect(row.borderWidth ?? 0).toBe(0);
    expect(row.backgroundColor).toBeUndefined();
  });

  it('shows the uploaded cover, and the type cover when the upload fails', () => {
    const v = render(<ArchiveRow entry={entry({ cover_url: 'https://example.test/a.jpg' })} onPress={jest.fn()} testID="row" />);
    expect(v.getByTestId('row-cover-image', hidden)).toBeTruthy();
    fireEvent(v.getByTestId('row-cover-image', hidden), 'error');
    expect(v.queryByTestId('row-cover-image', hidden)).toBeNull();
    expect(v.getByTestId('row-cover-type', hidden)).toBeTruthy();
  });

  it('gives an entry with no cover the designed type cover in its identity field, never a gradient', () => {
    // v0 painted the seeded CSS gradient (migration 098) or a ramp. v2 bans
    // gradients outside the wordmark: the fallback is a designed cover.
    const v = render(
      <ArchiveRow
        entry={entry({ cover_gradient: 'linear-gradient(160deg,#1E2A4E,#4A3A7A 55%,#D98A5E)' })}
        onPress={() => {}}
        testID="row"
      />,
    );
    const field = flat(v.getByTestId('row-cover-type', hidden));
    expect(field.backgroundColor).toBe(identityFor('e1'));
    expect(flat(v.getByTestId('row-cover', hidden)).width).toBe(COVER_WIDTH.row);
    expect(v.UNSAFE_queryAllByType('LinearGradient' as never)).toHaveLength(0);
  });
});
