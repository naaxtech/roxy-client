import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { RoxyCompanionButton } from '../../components/ui/RoxyCompanionButton';
import { FloatingTabBar } from '../../components/nav/FloatingTabBar';
import { CreateSheet } from '../../components/nav/CreateSheet';
import { useFriendStore } from '../../store/friendStore';
import { useConnectStore } from '../../store/connectStore';
import { useAuthStore } from '../../store/authStore';
import { useProfileStore } from '../../store/profileStore';
import { useSafetyStore } from '../../store/safetyStore';
import { supabase } from '../../lib/supabase';
import { freshChannel } from '../../lib/realtimeChannel';

/**
 * The companion FAB pins itself 90pt above its parent's bottom edge, a number
 * tuned to the old 68pt full-width bar. The floating pill is taller than that
 * once a home indicator is in play, so the FAB's parent is inset by this much
 * instead — lifting the button without editing it. The ceiling is 12: the FAB's
 * own pop-out sheet anchors at 158pt from the screen bottom, and the button's
 * top edge reaches 146 + lift. Roxy moving into Inbox (plan §1) retires this.
 */
const FAB_LIFT = 8;

export default function TabLayout() {
  const pathname = usePathname();
  const showFab = !pathname.includes('roxy-chat');
  const [createOpen, setCreateOpen] = useState(false);
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

  // Who she has blocked is session-independent state, so it is loaded once
  // here rather than by whichever screen happens to need it. safetyStore
  // checks this list before issuing a block, and it used to start empty on
  // every launch with nothing ever refilling it.
  const loadBlockedUsers = useSafetyStore((s) => s.loadBlockedUsers);
  useEffect(() => {
    if (!user?.id) return;
    void loadBlockedUsers();
  }, [user?.id, loadBlockedUsers]);

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

  // Route folders are deliberately untouched. `Rooms` is the `connect` folder,
  // `You` is `profile`, and `discover`/`build` keep their routes and reach Home
  // through the category pills instead of a bar slot. Renaming Expo Router
  // directories is a separate, breakage-prone change.
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={(props) => (
          <FloatingTabBar
            state={props.state}
            descriptors={props.descriptors}
            onTabPress={(route, isFocused) => {
              const event = props.navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!isFocused && !event.defaultPrevented) {
                props.navigation.navigate(route.name);
              }
            }}
            onCreatePress={() => setCreateOpen(true)}
          />
        )}
      >
        <Tabs.Screen
          name="grow"
          options={{
            title: 'Home',
            tabBarBadge: pendingCount > 0 ? pendingCount : undefined,
          }}
        />
        <Tabs.Screen name="connect" options={{ title: 'Rooms' }} />
        <Tabs.Screen name="discover" options={{ title: 'Games' }} />
        <Tabs.Screen
          name="messages"
          options={{
            title: 'Inbox',
            tabBarBadge: totalUnread > 0 ? totalUnread : undefined,
          }}
        />
        <Tabs.Screen name="build" options={{ title: 'Build' }} />
        <Tabs.Screen name="profile" options={{ title: 'You' }} />
      </Tabs>

      <View
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: FAB_LIFT }}
        pointerEvents="box-none"
      >
        <RoxyCompanionButton visible={showFab} />
      </View>

      <CreateSheet
        visible={createOpen}
        userId={user?.id ?? null}
        onClose={() => setCreateOpen(false)}
      />
    </View>
  );
}
