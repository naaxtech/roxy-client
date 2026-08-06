import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
const mockMembersQuery = jest.fn();

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: (...args: unknown[]) => mockMembersQuery(...args) }),
    }),
  },
}));

import { CreateSheet } from '../../../components/nav/CreateSheet';
import { TAB_MIN_TOUCH } from '../../../components/nav/navTokens';

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, number | string>;

const room = (id: string, name: string) => ({ community_id: id, communities: { id, name } });

beforeEach(() => {
  mockPush.mockClear();
  mockMembersQuery.mockReset();
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

  it('lists her rooms and opens the existing composer for the one she picks', async () => {
    mockMembersQuery.mockResolvedValue({
      data: [room('c1', 'The Sapphic Club'), room('c2', 'Manila WLW')],
      error: null,
    });
    const onClose = jest.fn();
    const { findByText, getByTestId } = render(<CreateSheet visible userId="u1" onClose={onClose} />);
    await findByText('The Sapphic Club');
    fireEvent.press(getByTestId('create-sheet-room-c2'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/community/create-post',
      params: { communityId: 'c2' },
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('gives each room row a real 44pt touch target', async () => {
    mockMembersQuery.mockResolvedValue({ data: [room('c1', 'The Sapphic Club')], error: null });
    const { findByTestId } = render(<CreateSheet visible userId="u1" onClose={jest.fn()} />);
    const row = await findByTestId('create-sheet-room-c1');
    expect(Number(flat(row).minHeight)).toBeGreaterThanOrEqual(TAB_MIN_TOUCH);
    expect(row.props.hitSlop).toBeUndefined();
  });

  it('sends a woman with no rooms to the place that has them', async () => {
    mockMembersQuery.mockResolvedValue({ data: [], error: null });
    const { findByTestId } = render(<CreateSheet visible userId="u1" onClose={jest.fn()} />);
    fireEvent.press(await findByTestId('create-sheet-empty-cta'));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/connect?tab=communities');
  });

  it('surfaces a failure with a retry rather than an empty list', async () => {
    mockMembersQuery.mockResolvedValueOnce({ data: null, error: { message: 'network' } });
    const { findByTestId, findByText } = render(<CreateSheet visible userId="u1" onClose={jest.fn()} />);
    await findByText('We could not load your rooms.');

    mockMembersQuery.mockResolvedValueOnce({ data: [room('c1', 'The Sapphic Club')], error: null });
    fireEvent.press(await findByTestId('create-sheet-retry'));
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
