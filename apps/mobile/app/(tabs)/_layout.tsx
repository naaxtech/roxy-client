import { useEffect, useState } from 'react';
import { View, AppState } from 'react-native';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { RoxyCompanionButton } from '../../components/ui/RoxyCompanionButton';
import { useRoxyFab, fabVisible, fabOnStage } from '../../lib/roxyFab';
import { FloatingTabBar } from '../../components/nav/FloatingTabBar';
import { CreateSheet } from '../../components/nav/CreateSheet';
import { useFriendStore } from '../../store/friendStore';
import { useConnectStore } from '../../store/connectStore';
import { useChatSettingsStore } from '../../store/chatSettingsStore';
import { useAuthStore } from '../../store/authStore';
import { useProfileStore } from '../../store/profileStore';
import { useSafetyStore } from '../../store/safetyStore';
import { useFeedStore } from '../../store/feedStore';
import { useAccess } from '../../hooks/useAccess';
import { ViewAsBanner } from '../../components/settings/ViewAsBanner';
import { PendingStatusHost } from '../../components/account/PendingStatusHost';
import { navSlotsFor } from '../../components/nav/navSlots3';
import { supabase } from '../../lib/supabase';
import { freshChannel } from '../../lib/realtimeChannel';
import { registerPushToken, pushResponsePath } from '../../lib/push';
import { useLastPushResponse } from '../../hooks/useLastPushResponse';
// `import * as Notifications from 'expo-notifications'` moved to
// hooks/useLastPushResponse.ts (its only use here was useLastNotificationResponse,
// which throws on web). Re-add it here only if this layout needs another
// expo-notifications API, and guard native-only calls with Platform.OS.

/*
 * RETIRED (v2, 2026-10-21): `FAB_LIFT = 8`. The FAB used to pin itself 90pt
 * above its parent and the parent was inset by this lift to clear the old
 * floating pill. Origin: the Roxy 3.0 shell (`git log -S FAB_LIFT`). The
 * Roxy AI button now measures its own lane from the docked bar
 * (`navTokens.FAB_LANE`, 16 dp above `NAV_HEIGHT` + inset), so its parent is
 * full-window. Reintroduce a lift only if the bar stops being docked.
 */

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
  const { user } = useAuthStore();
  // Roxy AI on/off (Settings), kept per member on this phone.
  const roxyEnabled = useRoxyFab((s) => s.enabled);
  const roxyLoadedFor = useRoxyFab((s) => s.loadedFor);
  const showFab = fabVisible({
    pathname,
    allowed: can('roxyCompanion'),
    enabled: roxyEnabled,
    loadedFor: roxyLoadedFor,
    userId: user?.id,
    suppressedOn: FAB_SUPPRESSED_ON,
  });
  const [createOpen, setCreateOpen] = useState(false);
  const pendingCount = useFriendStore((s) => s.pendingCount);
  const profile = useProfileStore((s) => s.profile);
  const router = useRouter();

  useEffect(() => {
    if (user?.id) void useRoxyFab.getState().load(user.id);
  }, [user?.id]);

  // A new screen starts with her out, not tucked from the last list.
  useEffect(() => {
    useRoxyFab.getState().untuck();
  }, [pathname]);

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
  // Hidden posts (`hidden_posts`, 133) load beside mutes for the same reason:
  // a hide that only lived in memory came back on the next launch (FEED-01).
  const loadHiddenPosts = useFeedStore((s) => s.loadHiddenPosts);
  // Her likes and saves, for the same reason: they were loaded only by the
  // community screen, so on a cold Feed open every post she had liked showed
  // an empty heart and a tap added a phantom +1 before the upsert no-oped.
  const initFeed = useFeedStore((s) => s.init);
  useEffect(() => {
    if (!user?.id) return;
    void loadBlockedUsers();
    void loadMutedUsers();
    void loadHiddenPosts();
    void initFeed(user.id);
  }, [user?.id, loadBlockedUsers, loadMutedUsers, loadHiddenPosts, initFeed]);

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
  const lastPush = useLastPushResponse();
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
    // Read receipts are reciprocal: every tick on screen draws by her setting,
    // so it is loaded with the inbox, not only when Settings opens.
    void useChatSettingsStore.getState().load();
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
            onCreatePress={() => setCreateOpen((open) => !open)}
            createOpen={createOpen}
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
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        pointerEvents="box-none"
      >
        <RoxyCompanionButton visible={showFab} onStage={fabOnStage(pathname)} />
      </View>

      <CreateSheet
        visible={createOpen}
        userId={user?.id ?? null}
        onClose={() => setCreateOpen(false)}
      />
    </View>
  );
}
