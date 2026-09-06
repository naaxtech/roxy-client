import { render, waitFor, fireEvent } from '@testing-library/react-native';
import { SelfControls } from '../../components/profile/SelfControls';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('../../lib/streaks', () => ({
  recordDailyCheckin: jest.fn(async () => 7),
}));
jest.mock('../../hooks/useAccess', () => ({
  useAccess: () => ({
    tier: 'public',
    isBeta: false,
    kind: 'member',
    can: () => false,
    canCommunity: () => false,
  }),
}));

describe('SelfControls — the You body, not the extra doors', () => {
  it('keeps Dating and Ghost on the profile even when she is not tagged beta', async () => {
    // Two taps from You. Burying these in More would be one tap too many on
    // the day she actually needs ghost mode.
    const view = render(<SelfControls userId="u1" onOpenDaily={jest.fn()} />);
    await waitFor(() => expect(view.getByTestId('self-controls')).toBeTruthy());
    expect(view.getByTestId('toggle-dating')).toBeTruthy();
    expect(view.getByTestId('toggle-ghost')).toBeTruthy();
    expect(view.queryByTestId('you-people')).toBeNull();
    expect(view.queryByTestId('you-wallet')).toBeNull();
  });

  it('opens Mini Wins from the streak row', async () => {
    const onOpenDaily = jest.fn();
    const view = render(<SelfControls userId="u1" onOpenDaily={onOpenDaily} />);
    await waitFor(() => expect(view.getByTestId('you-mini-wins')).toBeTruthy());
    fireEvent.press(view.getByTestId('you-mini-wins'));
    expect(onOpenDaily).toHaveBeenCalledTimes(1);
  });
});
