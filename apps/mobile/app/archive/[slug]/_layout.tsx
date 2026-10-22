import { TransitionStack } from '../../../components/motion/TransitionStack';

/**
 * One entry, plus the three things she can write about it.
 *
 * All three composers are modals over the entry. Each is a sentence she is
 * part-way through, and losing the entry behind it would cost her the thing she
 * is writing about.
 */
export default function ArchiveEntryLayout() {
  return (
    <TransitionStack screenOptions={{ headerShown: false }}>
      <TransitionStack.Screen name="index" />
      <TransitionStack.Screen name="review" options={{ presentation: 'modal' }} />
      <TransitionStack.Screen name="edit" options={{ presentation: 'modal' }} />
      <TransitionStack.Screen name="note" options={{ presentation: 'modal' }} />
    </TransitionStack>
  );
}
