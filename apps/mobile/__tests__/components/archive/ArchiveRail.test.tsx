import { render, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ArchiveRail } from '../../../components/archive/ArchiveRail';
import type { ArchiveEntry } from '../../../lib/archive';
import { identityFor } from '../../../lib/theme';
import { COVER_ASPECT, COVER_WIDTH } from '../../../components/archive/archiveTokens';

jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, string | number>;

const hidden = { includeHiddenElements: true } as const;

const entry = (over: Partial<ArchiveEntry> = {}): ArchiveEntry => ({
  id: 'e1',
  slug: 'portrait',
  title: 'Portrait of a Lady on Fire',
  media_type: 'film',
  release_year: 2019,
  creator: 'Céline Sciamma',
  length_label: '2h 2m',
  summary: 'A painter and her subject.',
  cover_url: null,
  cover_gradient: null,
  vote_count: 100,
  up_count: 96,
  review_count: 41,
  has_score: true,
  published_at: '2026-08-01T00:00:00Z',
  ...over,
});

/**
 * v2 (design direction › Discover + Archive, board v2-05 "From the Archive"):
 * a section with a title and "See all" only when there is more, covers at 2:3
 * with the title and "Type · year" under them, the score in words.
 */
describe('ArchiveRail', () => {
  it('titles itself like the other Discover sections and offers See all when there is more', () => {
    const onSeeAll = jest.fn();
    const v = render(
      <ArchiveRail entries={[entry()]} total={214} onPressEntry={jest.fn()} onSeeAll={onSeeAll} />
    );
    expect(v.getByText('From the Archive')).toBeTruthy();
    expect(v.getByText('See all')).toBeTruthy();
    expect(v.getByTestId('archive-rail-link').props.accessibilityLabel).toBe('See all 214 Archive entries');
    fireEvent.press(v.getByTestId('archive-rail-link'));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it('hides See all when the rail already shows everything', () => {
    const v = render(
      <ArchiveRail entries={[entry()]} total={1} onPressEntry={jest.fn()} onSeeAll={jest.fn()} />
    );
    expect(v.queryByText('See all')).toBeNull();
  });

  it('renders a card per entry with its title, type · year and the score in words', () => {
    const v = render(
      <ArchiveRail
        entries={[entry(), entry({ id: 'e2', slug: 'gentleman', title: 'Gentleman Jack', media_type: 'tv', release_year: 2019, vote_count: 60, up_count: 33 })]}
        total={2}
        onPressEntry={jest.fn()}
        onSeeAll={jest.fn()}
      />
    );
    expect(v.getByText('Portrait of a Lady on Fire')).toBeTruthy();
    expect(v.getByText('Gentleman Jack')).toBeTruthy();
    expect(v.getByText('96% from 100 members')).toBeTruthy();
    expect(v.getByText('Movies · 2019')).toBeTruthy();
    expect(v.getByText('Series · 2019')).toBeTruthy();
  });

  it('hands back the entry that was tapped, not its index', () => {
    const onPressEntry = jest.fn();
    const second = entry({ id: 'e2', slug: 'gentleman', title: 'Gentleman Jack' });
    const v = render(
      <ArchiveRail entries={[entry(), second]} total={2} onPressEntry={onPressEntry} onSeeAll={jest.fn()} />
    );
    fireEvent.press(v.getByTestId('archive-rail-card-gentleman'));
    expect(onPressEntry).toHaveBeenCalledWith(second);
  });

  it('offers the way into the Archive in words even when it has nothing to show', () => {
    const onSeeAll = jest.fn();
    const v = render(<ArchiveRail entries={[]} total={0} onPressEntry={jest.fn()} onSeeAll={onSeeAll} />);
    expect(v.getByTestId('archive-rail-empty')).toBeTruthy();
    // v2 copy: never "Browse all 0 →"; the empty state says the next step.
    expect(v.queryByText(/Browse all 0/)).toBeNull();
    fireEvent.press(v.getByTestId('archive-rail-link'));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it('loads as skeleton covers at their final size, and errors with a retry', () => {
    const loading = render(
      <ArchiveRail entries={[]} total={0} status="loading" onPressEntry={jest.fn()} onSeeAll={jest.fn()} onRetry={jest.fn()} />
    );
    expect(loading.getByTestId('archive-rail-loading')).toBeTruthy();
    const bone = flat(loading.getAllByTestId('archive-rail-skeleton')[0]);
    expect(bone.width).toBe(COVER_WIDTH.rail);
    expect(bone.height).toBe(COVER_WIDTH.rail * COVER_ASPECT);
    loading.unmount();

    const onRetry = jest.fn();
    const errored = render(
      <ArchiveRail entries={[]} total={0} status="error" onPressEntry={jest.fn()} onSeeAll={jest.fn()} onRetry={onRetry} />
    );
    expect(errored.getByTestId('archive-rail-error')).toBeTruthy();
    fireEvent.press(errored.getByText('Try again'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('carries no blurb under the heading: the section title is enough (v2 sections)', () => {
    const v = render(<ArchiveRail entries={[entry()]} total={1} onPressEntry={jest.fn()} onSeeAll={jest.fn()} />);
    expect(v.queryByText(/scored by us, for us/)).toBeNull();
  });

  it('shows each entry’s own cover: the designed type cover in its identity field, never a gradient', () => {
    const v = render(
      <ArchiveRail
        entries={[entry({ id: 'carol-id', slug: 'carol', cover_gradient: 'linear-gradient(160deg,#1E2A4E,#4A3A7A 55%,#D98A5E)' })]}
        total={45}
        onPressEntry={() => {}}
        onSeeAll={() => {}}
      />,
    );
    expect(flat(v.getByTestId('archive-rail-art-carol-type', hidden)).backgroundColor).toBe(identityFor('carol-id'));
    expect(v.UNSAFE_queryAllByType('LinearGradient' as never)).toHaveLength(0);
  });
});
