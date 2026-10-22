import { useCallback, useEffect } from 'react';
import { View, AppState, StyleSheet } from 'react-native';
import { Tabs, usePathname, useRouter } from 'expo-router';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { RoxyCompanionButton } from '../../components/ui/RoxyCompanionButton';
import { useRoxyFab, fabVisible, fabOnStage } from '../../lib/roxyFab';
import { FloatingTabBar, type TabBarRoute } from '../../components/nav/FloatingTabBar';
import { CreateSheet } from '../../components/nav/CreateSheet';
import { useCreateSheet } from '../../components/nav/createSheetStore';
import type { NavSlot } from '../../components/nav/navTokens';
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

/**
 * The navigator's options, created once. A new object per render made the
 * navigator treat every render of this layout as an options change (jank
 * audit #3).
 */
const TAB_SCREEN_OPTIONS = { headerShown: false } as const;

/**
 * The Roxy AI button, as its own leaf.
 *
 * It is the one piece of the shell that follows the route (where she is
 * suppressed, the stage colours on the Feed, untuck on a new screen), so it is
 * the only one that reads the pathname. In `TabLayout`, `usePathname()`
 * re-rendered the whole navigator on every route change (jank audit #3).
 */
function TabFab({ userId }: { userId: string | undefined }) {
  const pathname = usePathname();
  const { can } = useAccess();
  // Roxy AI on/off (Settings), kept per member on this phone.
  const roxyEnabled = useRoxyFab((s) => s.enabled);
  const roxyLoadedFor = useRoxyFab((s) => s.loadedFor);
  const showFab = fabVisible({
    pathname,
    allowed: can('roxyCompanion'),
    enabled: roxyEnabled,
    loadedFor: roxyLoadedFor,
    userId,
    suppressedOn: FAB_SUPPRESSED_ON,
  });

  useEffect(() => {
    if (userId) void useRoxyFab.getState().load(userId);
  }, [userId]);

  // A new screen starts with her out, not tucked from the last list.
  useEffect(() => {
    useRoxyFab.getState().untuck();
  }, [pathname]);

  return (
    <View style={layoutStyles.fabLayer} pointerEvents="box-none">
      <RoxyCompanionButton visible={showFab} onStage={fabOnStage(pathname)} />
    </View>
  );
}

/** The Create sheet, subscribed to its own open state (see `createSheetStore`). */
function CreateSheetHost({ userId }: { userId: string | undefined }) {
  const open = useCreateSheet((st) => st.open);
  const close = useCreateSheet((st) => st.close);
  // The open state outlives this layout now; a sign-out must not leave it open
  // for the next session.
  useEffect(() => () => useCreateSheet.getState().close(), []);
  return <CreateSheet visible={open} userId={userId ?? null} onClose={close} />;
}

/**
 * The bar as the navigator renders it. Reads the Create state itself, so the
 * key turns and the sheet opens without the navigator re-rendering.
 */
function TabBarHost({ slots, state, descriptors, navigation }: BottomTabBarProps & { slots: readonly NavSlot[] }) {
  const createOpen = useCreateSheet((st) => st.open);
  const toggleCreate = useCreateSheet((st) => st.toggle);
  const onTabPress = useCallback((route: TabBarRoute, isFocused: boolean) => {
    const event = navigation.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
    });
    if (!isFocused && !event.defaultPrevented) {
      navigation.navigate(route.name);
    }
  }, [navigation]);
  return (
    <FloatingTabBar
      slots={slots}
      state={state}
      descriptors={descriptors}
      onTabPress={onTabPress}
      onCreatePress={toggleCreate}
      createOpen={createOpen}
    />
  );
}

export default function TabLayout() {
  const { tier, loading: accessLoading } = useAccess();
  const slots = navSlotsFor(tier, { loading: accessLoading });
  // A selector, not the whole store: an auth tick (token refresh) must not
  // re-render the navigator.
  const userId = useAuthStore((st) => st.user?.id);
  const pendingCount = useFriendStore((st) => st.pendingCount);
  // Only whether onboarding is done matters here; null = no profile yet.
  const onboardingDone = useProfileStore((st) => (st.profile ? !!st.profile.onboarding_completed : null));
  const router = useRouter();

  // Secondary guard: if a user somehow reaches tabs without completing onboarding,
  // redirect them back. The root layout is the primary guard; this is the fallback.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (onboardingDone === false) {
      router.replace('/(auth)/onboarding/step1-identity');
    }
  }, [onboardingDone]);

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
    if (!userId) return;
    void loadBlockedUsers();
    void loadMutedUsers();
    void loadHiddenPosts();
    void initFeed(userId);
  }, [userId, loadBlockedUsers, loadMutedUsers, loadHiddenPosts, initFeed]);

  // One device push token per signed-in user, so the server can reach her for
  // messages and friend requests with the app closed.
  useEffect(() => {
    if (!userId) return;
    void registerPushToken(userId);
  }, [userId]);

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
    if (!userId) return;
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
    const channel = freshChannel(`inbox:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, nudge)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversation_members', filter: `user_id=eq.${userId}` },
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
  }, [userId, refreshInbox]);

  // The friend-request count lives in friendStore too; refresh the server
  // badge whenever it moves so the two never disagree on screen.
  useEffect(() => {
    if (userId) void refreshInbox();
  }, [pendingCount, userId, refreshInbox]);

  // Stable for the navigator: a new inline function per render rebuilt the bar
  // and every slot in it (jank audit #3). It changes only with the slot set.
  const renderTabBar = useCallback(
    (props: BottomTabBarProps) => <TabBarHost {...props} slots={slots} />,
    [slots],
  );

  // Four bar slots plus the ＋ action, per `components/nav/navSlots3.ts`.
  //
  // `grow`, `connect` and `build` were declared here through the re-homing so
  // their routes kept resolving while their screens moved out. The directories
  // are gone now, and a `Tabs.Screen` naming a route that does not exist is not
  // inert — Expo Router logs `No route named "grow" exists in nested children`
  // on every render of the navigator. The declarations went with the folders.
  return (
    <View style={layoutStyles.fill}>
      <ViewAsBanner />
      <PendingStatusHost />
      <Tabs screenOptions={TAB_SCREEN_OPTIONS} tabBar={renderTabBar}>
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

      <TabFab userId={userId} />

      <CreateSheetHost userId={userId} />
    </View>
  );
}

const layoutStyles = StyleSheet.create({
  fill: { flex: 1 },
  fabLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
});
