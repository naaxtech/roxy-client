import { Stack } from 'expo-router';

/**
 * One entry, plus the three things she can write about it.
 *
 * All three composers are modals over the entry. Each is a sentence she is
 * part-way through, and losing the entry behind it would cost her the thing she
 * is writing about.
 */
export default function ArchiveEntryLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="review" options={{ presentation: 'modal' }} />
      <Stack.Screen name="edit" options={{ presentation: 'modal' }} />
      <Stack.Screen name="note" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
