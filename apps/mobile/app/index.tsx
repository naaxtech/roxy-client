import { Redirect } from 'expo-router';

// Root index — immediately redirect to the default tab.
// The root _layout.tsx auth guard handles unauthenticated users
// and redirects them to /(auth)/welcome before this ever renders.
//
// This must agree with the `router.replace` in `app/_layout.tsx`. It did not:
// the layout sent a signed-in woman to the feed while a cold start sent her
// here, to a tab the redesign dissolved — so where she landed depended on
// whether the app was already running.
export default function Index() {
  return <Redirect href="/(tabs)/feed" />;
}
