import { Redirect } from 'expo-router';

// Root index — immediately redirect to the default tab.
// The root _layout.tsx auth guard handles unauthenticated users
// and redirects them to /(auth)/welcome before this ever renders.
export default function Index() {
  return <Redirect href="/(tabs)/grow" />;
}
