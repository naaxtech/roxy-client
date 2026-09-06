/**
 * Limited launch toggle.
 *
 * Public members may use the WLW Archive and the Roxy Official community
 * chat. Everything else is Coming soon until `profiles.access_tier` is
 * tagged `beta`. A missing or unknown value fails closed to public so a
 * new account never inherits the full app by accident.
 *
 * This is not `vetting_status`. Pending members already browse Archive
 * with a status chip; Official chat unlocks when a reviewer admits them.
 * Beta is a separate product tag for testers who should see the rest.
 */

export const OFFICIAL_COMMUNITY_SLUG = 'roxy-official';

export type AccessTier = 'public' | 'beta';

export type Feature =
  | 'archive'
  | 'officialChat'
  | 'feed'
  | 'discover'
  | 'create'
  | 'dms'
  | 'roxyCompanion'
  | 'sister'
  | 'rooms'
  | 'events'
  | 'commerce'
  | 'speedDating'
  | 'communities';

export const PUBLIC_FEATURES: readonly Feature[] = ['archive', 'officialChat'];

const PUBLIC_FEATURE_SET = new Set<Feature>(PUBLIC_FEATURES);

export function parseAccessTier(raw: string | null | undefined): AccessTier {
  return raw === 'beta' ? 'beta' : 'public';
}

export function canUseFeature(feature: Feature, tier: AccessTier): boolean {
  if (tier === 'beta') return true;
  return PUBLIC_FEATURE_SET.has(feature);
}

export function canAccessCommunity(
  slug: string | null | undefined,
  tier: AccessTier,
): boolean {
  if (tier === 'beta') return true;
  return slug === OFFICIAL_COMMUNITY_SLUG;
}

/**
 * Who is looking at the app — the real account, or a core preview of one.
 *
 * Core and staff see the full product. Approved members get Archive + Official
 * chat. Community owners are approved members who may also open community chat
 * (tagged only by core, never self-serve). Pending browses Archive with a
 * status chip; Official chat unlocks on approval.
 */
export type AccountKind = 'core' | 'staff' | 'member' | 'communityOwner' | 'pending';

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  core: 'Roxy core',
  staff: 'Staff',
  member: 'Member',
  communityOwner: 'Community owner',
  pending: 'Pending',
};

const KIND_FEATURES: Record<AccountKind, readonly Feature[] | 'all'> = {
  core: 'all',
  staff: 'all',
  communityOwner: ['archive', 'officialChat', 'communities'],
  member: PUBLIC_FEATURES,
  pending: ['archive'],
};

export function resolveAccountKind(profile: {
  staff_role?: string | null;
  is_staff?: boolean | null;
  is_community_owner?: boolean | null;
  vetting_status?: string | null;
} | null | undefined): AccountKind {
  if (profile?.staff_role === 'core') return 'core';
  if (profile?.staff_role === 'staff' || profile?.is_staff) return 'staff';
  if (profile?.vetting_status === 'pending' || profile?.vetting_status === 'rejected') {
    return 'pending';
  }
  if (profile?.is_community_owner) return 'communityOwner';
  return 'member';
}

export function canUseFeatureForKind(feature: Feature, kind: AccountKind): boolean {
  const allowed = KIND_FEATURES[kind];
  return allowed === 'all' || allowed.includes(feature);
}

export function canAccessCommunityForKind(
  slug: string | null | undefined,
  kind: AccountKind,
): boolean {
  if (kind === 'core' || kind === 'staff') return true;
  if (kind === 'pending') return false;
  if (kind === 'communityOwner') return true;
  return slug === OFFICIAL_COMMUNITY_SLUG;
}

export function accessTierForKind(kind: AccountKind): AccessTier {
  return kind === 'core' || kind === 'staff' ? 'beta' : 'public';
}

export function effectiveVettingStatus(
  real: string | null | undefined,
  preview: AccountKind | null,
): string | null | undefined {
  if (preview === 'pending') return 'pending';
  if (preview) return 'approved';
  return real;
}

const YOU_ALLOWED = new Set([
  '/you',
  '/you/settings',
  '/you/edit',
  '/you/blocked',
  '/you/delete-account',
  '/you/feedback',
]);

const AUTH_ALLOWED = new Set([
  '/code',
  '/welcome',
  '/application',
  '/pending',
]);

const ALWAYS_ALLOWED = new Set([
  '/',
  '/feed',
  '/messages',
  '/notifications',
  '/support',
  '/blocked',
  ...YOU_ALLOWED,
  ...AUTH_ALLOWED,
]);

const PATH_FEATURES: Array<[prefix: string, feature: Feature]> = [
  ['/messages/new', 'dms'],
  ['/chat', 'dms'],
  ['/roxy-chat', 'roxyCompanion'],
  ['/sister-button', 'sister'],
  ['/event', 'events'],
  ['/product', 'commerce'],
  ['/business', 'commerce'],
  ['/tickets', 'commerce'],
  ['/community-room-session', 'rooms'],
  ['/speed-dating', 'speedDating'],
  ['/people', 'feed'],
  ['/user', 'feed'],
  ['/badges', 'feed'],
  ['/qotd', 'feed'],
  ['/communities', 'communities'],
  ['/search', 'discover'],
  ['/discover', 'discover'],
];

function normalizePath(pathname: string): string {
  const stripped = pathname
    .split('?')[0]
    .replace(/\/\([^/]+\)/g, '')
    .replace(/\/+$/, '');
  return stripped || '/';
}

function pathMatches(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Which feature a route belongs to, or null when public may open it.
 *
 * Tab shells (Feed, Messages, You) stay null so their screens can swap
 * content. Official chat lives at `/community/channels/:id` and is checked
 * against the community slug after load, not here.
 */
export function featureForPath(pathname: string): Feature | null {
  const path = normalizePath(pathname);

  if (ALWAYS_ALLOWED.has(path)) return null;
  if (pathMatches(path, '/archive')) return null;
  if (pathMatches(path, '/community/channels')) return null;
  if (pathMatches(path, '/onboarding')) return null;

  for (const [prefix, feature] of PATH_FEATURES) {
    if (pathMatches(path, prefix)) return feature;
  }

  if (path.startsWith('/you/')) return 'feed';

  return 'discover';
}

const COPY: Record<Feature, { title: string; body: string }> = {
  archive: {
    title: 'Archive is here',
    body: 'Browse films, TV, books and more recommended by wlw.',
  },
  officialChat: {
    title: 'Roxy Official',
    body: 'Chat with the Roxy team and other members in the official community.',
  },
  feed: {
    title: 'Feed is coming soon',
    body: 'Reels, posts and people will open here. For now, the Archive and Roxy Official chat are live.',
  },
  discover: {
    title: 'Discover is coming soon',
    body: 'Rooms, events and the rest of Discover are on the way. The Archive is open now.',
  },
  create: {
    title: 'Create is coming soon',
    body: 'Posting, rooms and selling will land here. You can still rate titles in the Archive.',
  },
  dms: {
    title: 'DMs are coming soon',
    body: 'Private messages will open later. Roxy Official chat is live now.',
  },
  roxyCompanion: {
    title: 'Roxy is coming soon',
    body: 'Your wingwoman will be back. Official community chat is open in the meantime.',
  },
  sister: {
    title: 'Sister is coming soon',
    body: 'The private vent space will open with the full app.',
  },
  rooms: {
    title: 'Rooms are coming soon',
    body: 'Live audio rooms will open for beta first, then everyone.',
  },
  events: {
    title: 'Events are coming soon',
    body: 'Community events will show up here once they ship to your account.',
  },
  commerce: {
    title: 'Shop is coming soon',
    body: 'WLW businesses and checkout are part of the full app.',
  },
  speedDating: {
    title: 'Speed dating is coming soon',
    body: 'Flower-or-pass nights will open with the dating launch.',
  },
  communities: {
    title: 'More communities are coming soon',
    body: 'Roxy Official chat is live. Other communities will open for beta first.',
  },
};

const PENDING_COPY: Partial<Record<Feature, { title: string; body: string }>> = {
  officialChat: {
    title: 'Official chat unlocks when you’re approved',
    body: 'Only approved members can open Roxy Official chat. You’re still pending — a reviewer is reading your application, and this unlocks when they admit you.',
  },
  communities: {
    title: 'Community chat unlocks when you’re approved',
    body: 'Only approved members can join community chat. You’re still pending — this opens after a reviewer admits you.',
  },
  dms: {
    title: 'Messages unlock when you’re approved',
    body: 'Private messages are for approved members. You’re still pending — we’ll open this when a reviewer admits you.',
  },
};

/**
 * Root-layout gate. Tab-hosted routes stay null so Feed / Discover /
 * Messages / You can render Coming soon (or Archive / official chat)
 * inside the bar instead of replacing the navigator.
 */
export function launchGateFeature(pathname: string): Feature | null {
  const path = normalizePath(pathname);
  if (
    path === '/feed' ||
    path === '/discover' ||
    path.startsWith('/discover/') ||
    path === '/messages' ||
    path.startsWith('/messages/') ||
    path === '/you' ||
    path.startsWith('/you/')
  ) {
    return null;
  }
  return featureForPath(pathname);
}

const PENDING_FALLBACK = {
  title: 'This unlocks when you’re approved',
  body: 'Only approved members can open this part of Roxy. You’re still pending — a reviewer is reading your application, and this unlocks when they admit you.',
};

export function comingSoonCopy(
  feature: Feature,
  kind?: AccountKind,
): { title: string; body: string } {
  if (kind === 'pending') return PENDING_COPY[feature] ?? PENDING_FALLBACK;
  return COPY[feature];
}

/** Whether a public or beta member may follow this path. */
export function canOpenPath(pathname: string, tier: AccessTier): boolean {
  const feature = featureForPath(pathname);
  if (feature == null) return true;
  return canUseFeature(feature, tier);
}

export function canOpenPathForKind(pathname: string, kind: AccountKind): boolean {
  const feature = featureForPath(pathname);
  if (feature == null) return true;
  return canUseFeatureForKind(feature, kind);
}
