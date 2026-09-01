import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
const mockMembersQuery = jest.fn();
const mockBusinessQuery = jest.fn();

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
// Table-aware: the sheet asks two questions now — which rooms she is in, and
// whether she may sell. A single shared mock let the seller lookup eat the
// membership response and the sheet reported a network failure that never was.
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: (...args: unknown[]) =>
          table === 'businesses' ? mockBusinessQuery(...args) : mockMembersQuery(...args),
      }),
    }),
  },
}));

import { CreateSheet } from '../../../components/nav/CreateSheet';
import { TAB_MIN_TOUCH } from '../../../components/nav/navTokens';

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, number | string>;

const room = (id: string, name: string) => ({ community_id: id, communities: { id, name } });
const APPROVED_SELLER = { is_verified: true, can_sell: true, stripe_account_id: 'acct_1' };

/** Walk past the "what are you making?" step to the room picker. */
async function chooseePost(findByTestId: (id: string) => Promise<unknown>) {
  fireEvent.press((await findByTestId('create-kind-post')) as never);
}

beforeEach(() => {
  mockPush.mockClear();
  mockMembersQuery.mockReset();
  mockBusinessQuery.mockReset();
  mockBusinessQuery.mockResolvedValue({ data: [], error: null });
});

describe('CreateSheet', () => {
  it('renders nothing and fetches nothing while closed', () => {
    mockMembersQuery.mockResolvedValue({ data: [], error: null });
    const { queryByTestId } = render(<CreateSheet visible={false} userId="u1" onClose={jest.fn()} />);
    expect(queryByTestId('create-sheet')).toBeNull();
    expect(mockMembersQuery).not.toHaveBeenCalled();
  });

  it('shows a loading state while her rooms are still coming back', () => {
    mockMembersQuery.mockReturnValue(new Promise(() => {}));
    const { getByTestId } = render(<CreateSheet visible userId="u1" onClose={jest.fn()} />);
    expect(getByTestId('create-sheet-loading')).toBeTruthy();
  });

  it('offers all five things the design says you can make', async () => {
    mockMembersQuery.mockResolvedValue({ data: [room('c1', 'The Sapphic Club')], error: null });
    const { findByTestId } = render(<CreateSheet visible userId="u1" onClose={jest.fn()} />);
    for (const kind of ['post', 'event', 'room', 'product', 'game']) {
      expect(await findByTestId(`create-kind-${kind}`)).toBeTruthy();
    }
  });

  /**
   * The point of the whole sheet: a row that cannot do anything says why, out
   * loud, to a screen reader as well as on screen. A disabled button with no
   * reason teaches a woman that the ＋ lies.
   */
  it('says why a row is unavailable instead of failing silently', async () => {
    mockMembersQuery.mockResolvedValue({ data: [room('c1', 'The Sapphic Club')], error: null });
    const { findByTestId } = render(<CreateSheet visible userId="u1" onClose={jest.fn()} />);
    const event = await findByTestId('create-kind-event');
    expect(event.props.accessibilityState).toEqual({ disabled: true });
    expect(String(event.props.accessibilityLabel)).toContain('Roxy Studio');
  });

  it('locks Product for a woman who has not been approved to sell', async () => {
    mockMembersQuery.mockResolvedValue({ data: [room('c1', 'The Sapphic Club')], error: null });
    const { findByTestId } = render(<CreateSheet visible userId="u1" onClose={jest.fn()} />);
    const product = await findByTestId('create-kind-product');
    expect(product.props.accessibilityState).toEqual({ disabled: true });
    expect(String(product.props.accessibilityLabel)).toContain('Approved sellers only');
  });

  it('unlocks Product only when Stripe, verification and permission all agree', async () => {
    mockMembersQuery.mockResolvedValue({ data: [room('c1', 'The Sapphic Club')], error: null });
    mockBusinessQuery.mockResolvedValue({ data: [APPROVED_SELLER], error: null });
    const { findByTestId } = render(<CreateSheet visible userId="u1" onClose={jest.fn()} />);
    const product = await findByTestId('create-kind-product');
    expect(product.props.accessibilityState).toEqual({ disabled: false });
  });

  // Fail-closed: an unknown answer about permission is never a yes.
  it('keeps Product locked when the seller lookup fails', async () => {
    mockMembersQuery.mockResolvedValue({ data: [room('c1', 'The Sapphic Club')], error: null });
    mockBusinessQuery.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { findByTestId } = render(<CreateSheet visible userId="u1" onClose={jest.fn()} />);
    const product = await findByTestId('create-kind-product');
    expect(product.props.accessibilityState).toEqual({ disabled: true });
  });

  it('lists her rooms and opens the existing composer for the one she picks', async () => {
    mockMembersQuery.mockResolvedValue({
      data: [room('c1', 'The Sapphic Club'), room('c2', 'Manila WLW')],
      error: null,
    });
    const onClose = jest.fn();
    const { findByText, findByTestId, getByTestId } = render(
      <CreateSheet visible userId="u1" onClose={onClose} />
    );
    await chooseePost(findByTestId as never);
    await findByText('The Sapphic Club');
    fireEvent.press(getByTestId('create-sheet-room-c2'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/community/create-post',
      params: { communityId: 'c2' },
    });
    expect(onClose).toHaveBeenCalled();
  });

  // One room is not a choice, and asking anyway is a tax on the common case.
  it('still asks where the post goes when she is in exactly one community', async () => {
    // It used to skip straight into that community, on the reasoning that one
    // room is no question worth asking. Her own profile is now a destination
    // too, so with one community there are two answers and the question is
    // real again.
    mockMembersQuery.mockResolvedValue({ data: [room('c1', 'The Sapphic Club')], error: null });
    const { findByTestId } = render(<CreateSheet visible userId="u1" onClose={jest.fn()} />);
    await chooseePost(findByTestId as never);
    expect(mockPush).not.toHaveBeenCalled();
    expect(await findByTestId('create-sheet-profile')).toBeTruthy();
    expect(await findByTestId('create-sheet-room-c1')).toBeTruthy();
  });

  it('offers her profile above her communities, and posts there with no community', async () => {
    mockMembersQuery.mockResolvedValue({ data: [room('c1', 'The Sapphic Club')], error: null });
    const { findByTestId } = render(<CreateSheet visible userId="u1" onClose={jest.fn()} />);
    await chooseePost(findByTestId as never);
    fireEvent.press(await findByTestId('create-sheet-profile'));
    // No params at all: the composer reads an absent communityId as her profile.
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/community/create-post' });
  });

  it('gives each room row a real 44pt touch target', async () => {
    mockMembersQuery.mockResolvedValue({
      data: [room('c1', 'The Sapphic Club'), room('c2', 'Manila WLW')],
      error: null,
    });
    const { findByTestId } = render(<CreateSheet visible userId="u1" onClose={jest.fn()} />);
    await chooseePost(findByTestId as never);
    const row = await findByTestId('create-sheet-room-c1');
    expect(Number(flat(row).minHeight)).toBeGreaterThanOrEqual(TAB_MIN_TOUCH);
    expect(row.props.hitSlop).toBeUndefined();
  });

  it('posts to her profile when she is in no communities, instead of locking Post', async () => {
    // Post used to be a dead control until she joined something — the one row
    // in this sheet that refused her. A post no longer needs a community to
    // land in, so there is no such state left to lock.
    mockMembersQuery.mockResolvedValue({ data: [], error: null });
    const { findByTestId } = render(<CreateSheet visible userId="u1" onClose={jest.fn()} />);
    const post = await findByTestId('create-kind-post');
    expect(post.props.accessibilityState).not.toEqual({ disabled: true });
    fireEvent.press(post);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/community/create-post' });
  });

  it('surfaces a failure with a retry rather than an empty list', async () => {
    mockMembersQuery.mockResolvedValueOnce({ data: null, error: { message: 'network' } });
    const { findByTestId, findByText } = render(<CreateSheet visible userId="u1" onClose={jest.fn()} />);
    await findByText('We could not load your rooms.');

    mockMembersQuery.mockResolvedValueOnce({
      data: [room('c1', 'The Sapphic Club'), room('c2', 'Manila WLW')],
      error: null,
    });
    fireEvent.press(await findByTestId('create-sheet-retry'));
    await chooseePost(findByTestId as never);
    await findByText('The Sapphic Club');
    expect(mockMembersQuery).toHaveBeenCalledTimes(2);
  });

  it('closes without posting when she backs out', async () => {
    mockMembersQuery.mockResolvedValue({ data: [], error: null });
    const onClose = jest.fn();
    const { getByLabelText } = render(<CreateSheet visible userId="u1" onClose={onClose} />);
    fireEvent.press(getByLabelText('Close'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockPush).not.toHaveBeenCalled();
  });
});
