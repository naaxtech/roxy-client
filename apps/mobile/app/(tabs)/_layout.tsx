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
import { useAccess } from '../../hooks/useAccess';
import { navSlotsFor } from '../../components/nav/navSlots3';
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

/**
 * Where the Roxy companion is suppressed.
 *
 * She is a companion, not a chaperone: in a conversation she would sit on top of
 * the composer, and in a live room she would sit on top of the consent controls,
 * which are the one thing that must never be covered. `roxy-chat` is on the list
 * because a button that opens the screen you are already on is noise.
 */
const FAB_SUPPRESSED_ON = ['roxy-chat', '/messages', '/chat/', 'sister-button', 'room-session', 'speed-dating'];

export default function TabLayout() {
  const pathname = usePathname();
  const { can, tier } = useAccess();
  const slots = navSlotsFor(tier);
  const showFab =
    can('roxyCompanion') &&
    !FAB_SUPPRESSED_ON.some((fragment) => pathname.includes(fragment));
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

  // Four bar slots plus the ＋ action, per `components/nav/navSlots3.ts`.
  //
  // `grow`, `connect` and `build` were declared here through the re-homing so
  // their routes kept resolving while their screens moved out. The directories
  // are gone now, and a `Tabs.Screen` naming a route that does not exist is not
  // inert — Expo Router logs `No route named "grow" exists in nested children`
  // on every render of the navigator. The declarations went with the folders.
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={(props) => (
          <FloatingTabBar
            slots={slots}
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
        <Tabs.Screen name="feed" options={{ title: 'Feed' }} />
        <Tabs.Screen name="discover" options={{ title: 'Discover' }} />
        <Tabs.Screen
          name="messages"
          options={{
            title: 'Messages',
            // Friend requests are messages now: the request-first inbox is where
            // they land, so the count that used to badge Home badges Messages.
            tabBarBadge: totalUnread + pendingCount > 0 ? totalUnread + pendingCount : undefined,
          }}
        />
        <Tabs.Screen name="you" options={{ title: 'You' }} />
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
