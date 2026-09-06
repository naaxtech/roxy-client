import { parseMessageCard } from '../../lib/messageCard';

/**
 * A channel message that names an event, a product or an Archive entry
 * becomes a card, the way the prototype draws `m.hasCard` (markup 679).
 *
 * No attachment column: migration 105 refused schema nothing reads. The card
 * is parsed from a path she actually pasted, so a message without one stays
 * a message.
 */

describe('parseMessageCard', () => {
  it('turns an event path into an event card', () => {
    const card = parseMessageCard('Cinema tonight — /event/c2fb3fd8-8528-4e69-bce6-44931b4377c4');
    expect(card).toEqual({
      kind: 'event',
      path: '/event/c2fb3fd8-8528-4e69-bce6-44931b4377c4',
      title: 'Event',
      subtitle: 'On Roxy',
      cta: 'Open',
    });
  });

  it('turns a product path into a shop card', () => {
    const card = parseMessageCard('https://roxy.expo.app/product/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(card?.kind).toBe('product');
    expect(card?.path).toBe('/product/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(card?.cta).toBe('View');
  });

  it('turns an Archive slug into a catalogue card', () => {
    const card = parseMessageCard('watch this: /archive/portrait-of-a-lady-on-fire');
    expect(card).toEqual({
      kind: 'archive',
      path: '/archive/portrait-of-a-lady-on-fire',
      title: 'Archive',
      subtitle: 'WLW catalogue',
      cta: 'Open',
    });
  });

  it('turns a live-room link into a join card', () => {
    const card = parseMessageCard('we are in /community-room-session?room_id=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(card?.kind).toBe('room');
    expect(card?.cta).toBe('Join');
  });

  it('returns nothing for ordinary chat', () => {
    expect(parseMessageCard('see you at the cinema tonight')).toBeNull();
  });

  it('returns nothing for an empty body', () => {
    expect(parseMessageCard('')).toBeNull();
  });
});
