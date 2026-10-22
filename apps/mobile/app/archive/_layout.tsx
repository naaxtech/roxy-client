import { TransitionStack } from '../../components/motion/TransitionStack';

/**
 * The Archive stack.
 *
 * `new` is presented as a modal because it is a composer, not a destination:
 * she is mid-thought on a browse screen when she notices something is missing,
 * and a push would make her navigate back to where she already was.
 */
export default function ArchiveLayout() {
  return (
    <TransitionStack screenOptions={{ headerShown: false }}>
      <TransitionStack.Screen name="index" />
      <TransitionStack.Screen name="new" options={{ presentation: 'modal' }} />
      <TransitionStack.Screen name="[slug]" />
    </TransitionStack>
  );
}
