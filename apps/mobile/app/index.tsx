import { Redirect } from 'expo-router';

// Root index — immediately redirect to the default tab.
// Signed-out visitors are sent to the code gate by the root layout's redirect
// (hooks/useRootRedirect.ts, decideRootRoute), once the navigator is mounted.
//
// This must agree with MEMBER_HOME_HREF in `lib/authRouting.ts`, where the
// root layout's redirect (hooks/useRootRedirect.ts) now gets it. It did not:
// the layout sent a signed-in woman to the feed while a cold start sent her
// here, to a tab the redesign dissolved — so where she landed depended on
// whether the app was already running.
export default function Index() {
  return <Redirect href="/(tabs)/feed" />;
}
