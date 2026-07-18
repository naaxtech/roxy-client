import { Redirect } from 'expo-router';

// Communities is a Connect subtab now, not a detached screen. Old links and
// bookmarks land in the flow instead of a dead end.
export default function CommunitiesRedirect() {
  return <Redirect href={{ pathname: '/(tabs)/connect', params: { tab: 'communities' } } as any} />;
}
