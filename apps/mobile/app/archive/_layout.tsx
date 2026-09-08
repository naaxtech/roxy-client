import { Stack } from 'expo-router';

/**
 * The Archive stack.
 *
 * `new` is presented as a modal because it is a composer, not a destination:
 * she is mid-thought on a browse screen when she notices something is missing,
 * and a push would make her navigate back to where she already was.
 */
export default function ArchiveLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="[slug]" />
    </Stack>
  );
}
