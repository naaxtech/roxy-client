/**
 * ARC-04 / ARC-05 / ARC-09 / ARC-15 — the Archive composers.
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace, push: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({ slug: 'carol' }),
}));
jest.mock('../../hooks/useMembership', () => ({
  useMembership: () => ({ status: 'approved', canReview: true, canEdit: true, canBrowseArchive: true }),
}));
jest.mock('../../lib/analytics', () => ({
  Analytics: { archiveEntrySubmitted: jest.fn(), archiveReviewPublished: jest.fn() },
}));
const mockSubmitEntry = jest.fn();
const mockSubmitReview = jest.fn();
jest.mock('../../components/archive/composerActions', () => {
  const actual = jest.requireActual('../../components/archive/composerActions');
  return {
    ...actual,
    submitEntry: (...a: unknown[]) => mockSubmitEntry(...a),
    submitReview: (...a: unknown[]) => mockSubmitReview(...a),
  };
});
jest.mock('../../components/archive/useComposerEntry', () => ({
  useComposerEntry: () => ({ entry: { id: 'e1', slug: 'carol', title: 'Carol' }, status: 'ready' }),
}));
jest.mock('../../lib/supabase', () => ({ supabase: {}, callEdgeFunction: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import AddArchiveEntryScreen from '../../app/archive/new';
import WriteReviewScreen from '../../app/archive/[slug]/review';
import { archiveSubmitError, validateReleaseYear } from '../../components/archive/composerActions';
import { useArchiveStore } from '../../store/archiveStore';

beforeEach(() => {
  mockSubmitEntry.mockReset();
  mockSubmitReview.mockReset();
  mockBack.mockReset();
  useArchiveStore.setState({ flash: null } as never);
});

describe('Suggest a new entry (ARC-04, ARC-09, ARC-15)', () => {
  it('a BOOK is filed as a book — every type is selectable', async () => {
    mockSubmitEntry.mockResolvedValue({ data: { entry_id: 'x' }, error: null });
    const r = render(<AddArchiveEntryScreen />);
    fireEvent.changeText(r.getByTestId('archive-add-title'), 'Fingersmith');
    fireEvent.press(r.getByTestId('archive-add-type-book'));
    expect(r.getByTestId('archive-add-type-book').props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
    expect(r.getByTestId('archive-add-type-film').props.accessibilityState).toEqual(expect.objectContaining({ checked: false }));
    await act(async () => { fireEvent.press(r.getByTestId('archive-add-submit')); });
    expect(mockSubmitEntry).toHaveBeenCalledWith(expect.objectContaining({ media_type: 'book', title: 'Fingersmith' }));
  });

  it('a junk year is caught inline and nothing is sent', async () => {
    const r = render(<AddArchiveEntryScreen />);
    fireEvent.changeText(r.getByTestId('archive-add-title'), 'Carol');
    fireEvent.changeText(r.getByTestId('archive-add-year'), '0999');
    await act(async () => { fireEvent.press(r.getByTestId('archive-add-submit')); });
    expect(mockSubmitEntry).not.toHaveBeenCalled();
    expect(r.getByText(/year between 1800 and/)).toBeTruthy();
  });

  it('after sending, she is told it went to the Archive team (flash for the Archive screen)', async () => {
    mockSubmitEntry.mockResolvedValue({ data: { entry_id: 'x' }, error: null });
    const r = render(<AddArchiveEntryScreen />);
    fireEvent.changeText(r.getByTestId('archive-add-title'), 'Carol');
    await act(async () => { fireEvent.press(r.getByTestId('archive-add-submit')); });
    expect(useArchiveStore.getState().flash).toMatch(/Sent to the Archive team/);
    // v2 bans the flower anywhere, including this line's old ✿.
    expect(useArchiveStore.getState().flash).not.toMatch(/✿/);
    expect(mockBack).toHaveBeenCalled();
  });

  it('a raw server sentence becomes a human one', async () => {
    // The real submitEntry, over an edge function answering in developer-speak.
    const { callEdgeFunction } = jest.requireMock('../../lib/supabase') as { callEdgeFunction: jest.Mock };
    callEdgeFunction.mockResolvedValue({ data: null, error: 'Rate limit exceeded' });
    const actual = jest.requireActual('../../components/archive/composerActions');
    mockSubmitEntry.mockImplementation((d: unknown) => actual.submitEntry(d));
    const r = render(<AddArchiveEntryScreen />);
    fireEvent.changeText(r.getByTestId('archive-add-title'), 'Carol');
    await act(async () => { fireEvent.press(r.getByTestId('archive-add-submit')); });
    expect(r.queryByText('Rate limit exceeded')).toBeNull();
    expect(r.getByText(/a lot in a short time/)).toBeTruthy();
  });
});

describe('Write a review (ARC-04)', () => {
  it('👎 is reachable and is what gets published', async () => {
    mockSubmitReview.mockResolvedValue({ data: { id: 'r1' }, error: null });
    const r = render(<WriteReviewScreen />);
    fireEvent.press(r.getByTestId('archive-review-down'));
    fireEvent.changeText(r.getByTestId('archive-review-body'), 'Not for me.');
    fireEvent.press(r.getByTestId('archive-review-ack'));
    await act(async () => { fireEvent.press(r.getByTestId('archive-review-submit')); });
    expect(mockSubmitReview).toHaveBeenCalledWith('e1', 'Not for me.', false, true);
  });

  it('no verdict is assumed: publish stays off until she picks 👍 or 👎', async () => {
    mockSubmitReview.mockResolvedValue({ data: { id: 'r1' }, error: null });
    const r = render(<WriteReviewScreen />);
    fireEvent.changeText(r.getByTestId('archive-review-body'), 'Hmm.');
    fireEvent.press(r.getByTestId('archive-review-ack'));
    await act(async () => { fireEvent.press(r.getByTestId('archive-review-submit')); });
    expect(mockSubmitReview).not.toHaveBeenCalled();
    fireEvent.press(r.getByTestId('archive-review-up'));
    await act(async () => { fireEvent.press(r.getByTestId('archive-review-submit')); });
    expect(mockSubmitReview).toHaveBeenCalledWith('e1', 'Hmm.', true, true);
  });
});

describe('helpers', () => {
  it('validateReleaseYear', () => {
    const now = new Date().getFullYear();
    expect(validateReleaseYear('')).toEqual({ year: null, error: null });
    expect(validateReleaseYear('2019')).toEqual({ year: 2019, error: null });
    expect(validateReleaseYear('20x9').error).toBeTruthy();
    expect(validateReleaseYear('0999').error).toBeTruthy();
    expect(validateReleaseYear(String(now + 6)).error).toBeTruthy();
    expect(validateReleaseYear(String(now + 5)).error).toBeNull();
  });
  it('archiveSubmitError never passes a developer string through', () => {
    expect(archiveSubmitError('release_year must be an integer between 1800 and 2200', 'x')).toMatch(/year/);
    expect(archiveSubmitError('Approved membership required to add to the Archive', 'x')).toMatch(/approved/i);
    expect(archiveSubmitError('duplicate key value violates unique constraint', 'fallback')).toBe('fallback');
  });
});
