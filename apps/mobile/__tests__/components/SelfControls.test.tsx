import { render, waitFor, fireEvent } from '@testing-library/react-native';
import { SelfControls } from '../../components/profile/SelfControls';
import { supabase } from '../../lib/supabase';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../hooks/useAccess', () => ({
  useAccess: () => ({
    tier: 'beta',
    isBeta: true,
    can: () => true,
    canCommunity: () => true,
  }),
}));

const push = mockPush;
const from = supabase.from as jest.Mock;

/** No businesses — the seller row reads "Not selling yet" and nothing else changes. */
const noBusinesses = () => ({
  select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
});

beforeEach(() => {
  push.mockReset();
  from.mockReset();
  from.mockImplementation(noBusinesses);
});

const renderControls = (onOpenSaved = jest.fn()) => ({
  onOpenSaved,
  ...render(<SelfControls userId="u1" onOpenSaved={onOpenSaved} />),
});

describe('SelfControls links', () => {
  it('reaches My people', async () => {
    // `/people` — the friends list, the sent requests, unfriend and DM — had
    // ZERO entry points after the Grow tab dissolved. Messages carries the
    // request-first inbox, which is where a request ARRIVES; it is not where
    // she goes to see who she is already connected to.
    const view = renderControls();
    await waitFor(() => expect(view.getByTestId('you-people')).toBeTruthy());

    fireEvent.press(view.getByTestId('you-people'));
    expect(push).toHaveBeenCalledWith('/people');
  });

  it('reaches Badges', async () => {
    // Same story: `app/badges.tsx` survived the flattening and became
    // unreachable. ProfileCard shows the badges she has EARNED; the screen is
    // the only place that shows progress toward the ones she has not.
    const view = renderControls();
    await waitFor(() => expect(view.getByTestId('you-badges')).toBeTruthy());

    fireEvent.press(view.getByTestId('you-badges'));
    expect(push).toHaveBeenCalledWith('/badges');
  });

  it('reaches the ticket wallet', async () => {
    const view = renderControls();
    await waitFor(() => expect(view.getByTestId('you-wallet')).toBeTruthy());

    fireEvent.press(view.getByTestId('you-wallet'));
    expect(push).toHaveBeenCalledWith('/tickets');
  });

  it('opens Saved in place and never navigates away', async () => {
    // The row used to push `/(tabs)/feed`. Her saved posts are rendered by
    // `SavedPosts` further down THIS screen, so a row labelled Saved that threw
    // her into the video pager was pointing at the one place they are not.
    const view = renderControls();
    await waitFor(() => expect(view.getByTestId('you-saved')).toBeTruthy());

    fireEvent.press(view.getByTestId('you-saved'));
    expect(view.onOpenSaved).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it('every row is a button with a label a screen reader can read', async () => {
    const view = renderControls();
    await waitFor(() => expect(view.getByTestId('you-people')).toBeTruthy());

    for (const id of ['you-people', 'you-wallet', 'you-badges', 'you-saved', 'you-sell']) {
      const row = view.getByTestId(id);
      expect(row.props.accessibilityRole).toBe('button');
      expect(String(row.props.accessibilityLabel ?? '').length).toBeGreaterThan(0);
    }
  });
});
