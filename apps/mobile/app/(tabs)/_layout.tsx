import { useEffect, useState } from 'react';
import { View, AppState } from 'react-native';
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
import { ViewAsBanner } from '../../components/settings/ViewAsBanner';
import { PendingStatusHost } from '../../components/account/PendingStatusHost';
import { navSlotsFor } from '../../components/nav/navSlots3';
import { supabase } from '../../lib/supabase';
import { freshChannel } from '../../lib/realtimeChannel';
import { registerPushToken, pushResponsePath } from '../../lib/push';
import * as Notifications from 'expo-notifications';

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
  const loadMutedUsers = useSafetyStore((s) => s.loadMutedUsers);
  useEffect(() => {
    if (!user?.id) return;
    void loadBlockedUsers();
    void loadMutedUsers();
  }, [user?.id, loadBlockedUsers, loadMutedUsers]);

  // One device push token per signed-in user, so the server can reach her for
  // messages and friend requests with the app closed.
  useEffect(() => {
    if (!user?.id) return;
    void registerPushToken(user.id);
  }, [user?.id]);

  // A tapped push opens the screen it points at — including the cold start,
  // where the response is already waiting when this layout mounts. Routed
  // through expo-router (not Linking.openURL) so it lands inside the signed-in
  // stack instead of re-entering the app from the top.
  const lastPush = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const path = pushResponsePath(lastPush);
    if (path) router.push(path as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastPush]);

  // The Messages badge comes from the server (CHAT-13): unread chats, message
  // requests, friend requests and community-chat unread, all from
  // messages_badge(). Realtime events only NUDGE a refresh — nothing here
  // increments, so a message can never be counted twice.
  const badgeTotal = useConnectStore((s) => s.badgeTotal);
  const refreshInbox = useConnectStore((s) => s.refresh);

  useEffect(() => {
    if (!user?.id) return;
    void refreshInbox();

    // Debounced: a burst of inserts becomes one round trip.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const nudge = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void refreshInbox(); }, 400);
    };

    // RLS limits both feeds to rows she may read: messages in her threads and
    // her own membership rows (added to a group, request answered, muted).
    const channel = freshChannel(`inbox:${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, nudge)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversation_members', filter: `user_id=eq.${user.id}` },
        nudge,
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'community_channel_messages' }, nudge)
      .subscribe();

    // Coming back to the app: the socket may have slept through everything.
    const appSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refreshInbox();
    });

    return () => {
      if (timer) clearTimeout(timer);
      appSub.remove();
      void supabase.removeChannel(channel);
    };
  }, [user?.id, refreshInbox]);

  // The friend-request count lives in friendStore too; refresh the server
  // badge whenever it moves so the two never disagree on screen.
  useEffect(() => {
    if (user?.id) void refreshInbox();
  }, [pendingCount, user?.id, refreshInbox]);

  // Four bar slots plus the ＋ action, per `components/nav/navSlots3.ts`.
  //
  // `grow`, `connect` and `build` were declared here through the re-homing so
  // their routes kept resolving while their screens moved out. The directories
  // are gone now, and a `Tabs.Screen` naming a route that does not exist is not
  // inert — Expo Router logs `No route named "grow" exists in nested children`
  // on every render of the navigator. The declarations went with the folders.
  return (
    <View style={{ flex: 1 }}>
      <ViewAsBanner />
      <PendingStatusHost />
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
            // Unread chats + message requests + friend requests + community
            // unread — one server number (messages_badge, migration 132).
            tabBarBadge: badgeTotal > 0 ? (badgeTotal > 99 ? '99+' : badgeTotal) : undefined,
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
