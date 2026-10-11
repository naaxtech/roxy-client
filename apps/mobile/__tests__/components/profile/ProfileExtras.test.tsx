import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockPrompts = jest.fn();
const mockShelf = jest.fn();
const mockSave = jest.fn();
jest.mock('../../../lib/profileExtras', () => {
  const actual = jest.requireActual('../../../lib/profileExtras');
  return {
    ...actual,
    fetchProfilePrompts: (...a: unknown[]) => mockPrompts(...a),
    fetchArchiveShelf: (...a: unknown[]) => mockShelf(...a),
    savePromptAnswer: (...a: unknown[]) => mockSave(...a),
  };
});
jest.mock('../../../lib/errorLogger', () => ({ logError: jest.fn() }));

import { ProfileExtras, ProfilePromptsEditor } from '../../../components/profile/ProfileExtras';

beforeEach(() => {
  mockPrompts.mockReset().mockResolvedValue([]);
  mockShelf.mockReset().mockResolvedValue([]);
  mockSave.mockReset().mockResolvedValue(undefined);
});

describe('ProfileExtras (delight: prompts + Archive top four)', () => {
  it('renders nothing when there is nothing she may see', async () => {
    const r = render(<ProfileExtras userId="u2" />);
    await act(async () => { await Promise.resolve(); });
    expect(r.queryByTestId('profile-extras')).toBeNull();
  });

  it('shows up to three answer cards and the shelf, and a poster opens the entry', async () => {
    mockPrompts.mockResolvedValue([
      { prompt_key: 'comfort_show', answer: 'Feel Good' },
      { prompt_key: 'green_flag', answer: 'Texts back' },
      { prompt_key: 'find_me_at', answer: 'The climbing wall' },
      { prompt_key: 'ask_me_about', answer: 'Fourth one' },
    ]);
    mockShelf.mockResolvedValue([{ slot: 1, id: 'e1', slug: 'carol', title: 'Carol', media_type: 'film', cover_gradient: null }]);
    const onOpenEntry = jest.fn();
    const r = render(<ProfileExtras userId="u2" onOpenEntry={onOpenEntry} />);
    await waitFor(() => expect(r.getByTestId('profile-extras')).toBeTruthy());
    expect(r.getByText('My comfort show is…')).toBeTruthy();
    expect(r.getByText('Texts back')).toBeTruthy();
    expect(r.queryByText('Fourth one')).toBeNull();
    fireEvent.press(r.getByTestId('profile-extras-shelf-carol'));
    expect(onOpenEntry).toHaveBeenCalledWith('carol');
  });
});

describe('ProfilePromptsEditor', () => {
  it('saves an answer on blur and caps it at 150', async () => {
    const r = render(<ProfilePromptsEditor userId="me" />);
    await act(async () => { await Promise.resolve(); });
    const input = r.getByTestId('prompt-input-comfort_show');
    expect(input.props.maxLength).toBe(150);
    fireEvent.changeText(input, 'Carol on repeat');
    await act(async () => { fireEvent(input, 'blur'); });
    expect(mockSave).toHaveBeenCalledWith('me', 'comfort_show', 'Carol on repeat');
  });

  it('locks the other questions once three are answered', async () => {
    mockPrompts.mockResolvedValue([
      { prompt_key: 'comfort_show', answer: 'a' },
      { prompt_key: 'green_flag', answer: 'b' },
      { prompt_key: 'find_me_at', answer: 'c' },
    ]);
    const r = render(<ProfilePromptsEditor userId="me" />);
    await waitFor(() => expect(r.getByTestId('prompt-input-ask_me_about').props.editable).toBe(false));
    expect(r.getByTestId('prompt-input-comfort_show').props.editable).toBe(true);
  });
});
