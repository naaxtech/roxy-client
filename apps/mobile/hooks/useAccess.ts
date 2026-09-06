import { useProfileStore } from '../store/profileStore';
import {
  canAccessCommunity,
  canUseFeature,
  parseAccessTier,
  type AccessTier,
  type Feature,
} from '../lib/features';

/**
 * The launch toggle for the signed-in profile.
 *
 * Reads `profiles.access_tier`. Missing profile fails closed to public so a
 * cold start never flashes the full app before the row arrives.
 */
export function useAccess(): {
  tier: AccessTier;
  isBeta: boolean;
  can: (feature: Feature) => boolean;
  canCommunity: (slug?: string | null) => boolean;
} {
  const profile = useProfileStore((s) => s.profile);
  const tier = parseAccessTier(profile?.access_tier);

  return {
    tier,
    isBeta: tier === 'beta',
    can: (feature) => canUseFeature(feature, tier),
    canCommunity: (slug) => canAccessCommunity(slug, tier),
  };
}
