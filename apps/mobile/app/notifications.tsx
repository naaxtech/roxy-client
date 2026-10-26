import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator,
} from 'react-native';
import { TouchableOpacity } from '../components/ui/PressableScale';
import { PrimaryButton } from '../components/ui/PrimaryButton';
import { snackbar } from '../components/feedback/SnackbarHost';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { formatDistanceToNowStrict } from 'date-fns';
import { useAuthStore } from '../store/authStore';
import {
  fetchNotificationsResult, fetchArchivedNotifications,
  markNotificationRead, markAllNotificationsRead, countUnread,
  clearNotifications, clearNotificationsUpTo, restoreNotifications,
  type ClearedNotification, type RoxyNotification,
} from '../lib/notifications';
import { useThemeColors } from '../hooks/useThemeColors';
import { useAccess } from '../hooks/useAccess';
import { featureForPath } from '../lib/features';
import { routeParam } from '../lib/routeParams';
import { MIN_TOUCH_TARGET } from '../lib/touchTargets';

const TYPE_EMOJI: Record<RoxyNotification['type'], string> = {
  friend_request: '🌸',
  friend_accept: '💜',
  community_event: '🗓️',
  message: '💬',
  channel_message: '#️⃣',
  application_decided: '💌',
  // Migration 135: an invite to a private community, a request to join one.
  community_invite: '🔐',
  community_join_request: '🚪',
  post_reaction: '✿',
  comment: '💭',
  follow: '🌷',
  archive_revision: '📚',
};

const ARCHIVED_PATH = '/notifications?view=archived';
// An Undo or Restore whose row was deleted while it sat in the archive.
const GONE_ONE = 'That notification is no longer available';
const GONE_SOME = 'Some notifications are no longer available';

type Status = 'loading' | 'ready' | 'error';
type LoadMode = 'initial' | 'silent' | 'pull';
type SortKey = 'created_at' | 'archived_at';

const at = (iso: string | null): number => (iso ? Date.parse(iso) || 0 : 0);

/** "20,000": a count in a snackbar. */
const formatCount = (n: number): string => n.toLocaleString('en-US');

/**
 * Put rows back where they belong — newest first by `key`, the order each
 * view is read in — without duplicating one that is already there.
 */
function mergeRows(list: RoxyNotification[], back: RoxyNotification[], key: SortKey): RoxyNotification[] {
  const present = new Set(list.map((r) => r.id));
  return [...list, ...back.filter((r) => !present.has(r.id))]
    .sort((a, b) => at(b[key]) - at(a[key]));
}

/**
 * A cleared row back in the inbox the way it was: unread if it was unread when
 * cleared (Undo sends it as `p_mark_unread`), otherwise read.
 */
const backInInbox = (n: RoxyNotification, unread: boolean, now: string): RoxyNotification =>
  ({ ...n, read_at: unread ? null : (n.read_at ?? now), archived_at: null });

/**
 * The newest `created_at` among `rows`, as the server wrote it. Date.parse
 * keeps milliseconds and Postgres keeps microseconds, so two rows in the same
 * millisecond are told apart by the string itself (same-offset ISO strings
 * sort in time order). `rows` is never empty here.
 */
function newestCreatedAt(rows: RoxyNotification[]): string {
  return rows.reduce((best, n) => {
    const d = at(n.created_at) - at(best);
    return d > 0 || (d === 0 && n.created_at > best) ? n.created_at : best;
  }, rows[0].created_at);
}

/** Count a write in flight on each id; two can overlap on one row (a clear inside a Clear all). */
function hold(held: Map<string, number>, ids: string[]): void {
  ids.forEach((id) => held.set(id, (held.get(id) ?? 0) + 1));
}

function release(held: Map<string, number>, ids: string[]): void {
  ids.forEach((id) => {
    const left = (held.get(id) ?? 0) - 1;
    if (left > 0) held.set(id, left);
    else held.delete(id);
  });
}

/**
 * Her notifications. `?view=archived` is the same screen over what she
 * cleared: rows still open, Restore puts one back, nothing is counted.
 *
 * Clearing archives, never deletes (plan 2026-10-26-notifications-clear-archive).
 * Every clear is optimistic: the row leaves at once, the snackbar says
 * "Cleared" with Undo only after the write came back, and a failed write puts
 * the row back and offers Retry. Zero rows is not a failure: the row was
 * already gone server-side (a cancelled request, an un-react), so it stays
 * off the screen and nothing is offered that could only fail again.
 */
export default function NotificationsScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { view } = useLocalSearchParams<{ view?: string | string[] }>();
  const archived = routeParam(view) === 'archived';
  const { user } = useAuthStore();
  const { can } = useAccess();
  const pathOpen = (path: string) => {
    const feature = featureForPath(path);
    return feature == null || can(feature);
  };
  const [items, setItems] = useState<RoxyNotification[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [refreshing, setRefreshing] = useState(false);
  // She cleared something on this visit: the empty inbox says "All clear".
  const [clearedHere, setClearedHere] = useState(false);
  // A Clear all is in flight (it can take several calls): the button is
  // disabled. The ref answers a second tap in the same frame, before the
  // re-render that disables the button lands.
  const [clearingAll, setClearingAll] = useState(false);
  const clearingAllRef = useRef(false);

  // Rows with a write in flight — a clear, Clear all, Undo or Restore. A
  // re-read that lands first keeps what the screen shows for them (gone, or put
  // back) instead of the server's not-yet-written state.
  const pending = useRef(new Map<string, number>());
  const loaded = useRef(false);
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const load = useCallback(async (mode: LoadMode) => {
    if (!user) return;
    if (mode === 'initial') setStatus('loading');
    if (mode === 'pull') setRefreshing(true);
    const result = archived
      ? await fetchArchivedNotifications(user.id)
      : await fetchNotificationsResult(user.id);
    if (mode === 'pull') setRefreshing(false);
    if (result.ok) {
      loaded.current = true;
      const held = pending.current;
      setItems((prev) => mergeRows(
        result.items.filter((n) => !held.has(n.id)),
        prev.filter((n) => held.has(n.id)),
        archived ? 'archived_at' : 'created_at',
      ));
      setStatus('ready');
      return;
    }
    // A first load (or Retry) that fails is the error state. A re-read that
    // fails keeps the list she is looking at; a pull she asked for says so.
    if (mode === 'initial') setStatus('error');
    else if (mode === 'pull') snackbar.show({ message: "Couldn't refresh. Check your connection." });
  }, [user, archived]);

  // On every focus, not just mount: coming back from the archive (or from a
  // row she opened) shows what is true now.
  useFocusEffect(useCallback(() => {
    void load(loaded.current ? 'silent' : 'initial');
  }, [load]));

  const unread = archived ? 0 : countUnread(items);

  const handleOpen = (n: RoxyNotification) => {
    if (n.read_at === null) {
      void markNotificationRead(n.id);
      setItems((prev) => prev.map((x) =>
        x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x
      ));
    }
    if (n.link_path && pathOpen(n.link_path)) {
      router.push(n.link_path as never);
    }
  };

  const handleMarkAll = () => {
    if (!user) return;
    void markAllNotificationsRead(user.id);
    const now = new Date().toISOString();
    setItems((prev) => prev.map((x) => (x.read_at === null ? { ...x, read_at: now } : x)));
  };

  // Accepted: a clear marks the row read and a retraction (un-react, unfollow)
  // deletes only unread rows (133, 136), so Undo can bring back a notification
  // whose reaction or follow was withdrawn between the clear and the Undo.
  const undoClear = async (n: RoxyNotification, wasUnread: boolean) => {
    hold(pending.current, [n.id]);
    setItems((prev) => mergeRows(prev, [backInInbox(n, wasUnread, new Date().toISOString())], 'created_at'));
    const result = await restoreNotifications([n.id], wasUnread ? [n.id] : []);
    release(pending.current, [n.id]);
    if (!result.ok) {
      setItems((prev) => prev.filter((x) => x.id !== n.id));
      snackbar.show({
        message: "Couldn't undo. It's still in Archived.",
        actionLabel: 'Retry',
        onAction: () => { void undoClear(n, wasUnread); },
      });
      return;
    }
    if (result.restored === 0) {
      // Deleted while it sat in the archive: nothing to bring back.
      setItems((prev) => prev.filter((x) => x.id !== n.id));
      snackbar.show({ message: GONE_ONE });
    }
  };

  const clearOne = async (n: RoxyNotification) => {
    hold(pending.current, [n.id]);
    setClearedHere(true);
    setItems((prev) => prev.filter((x) => x.id !== n.id));
    const result = await clearNotifications([n.id]);
    release(pending.current, [n.id]);
    if (!result.ok) {
      setItems((prev) => mergeRows(prev, [n], 'created_at'));
      snackbar.show({
        message: "Couldn't clear that notification.",
        actionLabel: 'Retry',
        onAction: () => { void clearOne(n); },
      });
      return;
    }
    const cleared = result.cleared.find((c) => c.id === n.id);
    // Zero rows: already gone (retracted, or reached first by a Clear all).
    // It stays off the screen, and there is nothing to undo.
    if (!cleared) return;
    snackbar.show({
      message: 'Cleared',
      actionLabel: 'Undo',
      onAction: () => { void undoClear(n, cleared.wasUnread); },
    });
  };

  const undoClearAll = async (snapshot: RoxyNotification[], cleared: ClearedNotification[]) => {
    const ids = cleared.map((c) => c.id);
    const unreadIds = cleared.filter((c) => c.wasUnread).map((c) => c.id);
    const wanted = new Set(ids);
    const unread = new Set(unreadIds);
    const now = new Date().toISOString();
    const back = snapshot
      .filter((n) => wanted.has(n.id))
      .map((n) => backInInbox(n, unread.has(n.id), now));
    hold(pending.current, ids);
    setItems((prev) => mergeRows(prev, back, 'created_at'));
    // Restored 500 a call: a failure part-way leaves the calls before it
    // standing, and Retry sends only the ids still archived.
    const result = await restoreNotifications(ids, unreadIds);
    release(pending.current, ids);
    if (!result.ok) {
      const left = new Set(result.unrestored);
      const rest = cleared.filter((c) => left.has(c.id));
      setItems((prev) => prev.filter((x) => !left.has(x.id)));
      snackbar.show({
        message: result.restored > 0
          ? "Couldn't undo all of them. The rest are still in Archived."
          : "Couldn't undo. They're still in Archived.",
        actionLabel: 'Retry',
        onAction: () => { void undoClearAll(snapshot, rest); },
      });
      // Some came back, rows past the 50 on screen among them: re-read.
      if (result.restored > 0) void load('silent');
      return;
    }
    if (result.restored < ids.length) {
      // Some were deleted while archived, and a count can't say which: re-read
      // so the ones that are gone leave the list.
      snackbar.show({ message: ids.length === 1 ? GONE_ONE : GONE_SOME });
      void load('silent');
      return;
    }
    // Rows past the 50 on screen came back too: re-read so the list is the server's.
    if (ids.length > back.length) void load('silent');
  };

  const clearAll = async () => {
    if (!user || clearingAllRef.current) return;
    const snapshot = itemsRef.current;
    if (snapshot.length === 0) return;
    clearingAllRef.current = true;
    setClearingAll(true);
    // Only what she has seen: a notification newer than her newest row stays.
    const upTo = newestCreatedAt(snapshot);
    // Rows with a clear, Undo or Restore of their own in flight. The server's
    // Clear all may reach one first and report it, but undoing it is not Clear
    // all's to do: her single clear stands.
    const ownWrite = new Set(pending.current.keys());
    const ids = snapshot.map((n) => n.id);
    hold(pending.current, ids);
    setClearedHere(true);
    setItems([]);
    // 500 a call until a call comes back short (lib/notifications).
    const result = await clearNotificationsUpTo(upTo);
    release(pending.current, ids);
    clearingAllRef.current = false;
    setClearingAll(false);
    const undoable = result.cleared.filter((c) => !ownWrite.has(c.id));
    const undo = undoable.length > 0
      ? { actionLabel: 'Undo', onAction: () => { void undoClearAll(snapshot, undoable); } }
      : {};
    if (!result.ok && result.cleared.length === 0) {
      setItems((prev) => mergeRows(prev, snapshot, 'created_at'));
      snackbar.show({
        message: "Couldn't clear your notifications.",
        actionLabel: 'Retry',
        onAction: () => { void clearAll(); },
      });
      return;
    }
    if (!result.ok) {
      // Failed part-way. Each call commits on its own, so what landed stays
      // cleared and Undo restores exactly that; the rest are still hers.
      const gone = new Set(result.cleared.map((c) => c.id));
      setItems((prev) => mergeRows(prev, snapshot.filter((n) => !gone.has(n.id)), 'created_at'));
      snackbar.show({ message: `Cleared ${formatCount(result.cleared.length)}, but couldn't clear the rest.`, ...undo });
      void load('silent');
      return;
    }
    if (result.cleared.length === 0) {
      snackbar.show({ message: 'Nothing left to clear' });
      return;
    }
    if (result.more) {
      // Stopped at its cap (CLEAR_ALL_MAX_CALLS): older ones may remain. Re-read
      // so they show, Clear all with them.
      snackbar.show({ message: `Cleared ${formatCount(result.cleared.length)}. Tap Clear all again for the rest.`, ...undo });
      void load('silent');
      return;
    }
    snackbar.show({ message: 'Cleared all', ...undo });
  };

  const restore = async (n: RoxyNotification) => {
    hold(pending.current, [n.id]);
    setItems((prev) => prev.filter((x) => x.id !== n.id));
    // From the archive it comes back read: she has already seen it here.
    const result = await restoreNotifications([n.id], []);
    release(pending.current, [n.id]);
    if (!result.ok) {
      setItems((prev) => mergeRows(prev, [n], 'archived_at'));
      snackbar.show({
        message: "Couldn't restore that notification.",
        actionLabel: 'Retry',
        onAction: () => { void restore(n); },
      });
      return;
    }
    // Zero restored: deleted while archived. It stays off the list either way.
    snackbar.show({ message: result.restored > 0 ? 'Restored' : GONE_ONE });
  };

  const openArchive = () => router.push(ARCHIVED_PATH as never);

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 8, paddingVertical: 4, minHeight: 56,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    headerBtn: {
      minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET,
      alignItems: 'center', justifyContent: 'center',
    },
    headerTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700', flex: 1 },
    headerAction: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: 8 },
    headerActionBusy: { opacity: 0.5 },
    markAll: { color: colors.roxy, fontSize: 13, fontWeight: '700' },
    row: {
      flexDirection: 'row', alignItems: 'center',
      paddingLeft: 16, paddingRight: 4,
      borderBottomWidth: 1, borderBottomColor: colors.surfaceLight,
    },
    rowUnread: { backgroundColor: colors.roxy + '0D' },
    rowMain: {
      flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingVertical: 13,
    },
    emoji: {
      width: 40, height: 40, borderRadius: 20, fontSize: 18,
      backgroundColor: colors.surface,
      textAlign: 'center', lineHeight: 38, overflow: 'hidden',
    },
    body: { flex: 1, gap: 2 },
    title: { color: colors.textSecondary, fontSize: 14, fontWeight: '500' },
    titleUnread: { color: colors.textPrimary, fontWeight: '700' },
    sub: { color: colors.textMuted, fontSize: 12 },
    time: { color: colors.textMuted, fontSize: 11, flexShrink: 0 },
    gated: { color: colors.primary, fontSize: 11, fontWeight: '700' },
    dot: {
      width: 8, height: 8, borderRadius: 4,
      backgroundColor: colors.roxy, marginLeft: 4,
    },
    clearBtn: {
      width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET,
      alignItems: 'center', justifyContent: 'center',
    },
    restoreBtn: {
      minHeight: MIN_TOUCH_TARGET, justifyContent: 'center',
      paddingHorizontal: 12,
    },
    restore: { color: colors.pinkInk, fontSize: 13, fontWeight: '700' },
    viewArchived: {
      minHeight: MIN_TOUCH_TARGET, alignSelf: 'center', justifyContent: 'center',
      paddingHorizontal: 16, marginVertical: 8,
    },
    viewArchivedText: { color: colors.pinkInk, fontSize: 13, fontWeight: '700' },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 10 },
    emptyIcon: { fontSize: 44 },
    emptyTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700', textAlign: 'center' },
    emptyText: { color: colors.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 19 },
    retry: { marginTop: 6 },
  });

  const viewArchivedLink = (
    <TouchableOpacity
      onPress={openArchive}
      style={styles.viewArchived}
      testID="notifications-view-archived"
      accessibilityRole="button"
      accessibilityLabel="View archived"
    >
      <Text style={styles.viewArchivedText}>View archived</Text>
    </TouchableOpacity>
  );

  const emptyState = archived ? (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>🗂️</Text>
      <Text style={styles.emptyTitle}>Nothing archived</Text>
      <Text style={styles.emptyText}>Notifications you clear are kept here.</Text>
    </View>
  ) : (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>🔔</Text>
      <Text style={styles.emptyTitle}>{clearedHere ? 'All clear' : 'Nothing yet'}</Text>
      <Text style={styles.emptyText}>
        {clearedHere
          ? 'Cleared notifications are kept in Archived.'
          : 'Messages, friend requests and community events will land here 💜'}
      </Text>
      {viewArchivedLink}
    </View>
  );

  const renderRow = ({ item }: { item: RoxyNotification }) => {
    const isUnread = !archived && item.read_at === null;
    const gated = !!(item.link_path && !pathOpen(item.link_path));
    return (
      <View style={[styles.row, isUnread && styles.rowUnread]}>
        <TouchableOpacity
          style={styles.rowMain}
          onPress={() => handleOpen(item)}
          activeOpacity={0.7}
          testID={`notification-row-${item.id}`}
          accessibilityRole="button"
          accessibilityLabel={gated ? `${item.title}. Coming soon` : item.title}
        >
          <Text style={styles.emoji}>{TYPE_EMOJI[item.type] ?? '🔔'}</Text>
          <View style={styles.body}>
            <Text style={[styles.title, isUnread && styles.titleUnread]} numberOfLines={2}>
              {item.title}
            </Text>
            {item.body ? <Text style={styles.sub} numberOfLines={1}>{item.body}</Text> : null}
          </View>
          {gated ? (
            <Text style={styles.gated}>Coming soon</Text>
          ) : (
            <Text style={styles.time}>
              {formatDistanceToNowStrict(new Date(item.created_at), { addSuffix: false })}
            </Text>
          )}
          {isUnread && <View style={styles.dot} />}
        </TouchableOpacity>
        {archived ? (
          <TouchableOpacity
            onPress={() => { void restore(item); }}
            style={styles.restoreBtn}
            testID={`notification-restore-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel="Restore"
            aria-label="Restore"
          >
            <Text style={styles.restore}>Restore</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={() => { void clearOne(item); }}
            style={styles.clearBtn}
            testID={`notification-clear-${item.id}`}
            accessibilityRole="button"
            accessibilityLabel="Clear notification"
            aria-label="Clear notification"
          >
            <Ionicons name="close" size={20} color={colors.ink3} />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
          aria-label="Back"
        >
          <Ionicons name="arrow-back-outline" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">
          {archived ? 'Archived' : 'Notifications'}
        </Text>
        {unread > 0 && (
          <TouchableOpacity
            onPress={handleMarkAll}
            style={styles.headerAction}
            accessibilityRole="button"
            accessibilityLabel="Mark all read"
          >
            <Text style={styles.markAll}>Mark all read</Text>
          </TouchableOpacity>
        )}
        {!archived && status === 'ready' && items.length > 0 && (
          <TouchableOpacity
            onPress={() => { void clearAll(); }}
            disabled={clearingAll}
            style={[styles.headerAction, clearingAll && styles.headerActionBusy]}
            testID="notifications-clear-all"
            accessibilityRole="button"
            accessibilityLabel="Clear all"
          >
            <Text style={styles.markAll}>Clear all</Text>
          </TouchableOpacity>
        )}
      </View>

      {status === 'loading' ? (
        <ActivityIndicator color={colors.roxy} style={{ marginTop: 40 }} />
      ) : status === 'error' ? (
        <View style={styles.empty} testID="notifications-error">
          <Text style={styles.emptyTitle} accessibilityRole="alert">
            {archived ? "Couldn't load your archive" : "Couldn't load your notifications"}
          </Text>
          <Text style={styles.emptyText}>Check your connection and try again.</Text>
          <PrimaryButton
            label="Retry"
            onPress={() => { void load('initial'); }}
            testID="notifications-retry"
            style={styles.retry}
          />
        </View>
      ) : (
        <FlatList
          testID="notifications-list"
          data={items}
          keyExtractor={(item) => item.id}
          onRefresh={() => { void load('pull'); }}
          refreshing={refreshing}
          contentContainerStyle={{ flexGrow: 1 }}
          ListEmptyComponent={emptyState}
          ListFooterComponent={!archived && items.length > 0 ? viewArchivedLink : null}
          renderItem={renderRow}
        />
      )}
    </SafeAreaView>
  );
}
