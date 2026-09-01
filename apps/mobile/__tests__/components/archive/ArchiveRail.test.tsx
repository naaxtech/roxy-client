import { render, fireEvent } from '@testing-library/react-native';
import { ArchiveRail } from '../../../components/archive/ArchiveRail';
import type { ArchiveEntry } from '../../../lib/archive';

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

describe('ArchiveRail', () => {
  it('titles itself and offers the browse-all link with the real total', () => {
    const v = render(
      <ArchiveRail entries={[entry()]} total={214} onPressEntry={jest.fn()} onSeeAll={jest.fn()} />
    );
    expect(v.getByText('The WLW Archive')).toBeTruthy();
    expect(v.getByText('Browse all 214 →')).toBeTruthy();
  });

  it('renders a card per entry with its score and year', () => {
    const v = render(
      <ArchiveRail
        entries={[entry(), entry({ id: 'e2', slug: 'gentleman', title: 'Gentleman Jack', release_year: 2019, vote_count: 60, up_count: 33 })]}
        total={2}
        onPressEntry={jest.fn()}
        onSeeAll={jest.fn()}
      />
    );
    expect(v.getByText('Portrait of a Lady on Fire')).toBeTruthy();
    expect(v.getByText('Gentleman Jack')).toBeTruthy();
    expect(v.getByText('96%')).toBeTruthy();
    expect(v.getByText('2019 · 100 votes')).toBeTruthy();
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

  it('offers browse-all even when it has nothing to show', () => {
    const onSeeAll = jest.fn();
    const v = render(<ArchiveRail entries={[]} total={0} onPressEntry={jest.fn()} onSeeAll={onSeeAll} />);
    expect(v.getByTestId('archive-rail-empty')).toBeTruthy();
    fireEvent.press(v.getByTestId('archive-rail-link'));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it('shows a spinner while loading and an error with a retry', () => {
    const loading = render(
      <ArchiveRail entries={[]} total={0} status="loading" onPressEntry={jest.fn()} onSeeAll={jest.fn()} onRetry={jest.fn()} />
    );
    expect(loading.getByTestId('archive-rail-loading')).toBeTruthy();
    loading.unmount();

    const onRetry = jest.fn();
    const errored = render(
      <ArchiveRail entries={[]} total={0} status="error" onPressEntry={jest.fn()} onSeeAll={jest.fn()} onRetry={onRetry} />
    );
    expect(errored.getByTestId('archive-rail-error')).toBeTruthy();
    fireEvent.press(errored.getByText('Try again'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('explains what the Archive is, in the prototype words', () => {
    const v = render(<ArchiveRail entries={[entry()]} total={1} onPressEntry={jest.fn()} onSeeAll={jest.fn()} />);
    expect(
      v.getByText(
        'Films, shows, books, comics and music — scored by us, for us. Open to everyone, even while your membership is pending.'
      )
    ).toBeTruthy();
  });
});
