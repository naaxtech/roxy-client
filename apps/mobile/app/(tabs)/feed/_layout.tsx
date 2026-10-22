import { Stack } from 'expo-router';
import { TabFade } from '../../../components/motion/TabFade';
import { STAGE_BG } from '../../../components/feed/stageColors';

/**
 * The Feed tab. Its ground is the dark stage in both themes, so a switch to
 * the Feed is dark in frame 1 and only the post fades in (TabFade, F4).
 */
export default function FeedLayout() {
  return (
    <TabFade ground={STAGE_BG}>
      <Stack screenOptions={{ headerShown: false }} />
    </TabFade>
  );
}
