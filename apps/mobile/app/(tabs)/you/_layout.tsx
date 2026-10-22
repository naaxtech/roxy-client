import { TransitionStack } from '../../../components/motion/TransitionStack';
import { TabFade } from '../../../components/motion/TabFade';
import { useThemeColors } from '../../../hooks/useThemeColors';

/** The You tab: theme ground in frame 1, content fades in (TabFade, F4). */
export default function ProfileLayout() {
  const colors = useThemeColors();
  return (
    <TabFade ground={colors.ground} testID="tab-fade-you">
      <TransitionStack screenOptions={{ headerShown: false }} />
    </TabFade>
  );
}
