/**
 * The event screen as a poster — design direction v2 › signature moment 3
 * (board v2-03). "I'm going" becomes the 16-point seal on the poster's corner
 * with a medium haptic; the ticket row appears with a mono code; the exact
 * place is only on the ticket; who is going is never listed here; a shared
 * link never names the event or the club.
 */
import React from 'react';
import { Platform, Share } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linking', () => ({ createURL: (p: string) => `https://roxy.test${p}` }));
const mockImpact = jest.fn(() => Promise.resolve());
jest.mock('expo-haptics', () => ({
  impactAsync: (...a: unknown[]) => mockImpact(...(a as [])),
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success' },
}));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({ id: 'ev1' }),
}));
let mockReduced = true;
jest.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => mockReduced }));
jest.mock('../../store/authStore', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { user: { id: 'u1' } };
    return typeof sel === 'function' ? sel(state) : state;
  },
}));
jest.mock('@stripe/stripe-react-native', () => ({
  useStripe: () => ({ initPaymentSheet: jest.fn(), presentPaymentSheet: jest.fn() }),
}));
jest.mock('../../lib/stripe', () => ({ purchaseTicket: jest.fn(), subscribeToTicket: jest.fn(() => () => undefined) }));
jest.mock('../../components/profile/ProfileFavorites', () => ({ toggleUserFavorite: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../../components/TicketConfirmation', () => ({ TicketConfirmation: () => null }));

type Ev = Record<string, unknown>;
let mockEvent: Ev;
let mockAttendee: { ticket_code: string; status: string } | null;
const mockInsert = jest.fn();
const mockDelete = jest.fn();

jest.mock('../../lib/supabase', () => {
  const make = (table: string) => {
    const state = { inserted: false, deleting: false };
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q,
      eq: () => q,
      insert: (row: unknown) => { mockInsert(table, row); state.inserted = true; return q; },
      delete: () => { mockDelete(table); state.deleting = true; return q; },
      single: () => Promise.resolve(
        table === 'events'
          ? { data: mockEvent, error: null }
          : state.inserted ? { data: { ticket_code: 'CDD-0512-023' }, error: null } : { data: null, error: null },
      ),
      maybeSingle: () => Promise.resolve({ data: table === 'event_attendees' ? mockAttendee : null, error: null }),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res),
    });
    return q;
  };
  const channel = { on: () => channel, subscribe: () => channel };
  return { supabase: { from: (t: string) => make(t), channel: () => channel, removeChannel: jest.fn() } };
});

import EventDetailScreen from '../../app/event/[id]';

const future = new Date(Date.now() + 7 * 86_400_000);
future.setHours(20, 30, 0, 0);
const futureEnd = new Date(future.getTime() + 90 * 60_000);

beforeEach(() => {
  jest.clearAllMocks();
  mockReduced = true;
  Platform.OS = 'ios';
  mockAttendee = null;
  mockEvent = {
    id: 'ev1', title: 'Full moon swim', description: 'Towel, warm layers, a torch.',
    event_type: 'in_person', starts_at: future.toISOString(), ends_at: futureEnd.toISOString(),
    location_text: 'Gordons Bay steps', location_url: null, attendee_count: 23, max_attendees: null,
    is_paid: false, is_private: false, price_cents: null, status: 'active',
    community_id: 'c1', communities: { id: 'c1', name: 'Clovelly Dawn Dippers' },
  };
});

const ready = async (r: ReturnType<typeof render>) => {
  await waitFor(() => expect(r.getByTestId('event-poster')).toBeTruthy());
};

describe('event poster (v2)', () => {
  it('is a poster with the title and the club, and keeps the exact place off the page until she is going', async () => {
    const r = render(<EventDetailScreen />);
    await ready(r);
    expect(r.getByText('Full moon swim')).toBeTruthy();
    expect(r.getByText('Clovelly Dawn Dippers')).toBeTruthy();
    expect(r.getByText('In person')).toBeTruthy();
    expect(r.getByText('The exact meeting point is on your ticket.')).toBeTruthy();
    expect(r.queryByText(/Gordons Bay steps/)).toBeNull();
  });

  it('counts who is going and never lists them', async () => {
    const r = render(<EventDetailScreen />);
    await ready(r);
    expect(r.getByText('23 going')).toBeTruthy();
    expect(r.getByText('Who’s going isn’t shown here.')).toBeTruthy();
  });

  it('"I’m going" stamps the seal with a medium haptic, and the ticket row shows the mono code and the place', async () => {
    const r = render(<EventDetailScreen />);
    await ready(r);
    expect(r.queryByTestId('event-seal')).toBeNull();
    await act(async () => { fireEvent.press(r.getByTestId('event-rsvp')); });
    expect(mockInsert).toHaveBeenCalledWith('event_attendees', { event_id: 'ev1', user_id: 'u1', status: 'going' });
    await waitFor(() => expect(r.getByTestId('event-seal')).toBeTruthy());
    expect(mockImpact).toHaveBeenCalledWith('medium');
    expect(r.getByTestId('event-ticket')).toBeTruthy();
    expect(r.getByText('CDD-0512-023')).toBeTruthy();
    expect(r.getByText('Gordons Bay steps')).toBeTruthy();
  });

  it('no haptic on the web build', async () => {
    Platform.OS = 'web';
    const r = render(<EventDetailScreen />);
    await ready(r);
    await act(async () => { fireEvent.press(r.getByTestId('event-rsvp')); });
    await waitFor(() => expect(r.getByTestId('event-seal')).toBeTruthy());
    expect(mockImpact).not.toHaveBeenCalled();
  });

  it('already going: seal and ticket on arrival, no haptic, and "Bring a friend" shares a link that names neither the event nor the club', async () => {
    mockAttendee = { ticket_code: 'CDD-0512-023', status: 'going' };
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    const r = render(<EventDetailScreen />);
    await ready(r);
    await waitFor(() => expect(r.getByTestId('event-seal')).toBeTruthy());
    expect(mockImpact).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(r.getByTestId('event-bring-friend')); });
    const payload = share.mock.calls[0][0] as { message: string; url?: string };
    expect(payload.message).toContain('https://roxy.test/event/ev1');
    expect(payload.message).not.toMatch(/Full moon swim|Clovelly/);
    expect(r.getByText('The link preview won’t name the event or the club.')).toBeTruthy();
    share.mockRestore();
  });

  it('opens the ticket from its row', async () => {
    mockAttendee = { ticket_code: 'CDD-0512-023', status: 'going' };
    const r = render(<EventDetailScreen />);
    await ready(r);
    await waitFor(() => expect(r.getByTestId('event-ticket-open')).toBeTruthy());
    fireEvent.press(r.getByTestId('event-ticket-open'));
    expect(mockPush).toHaveBeenCalledWith('/tickets');
  });

  it('a paid event offers a ticket at its price', async () => {
    mockEvent = { ...mockEvent, is_paid: true, price_cents: 1200 };
    const r = render(<EventDetailScreen />);
    await ready(r);
    expect(r.getByTestId('event-buy')).toHaveTextContent('Get a ticket · $12.00');
  });

  it('says a cancelled event plainly, with no emoji', async () => {
    mockEvent = { ...mockEvent, status: 'cancelled' };
    const r = render(<EventDetailScreen />);
    await ready(r);
    expect(r.getByText('This event was cancelled.')).toBeTruthy();
    expect(r.queryByText(/❌/)).toBeNull();
    expect(r.queryByTestId('event-rsvp')).toBeNull();
  });

  it('an online event says so and keeps its own words', async () => {
    mockEvent = { ...mockEvent, event_type: 'online', location_text: null };
    const r = render(<EventDetailScreen />);
    await ready(r);
    expect(r.getByText('Online')).toBeTruthy();
  });

  it('says plainly when the event is gone', async () => {
    mockEvent = null as unknown as Ev;
    const r = render(<EventDetailScreen />);
    await waitFor(() => expect(r.getByText('This event is no longer available.')).toBeTruthy());
  });
});
