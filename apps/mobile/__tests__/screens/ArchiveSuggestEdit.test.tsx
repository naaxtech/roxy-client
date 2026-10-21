/**
 * Suggest an edit (M158), v2: the cover field. Design direction › Archive:
 * "Add a cover" opens Suggest an edit with the cover field focused, and after
 * sending: "Sent to the Archive team. It shows here once it's approved."
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

const mockBack = jest.fn();
let mockParams: Record<string, string> = { slug: 'carol' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, replace: jest.fn(), push: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('../../hooks/useMembership', () => ({
  useMembership: () => ({ status: 'approved', canReview: true, canEdit: true, canBrowseArchive: true }),
}));
jest.mock('../../lib/analytics', () => ({ Analytics: { archiveEditSubmitted: jest.fn() } }));
const mockSubmitEdit = jest.fn();
jest.mock('../../components/archive/composerActions', () => {
  const actual = jest.requireActual('../../components/archive/composerActions');
  return { ...actual, submitEdit: (...a: unknown[]) => mockSubmitEdit(...a) };
});
// One stable object, like the real hook's state: a fresh object per render
// would re-run the screen's prefill effect and wipe what she typed.
const mockComposerEntry = {
  entry: {
    id: 'e1', slug: 'carol', title: 'Carol', creator: 'Todd Haynes', length_label: '1h 58m',
    summary: 'A shopgirl.', cover_url: null,
  },
  status: 'ready',
};
jest.mock('../../components/archive/useComposerEntry', () => ({
  useComposerEntry: () => mockComposerEntry,
}));
jest.mock('../../lib/supabase', () => ({ supabase: {}, callEdgeFunction: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import SuggestEditScreen from '../../app/archive/[slug]/edit';
import { useArchiveStore } from '../../store/archiveStore';

beforeEach(() => {
  mockParams = { slug: 'carol' };
  mockBack.mockReset();
  mockSubmitEdit.mockReset().mockResolvedValue({ data: { revision_id: 'rev1' }, error: null });
  useArchiveStore.setState({ flash: null } as never);
});

describe('Suggest an edit: the cover', () => {
  it('has a cover field, focused when she came from "Add a cover"', () => {
    mockParams = { slug: 'carol', focus: 'cover' };
    const r = render(<SuggestEditScreen />);
    expect(r.getByTestId('archive-edit-cover').props.autoFocus).toBe(true);
    expect(r.getByTestId('archive-edit-title').props.autoFocus).toBeFalsy();
  });

  it('does not grab focus when she opened it for something else', () => {
    const r = render(<SuggestEditScreen />);
    expect(r.getByTestId('archive-edit-cover').props.autoFocus).toBeFalsy();
  });

  it('sends only the cover link she added, then says it went to the Archive team', async () => {
    const r = render(<SuggestEditScreen />);
    fireEvent.changeText(r.getByTestId('archive-edit-cover'), ' https://example.test/carol.jpg ');
    await act(async () => { fireEvent.press(r.getByTestId('archive-edit-submit')); });
    expect(mockSubmitEdit).toHaveBeenCalledWith('e1', { cover_url: 'https://example.test/carol.jpg' });
    expect(useArchiveStore.getState().flash).toBe('Sent to the Archive team. It shows here once it’s approved.');
    expect(mockBack).toHaveBeenCalled();
  });

  it('refuses a cover that is not a web link, in words, and sends nothing', async () => {
    const r = render(<SuggestEditScreen />);
    fireEvent.changeText(r.getByTestId('archive-edit-cover'), 'carol.jpg');
    await act(async () => { fireEvent.press(r.getByTestId('archive-edit-submit')); });
    expect(mockSubmitEdit).not.toHaveBeenCalled();
    expect(r.getByText('Use a link that starts with https://')).toBeTruthy();
  });

  it('labels fields in sentence case, not tracked capitals', () => {
    const r = render(<SuggestEditScreen />);
    expect(r.getByText('Cover image link')).toBeTruthy();
    expect(r.queryByText('COVER IMAGE LINK')).toBeNull();
    expect(r.queryByText('TITLE')).toBeNull();
  });
});
