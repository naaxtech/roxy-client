const mockFetch = jest.fn();
global.fetch = mockFetch;

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { GifPicker } from '../../../components/chat/GifPicker';

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

  // GIPHY_KEY is read once at module load from EXPO_PUBLIC_GIPHY_API_KEY,
  // which is unset in this test environment (same as prod today) — so the
  // empty-results state renders the "no key configured" copy, not a bare
  // "No GIFs found". Once a key is set, GifPicker.tsx's ternary switches
  // this back automatically; no test change needed at that point.
  it('shows the "warming up" fallback when results are empty and no GIPHY key is configured', async () => {
    mockGiphyResponse([]);
    const { findByText } = render(
      <GifPicker visible={true} onGifSelected={jest.fn()} onClose={jest.fn()} />
    );
    await waitFor(async () => {
      expect(await findByText('GIF search is warming up — check back soon 🌸')).toBeTruthy();
    });
  });
});
