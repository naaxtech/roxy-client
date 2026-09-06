import { useProfileStore } from '../store/profileStore';
import { useViewAsStore } from '../store/viewAsStore';
import {
  accessTierForKind,
  canAccessCommunityForKind,
  canUseFeatureForKind,
  parseAccessTier,
  resolveAccountKind,
  type AccessTier,
  type AccountKind,
  type Feature,
} from '../lib/features';

/**
 * What this session may open.
 *
 * Real capabilities come from the profile. A beta tag on an approved member
 * still opens the full app. If the account is Roxy core and she has picked a
 * preview in Settings, the gates follow that preview so HQ can see what a
 * member, owner, staffer or applicant sees — the signed-in row does not change.
 */
export function useAccess(): {
  kind: AccountKind;
  realKind: AccountKind;
  isCore: boolean;
  isPreviewing: boolean;
  tier: AccessTier;
  isBeta: boolean;
  can: (feature: Feature) => boolean;
  canCommunity: (slug?: string | null) => boolean;
} {
  const profile = useProfileStore((s) => s.profile);
  const preview = useViewAsStore((s) => s.preview);
  const realKind = resolveAccountKind(profile);
  const isCore = realKind === 'core';
  const kind = isCore && preview ? preview : realKind;
  const isPreviewing = isCore && preview != null && preview !== 'core';
  const realTier = parseAccessTier(profile?.access_tier);

  const tier: AccessTier = (() => {
    if (kind === 'core' || kind === 'staff') return 'beta';
    if (isPreviewing) return accessTierForKind(kind);
    if (realTier === 'beta') return 'beta';
    return 'public';
  })();

  const can = (feature: Feature): boolean => {
    if (kind === 'core' || kind === 'staff') return true;
    if (kind === 'pending') return canUseFeatureForKind(feature, 'pending');
    if (!isPreviewing && realTier === 'beta') return true;
    return canUseFeatureForKind(feature, kind);
  };

  return {
    kind,
    realKind,
    isCore,
    isPreviewing,
    tier,
    isBeta: tier === 'beta',
    can,
    canCommunity: (slug) => {
      if (can('communities') && (kind === 'core' || kind === 'staff' || kind === 'communityOwner' || tier === 'beta')) {
        return true;
      }
      return canAccessCommunityForKind(slug, kind);
    },
  };
}
