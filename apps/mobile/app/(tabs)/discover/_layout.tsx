import { Stack } from 'expo-router';
import { FeatureGate } from '../../../components/features/FeatureGate';
import { TabFade } from '../../../components/motion/TabFade';
import { useThemeColors } from '../../../hooks/useThemeColors';

/** The Discover tab: theme ground in frame 1, content fades in (TabFade, F4). */
export default function DiscoverLayout() {
  const colors = useThemeColors();
  return (
    <TabFade ground={colors.ground}>
      <FeatureGate feature="discover">
        <Stack screenOptions={{ headerShown: false }} />
      </FeatureGate>
    </TabFade>
  );
}
