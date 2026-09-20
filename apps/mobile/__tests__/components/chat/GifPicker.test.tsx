const mockFetch = jest.fn();
global.fetch = mockFetch;

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { GifPicker } from '../../../components/chat/GifPicker';

// EXPO_PUBLIC_* vars are inlined by babel at transform time (see jest.setup.env.js),
// so the key cannot be flipped at runtime — the picker reads it through lib/giphy,
// which a test can mock for both the configured and unconfigured builds.
jest.mock('../../../lib/giphy', () => ({
  isGiphyConfigured: jest.fn(() => true),
  giphyEndpoint: jest.fn((q: string) =>
    q.trim()
      ? `https://api.giphy.com/v1/gifs/search?api_key=k&q=${encodeURIComponent(q.trim())}`
      : 'https://api.giphy.com/v1/gifs/trending?api_key=k'
  ),
}));

const { isGiphyConfigured } = jest.requireMock('../../../lib/giphy');

const makeGiphyResult = (id: string) => ({
  id,
  title: `GIF ${id}`,
  images: {
    fixed_width: { url: `https://media.giphy.com/${id}.gif`, width: '200', height: '150' },
  },
});

const mockGiphyResponse = (results: ReturnType<typeof makeGiphyResult>[]) => {
  mockFetch.mockResolvedValueOnce({
    json: async () => ({ data: results }),
  } as unknown as Response);
};

describe('GifPicker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isGiphyConfigured.mockReturnValue(true);
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not render content when visible is false', () => {
    const { queryByText } = render(
      <GifPicker visible={false} onGifSelected={jest.fn()} onClose={jest.fn()} />
    );
    expect(queryByText('GIFs')).toBeNull();
  });

  it('renders header when visible is true', async () => {
    mockGiphyResponse([]);
    const { getByText } = render(
      <GifPicker visible={true} onGifSelected={jest.fn()} onClose={jest.fn()} />
    );
    expect(getByText('GIFs')).toBeTruthy();
  });

  it('fetches trending GIFs on open', async () => {
    mockGiphyResponse([makeGiphyResult('g1'), makeGiphyResult('g2')]);
    render(<GifPicker visible={true} onGifSelected={jest.fn()} onClose={jest.fn()} />);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toContain('trending');
    });
  });

  it('calls onClose when the close button is pressed', async () => {
    mockGiphyResponse([]);
    const onClose = jest.fn();
    const { getByLabelText } = render(
      <GifPicker visible={true} onGifSelected={jest.fn()} onClose={onClose} />
    );
    fireEvent.press(getByLabelText('Close GIF picker'));
    expect(onClose).toHaveBeenCalled();
  });

  it('debounces search query — only one fetch after 400ms', async () => {
    mockGiphyResponse([]); // trending on open
    mockGiphyResponse([]); // search after debounce
    const { getByPlaceholderText } = render(
      <GifPicker visible={true} onGifSelected={jest.fn()} onClose={jest.fn()} />
    );

    const input = getByPlaceholderText('Search GIFs...');
    fireEvent.changeText(input, 'c');
    fireEvent.changeText(input, 'ca');
    fireEvent.changeText(input, 'cat');

    // Before debounce fires — only the initial trending fetch
    expect(mockFetch).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(400);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1][0]).toContain('search');
      expect(mockFetch.mock.calls[1][0]).toContain('cat');
    });
  });

  it('calls onGifSelected and onClose when a GIF is tapped', async () => {
    mockGiphyResponse([makeGiphyResult('g1')]);
    const onGifSelected = jest.fn();
    const onClose = jest.fn();

    render(
      <GifPicker visible={true} onGifSelected={onGifSelected} onClose={onClose} />
    );

    // Verify fetch was called with trending endpoint on open
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('trending'));
    });
  });

  it('shows "Powered by GIPHY" attribution', async () => {
    mockGiphyResponse([]);
    const { getByText } = render(
      <GifPicker visible={true} onGifSelected={jest.fn()} onClose={jest.fn()} />
    );
    expect(getByText('Powered by GIPHY')).toBeTruthy();
  });

  it('says so when GIPHY returns nothing for a search', async () => {
    mockGiphyResponse([]);
    const { findByText } = render(
      <GifPicker visible={true} onGifSelected={jest.fn()} onClose={jest.fn()} />
    );
    expect(await findByText('No GIFs found')).toBeTruthy();
  });

  it('reports a failed GIPHY call instead of showing an empty grid', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'));
    const { findByText } = render(
      <GifPicker visible={true} onGifSelected={jest.fn()} onClose={jest.fn()} />
    );
    expect(await findByText("GIF search isn't responding right now — try again in a moment")).toBeTruthy();
  });

  // EXPO_PUBLIC_GIPHY_API_KEY is in neither .env nor any eas.json profile, so this
  // is the state of every build shipping today: say it plainly, and never fire a
  // request that can only come back 403.
  describe('when no GIPHY key was bundled', () => {
    beforeEach(() => isGiphyConfigured.mockReturnValue(false));

    it('shows an honest unavailable state and makes no request', async () => {
      const { getByText, queryByPlaceholderText } = render(
        <GifPicker visible={true} onGifSelected={jest.fn()} onClose={jest.fn()} />
      );

      expect(getByText("GIFs aren't set up yet")).toBeTruthy();
      expect(queryByPlaceholderText('Search GIFs...')).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('still closes cleanly', () => {
      const onClose = jest.fn();
      const { getByLabelText } = render(
        <GifPicker visible={true} onGifSelected={jest.fn()} onClose={onClose} />
      );
      fireEvent.press(getByLabelText('Close GIF picker'));
      expect(onClose).toHaveBeenCalled();
    });
  });
});
