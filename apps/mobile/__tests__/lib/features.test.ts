import { readFileSync } from 'fs';
import { join } from 'path';
import {
  OFFICIAL_COMMUNITY_SLUG,
  PUBLIC_FEATURES,
  canAccessCommunity,
  canUseFeature,
  canOpenPath,
  comingSoonCopy,
  featureForPath,
  launchGateFeature,
  parseAccessTier,
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
