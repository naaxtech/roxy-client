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
/** What the RSVP insert answers (F10 tests hold it open or refuse it). */
let mockRsvpAnswer: () => Promise<unknown> = () => Promise.resolve({ data: { ticket_code: 'CDD-0512-023' }, error: null });
/** What giving up the spot answers. */
let mockDeleteAnswer: () => Promise<unknown> = () => Promise.resolve({ data: null, error: null });

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
          : state.inserted ? undefined : { data: null, error: null },
      ).then((v) => (v === undefined ? mockRsvpAnswer() : v)),
      maybeSingle: () => Promise.resolve({ data: table === 'event_attendees' ? mockAttendee : null, error: null }),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        (state.deleting ? mockDeleteAnswer() : Promise.resolve({ data: null, error: null })).then(res, rej),
    });
    return q;
  };
  const channel = { on: () => channel, subscribe: () => channel };
  return { supabase: { from: (t: string) => make(t), channel: () => channel, removeChannel: jest.fn() } };
});

import EventDetailScreen from '../../app/event/[id]';
// eslint-disable-next-line import/first
import { clearEventCache, readEventMemory, writeEventMemory, EVENT_CACHE_MAX } from '../../components/events/eventCache';

const future = new Date(Date.now() + 7 * 86_400_000);
future.setHours(20, 30, 0, 0);
const futureEnd = new Date(future.getTime() + 90 * 60_000);

beforeEach(() => {
  jest.clearAllMocks();
  clearEventCache();
  mockReduced = true;
  Platform.OS = 'ios';
  mockAttendee = null;
  mockRsvpAnswer = () => Promise.resolve({ data: { ticket_code: 'CDD-0512-023' }, error: null });
  mockDeleteAnswer = () => Promise.resolve({ data: null, error: null });
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

describe('event memory (F7: a second visit shows the poster in the first frame)', () => {
  const firstFrame = () => {
    // react-test-renderer outside act on purpose: React 18 legacy root commits
    // synchronously and leaves passive effects pending, so this is the frame
    // she sees before any effect (or fetch) runs.
    const TestRenderer = require('react-test-renderer');
    const tree = TestRenderer.create(<EventDetailScreen />);
    const byId = (id: string) => tree.root.findAll((n: { props: Record<string, unknown> }) => n.props.testID === id).length;
    return { tree, byId };
  };

  it('reopening an event paints the poster at once, no skeleton', async () => {
    const first = render(<EventDetailScreen />);
    await ready(first);
    first.unmount();
    const { tree, byId } = firstFrame();
    expect(byId('event-loading')).toBe(0);
    expect(byId('event-poster')).toBeGreaterThan(0);
    await act(async () => { tree.unmount(); });
  });

  it('her ticket is remembered too: the seal is simply there on a revisit (no jump)', async () => {
    mockAttendee = { ticket_code: 'CDD-0512-023', status: 'going' };
    const first = render(<EventDetailScreen />);
    await ready(first);
    await waitFor(() => expect(first.getByText('CDD-0512-023')).toBeTruthy());
    first.unmount();
    const { tree } = firstFrame();
    const code = tree.root.findAll((n: { props: Record<string, unknown> }) => n.props.children === 'CDD-0512-023');
    expect(code.length).toBeGreaterThan(0);
    await act(async () => { tree.unmount(); });
  });

  it('a remembered ticket she gave up elsewhere is gone once the refresh answers', async () => {
    mockAttendee = { ticket_code: 'CDD-0512-023', status: 'going' };
    const first = render(<EventDetailScreen />);
    await ready(first);
    await waitFor(() => expect(first.getByText('CDD-0512-023')).toBeTruthy());
    first.unmount();
    mockAttendee = null;
    const again = render(<EventDetailScreen />);
    await waitFor(() => expect(again.queryByText('CDD-0512-023')).toBeNull());
  });

  it('the quiet refresh still lands what changed', async () => {
    const first = render(<EventDetailScreen />);
    await ready(first);
    first.unmount();
    mockEvent = { ...mockEvent, title: 'Full moon swim (moved)' };
    const again = render(<EventDetailScreen />);
    expect(again.getByText('Full moon swim')).toBeTruthy();
    expect(await again.findByText('Full moon swim (moved)')).toBeTruthy();
  });

  it('memory belongs to one member and is bounded', () => {
    writeEventMemory('u1', 'e1', { event: { id: 'e1' }, ticketCode: 'T' });
    expect(readEventMemory('u2', 'e1')).toBeNull();
    writeEventMemory('u2', 'e2', { event: { id: 'e2' }, ticketCode: null });
    expect(readEventMemory('u1', 'e1')).toBeNull();
    for (let i = 0; i <= EVENT_CACHE_MAX; i += 1) writeEventMemory('u2', `x${i}`, { event: {}, ticketCode: null });
    expect(readEventMemory('u2', 'e2')).toBeNull();
  });
});

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

  it('says plainly when the event is gone (F10 suite below)', async () => {
    mockEvent = null as unknown as Ev;
    const r = render(<EventDetailScreen />);
    await waitFor(() => expect(r.getByText('This event is no longer available.')).toBeTruthy());
  });
});

/**
 * F10: every action on the event answers in the same frame. RSVP is
 * server-first by design (the ticket code comes from the insert), so it shows
 * an instant pending state; save and "give up your spot" flip at once. A
 * refusal rolls back with a snackbar and Retry. Writes here are promises the
 * file holds open or refuses: nothing reaches a server.
 */
describe('event actions answer the tap (F10)', () => {
  const NEVER = () => new Promise<never>(() => undefined);
  const favorites = jest.requireMock('../../components/profile/ProfileFavorites') as { toggleUserFavorite: jest.Mock };

  it('"I’m going" turns pending in the same frame, before the insert answers', async () => {
    mockRsvpAnswer = NEVER;
    const r = render(<EventDetailScreen />);
    await ready(r);
    act(() => { fireEvent.press(r.getByTestId('event-rsvp')); });
    expect(r.getByTestId('event-rsvp').props.accessibilityState).toMatchObject({ busy: true });
  });

  it('a refused RSVP rolls back to "I’m going" with a snackbar that offers Retry', async () => {
    mockRsvpAnswer = () => Promise.resolve({ data: null, error: { code: '42501', message: 'policy text' } });
    const r = render(<EventDetailScreen />);
    await ready(r);
    await act(async () => { fireEvent.press(r.getByTestId('event-rsvp')); });

    expect(r.getByTestId('event-snackbar')).toBeTruthy();
    expect(r.getByText('That didn’t go through.')).toBeTruthy();
    expect(r.queryByText(/policy text/)).toBeNull();
    expect(r.getByTestId('event-rsvp').props.accessibilityState).toMatchObject({ busy: false });
    expect(r.queryByTestId('event-seal')).toBeNull();

    mockRsvpAnswer = () => Promise.resolve({ data: { ticket_code: 'CDD-0512-023' }, error: null });
    await act(async () => { fireEvent.press(r.getByTestId('event-snackbar-action')); });
    expect(mockInsert).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(r.getByTestId('event-seal')).toBeTruthy());
  });

  it('save flips the bookmark at once and puts it back when the write fails', async () => {
    favorites.toggleUserFavorite.mockImplementationOnce(NEVER);
    const r = render(<EventDetailScreen />);
    await ready(r);
    act(() => { fireEvent.press(r.getByTestId('event-save')); });
    expect(r.getByTestId('event-save').props.accessibilityLabel).toBe('Remove event from saved');

    r.unmount();
    favorites.toggleUserFavorite.mockRejectedValueOnce(new Error('offline'));
    const again = render(<EventDetailScreen />);
    await ready(again);
    await act(async () => { fireEvent.press(again.getByTestId('event-save')); });
    expect(again.getByTestId('event-save').props.accessibilityLabel).toBe('Save event');
    expect(again.getByTestId('event-snackbar')).toBeTruthy();
  });

  it('"give up your spot" takes the ticket away at once and gives it back if refused', async () => {
    mockAttendee = { ticket_code: 'CDD-0512-023', status: 'going' };
    mockDeleteAnswer = NEVER;
    const r = render(<EventDetailScreen />);
    await ready(r);
    await waitFor(() => expect(r.getByTestId('event-cancel-rsvp')).toBeTruthy());
    act(() => { fireEvent.press(r.getByTestId('event-cancel-rsvp')); });
    expect(r.queryByTestId('event-ticket')).toBeNull();
    r.unmount();

    mockDeleteAnswer = () => Promise.resolve({ data: null, error: { code: '42501', message: 'policy text' } });
    const again = render(<EventDetailScreen />);
    await ready(again);
    await waitFor(() => expect(again.getByTestId('event-cancel-rsvp')).toBeTruthy());
    await act(async () => { fireEvent.press(again.getByTestId('event-cancel-rsvp')); });
    expect(again.getByTestId('event-ticket')).toBeTruthy();
    expect(again.getByTestId('event-snackbar')).toBeTruthy();
    expect(again.queryByText(/policy text/)).toBeNull();
  });
});
