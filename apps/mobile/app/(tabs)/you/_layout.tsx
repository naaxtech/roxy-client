import { Stack } from 'expo-router';
import { TabFade } from '../../../components/motion/TabFade';
import { useThemeColors } from '../../../hooks/useThemeColors';

/** The You tab: theme ground in frame 1, content fades in (TabFade, F4). */
export default function ProfileLayout() {
  const colors = useThemeColors();
  return (
    <TabFade ground={colors.ground}>
      <Stack screenOptions={{ headerShown: false }} />
    </TabFade>
  );
}
