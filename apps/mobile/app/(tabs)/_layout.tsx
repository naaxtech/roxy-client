import { Tabs } from 'expo-router';
import { COLORS } from '../../lib/constants';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: COLORS.background, borderTopColor: COLORS.surface },
        tabBarActiveTintColor: COLORS.roxy,
        tabBarInactiveTintColor: COLORS.textMuted,
      }}
    >
      <Tabs.Screen name="grow" options={{ title: 'Grow' }} />
      <Tabs.Screen name="discover" options={{ title: 'Discover' }} />
      <Tabs.Screen name="connect" options={{ title: 'Connect' }} />
      <Tabs.Screen name="build" options={{ title: 'Build' }} />
    </Tabs>
  );
}
