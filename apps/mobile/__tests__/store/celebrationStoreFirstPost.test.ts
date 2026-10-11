import { act } from '@testing-library/react-native';

const mockClaim = jest.fn();
jest.mock('../../lib/firstPost', () => ({
  claimFirstPostCelebration: (...args: unknown[]) => mockClaim(...args),
}));
jest.mock('../../lib/badges', () => ({ fetchJustEarned: jest.fn(() => Promise.resolve([])) }));

import { useCelebrationStore } from '../../store/celebrationStore';

beforeEach(() => {
  mockClaim.mockReset();
  useCelebrationStore.setState({ firstPost: null, pending: [] });
});

describe('celebrationStore first post', () => {
  it('queues the moment when the claim says it is her first', async () => {
    mockClaim.mockResolvedValue(true);
    await act(async () => {
      await useCelebrationStore.getState().celebrateFirstPost('u1', 'photo');
    });

    expect(mockClaim).toHaveBeenCalledWith('u1');
    expect(useCelebrationStore.getState().firstPost).toEqual({ postType: 'photo' });
  });

  it('queues nothing when it is not her first', async () => {
    mockClaim.mockResolvedValue(false);
    await act(async () => {
      await useCelebrationStore.getState().celebrateFirstPost('u1', 'standard');
    });

    expect(useCelebrationStore.getState().firstPost).toBeNull();
  });

  it('dismisses', () => {
    useCelebrationStore.setState({ firstPost: { postType: 'video' } });
    useCelebrationStore.getState().dismissFirstPost();
    expect(useCelebrationStore.getState().firstPost).toBeNull();
  });
});
