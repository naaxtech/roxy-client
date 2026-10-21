import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
const mockBusinessQuery = jest.fn();
const mockProfileQuery = jest.fn();

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => mockProfileQuery(),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: (...args: unknown[]) => mockBusinessQuery(...args),
        }),
      };
    },
  },
}));

import { CreateSheet } from '../../../components/nav/CreateSheet';
import { THEMES } from '../../../lib/theme';

const APPROVED_SELLER = { is_verified: true, can_sell: true, stripe_account_id: 'acct_1' };
const IN_REVIEW_SELLER = { is_verified: false, can_sell: false, stripe_account_id: null };

beforeEach(() => {
  mockPush.mockClear();
  mockBusinessQuery.mockReset();
  mockBusinessQuery.mockResolvedValue({ data: [], error: null });
  mockProfileQuery.mockReset();
  mockProfileQuery.mockResolvedValue({ data: { official_community_id: null }, error: null });
});

/**
 * v2 Create sheet (design direction v2 › Create sheet): "Make something", ONE
 * large Post row, then one quiet line each for what else exists and who can
 * make it. The v0 sheet drew five tinted tiles, four of them padlocked for
 * almost everyone — a wall of locks in front of the one thing she can do.
 * Event stays a real row for an official community account (feature parity).
 */
describe('CreateSheet', () => {
  it('renders nothing and fetches nothing while closed', () => {
    const { queryByTestId } = render(<CreateSheet visible={false} userId="u1" onClose={jest.fn()} />);
    expect(queryByTestId('create-sheet')).toBeNull();
    expect(mockBusinessQuery).not.toHaveBeenCalled();
  });

  it('is titled "Make something" and leads with one large Post row', async () => {
    const { findByTestId, getByText } = render(<CreateSheet visible userId="u1" onClose={jest.fn()} />);
    expect(getByText('Make something')).toBeTruthy();
    const post = await findByTestId('create-kind-post');
    expect(post.props.accessibilityRole).toBe('button');
    expect(getByText('A photo, a video or a few words')).toBeTruthy();
  });

  it('names everything else she can make as quiet lines, not locked buttons', async () => {
    const { findByTestId, queryByTestId } = render(<CreateSheet visible userId="u1" onClose={jest.fn()} />);
    const communities = await findByTestId('create-line-communities');
    expect(communities.props.accessibilityRole).not.toBe('button');
    expect(String(communities.props.accessibilityLabel)).toBe(
      'Events, rooms and games come from communities. Ask an admin of one you’re in.',
    );
    const sell = await findByTestId('create-line-sell');
    expect(String(sell.props.accessibilityLabel)).toBe('Sell on Roxy — apply from You.');
    // A member gets no padlocked Event / Room / Product / Game rows any more.
    for (const kind of ['event', 'room', 'product', 'game']) {
      expect(queryByTestId(`create-kind-${kind}`)).toBeNull();
    }
  });

  it('unlocks Event for an official community account', async () => {
    mockProfileQuery.mockResolvedValue({ data: { official_community_id: 'c-official' }, error: null });
    const onClose = jest.fn();
    const { findByTestId } = render(<CreateSheet visible userId="u1" onClose={onClose} />);
    const event = await findByTestId('create-kind-event');
    expect(event.props.accessibilityRole).toBe('button');
    fireEvent.press(event);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/community/create-event' });
    expect(onClose).toHaveBeenCalled();
    // Rooms and games still come from Studio, even for a community account.
    const line = await findByTestId('create-line-communities');
    expect(String(line.props.accessibilityLabel)).toContain('Roxy Studio');
  });

  it('tells a woman who is not an approved seller where to apply', async () => {
    const { findByTestId } = render(<CreateSheet visible userId="u1" onClose={jest.fn()} />);
    const sell = await findByTestId('create-line-sell');
    expect(String(sell.props.accessibilityLabel)).toContain('apply from You');
  });

  it('tells a seller in review that she is in review', async () => {
    mockBusinessQuery.mockResolvedValue({ data: [IN_REVIEW_SELLER], error: null });
    const { findByTestId } = render(<CreateSheet visible userId="u1" onClose={jest.fn()} />);
    await waitFor(async () => {
      const sell = await findByTestId('create-line-sell');
      expect(String(sell.props.accessibilityLabel)).toContain('in review');
    });
  });

  it('tells an approved seller her shop items go on a post — never a dead Product button', async () => {
    mockBusinessQuery.mockResolvedValue({ data: [APPROVED_SELLER], error: null });
    const { findByTestId, queryByTestId } = render(<CreateSheet visible userId="u1" onClose={jest.fn()} />);
    await waitFor(async () => {
      const sell = await findByTestId('create-line-sell');
      expect(String(sell.props.accessibilityLabel)).toContain('Tag your shop items');
    });
    expect(queryByTestId('create-kind-product')).toBeNull();
  });

  it('keeps the apply line when the seller lookup fails', async () => {
    mockBusinessQuery.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { findByTestId } = render(<CreateSheet visible userId="u1" onClose={jest.fn()} />);
    const sell = await findByTestId('create-line-sell');
    expect(String(sell.props.accessibilityLabel)).toContain('apply from You');
  });

  it('opens the composer on her profile — never asks where the post goes', async () => {
    const onClose = jest.fn();
    const { findByTestId } = render(<CreateSheet visible userId="u1" onClose={onClose} />);
    fireEvent.press(await findByTestId('create-kind-post'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/community/create-post' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes without posting when she backs out', async () => {
    const onClose = jest.fn();
    const { getByLabelText } = render(<CreateSheet visible userId="u1" onClose={onClose} />);
    fireEvent.press(getByLabelText('Close'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('draws 24 dp outline icons in ink2 and no tinted tiles', async () => {
    const view = render(<CreateSheet visible userId="u1" onClose={jest.fn()} />);
    await view.findByTestId('create-line-sell');
    expect(view.UNSAFE_queryAllByType('LinearGradient' as never)).toHaveLength(0);
    for (const id of ['create-icon-post', 'create-icon-communities', 'create-icon-sell']) {
      const icon = view.getByTestId(id);
      expect(icon.props.size).toBe(24);
      expect(icon.props.color).toBe(THEMES.light.ink2);
      expect(String(icon.props.name)).toMatch(/-outline$/);
    }
    const post = view.getByTestId('create-kind-post');
    const flat = StyleSheet.flatten(post.props.style) as Record<string, unknown>;
    expect(Number(flat.minHeight)).toBeGreaterThanOrEqual(72);
  });
});
