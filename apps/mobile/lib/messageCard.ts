/**
 * Inline cards in community chat.
 *
 * The prototype draws a tappable event/product card under a message
 * (`m.hasCard`, markup 679). Migration 105 has no attachment column — schema
 * nothing reads is dead schema — so the card is parsed from a path she
 * actually pasted. A message without one stays a message.
 */

export type MessageCardKind = 'event' | 'product' | 'archive' | 'room';

export type MessageCard = {
  kind: MessageCardKind;
  path: string;
  title: string;
  subtitle: string;
  cta: string;
};

type Pattern = {
  kind: MessageCardKind;
  re: RegExp;
  path: (id: string) => string;
  title: string;
  subtitle: string;
  cta: string;
};

const PATTERNS: Pattern[] = [
  {
    kind: 'event',
    re: /(?:\/|roxy:\/\/)event\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    path: (id) => `/event/${id}`,
    title: 'Event',
    subtitle: 'On Roxy',
    cta: 'Open',
  },
  {
    kind: 'product',
    re: /(?:\/|roxy:\/\/)product\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    path: (id) => `/product/${id}`,
    title: 'Product',
    subtitle: 'Shop',
    cta: 'View',
  },
  {
    kind: 'archive',
    re: /(?:\/|roxy:\/\/)archive\/([a-z0-9][a-z0-9-]{1,80})/i,
    path: (slug) => `/archive/${slug}`,
    title: 'Archive',
    subtitle: 'WLW catalogue',
    cta: 'Open',
  },
  {
    kind: 'room',
    re: /community-room-session\?room_id=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    path: (id) => `/community-room-session?room_id=${id}`,
    title: 'Live room',
    subtitle: 'Join the stage',
    cta: 'Join',
  },
];

export function parseMessageCard(body: string): MessageCard | null {
  if (!body) return null;
  for (const p of PATTERNS) {
    const m = body.match(p.re);
    if (m?.[1]) {
      return {
        kind: p.kind,
        path: p.path(m[1]),
        title: p.title,
        subtitle: p.subtitle,
        cta: p.cta,
      };
    }
  }
  return null;
}
