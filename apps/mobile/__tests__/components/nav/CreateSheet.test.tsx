import React from 'react';
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

const APPROVED_SELLER = { is_verified: true, can_sell: true, stripe_account_id: 'acct_1' };

beforeEach(() => {
  mockPush.mockClear();
  mockBusinessQuery.mockReset();
  mockBusinessQuery.mockResolvedValue({ data: [], error: null });
  mockProfileQuery.mockReset();
  mockProfileQuery.mockResolvedValue({ data: { official_community_id: null }, error: null });
});

describe('CreateSheet', () => {
  it('renders nothing and fetches nothing while closed', () => {
    const { queryByTestId } = render(<CreateSheet visible={false} userId="u1" onClose={jest.fn()} />);
    expect(queryByTestId('create-sheet')).toBeNull();
    expect(mockBusinessQuery).not.toHaveBeenCalled();
  });

  it('offers all five things the design says you can make', async () => {
    const { findByTestId } = render(<CreateSheet visible userId="u1" onClose={jest.fn()} />);
    for (const kind of ['post', 'event', 'room', 'product', 'game']) {
      expect(await findByTestId(`create-kind-${kind}`)).toBeTruthy();
    }
  });

  it('says why a row is unavailable instead of failing silently', async () => {
    const { findByTestId } = render(<CreateSheet visible userId="u1" onClose={jest.fn()} />);
    const event = await findByTestId('create-kind-event');
    expect(event.props.accessibilityState).toEqual({ disabled: true });
    expect(String(event.props.accessibilityLabel)).toContain('Studio');
  });

  it('unlocks Event for an official community account', async () => {
    mockProfileQuery.mockResolvedValue({ data: { official_community_id: 'c-official' }, error: null });
    const onClose = jest.fn();
    const { findByTestId } = render(<CreateSheet visible userId="u1" onClose={onClose} />);
    await waitFor(async () => {
      const event = await findByTestId('create-kind-event');
      expect(event.props.accessibilityState).toEqual({ disabled: false });
    });
    fireEvent.press(await findByTestId('create-kind-event'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/community/create-event' });
    expect(onClose).toHaveBeenCalled();
  });

  it('locks Product for a woman who has not been approved to sell', async () => {
    const { findByTestId } = render(<CreateSheet visible userId="u1" onClose={jest.fn()} />);
    const product = await findByTestId('create-kind-product');
    expect(product.props.accessibilityState).toEqual({ disabled: true });
    expect(String(product.props.accessibilityLabel)).toContain('Approved sellers only');
  });

  it('unlocks Product only when Stripe, verification and permission all agree', async () => {
    mockBusinessQuery.mockResolvedValue({ data: [APPROVED_SELLER], error: null });
    const { findByTestId } = render(<CreateSheet visible userId="u1" onClose={jest.fn()} />);
    await waitFor(async () => {
      const product = await findByTestId('create-kind-product');
      expect(product.props.accessibilityState).toEqual({ disabled: false });
    });
  });

  it('keeps Product locked when the seller lookup fails', async () => {
    mockBusinessQuery.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { findByTestId } = render(<CreateSheet visible userId="u1" onClose={jest.fn()} />);
    const product = await findByTestId('create-kind-product');
    expect(product.props.accessibilityState).toEqual({ disabled: true });
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
});
