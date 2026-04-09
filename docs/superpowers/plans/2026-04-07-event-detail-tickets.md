# Event Detail & Tickets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared event detail screen with free RSVP → in-app ticket (card + QR), Google Calendar deeplink, and a My Tickets section in Grow.

**Architecture:** One shared route `/app/event/[id].tsx` used from both Connect and Discover. Postgres generates collision-safe ticket codes (`ROXY-XXXXXXXX`) on `event_attendees` insert. `TicketCard` is a reusable component rendering the card + QR. My Tickets is a horizontal scroll section appended to the Grow ScrollView.

**Tech Stack:** Expo Router v3, Supabase, `react-native-qrcode-svg` (QR rendering), `date-fns`, Zustand (`authStore`), React Native `Linking` (calendar deeplink).

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/020_event_detail.sql` | Create | Add `is_private`, `is_paid` to `events`; `ticket_code` to `event_attendees` |
| `apps/mobile/lib/eventUtils.ts` | Create | Pure helpers: `formatDuration`, `buildCalendarUrl`, `openCalendar` |
| `apps/mobile/__tests__/lib/eventUtils.test.ts` | Create | Unit tests for pure helpers |
| `apps/mobile/components/TicketCard.tsx` | Create | Ticket card UI with QR code |
| `apps/mobile/__tests__/components/TicketCard.test.tsx` | Create | TicketCard render tests |
| `apps/mobile/app/event/[id].tsx` | Create | Shared event detail screen |
| `apps/mobile/app/(tabs)/connect/index.tsx` | Modify | Event card body tappable; fix `location_text` type |
| `apps/mobile/app/(tabs)/discover/index.tsx` | Modify | Event card body tappable; add `is_private: false` filter; fix `location_text` type |
| `apps/mobile/app/(tabs)/grow/index.tsx` | Modify | Add My Tickets horizontal scroll section |

---

## Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/020_event_detail.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/020_event_detail.sql
-- Adds is_private + is_paid to events, ticket_code to event_attendees

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_paid    boolean NOT NULL DEFAULT false;

ALTER TABLE public.event_attendees
  ADD COLUMN IF NOT EXISTS ticket_code text UNIQUE
    DEFAULT ('ROXY-' || upper(substr(gen_random_uuid()::text, 1, 8)));

-- Index for fast ticket lookup
CREATE INDEX IF NOT EXISTS idx_ea_ticket_code ON public.event_attendees(ticket_code);

-- Backfill ticket_code for any existing attendee rows that have NULL
UPDATE public.event_attendees
SET ticket_code = 'ROXY-' || upper(substr(gen_random_uuid()::text, 1, 8))
WHERE ticket_code IS NULL;

-- Now enforce NOT NULL
ALTER TABLE public.event_attendees
  ALTER COLUMN ticket_code SET NOT NULL;

-- Discover query: private events must not leak — enforce with RLS policy
-- Public events (is_private = false) are visible to all authenticated users.
-- Private events (is_private = true) are only visible if the user is a member
-- of the event's community. We replace the existing permissive events_select policy.
DROP POLICY IF EXISTS "events_select" ON public.events;

CREATE POLICY "events_select" ON public.events
  FOR SELECT TO authenticated
  USING (
    is_private = false
    OR (
      is_private = true
      AND community_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.community_members cm
        WHERE cm.community_id = public.events.community_id
          AND cm.user_id = auth.uid()
      )
    )
  );
```

- [ ] **Step 2: Push the migration**

Run from the repo root:
```bash
npx supabase db push
```

Expected: migration applied with no errors. Confirm with:
```bash
npx supabase db diff
```
Expected: no diff (migration is current).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/020_event_detail.sql
git commit -m "feat: add is_private, is_paid to events and ticket_code to event_attendees"
```

---

## Task 2: Event Utility Helpers + Tests

**Files:**
- Create: `apps/mobile/lib/eventUtils.ts`
- Create: `apps/mobile/__tests__/lib/eventUtils.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/__tests__/lib/eventUtils.test.ts`:

```ts
import { formatDuration, buildCalendarUrl } from '../../lib/eventUtils';

describe('formatDuration', () => {
  it('returns null when endsAt is null', () => {
    expect(formatDuration('2026-04-12T19:00:00Z', null)).toBeNull();
  });

  it('returns whole hours only when no leftover minutes', () => {
    expect(formatDuration('2026-04-12T19:00:00Z', '2026-04-12T21:00:00Z')).toBe('2h');
  });

  it('returns hours and minutes for non-round durations', () => {
    expect(formatDuration('2026-04-12T19:00:00Z', '2026-04-12T20:30:00Z')).toBe('1h 30min');
  });

  it('returns minutes-only for sub-hour sessions', () => {
    expect(formatDuration('2026-04-12T19:00:00Z', '2026-04-12T19:45:00Z')).toBe('45 min');
  });

  it('returns null when end is before start', () => {
    expect(formatDuration('2026-04-12T19:00:00Z', '2026-04-12T18:00:00Z')).toBeNull();
  });
});

describe('buildCalendarUrl', () => {
  it('includes event title encoded in URL', () => {
    const url = buildCalendarUrl({
      title: 'WLW Social Mixer',
      startsAt: '2026-04-12T19:00:00Z',
      endsAt: '2026-04-12T21:00:00Z',
      locationText: null,
      communityName: null,
    });
    expect(url).toContain('calendar.google.com');
    expect(url).toContain('WLW');
  });

  it('falls back to starts_at + 1 hour when endsAt is null', () => {
    const url = buildCalendarUrl({
      title: 'Test',
      startsAt: '2026-04-12T19:00:00Z',
      endsAt: null,
      locationText: null,
      communityName: null,
    });
    // 19:00 + 1h = 20:00 UTC
    expect(url).toContain('20260412T200000Z');
  });

  it('includes location when provided', () => {
    const url = buildCalendarUrl({
      title: 'Test',
      startsAt: '2026-04-12T19:00:00Z',
      endsAt: null,
      locationText: 'The Garden Bar',
      communityName: null,
    });
    expect(url).toContain('Garden');
  });

  it('includes community name in details', () => {
    const url = buildCalendarUrl({
      title: 'Test',
      startsAt: '2026-04-12T19:00:00Z',
      endsAt: null,
      locationText: null,
      communityName: 'Queer Manila',
    });
    expect(url).toContain('Queer');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/mobile && npx jest --ci --testPathPattern="eventUtils" --passWithNoTests 2>&1 | tail -5
```

Expected: `Cannot find module '../../lib/eventUtils'`

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/lib/eventUtils.ts`:

```ts
import { Linking } from 'react-native';

export function formatDuration(startsAt: string, endsAt: string | null): string | null {
  if (!endsAt) return null;
  const mins = Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000);
  if (mins <= 0) return null;
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

export function buildCalendarUrl(params: {
  title: string;
  startsAt: string;
  endsAt: string | null;
  locationText: string | null;
  communityName: string | null;
}): string {
  const { title, startsAt, endsAt, locationText, communityName } = params;
  const start = new Date(startsAt);
  const end = endsAt ? new Date(endsAt) : new Date(start.getTime() + 60 * 60 * 1000);

  // Google Calendar expects YYYYMMDDTHHmmssZ
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, '').replace('.000', '');

  const details = communityName ? `Roxy event · ${communityName}` : 'Roxy event';
  const locationPart = locationText
    ? `&location=${encodeURIComponent(locationText)}`
    : '';

  return (
    `https://calendar.google.com/calendar/render` +
    `?action=TEMPLATE` +
    `&text=${encodeURIComponent(title)}` +
    `&dates=${fmt(start)}/${fmt(end)}` +
    locationPart +
    `&details=${encodeURIComponent(details)}`
  );
}

export function openCalendar(params: Parameters<typeof buildCalendarUrl>[0]): void {
  Linking.openURL(buildCalendarUrl(params)).catch(() => {});
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd apps/mobile && npx jest --ci --testPathPattern="eventUtils" 2>&1 | tail -5
```

Expected: `Tests: 9 passed, 9 total`

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/eventUtils.ts apps/mobile/__tests__/lib/eventUtils.test.ts
git commit -m "feat: event utility helpers (formatDuration, buildCalendarUrl)"
```

---

## Task 3: TicketCard Component + Tests

**Files:**
- Create: `apps/mobile/components/TicketCard.tsx`
- Create: `apps/mobile/__tests__/components/TicketCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/__tests__/components/TicketCard.test.tsx`:

```tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import { TicketCard } from '../../components/TicketCard';

// Mock QR code library — SVG doesn't render in Jest
jest.mock('react-native-qrcode-svg', () => {
  const { View } = require('react-native');
  return function MockQRCode({ testID }: { testID?: string }) {
    return <View testID={testID ?? 'qr-mock'} />;
  };
});

const baseProps = {
  eventTitle: 'WLW Social Mixer',
  startsAt: '2026-04-12T19:00:00Z',
  locationText: 'The Garden Bar, Manila',
  communityName: 'Queer Manila',
  ticketCode: 'ROXY-A3F9BC12',
};

describe('TicketCard', () => {
  it('renders event title', () => {
    const { getByText } = render(<TicketCard {...baseProps} />);
    expect(getByText('WLW Social Mixer')).toBeTruthy();
  });

  it('renders ticket code', () => {
    const { getByText } = render(<TicketCard {...baseProps} />);
    expect(getByText('ROXY-A3F9BC12')).toBeTruthy();
  });

  it('renders QR code element', () => {
    const { getByTestId } = render(<TicketCard {...baseProps} />);
    expect(getByTestId('ticket-qr')).toBeTruthy();
  });

  it('renders location when provided', () => {
    const { getByText } = render(<TicketCard {...baseProps} />);
    expect(getByText('📍 The Garden Bar, Manila')).toBeTruthy();
  });

  it('omits location row when locationText is null', () => {
    const { queryByText } = render(<TicketCard {...baseProps} locationText={null} />);
    expect(queryByText(/Garden Bar/)).toBeNull();
  });

  it('renders community name when provided', () => {
    const { getByText } = render(<TicketCard {...baseProps} />);
    expect(getByText('🏳️‍🌈 Queer Manila')).toBeTruthy();
  });

  it('omits community row when communityName is null', () => {
    const { queryByText } = render(<TicketCard {...baseProps} communityName={null} />);
    expect(queryByText(/Queer Manila/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/mobile && npx jest --ci --testPathPattern="TicketCard" --passWithNoTests 2>&1 | tail -5
```

Expected: `Cannot find module '../../components/TicketCard'`

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/components/TicketCard.tsx`:

```tsx
import { View, Text, StyleSheet } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { format } from 'date-fns';
import { COLORS } from '../lib/constants';

interface TicketCardProps {
  eventTitle: string;
  startsAt: string;
  locationText: string | null;
  communityName: string | null;
  ticketCode: string;
}

export function TicketCard({ eventTitle, startsAt, locationText, communityName, ticketCode }: TicketCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.going}>🌸 You're going!</Text>
      <Text style={styles.title}>{eventTitle}</Text>
      <Text style={styles.date}>{format(new Date(startsAt), 'EEE d MMM · h:mm a')}</Text>
      {locationText ? <Text style={styles.meta}>📍 {locationText}</Text> : null}
      {communityName ? <Text style={styles.meta}>🏳️‍🌈 {communityName}</Text> : null}
      <View style={styles.qrWrap} testID="ticket-qr">
        <QRCode value={ticketCode} size={160} />
      </View>
      <Text style={styles.code}>{ticketCode}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: COLORS.primary + '40',
  },
  going: { color: COLORS.roxy, fontWeight: '700', fontSize: 14, marginBottom: 4 },
  title: { color: COLORS.textPrimary, fontWeight: '800', fontSize: 16, textAlign: 'center' },
  date: { color: COLORS.textSecondary, fontSize: 13 },
  meta: { color: COLORS.textSecondary, fontSize: 13 },
  qrWrap: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    marginBottom: 4,
  },
  code: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: 4,
  },
});
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd apps/mobile && npx jest --ci --testPathPattern="TicketCard" 2>&1 | tail -5
```

Expected: `Tests: 7 passed, 7 total`

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/components/TicketCard.tsx apps/mobile/__tests__/components/TicketCard.test.tsx
git commit -m "feat: TicketCard component with QR code"
```

---

## Task 4: Event Detail Screen

**Files:**
- Create: `apps/mobile/app/event/[id].tsx`

No automated test for this screen (full Supabase + navigation integration — too much mocking overhead for the value). Manual test steps are at the end of this task.

- [ ] **Step 1: Create the screen**

Create `apps/mobile/app/event/[id].tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Animated, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { format } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { COLORS } from '../../lib/constants';
import { TicketCard } from '../../components/TicketCard';
import { formatDuration, openCalendar } from '../../lib/eventUtils';

type EventDetail = {
  id: string;
  title: string;
  description: string | null;
  event_type: 'online' | 'in_person' | 'hybrid';
  starts_at: string;
  ends_at: string | null;
  location_text: string | null;
  location_url: string | null;
  attendee_count: number;
  is_paid: boolean;
  is_private: boolean;
  community_id: string | null;
  communities: { id: string; name: string } | null;
};

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [ticketCode, setTicketCode] = useState<string | null>(null);
  const [rsvping, setRsvping] = useState(false);
  const ticketAnim = useRef(new Animated.Value(0)).current;

  const fetchEvent = useCallback(async () => {
    if (!id) return;
    const { data, error } = await supabase
      .from('events')
      .select('*, communities(id, name)')
      .eq('id', id)
      .single();
    if (error || !data) { setNotFound(true); setLoading(false); return; }
    setEvent(data as EventDetail);
    setLoading(false);
  }, [id]);

  const fetchRsvp = useCallback(async () => {
    if (!id || !user) return;
    const { data } = await supabase
      .from('event_attendees')
      .select('ticket_code, status')
      .eq('event_id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (data?.ticket_code) {
      setTicketCode(data.ticket_code);
      ticketAnim.setValue(1); // already going — show ticket instantly, no animation
    }
  }, [id, user]);

  useEffect(() => {
    fetchEvent();
    fetchRsvp();
  }, [fetchEvent, fetchRsvp]);

  const animateTicketIn = (code: string) => {
    setTicketCode(code);
    Animated.timing(ticketAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  };

  const handleRsvp = async () => {
    if (!event || !user || rsvping) return;
    setRsvping(true);
    const { data, error } = await supabase
      .from('event_attendees')
      .insert({ event_id: event.id, user_id: user.id, status: 'going' })
      .select('ticket_code')
      .single();
    setRsvping(false);
    if (!error && data?.ticket_code) animateTicketIn(data.ticket_code);
  };

  const handleCancel = async () => {
    if (!event || !user) return;
    await supabase
      .from('event_attendees')
      .delete()
      .eq('event_id', event.id)
      .eq('user_id', user.id);
    setTicketCode(null);
    ticketAnim.setValue(0);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back-outline" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <ActivityIndicator color={COLORS.roxy} style={{ marginTop: 48 }} />
      </SafeAreaView>
    );
  }

  if (notFound || !event) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back-outline" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={styles.notFound}>
          <Text style={styles.notFoundText}>This event is no longer available.</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.notFoundBack}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const duration = formatDuration(event.starts_at, event.ends_at);
  const going = ticketCode !== null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
        <Ionicons name="arrow-back-outline" size={24} color={COLORS.textPrimary} />
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>{event.title}</Text>

        {event.communities && (
          <TouchableOpacity onPress={() => router.push(`/community/${event.community_id}` as any)}>
            <Text style={styles.communityLink}>🏳️‍🌈 {event.communities.name}</Text>
          </TouchableOpacity>
        )}

        <View style={styles.metaBlock}>
          <Text style={styles.metaRow}>
            🗓  {format(new Date(event.starts_at), 'EEE d MMM · h:mm a')}
          </Text>
          {duration && <Text style={styles.metaRow}>⏱  {duration}</Text>}
          {event.location_text && (
            <TouchableOpacity
              disabled={!event.location_url}
              onPress={() => event.location_url
                ? Linking.openURL(event.location_url!).catch(() => {})
                : undefined
              }
            >
              <Text style={[styles.metaRow, event.location_url ? styles.metaLink : null]}>
                📍  {event.location_text}
              </Text>
            </TouchableOpacity>
          )}
          <Text style={styles.metaRow}>👥  {event.attendee_count} going</Text>
          <Text style={[styles.metaRow, event.is_paid ? styles.metaPaid : styles.metaFree]}>
            🎟  {event.is_paid ? 'Paid' : 'Free'}
          </Text>
        </View>

        {event.description ? (
          <View style={styles.descBlock}>
            <Text style={styles.descLabel}>About</Text>
            <Text style={styles.desc}>{event.description}</Text>
          </View>
        ) : null}

        {going ? (
          <Animated.View style={{ opacity: ticketAnim }}>
            <View style={styles.divider} />
            <TicketCard
              eventTitle={event.title}
              startsAt={event.starts_at}
              locationText={event.location_text}
              communityName={event.communities?.name ?? null}
              ticketCode={ticketCode!}
            />
            <TouchableOpacity
              style={styles.calendarBtn}
              onPress={() => openCalendar({
                title: event.title,
                startsAt: event.starts_at,
                endsAt: event.ends_at,
                locationText: event.location_text,
                communityName: event.communities?.name ?? null,
              })}
            >
              <Text style={styles.calendarBtnText}>+ Add to Calendar</Text>
            </TouchableOpacity>
          </Animated.View>
        ) : null}

        {going ? (
          <View style={styles.rsvpRow}>
            <View style={styles.goingPill}>
              <Text style={styles.goingPillText}>You're going ✓</Text>
            </View>
            <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.rsvpBtn, rsvping && styles.rsvpBtnDisabled]}
            onPress={handleRsvp}
            disabled={rsvping}
          >
            {rsvping
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.rsvpBtnText}>RSVP — It's Free</Text>
            }
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  backBtn: { padding: 16, paddingBottom: 4 },

  scroll: { paddingHorizontal: 20, paddingBottom: 40, gap: 0 },

  title: {
    color: COLORS.textPrimary, fontSize: 22, fontWeight: '800',
    marginTop: 8, marginBottom: 6,
  },
  communityLink: {
    color: COLORS.primary, fontSize: 14, fontWeight: '600', marginBottom: 16,
  },

  metaBlock: { gap: 8, marginBottom: 20 },
  metaRow: { color: COLORS.textSecondary, fontSize: 14 },
  metaLink: { color: COLORS.primary, textDecorationLine: 'underline' },
  metaFree: { color: COLORS.success },
  metaPaid: { color: COLORS.warning },

  descBlock: { marginBottom: 24 },
  descLabel: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 15, marginBottom: 8 },
  desc: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 22 },

  divider: {
    height: 1, backgroundColor: COLORS.surface,
    marginVertical: 20,
  },

  calendarBtn: {
    marginTop: 12, alignSelf: 'center',
    paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 20, borderWidth: 1, borderColor: COLORS.primary + '60',
  },
  calendarBtnText: { color: COLORS.primary, fontWeight: '600', fontSize: 14 },

  rsvpRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 12, marginTop: 24,
  },
  goingPill: {
    flex: 1, backgroundColor: COLORS.primary,
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  },
  goingPillText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cancelBtn: {
    paddingHorizontal: 16, paddingVertical: 14,
    borderRadius: 14, borderWidth: 1, borderColor: COLORS.surface,
  },
  cancelBtnText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 14 },

  rsvpBtn: {
    marginTop: 24, backgroundColor: COLORS.primary,
    borderRadius: 14, paddingVertical: 16, alignItems: 'center',
  },
  rsvpBtnDisabled: { opacity: 0.6 },
  rsvpBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  notFoundText: { color: COLORS.textSecondary, fontSize: 15 },
  notFoundBack: { color: COLORS.primary, fontWeight: '600', fontSize: 14 },
});
```

- [ ] **Step 2: Install react-native-qrcode-svg**

```bash
cd apps/mobile && npx expo install react-native-qrcode-svg -- --legacy-peer-deps 2>&1
```

Expected: `added N packages`

- [ ] **Step 3: Verify app builds (bundler check)**

```bash
cd apps/mobile && npx expo export --platform ios --output-dir /tmp/roxy-build-check 2>&1 | tail -10
```

Expected: no `Unable to resolve` errors. If bundling fails, check the error and ensure `react-native-svg` and `react-native-qrcode-svg` are in `node_modules`.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/event apps/mobile/app/event/[id].tsx
git commit -m "feat: event detail screen with RSVP and in-app ticket"
```

---

## Task 5: Wire Connect Event Cards

**Files:**
- Modify: `apps/mobile/app/(tabs)/connect/index.tsx`

This task makes the event card body tappable to the detail screen, while keeping the RSVP button separate. It also fixes the pre-existing `location` → `location_text` type bug.

- [ ] **Step 1: Update the EventRow type and fix location field**

In `apps/mobile/app/(tabs)/connect/index.tsx`, replace the `EventRow` type (around line 28–32):

```ts
// Before:
type EventRow = {
  id: string; title: string; starts_at: string; location: string | null; community_id: string;
  communities: { name: string } | null;
};

// After:
type EventRow = {
  id: string; title: string; starts_at: string; ends_at: string | null;
  location_text: string | null; community_id: string;
  is_paid: boolean; communities: { name: string } | null;
};
```

- [ ] **Step 2: Update the events FlashList renderItem**

In the events FlashList `renderItem` (around line 287–310), replace the entire `renderItem` function:

```tsx
renderItem={({ item }) => {
  const going = rsvpIds.has(item.id);
  return (
    <View style={styles.eventCard}>
      {/* Tappable body → event detail */}
      <TouchableOpacity
        style={styles.eventCardBody}
        onPress={() => router.push(`/event/${item.id}` as any)}
        activeOpacity={0.75}
      >
        <View style={styles.dateChip}>
          <Text style={styles.dateDay}>{format(new Date(item.starts_at), 'dd')}</Text>
          <Text style={styles.dateMonth}>{format(new Date(item.starts_at), 'MMM')}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.eventTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.eventCommunity}>{item.communities?.name ?? '—'}</Text>
          {item.location_text
            ? <Text style={styles.eventLocation} numberOfLines={1}>📍 {item.location_text}</Text>
            : null
          }
        </View>
      </TouchableOpacity>
      {/* RSVP button stays separate — does not trigger card tap */}
      <TouchableOpacity
        style={[styles.rsvpBtn, going && styles.rsvpBtnGoing]}
        onPress={() => toggleRsvp(item.id)}
      >
        <Text style={[styles.rsvpBtnText, going && styles.rsvpBtnTextGoing]}>
          {going ? 'Going ✓' : 'RSVP'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}}
```

- [ ] **Step 3: Add `eventCardBody` style**

In the `StyleSheet.create({...})` block, add after `eventCard`:

```ts
eventCardBody: {
  flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1,
},
```

And update `eventCard` to use `flexDirection: 'row'` (it already does, but now needs to accommodate the separate RSVP button):

```ts
eventCard: {
  flexDirection: 'row', alignItems: 'center', gap: 10,
  backgroundColor: COLORS.surface, marginHorizontal: 12, marginBottom: 8,
  borderRadius: 12, padding: 10,
},
```

- [ ] **Step 4: Run tests to confirm nothing broke**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/\(tabs\)/connect/index.tsx
git commit -m "feat: connect event cards tappable to event detail"
```

---

## Task 6: Wire Discover Event Cards

**Files:**
- Modify: `apps/mobile/app/(tabs)/discover/index.tsx`

Same pattern as Task 5, plus add `is_private: false` filter to the events query.

- [ ] **Step 1: Update EventRow type**

In `apps/mobile/app/(tabs)/discover/index.tsx`, replace the `EventRow` type (around line 19–22):

```ts
// Before:
type EventRow = {
  id: string; title: string; starts_at: string; location: string | null; community_id: string;
  communities: { name: string } | null;
};

// After:
type EventRow = {
  id: string; title: string; starts_at: string; ends_at: string | null;
  location_text: string | null; community_id: string;
  is_paid: boolean; communities: { name: string } | null;
};
```

- [ ] **Step 2: Add is_private filter to the events query**

In the `loadEvents` callback (around line 55–70), add `.eq('is_private', false)`:

```ts
const loadEvents = useCallback(async () => {
  setLoadingEvents(true);
  const now = new Date().toISOString();
  let query = supabase
    .from('events')
    .select('*, communities(name)')
    .eq('is_private', false)          // ← add this line
    .gte('starts_at', now)
    .order('starts_at')
    .limit(50);
  if (selectedCommunityId) {
    query = query.eq('community_id', selectedCommunityId);
  }
  const { data } = await query;
  if (data) setEvents(data as EventRow[]);
  setLoadingEvents(false);
}, [selectedCommunityId]);
```

- [ ] **Step 3: Update the events FlashList renderItem**

Find the events FlashList `renderItem` in the Discover screen and replace it with the tappable card pattern. The Discover screen has an "Interested" button instead of RSVP:

```tsx
renderItem={({ item }) => {
  const interested = interestedIds.has(item.id);
  return (
    <View style={styles.eventCard}>
      {/* Tappable body → event detail */}
      <TouchableOpacity
        style={styles.eventCardBody}
        onPress={() => router.push(`/event/${item.id}` as any)}
        activeOpacity={0.75}
      >
        <View style={styles.dateChip}>
          <Text style={styles.dateDay}>{format(new Date(item.starts_at), 'dd')}</Text>
          <Text style={styles.dateMonth}>{format(new Date(item.starts_at), 'MMM')}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.eventTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.eventMeta}>{item.communities?.name ?? '—'}</Text>
          {item.location_text
            ? <Text style={styles.eventMeta} numberOfLines={1}>📍 {item.location_text}</Text>
            : null
          }
        </View>
      </TouchableOpacity>
      {/* Interested button stays separate */}
      <TouchableOpacity
        style={[styles.interestedBtn, interested && styles.interestedBtnActive]}
        onPress={() => toggleInterested(item.id)}
      >
        <Text style={[styles.interestedBtnText, interested && styles.interestedBtnTextActive]}>
          {interested ? '★ Saved' : '☆ Save'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}}
```

Add `eventCardBody` style to the Discover StyleSheet:

```ts
eventCardBody: {
  flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1,
},
```

- [ ] **Step 4: Run tests to confirm nothing broke**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/\(tabs\)/discover/index.tsx
git commit -m "feat: discover event cards tappable; add is_private filter"
```

---

## Task 7: My Tickets Section in Grow

**Files:**
- Modify: `apps/mobile/app/(tabs)/grow/index.tsx`

- [ ] **Step 1: Add the TicketRow type and tickets state**

At the top of `grow/index.tsx`, after the existing type declarations (around line 40), add:

```ts
type TicketRow = {
  ticket_code: string;
  events: {
    id: string;
    title: string;
    starts_at: string;
    location_text: string | null;
    communities: { name: string } | null;
  } | null;
};
```

Inside `GrowScreen()`, after the existing `const [chatPreviews, ...]` state (around line 98), add:

```ts
const [tickets, setTickets] = useState<TicketRow[]>([]);
```

- [ ] **Step 2: Add the tickets fetch useEffect**

After the chatPreviews `useEffect` (around line 127), add:

```ts
useEffect(() => {
  if (!user?.id) return;
  const now = new Date().toISOString();
  (async () => {
    const { data } = await supabase
      .from('event_attendees')
      .select('ticket_code, events!inner(id, title, starts_at, location_text, communities(name))')
      .eq('user_id', user.id)
      .eq('status', 'going')
      .order('events.starts_at', { ascending: true })
      .limit(20);
    const upcoming = ((data ?? []) as TicketRow[])
      .filter((r) => r.events && r.events.starts_at >= now)
      .slice(0, 5);
    setTickets(upcoming);
  })();
}, [user?.id]);
```

- [ ] **Step 3: Add the My Tickets JSX section**

In the JSX, just before the closing `</ScrollView>` tag (around line 342, after the Badges section):

```tsx
{/* My Tickets */}
{tickets.length > 0 && (
  <View style={styles.section}>
    <View style={styles.ticketSectionHeader}>
      <Text style={styles.sectionTitle}>My Tickets</Text>
      <Text style={styles.ticketCount}>({tickets.length})</Text>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
      {tickets.map((t) => (
        <TouchableOpacity
          key={t.ticket_code}
          style={styles.ticketChip}
          onPress={() => t.events && router.push(`/event/${t.events.id}` as any)}
          activeOpacity={0.8}
        >
          <Text style={styles.ticketChipGoing}>🌸 Going</Text>
          <Text style={styles.ticketChipTitle} numberOfLines={2}>
            {t.events?.title ?? '—'}
          </Text>
          <Text style={styles.ticketChipDate}>
            {t.events ? format(new Date(t.events.starts_at), 'EEE d MMM') : ''}
          </Text>
          <Text style={styles.ticketChipTime}>
            {t.events ? format(new Date(t.events.starts_at), 'h:mm a') : ''}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  </View>
)}
```

- [ ] **Step 4: Add the new styles**

In the `StyleSheet.create({...})` block, add after the existing `chipJoinText` style:

```ts
ticketSectionHeader: {
  flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6,
},
ticketCount: { color: COLORS.textMuted, fontSize: 12, fontWeight: '600' },
ticketChip: {
  backgroundColor: COLORS.background,
  borderRadius: 12,
  padding: 12,
  marginRight: 10,
  width: 130,
  borderWidth: 1,
  borderColor: COLORS.primary + '40',
  gap: 3,
},
ticketChipGoing: { color: COLORS.roxy, fontSize: 11, fontWeight: '700' },
ticketChipTitle: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '700', lineHeight: 17 },
ticketChipDate: { color: COLORS.textSecondary, fontSize: 11, marginTop: 4 },
ticketChipTime: { color: COLORS.textMuted, fontSize: 11 },
```

- [ ] **Step 5: Run all tests**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -5
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/app/\(tabs\)/grow/index.tsx
git commit -m "feat: My Tickets section in Grow"
```

---

## Manual Smoke Test Checklist

After all tasks are complete, verify in the running app:

- [ ] Tap an event in Connect → Events tab → opens event detail screen
- [ ] Tap an event in Discover → Events tab → opens event detail screen
- [ ] Private events do not appear in Discover → Events tab
- [ ] Event detail shows: title, community, date, duration (if ends_at set), location, attendee count, Free/Paid badge, description
- [ ] Tap "RSVP — It's Free" → button shows spinner → ticket card fades in with QR code and ticket code
- [ ] Button becomes "You're going ✓ · Cancel" after RSVP
- [ ] Tap "Cancel" → ticket section disappears, RSVP button returns
- [ ] Tap "+ Add to Calendar" → Google Calendar opens with event pre-filled
- [ ] Navigate away and back to same event → ticket section shows immediately (pre-loaded)
- [ ] Grow screen shows My Tickets section with upcoming events
- [ ] Tap a ticket chip in Grow → opens event detail with ticket visible
- [ ] Event detail for deleted event → shows "This event is no longer available"
