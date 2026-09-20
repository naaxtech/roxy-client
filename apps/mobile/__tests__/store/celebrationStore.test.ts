import { useCelebrationStore } from '../../store/celebrationStore';

const mockFetch = jest.fn();
jest.mock('../../lib/badges', () => ({
  fetchJustEarned: (...a: unknown[]) => mockFetch(...a),
}));

const badge = (id: string) => ({
  id, name: `Badge ${id}`, emoji: '🏅', description: 'why', points: 10,
});

beforeEach(() => {
  mockFetch.mockReset();
  useCelebrationStore.setState({ pending: [] });
});

describe('celebrate', () => {
  it('queues the badges the server says just landed', async () => {
    mockFetch.mockResolvedValue([badge('a'), badge('b')]);
    await useCelebrationStore.getState().celebrate(2);
    expect(mockFetch).toHaveBeenCalledWith(2);
    expect(useCelebrationStore.getState().pending).toHaveLength(2);
  });

  it('asks nothing when nothing was earned', async () => {
    await useCelebrationStore.getState().celebrate(0);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(useCelebrationStore.getState().pending).toEqual([]);
  });

  it('never opens an empty celebration', async () => {
    // fetchJustEarned returns [] on a failed read. A blank card she taps
    // through teaches her the reward means nothing — worse than missing it.
    mockFetch.mockResolvedValue([]);
    await useCelebrationStore.getState().celebrate(3);
    expect(useCelebrationStore.getState().pending).toEqual([]);
  });
});

describe('dismiss', () => {
  it('clears the queue so the same badge is not celebrated twice', () => {
    useCelebrationStore.setState({ pending: [badge('a')] });
    useCelebrationStore.getState().dismiss();
    expect(useCelebrationStore.getState().pending).toEqual([]);
  });
});
