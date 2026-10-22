import { TransitionStack } from '../../../components/motion/TransitionStack';
import { TabFade } from '../../../components/motion/TabFade';
import { useThemeColors } from '../../../hooks/useThemeColors';

/** The Messages tab: theme ground in frame 1, content fades in (TabFade, F4). */
export default function MessagesLayout() {
  const colors = useThemeColors();
  return (
    <TabFade ground={colors.ground} testID="tab-fade-messages">
      <TransitionStack screenOptions={{ headerShown: false }} />
    </TabFade>
  );
}
