import {
  visibleTabs,
  type ProfileTab,
  type ProfileVariant,
  type PopulatedTabs,
  resolveActiveTab,
  profileLevel,
} from '../../../components/profile/profileVariant';

/** Nothing has content. Every test starts from here and turns exactly one thing on. */
const NONE: PopulatedTabs = {
  posts: false, shop: false, events: false, rooms: false,
  games: false, about: false, saved: false,
};

const ALL: PopulatedTabs = {
  posts: true, shop: true, events: true, rooms: true,
  games: true, about: true, saved: true,
};

const VARIANTS: ProfileVariant[] = ['user', 'seller', 'community', 'self'];

describe('visibleTabs — a tab with no content is not rendered at all', () => {
  it('renders nothing when nothing is populated', () => {
    // Not "renders seven empty tabs". The prototype never draws a tab it cannot
    // fill, and an empty tab strip is the thing that makes a new profile look
    // broken rather than new.
    for (const variant of VARIANTS) {
      expect(visibleTabs(variant, NONE)).toEqual([]);
    }
  });

  it('drops Posts when she has posted nothing, and keeps everything else', () => {
    const populated: PopulatedTabs = { ...ALL, posts: false };
    for (const variant of VARIANTS) {
      expect(visibleTabs(variant, populated)).not.toContain('posts');
      expect(visibleTabs(variant, populated).length).toBeGreaterThan(0);
    }
  });

  it('shows exactly the one tab that has content', () => {
    expect(visibleTabs('community', { ...NONE, rooms: true })).toEqual(['rooms']);
    expect(visibleTabs('user', { ...NONE, events: true })).toEqual(['events']);
    expect(visibleTabs('self', { ...NONE, saved: true })).toEqual(['saved']);
  });
});

describe('visibleTabs — Saved is hers alone', () => {
  it('shows Saved on the self variant when there is something saved', () => {
    expect(visibleTabs('self', { ...NONE, saved: true })).toContain('saved');
  });

  it('never shows Saved on anyone else, even if the caller claims it is populated', () => {
    // A bookmark list is private. If a caller ever passes saved:true for another
    // woman's profile, that is a leak, and the pure function is the cheapest
    // place to make it impossible.
    for (const variant of ['user', 'seller', 'community'] as ProfileVariant[]) {
      expect(visibleTabs(variant, ALL)).not.toContain('saved');
    }
  });
});

describe('visibleTabs — Shop needs an approved seller', () => {
  it('shows Shop for the seller variant', () => {
    expect(visibleTabs('seller', { ...NONE, shop: true })).toEqual(['shop']);
  });

  it('shows Shop for self, since she can be an approved seller too', () => {
    expect(visibleTabs('self', { ...NONE, shop: true })).toEqual(['shop']);
  });

  it('never shows Shop for a plain user — the variant IS the approval', () => {
    // `user` means "not an approved seller": the route derives the variant from
    // canSell(deriveSellerStatus(rows)). Honouring populated.shop here would let
    // one careless caller put a checkout in front of an unverified account.
    expect(visibleTabs('user', ALL)).not.toContain('shop');
  });

  it('never shows Shop on a community', () => {
    expect(visibleTabs('community', ALL)).not.toContain('shop');
  });
});

describe('visibleTabs — About only when there is something to say', () => {
  it('shows About for a community with rules or a bio', () => {
    expect(visibleTabs('community', { ...NONE, about: true })).toEqual(['about']);
  });

  it('hides About for a community with neither', () => {
    expect(visibleTabs('community', { ...ALL, about: false })).not.toContain('about');
  });
});

describe('visibleTabs — order follows the prototype', () => {
  it('orders a community Posts · Rooms · Events · Games · About', () => {
    // Prototype `tabsFor.wlw` — behaviour line 1523.
    expect(visibleTabs('community', ALL)).toEqual<ProfileTab[]>([
      'posts', 'rooms', 'events', 'games', 'about',
    ]);
  });

  it('orders a seller Posts · Shop · Events', () => {
    // Prototype `tabsFor.maya`.
    expect(visibleTabs('seller', { ...NONE, posts: true, shop: true, events: true }))
      .toEqual<ProfileTab[]>(['posts', 'shop', 'events']);
  });

  it('orders self Posts · Saved · Shop', () => {
    // Prototype: `['Posts','Saved'].concat(seller==='approved' ? ['Shop'] : [])`.
    expect(visibleTabs('self', { ...NONE, posts: true, saved: true, shop: true }))
      .toEqual<ProfileTab[]>(['posts', 'saved', 'shop']);
  });

  it('is stable — the same input gives the same order every time', () => {
    expect(visibleTabs('user', ALL)).toEqual(visibleTabs('user', ALL));
  });
});

describe('visibleTabs — pure', () => {
  it('does not mutate the populated map it is handed', () => {
    const populated: PopulatedTabs = { ...ALL };
    visibleTabs('self', populated);
    expect(populated).toEqual(ALL);
  });

  it('returns a fresh array each call, so a caller can sort or splice it', () => {
    const a = visibleTabs('community', ALL);
    const b = visibleTabs('community', ALL);
    expect(a).not.toBe(b);
    a.pop();
    expect(visibleTabs('community', ALL)).toEqual(b);
  });
});

describe('resolveActiveTab — the strip can change under her', () => {
  it('keeps her selection when it is still on the strip', () => {
    expect(resolveActiveTab(['posts', 'rooms', 'about'], 'rooms')).toBe('rooms');
  });

  it('falls back to the FIRST visible tab, never to a hardcoded Posts', () => {
    // A seller with no posts opens on Shop. Defaulting to 'posts' would select a
    // tab that visibleTabs deliberately did not render, and the body would be
    // blank with nothing highlighted.
    expect(resolveActiveTab(['shop', 'events'], null)).toBe('shop');
  });

  it('drops a selection the strip no longer contains', () => {
    // She taps Rooms, a refetch finds no rooms, the tab goes. Holding the stale
    // selection renders content for a tab that is not on screen.
    expect(resolveActiveTab(['posts'], 'rooms')).toBe('posts');
  });

  it('answers null when there is no strip at all', () => {
    expect(resolveActiveTab([], 'posts')).toBeNull();
  });
});

describe('profileLevel — ProfileCard bands, kept', () => {
  it('bands points into Seedling, Bloom and Radiant', () => {
    expect(profileLevel(0).label).toBe('Seedling');
    expect(profileLevel(99).label).toBe('Seedling');
    expect(profileLevel(100).label).toBe('Bloom');
    expect(profileLevel(499).label).toBe('Bloom');
    expect(profileLevel(500).label).toBe('Radiant');
  });

  it('carries an emoji for each band, so the badge is never a bare word', () => {
    for (const points of [0, 100, 500]) {
      expect(profileLevel(points).emoji.length).toBeGreaterThan(0);
    }
  });

  it('treats a missing or negative score as the first band rather than crashing', () => {
    expect(profileLevel(null).label).toBe('Seedling');
    expect(profileLevel(undefined).label).toBe('Seedling');
    expect(profileLevel(-5).label).toBe('Seedling');
  });
});
