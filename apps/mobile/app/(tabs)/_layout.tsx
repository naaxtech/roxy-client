import { View } from 'react-native';
import { Tabs, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../lib/constants';
import { RoxyCompanionButton } from '../../components/ui/RoxyCompanionButton';

export default function TabLayout() {
  const pathname = usePathname();
  const showFab = !pathname.includes('roxy-chat');

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { backgroundColor: COLORS.background, borderTopColor: COLORS.surface },
          tabBarActiveTintColor: COLORS.roxy,
          tabBarInactiveTintColor: COLORS.textMuted,
        }}
      >
        <Tabs.Screen
          name="grow"
          options={{
            title: 'Grow',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="home-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="connect"
          options={{
            title: 'Connect',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="heart-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="discover"
          options={{
            title: 'Discover',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="compass-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="build"
          options={{
            title: 'Build',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="hammer-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            href: null,
          }}
        />
      </Tabs>
      <RoxyCompanionButton visible={showFab} />
    </View>
  );
}
