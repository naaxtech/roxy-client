import { eventStage, eventCta, EVENT_JOIN_OPENS_MS } from '../../lib/eventUtils';

/**
 * When an online event turns into a room you can walk into.
 *
 * The design's online event is not a static RSVP: it becomes **Join** at start
 * time. Nothing read the clock before this, so an online event she had RSVP'd
 * to looked identical five minutes before it began and an hour after it ended —
 * she had to guess, or open it and find out.
 *
 * Pure and injectable, so the boundaries are asserted directly rather than by
 * mocking a clock inside a component. Every one of these is a moment a real
 * person is looking at the screen.
 */

const at = (iso: string) => new Date(iso).getTime();
const START = '2026-09-02T19:00:00.000Z';
const END = '2026-09-02T21:00:00.000Z';

describe('eventStage', () => {
  it('is upcoming well before it begins', () => {
    expect(eventStage(START, END, at('2026-09-02T17:00:00.000Z'))).toBe('upcoming');
  });

  it('opens the door a little BEFORE the hour, not on the dot', () => {
    // Nobody arrives at exactly 19:00, and a Join button that appears at the
    // stroke of the hour is a button she watches instead of a room she enters.
    const justBefore = at(START) - EVENT_JOIN_OPENS_MS + 1000;
    expect(eventStage(START, END, justBefore)).toBe('live');
  });

  it('is live at the start instant and through the event', () => {
    expect(eventStage(START, END, at(START))).toBe('live');
    expect(eventStage(START, END, at('2026-09-02T20:00:00.000Z'))).toBe('live');
  });

  it('is over once the end has passed', () => {
    expect(eventStage(START, END, at(END) + 1)).toBe('ended');
  });

  it('treats an event with no end as live for a sensible window, not forever', () => {
    // ends_at is nullable. Without a fallback an online event with no end time
    // would advertise Join for the rest of the year.
    const noEnd = eventStage(START, null, at('2026-09-02T20:00:00.000Z'));
    expect(noEnd).toBe('live');
    expect(eventStage(START, null, at('2026-09-03T06:00:00.000Z'))).toBe('ended');
  });

  it('says upcoming rather than guessing when the date is unparseable', () => {
    // A bad timestamp must not render Join on a room that is not open.
    expect(eventStage('not-a-date', null, Date.now())).toBe('upcoming');
  });
});

describe('eventCta', () => {
  it('asks her to RSVP before, and to join once it is open', () => {
    expect(eventCta('upcoming', false, false)).toBe('RSVP — it’s free');
    expect(eventCta('live', true, false)).toBe('Join now');
  });

  it('offers the room to someone who never RSVP’d, rather than a dead end', () => {
    // She found it while it was already running. Refusing her because she did
    // not RSVP to something already open helps nobody.
    expect(eventCta('live', false, false)).toBe('Join now');
  });

  it('says she is going once she has RSVP’d', () => {
    expect(eventCta('upcoming', true, false)).toBe('You’re going ✓');
  });

  it('asks for money when there is money to ask for', () => {
    expect(eventCta('upcoming', false, true)).toBe('Get a ticket');
  });

  it('never offers to join something that has ended', () => {
    expect(eventCta('ended', true, false)).toBe('This has ended');
    expect(eventCta('ended', false, true)).toBe('This has ended');
  });
});
