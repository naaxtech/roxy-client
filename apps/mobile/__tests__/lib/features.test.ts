import { readFileSync } from 'fs';
import { join } from 'path';
import {
  OFFICIAL_COMMUNITY_SLUG,
  PUBLIC_FEATURES,
  canAccessCommunity,
  canAccessCommunityForKind,
  canOpenPath,
  canOpenPathForKind,
  canUseFeature,
  canUseFeatureForKind,
  comingSoonCopy,
  effectiveVettingStatus,
  featureForPath,
  launchGateFeature,
  parseAccessTier,
  resolveAccountKind,
} from '../../lib/features';

/**
 * Limited launch: public sees Archive + Roxy Official chat. Beta sees the rest.
 *
 * The toggle is a column on the profile (`access_tier`), not a client flag and
 * not vetting_status. A missing or unknown value fails closed to public so a
 * new account never inherits the full app by accident.
 */

describe('parseAccessTier', () => {
  it('only treats the literal tag beta as beta', () => {
    expect(parseAccessTier('beta')).toBe('beta');
  });

  it('fails closed to public for everything else', () => {
    expect(parseAccessTier('public')).toBe('public');
    expect(parseAccessTier(undefined)).toBe('public');
    expect(parseAccessTier(null)).toBe('public');
    expect(parseAccessTier('')).toBe('public');
    expect(parseAccessTier('BETA')).toBe('public');
    expect(parseAccessTier('admin')).toBe('public');
  });
});

describe('canUseFeature', () => {
  it('lets a public member into Archive and official chat only', () => {
    expect(PUBLIC_FEATURES).toEqual(['archive', 'officialChat']);
    expect(canUseFeature('archive', 'public')).toBe(true);
    expect(canUseFeature('officialChat', 'public')).toBe(true);
  });

  it('holds everything else behind the toggle for public', () => {
    for (const feature of [
      'feed',
      'discover',
      'create',
      'dms',
      'roxyCompanion',
      'sister',
      'rooms',
      'events',
      'commerce',
      'speedDating',
      'communities',
    ] as const) {
      expect(canUseFeature(feature, 'public')).toBe(false);
    }
  });

  it('lets a beta member into every named feature', () => {
    for (const feature of [
      'archive',
      'officialChat',
      'feed',
      'discover',
      'create',
      'dms',
      'roxyCompanion',
      'sister',
      'rooms',
      'events',
      'commerce',
      'speedDating',
      'communities',
    ] as const) {
      expect(canUseFeature(feature, 'beta')).toBe(true);
    }
  });
});

describe('canAccessCommunity', () => {
  it('lets public into Roxy Official only', () => {
    expect(OFFICIAL_COMMUNITY_SLUG).toBe('roxy-official');
    expect(canAccessCommunity('roxy-official', 'public')).toBe(true);
    expect(canAccessCommunity('wlw-london', 'public')).toBe(false);
    expect(canAccessCommunity(undefined, 'public')).toBe(false);
  });

  it('lets beta into any community, including one still loading', () => {
    expect(canAccessCommunity('wlw-london', 'beta')).toBe(true);
    expect(canAccessCommunity(undefined, 'beta')).toBe(true);
  });
});

describe('featureForPath', () => {
  it('leaves Archive, You chrome, and the tab shells un-gated', () => {
    for (const path of [
      '/archive',
      '/archive/portrait-of-a-lady-on-fire',
      '/feed',
      '/(tabs)/feed',
      '/messages',
      '/(tabs)/messages',
      '/you',
      '/(tabs)/you',
      '/you/settings',
      '/you/edit',
      '/you/blocked',
      '/you/delete-account',
      '/you/feedback',
      '/notifications',
      '/support',
      '/blocked',
      '/community/channels',
      '/community/channels/abc',
      '/community/create-post',
      '/community/create-event',
      '/code',
      '/(auth)/pending',
    ]) {
      expect(`${path} → ${featureForPath(path)}`).toBe(`${path} → null`);
    }
  });

  it('maps the rest of the app onto a named feature so Coming soon has copy', () => {
    expect(featureForPath('/discover')).toBe('discover');
    expect(featureForPath('/(tabs)/discover')).toBe('discover');
    expect(featureForPath('/discover/community/xyz')).toBe('discover');
    expect(featureForPath('/messages/new')).toBe('dms');
    expect(featureForPath('/chat/abc')).toBe('dms');
    expect(featureForPath('/roxy-chat')).toBe('roxyCompanion');
    expect(featureForPath('/sister-button')).toBe('sister');
    expect(featureForPath('/event/1')).toBe('events');
    expect(featureForPath('/product/1')).toBe('commerce');
    expect(featureForPath('/business/1')).toBe('commerce');
    expect(featureForPath('/tickets')).toBe('commerce');
    expect(featureForPath('/community-room-session')).toBe('rooms');
    expect(featureForPath('/speed-dating')).toBe('speedDating');
    expect(featureForPath('/people')).toBe('feed');
    expect(featureForPath('/user/abc')).toBe('feed');
    expect(featureForPath('/communities')).toBe('communities');
    expect(featureForPath('/search')).toBe('discover');
  });
});

describe('launchGateFeature', () => {
  it('lets tab screens keep their own chrome so Coming soon sits inside the bar', () => {
    expect(launchGateFeature('/discover')).toBeNull();
    expect(launchGateFeature('/discover/community/xyz')).toBeNull();
    expect(launchGateFeature('/messages/new')).toBeNull();
    expect(launchGateFeature('/you/abc')).toBeNull();
    expect(launchGateFeature('/feed')).toBeNull();
  });

  it('still blocks stack routes a public member can deep-link into', () => {
    expect(launchGateFeature('/roxy-chat')).toBe('roxyCompanion');
    expect(launchGateFeature('/event/1')).toBe('events');
    expect(launchGateFeature('/chat/abc')).toBe('dms');
    expect(launchGateFeature('/archive')).toBeNull();
  });

  /**
   * `featureForPath` ends in `return 'discover'`, so every path nobody listed
   * is gated by default. That default is right for a product surface and wrong
   * for an auth screen: LaunchGate renders ComingSoon in an `absoluteFill` with
   * `pointerEvents="auto"`, so the screen still paints but every tap lands on
   * the overlay.
   *
   * Caught in a browser, not by a test: the reset form rendered perfectly and
   * `elementFromPoint` over the Save button returned "Discover is coming soon".
   * A password reset a woman cannot submit is the same bug as no reset at all.
   */
  it('never gates an auth screen — a locked-out member is not a launch decision', () => {
    expect(launchGateFeature('/reset-password')).toBeNull();
    expect(launchGateFeature('/welcome')).toBeNull();
    expect(launchGateFeature('/code')).toBeNull();
    expect(launchGateFeature('/application')).toBeNull();
    expect(launchGateFeature('/pending')).toBeNull();
  });

  it('leaves the reset screen open to a public-tier account', () => {
    // She cannot have a tier worth checking — she cannot get in to have one.
    expect(featureForPath('/reset-password')).toBeNull();
    expect(canOpenPath('/reset-password', 'public')).toBe(true);
  });

  /**
   * `normalizePath` stripped `?query` but not `#fragment`, so a path arriving
   * with a hash never matched the exact-match sets and fell through to the
   * `return 'discover'` default.
   *
   * It bit the recovery screen hardest, because a recovery link is ALWAYS a
   * fragment: `/reset-password#access_token=…` read as an unknown route, the
   * gate drew ComingSoon over the form, and the same URL with the hash removed
   * behaved perfectly — which is exactly why it survived a bare-URL check.
   */
  it('ignores a URL fragment when deciding the route, as it already does a query', () => {
    expect(launchGateFeature('/reset-password#access_token=abc&type=recovery')).toBeNull();
    expect(launchGateFeature('/welcome#anything')).toBeNull();
    expect(featureForPath('/archive#top')).toBeNull();
  });

  it('still gates a real product route that happens to carry a fragment', () => {
    expect(launchGateFeature('/roxy-chat#x')).toBe('roxyCompanion');
  });
});

describe('canOpenPath', () => {
  it('lets public follow Archive and refuses event and DM links', () => {
    expect(canOpenPath('/archive/portrait', 'public')).toBe(true);
    expect(canOpenPath('/event/1', 'public')).toBe(false);
    expect(canOpenPath('/chat/abc', 'public')).toBe(false);
    expect(canOpenPath('/you/settings', 'public')).toBe(true);
  });

  it('lets beta follow the rest of the app', () => {
    expect(canOpenPath('/event/1', 'beta')).toBe(true);
    expect(canOpenPath('/chat/abc', 'beta')).toBe(true);
  });
});

describe('comingSoonCopy', () => {
  it('names the thing she cannot open yet', () => {
    expect(comingSoonCopy('discover').title).toMatch(/coming soon/i);
    expect(comingSoonCopy('officialChat').title.length).toBeGreaterThan(0);
  });

  it('tells a pending applicant Official chat unlocks on approval, not that more communities are coming', () => {
    const official = comingSoonCopy('officialChat', 'pending');
    expect(official.title).toMatch(/approved/i);
    expect(official.body).toMatch(/pending/i);
    expect(official.body).not.toMatch(/coming soon/i);

    const communities = comingSoonCopy('communities', 'pending');
    expect(communities.body).toMatch(/approved/i);
    expect(communities.title).not.toMatch(/coming soon/i);

    const discover = comingSoonCopy('discover', 'pending');
    expect(discover.title).toMatch(/approved/i);
    expect(discover.title).not.toMatch(/coming soon/i);
  });
});

describe('migration 108', () => {
  const sql = readFileSync(
    join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '108_limited_launch_access_tier.sql'),
    'utf8',
  );

  it('defaults new profiles to public and seeds Roxy Official', () => {
    expect(sql).toMatch(/default 'public'/);
    expect(sql).toMatch(/roxy-official/);
    expect(sql).not.toMatch(/update public\.profiles[\s\S]*access_tier\s*=\s*'beta'/i);
  });
});

describe('migration 109', () => {
  const sql = readFileSync(
    join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '109_staff_set_access_tier.sql'),
    'utf8',
  );

  it('gives staff one RPC and no client UPDATE grant on the column', () => {
    expect(sql).toMatch(/create or replace function public\.set_access_tier/);
    expect(sql).toMatch(/is_roxy_staff/);
    expect(sql).not.toMatch(/grant update\s*\([^)]*access_tier/i);
  });
});

describe('migration 110', () => {
  const sql = readFileSync(
    join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '110_roxy_core_staff_role.sql'),
    'utf8',
  );

  it('seeds the two HQ inboxes as core and never grants a client UPDATE', () => {
    expect(sql).toMatch(/naaxtech\.official@gmail\.com/);
    expect(sql).toMatch(/naaxtech\.marketing@gmail\.com/);
    expect(sql).toMatch(/create or replace function public\.set_staff_role/);
    expect(sql).toMatch(/is_roxy_core/);
    expect(sql).not.toMatch(/grant update\s*\([^)]*staff_role/i);
    expect(sql).toMatch(/cannot change a core account/);
  });
});

describe('resolveAccountKind', () => {
  it('reads core before staff, and pending before a community-owner tag', () => {
    expect(resolveAccountKind({ staff_role: 'core', is_staff: true })).toBe('core');
    expect(resolveAccountKind({ staff_role: 'staff', is_staff: true })).toBe('staff');
    expect(resolveAccountKind({ is_staff: true })).toBe('staff');
    expect(resolveAccountKind({
      is_community_owner: true,
      vetting_status: 'pending',
    })).toBe('pending');
    expect(resolveAccountKind({
      is_community_owner: true,
      vetting_status: 'approved',
    })).toBe('communityOwner');
    expect(resolveAccountKind({ vetting_status: 'approved' })).toBe('member');
    expect(resolveAccountKind(null)).toBe('member');
  });
});

describe('canUseFeatureForKind', () => {
  it('gives core and staff the full app, members Archive + Official, owners community chat too', () => {
    expect(canUseFeatureForKind('dms', 'core')).toBe(true);
    expect(canUseFeatureForKind('dms', 'staff')).toBe(true);
    expect(canUseFeatureForKind('dms', 'member')).toBe(false);
    expect(canUseFeatureForKind('officialChat', 'member')).toBe(true);
    expect(canUseFeatureForKind('communities', 'member')).toBe(false);
    expect(canUseFeatureForKind('communities', 'communityOwner')).toBe(true);
    expect(canUseFeatureForKind('dms', 'communityOwner')).toBe(false);
    expect(canUseFeatureForKind('archive', 'pending')).toBe(true);
    expect(canUseFeatureForKind('officialChat', 'pending')).toBe(false);
  });
});

describe('canAccessCommunityForKind', () => {
  it('lets owners into any community and members into Official only', () => {
    expect(canAccessCommunityForKind('wlw-london', 'communityOwner')).toBe(true);
    expect(canAccessCommunityForKind('wlw-london', 'member')).toBe(false);
    expect(canAccessCommunityForKind('roxy-official', 'member')).toBe(true);
    expect(canAccessCommunityForKind('roxy-official', 'pending')).toBe(false);
  });
});

describe('canOpenPathForKind', () => {
  it('lets a community owner open /communities and still refuses DMs', () => {
    expect(canOpenPathForKind('/communities', 'communityOwner')).toBe(true);
    expect(canOpenPathForKind('/chat/abc', 'communityOwner')).toBe(false);
    expect(canOpenPathForKind('/communities', 'member')).toBe(false);
  });
});

describe('effectiveVettingStatus', () => {
  it('only pretends pending when core is previewing that kind', () => {
    expect(effectiveVettingStatus('approved', 'pending')).toBe('pending');
    expect(effectiveVettingStatus('approved', 'member')).toBe('approved');
    expect(effectiveVettingStatus('pending', null)).toBe('pending');
  });
});

describe('migration 111', () => {
  const sql = readFileSync(
    join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '111_community_owner_tag.sql'),
    'utf8',
  );

  it('lets core tag an approved member and never grants a client UPDATE', () => {
    expect(sql).toMatch(/is_community_owner/);
    expect(sql).toMatch(/create or replace function public\.set_community_owner/);
    expect(sql).toMatch(/is_roxy_core/);
    expect(sql).toMatch(/only approved members/);
    expect(sql).toMatch(/cannot tag staff/);
    expect(sql).toMatch(/cannot tag a core/);
    expect(sql).not.toMatch(/grant update\s*\([^)]*is_community_owner/i);
  });
});

describe('migration 116', () => {
  const sql = readFileSync(
    join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '116_follows_and_official_community.sql'),
    'utf8',
  );

  it('adds follows and an official community FK that clients cannot UPDATE', () => {
    expect(sql).toMatch(/create table if not exists public\.follows/);
    expect(sql).toMatch(/follows_no_self/);
    expect(sql).toMatch(/official_community_id/);
    expect(sql).toMatch(/profiles_official_community_unique/);
    expect(sql).toMatch(/create or replace function public\.set_community_owner/);
    expect(sql).toMatch(/community_channels/);
    expect(sql).not.toMatch(/grant update\s*\([^)]*official_community_id/i);
  });
});

describe('migration 119', () => {
  const sql = readFileSync(
    join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '119_product_link_on_posts.sql'),
    'utf8',
  );

  it('lets a regular post carry a shop item', () => {
    expect(sql).toMatch(/posts_link_type_check/);
    expect(sql).toMatch(/'product'/);
    expect(sql).toMatch(/'game'/);
  });
});

describe('migration 118', () => {
  const sql = readFileSync(
    join(__dirname, '..', '..', '..', '..', 'supabase', 'migrations', '118_account_wall_feed_and_reseed.sql'),
    'utf8',
  );

  it('locks posts to the author and ranks For You on profile walls', () => {
    expect(sql).toMatch(/posts_force_profile_wall/);
    expect(sql).toMatch(/NEW\.community_id := NULL/);
    expect(sql).toMatch(/NEW\.posted_as_community := false/);
    expect(sql).toMatch(/create or replace function public\.announcement_feed/i);
    expect(sql).toMatch(/join public\.follows f/i);
    expect(sql).toMatch(/create or replace function public\.link_official_community/i);
    expect(sql).not.toMatch(/grant update\s*\([^)]*official_community_id/i);
  });
});
