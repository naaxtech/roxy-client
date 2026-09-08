import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { usePathname } from 'expo-router';
import { useAccess } from '../../hooks/useAccess';
import {
  launchGateFeature,
  type Feature,
} from '../../lib/features';
import { ComingSoon } from './ComingSoon';

type GateProps = {
  feature: Feature;
  children: ReactNode;
};

/** Swap a screen for Coming soon when the signed-in member is not beta. */
export function FeatureGate({ feature, children }: GateProps) {
  const { can } = useAccess();
  if (can(feature)) return <>{children}</>;
  return <ComingSoon feature={feature} />;
}

type CommunityProps = {
  slug?: string | null;
  children: ReactNode;
};

/**
 * Official chat is the one community public members may open. Any other
 * slug — or a public member before the slug has arrived — is Coming soon.
 */
export function CommunityGate({ slug, children }: CommunityProps) {
  const { canCommunity, isBeta } = useAccess();
  if (isBeta || canCommunity(slug)) return <>{children}</>;
  return <ComingSoon feature="communities" />;
}

/** Root-layout gate for stack routes a public member can deep-link into. */
export function LaunchGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { can } = useAccess();
  const feature = launchGateFeature(pathname);
  if (!feature || can(feature)) return <>{children}</>;
  // Keep the navigator mounted so Back to Archive can actually route.
  return (
    <View style={styles.fill}>
      {children}
      <View style={StyleSheet.absoluteFill} pointerEvents="auto">
        <ComingSoon feature={feature} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
