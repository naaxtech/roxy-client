import { useEffect } from 'react';
import { View } from 'react-native';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { RoxyCompanionButton } from '../../components/ui/RoxyCompanionButton';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useFriendStore } from '../../store/friendStore';
import { useConnectStore } from '../../store/connectStore';
import { useAuthStore } from '../../store/authStore';
import { useProfileStore } from '../../store/profileStore';
import { supabase } from '../../lib/supabase';
import { freshChannel } from '../../lib/realtimeChannel';

export default function TabLayout() {
  const colors = useThemeColors();
  const pathname = usePathname();
  const showFab = !pathname.includes('roxy-chat');
  const pendingCount = useFriendStore((s) => s.pendingCount);
  const { user } = useAuthStore();
  const profile = useProfileStore((s) => s.profile);
  const router = useRouter();

  // Secondary guard: if a user somehow reaches tabs without completing onboarding,
  // redirect them back. The root layout is the primary guard; this is the fallback.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (profile !== null && !profile.onboarding_completed) {
      router.replace('/(auth)/onboarding/step1-identity');
    }
  }, [profile?.onboarding_completed]);

  const unreadCounts = useConnectStore((s) => s.unreadCounts);
  const totalUnread = Object.values(unreadCounts).reduce((sum, n) => sum + n, 0);

  // Global message listener — fires for every INSERT on messages that RLS
  // allows this user to see (i.e. only messages in their own conversations).
  // When a message arrives for a conversation that isn't currently open,
  // increment its unread count to drive the Connect tab badge.
  // We call getState() inside the callback so we always read the live value
  // of activeConversationId with no stale-closure risk.
  useEffect(() => {
    if (!user?.id) return;

    const channel = freshChannel(`global-messages:${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const msg = payload.new as { conversation_id: string; sender_id: string | null };
          // Own messages are already shown via optimistic update — skip.
          if (msg.sender_id === user.id) return;
          const { activeConversationId, incrementUnread } = useConnectStore.getState();
          // If the user is currently inside this conversation, skip —
          // the per-conversation subscription handles display and the screen
          // calls clearUnread on mount.
          if (msg.conversation_id === activeConversationId) return;
          incrementUnread(msg.conversation_id);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: colors.background,
            borderTopWidth: 0,
            height: 68,
            paddingTop: 8,
            paddingBottom: 10,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -2 },
            shadowOpacity: 0.06,
            shadowRadius: 10,
            elevation: 12,
          },
          tabBarActiveTintColor: colors.roxy,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarActiveBackgroundColor: colors.roxy + '16',
          tabBarItemStyle: { borderRadius: 16, marginHorizontal: 6, marginVertical: 2 },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '700', marginTop: 0 },
        }}
      >
        <Tabs.Screen
          name="grow"
          options={{
            title: 'Grow',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? 'home' : 'home-outline'} size={size} color={color} />
            ),
            tabBarBadge: pendingCount > 0 ? pendingCount : undefined,
          }}
        />
        <Tabs.Screen
          name="connect"
          options={{
            title: 'Connect',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? 'heart' : 'heart-outline'} size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="discover"
          options={{
            title: 'Play',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? 'game-controller' : 'game-controller-outline'} size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="messages"
          options={{
            title: 'Messages',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? 'chatbubbles' : 'chatbubbles-outline'} size={size} color={color} />
            ),
            tabBarBadge: totalUnread > 0 ? totalUnread : undefined,
          }}
        />
        <Tabs.Screen
          name="build"
          options={{
            title: 'Build',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? 'hammer' : 'hammer-outline'} size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{ href: null }}
        />
      </Tabs>
      <RoxyCompanionButton visible={showFab} />
    </View>
  );
}
