import { render, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ArchiveRow } from '../../../components/archive/ArchiveRow';
import type { ArchiveEntry } from '../../../lib/archive';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';
import { THEMES } from '../../../lib/theme';
import { useThemeStore } from '../../../store/themeStore';

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, string | number>;

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

describe('ArchiveRow', () => {
  it('renders title, meta, blurb and review count', () => {
    const v = render(<ArchiveRow entry={entry()} onPress={jest.fn()} />);
    expect(v.getByText('Portrait of a Lady on Fire')).toBeTruthy();
    expect(v.getByText('2019 · Céline Sciamma · 100 votes')).toBeTruthy();
    expect(v.getByText('A painter and her subject, on an island, running out of days.')).toBeTruthy();
    expect(v.getByText('41 reviews')).toBeTruthy();
  });

  it('says Unreviewed when nobody has rated it', () => {
    const v = render(<ArchiveRow entry={entry({ vote_count: 0, up_count: 0, has_score: false })} onPress={jest.fn()} />);
    expect(v.getByText('Unreviewed')).toBeTruthy();
    expect(v.queryByText('0%')).toBeNull();
  });

  it('shows the rating beside its sample size from the first vote', () => {
    const v = render(<ArchiveRow entry={entry({ vote_count: 1, up_count: 1, has_score: false })} onPress={jest.fn()} />);
    expect(v.getByText('100%')).toBeTruthy();
    // The count travels with the number, so 100% is never bare.
    expect(v.getByText(/1 vote/)).toBeTruthy();
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
    expect(v.getByText('100 votes')).toBeTruthy();
    expect(v.getByText('Portrait of a Lady on Fire')).toBeTruthy();
  });

  it('names the media type on the cover', () => {
    const v = render(<ArchiveRow entry={entry({ media_type: 'tv' })} onPress={jest.fn()} />);
    expect(v.getByText('TV')).toBeTruthy();
  });

  it('is one button, announced as a sentence, at the touch-target floor', () => {
    const v = render(<ArchiveRow entry={entry()} onPress={jest.fn()} testID="row" />);
    const row = v.getByTestId('row');
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityLabel).toContain('Portrait of a Lady on Fire');
    expect(row.props.accessibilityLabel).toContain('96%');
    expect(flat(row).minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });

  it('calls back on press', () => {
    const onPress = jest.fn();
    const v = render(<ArchiveRow entry={entry()} onPress={onPress} testID="row" />);
    fireEvent.press(v.getByTestId('row'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('takes its card colours from the active theme', () => {
    const dark = render(<ArchiveRow entry={entry()} onPress={jest.fn()} testID="row" />);
    expect(flat(dark.getByTestId('row')).backgroundColor).toBe(THEMES.dark.surface);
    dark.unmount();

    useThemeStore.setState({ theme: 'light' });
    const light = render(<ArchiveRow entry={entry()} onPress={jest.fn()} testID="row" />);
    expect(flat(light.getByTestId('row')).backgroundColor).toBe(THEMES.light.surface);
  });

  it('falls back to the gradient plate when the cover image fails', () => {
    const v = render(<ArchiveRow entry={entry({ cover_url: 'https://example.test/a.jpg' })} onPress={jest.fn()} testID="row" />);
    expect(v.getByTestId('row-cover-image')).toBeTruthy();
    fireEvent(v.getByTestId('row-cover-image'), 'error');
    expect(v.queryByTestId('row-cover-image')).toBeNull();
  });
});
