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

// ── When an online event becomes a room you can walk into ────────────────────

/**
 * How early the Join door opens.
 *
 * Nobody arrives at exactly the hour, and a button that appears on the stroke
 * of it is a button she watches rather than a room she enters. Ten minutes is
 * the same courtesy a physical door gets.
 */
export const EVENT_JOIN_OPENS_MS = 10 * 60 * 1000;

/**
 * How long an event with no end time stays joinable.
 *
 * `events.ends_at` is nullable. Without a bound, an online event with no end
 * would advertise Join for the rest of the year — so an unbounded one is
 * treated as a long evening and then closed.
 */
const OPEN_ENDED_RUNS_FOR_MS = 6 * 60 * 60 * 1000;

export type EventStage = 'upcoming' | 'live' | 'ended';

/**
 * Where an event is relative to now.
 *
 * Pure and injectable so the boundaries can be asserted directly instead of by
 * mocking a clock inside a component — each boundary is a moment a real person
 * is looking at the screen, and they are worth testing one at a time.
 *
 * An unparseable date answers `upcoming`. Guessing `live` on a bad timestamp
 * would put a Join button on a room that is not open, which is the one wrong
 * answer that wastes her time twice.
 */
export function eventStage(
  startsAt: string,
  endsAt: string | null,
  now: number = Date.now()
): EventStage {
  const start = Date.parse(startsAt);
  if (Number.isNaN(start)) return 'upcoming';

  const parsedEnd = endsAt ? Date.parse(endsAt) : NaN;
  const end = Number.isNaN(parsedEnd) ? start + OPEN_ENDED_RUNS_FOR_MS : parsedEnd;

  if (now > end) return 'ended';
  if (now >= start - EVENT_JOIN_OPENS_MS) return 'live';
  return 'upcoming';
}

/**
 * What the primary button should say.
 *
 * Composed from the stage it is handling rather than by elimination — this
 * codebase has shipped the `!== 'x'` version of this three times, and the
 * version here would offer a room that has closed.
 */
/**
 * The safety line under About.
 *
 * The prototype always prints one (markup 1231). Roxy has no `safety_notes`
 * column, so this is composed from facts the row already has — venue kind,
 * host, and whether the attendee list is private. Inventing "step-free" or a
 * host we do not have would be a lie on the one line she reads before she
 * books a train.
 */
export function eventSafetyLine(event: {
  event_type: 'online' | 'in_person' | 'hybrid';
  is_private: boolean;
  communityName?: string | null;
}): string {
  if (event.event_type === 'online') {
    return 'Lurk-friendly — mics optional. Doors open 10 min early.';
  }

  const host = event.communityName?.trim()
    ? `hosted by ${event.communityName.trim()}`
    : 'community hosted';
  const list = event.is_private
    ? 'attendee list hidden'
    : 'attendee list visible to members only';

  if (event.event_type === 'hybrid') {
    return `Online and in person · ${host} · ${list}`;
  }

  return event.is_private
    ? `Private event · ${host} · ${list}`
    : `Public venue · ${host} · ${list}`;
}

export function eventCta(stage: EventStage, isAttending: boolean, isPaid: boolean): string {
  if (stage === 'ended') return 'This has ended';
  // Open to anyone who finds it while it is running. Refusing her because she
  // did not RSVP to something already open helps nobody.
  if (stage === 'live') return 'Join now';
  if (isAttending) return 'You’re going ✓';
  if (isPaid) return 'Get a ticket';
  return 'RSVP — it’s free';
}
