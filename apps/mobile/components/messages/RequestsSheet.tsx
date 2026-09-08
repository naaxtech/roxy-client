import { useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, Pressable, ScrollView, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useFriendStore, type FriendshipRow } from '../../store/friendStore';
import { logError } from '../../lib/errorLogger';
import { avatarGradient } from '../../lib/avatars';
import { TYPE } from '../../lib/typography';
import { RADII, inkOn, type ThemeColors } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Requests, answered one at a time.
 *
 * Roxy is request-first: a stranger cannot land in the main thread list. This
 * sheet is where those requests wait, and it is deliberately a separate surface
 * rather than a section she has to scroll past — the whole point of a request
 * inbox is that reading it is a decision, not an ambush.
 *
 * Declining deletes the friendship row rather than marking it declined, so the
 * sender is never told. That is a safety property, not an implementation
 * detail, and the copy says so out loud: a woman deciding whether to decline
 * needs to know it will not start a conversation.
 */
export function RequestsSheet({ visible, onClose }: Props) {
  const colors = useThemeColors();
  const s = styles(colors);

  const pendingReceived = useFriendStore((st) => st.pendingReceived);
  const acceptRequest = useFriendStore((st) => st.acceptRequest);
  const rejectRequest = useFriendStore((st) => st.rejectRequest);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (row: FriendshipRow, accept: boolean) => {
    setBusyId(row.id);
    setError(null);
    try {
      // Both store actions throw on a refused write and refetch on success, so
      // the list is never stale and a failure is never announced as a success.
      if (accept) await acceptRequest(row.id);
      else await rejectRequest(row.id);
    } catch (e) {
      setError(accept ? 'Could not accept that just now.' : 'Could not decline that just now.');
      logError(e, 'RequestsSheet.act');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Dismiss" />
      <View style={s.sheet} testID="requests-sheet">
        <View style={s.grabber} />
        <View style={s.head}>
          <View style={s.headText}>
            <Text style={s.title}>Requests</Text>
            <Text style={s.sub}>Declining is quiet — she is never told.</Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            activeOpacity={0.75}
            style={s.close}
          >
            <Ionicons name="close" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {error ? (
          <Text style={s.error} accessibilityLiveRegion="polite" testID="requests-error">{error}</Text>
        ) : null}

        {pendingReceived.length === 0 ? (
          <View style={s.empty} testID="requests-empty">
            <Text style={s.emptyTitle}>No requests right now</Text>
            <Text style={s.emptyBody}>
              When someone asks to talk, she waits here until you decide.
            </Text>
          </View>
        ) : (
          <ScrollView style={s.list} contentContainerStyle={s.listContent}>
            {pendingReceived.map((row) => {
              const grad = avatarGradient(row.profile.display_name);
              const busy = busyId === row.id;
              return (
                <View key={row.id} style={s.row} testID={`request-${row.id}`}>
                  <View style={[s.avatar, { backgroundColor: grad[0] }]}>
                    <Text style={[s.initial, { color: inkOn(grad[0]) }]}>
                      {row.profile.display_name?.[0]?.toUpperCase() ?? '?'}
                    </Text>
                  </View>
                  <View style={s.rowText}>
                    <Text style={s.name} numberOfLines={1}>{row.profile.display_name}</Text>
                    <Text style={s.handle} numberOfLines={1}>@{row.profile.username}</Text>
                  </View>

                  {busy ? (
                    <ActivityIndicator color={colors.roxy} />
                  ) : (
                    <View style={s.actions}>
                      <TouchableOpacity
                        onPress={() => void act(row, false)}
                        accessibilityRole="button"
                        accessibilityLabel={`Decline ${row.profile.display_name}. She will not be told.`}
                        activeOpacity={0.8}
                        style={s.decline}
                        testID={`request-decline-${row.id}`}
                      >
                        <Text style={s.declineText}>Decline</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => void act(row, true)}
                        accessibilityRole="button"
                        accessibilityLabel={`Accept ${row.profile.display_name}`}
                        activeOpacity={0.8}
                        style={s.accept}
                        testID={`request-accept-${row.id}`}
                      >
                        <Text style={s.acceptText}>Accept</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(8,3,18,0.66)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: RADII.sheet, borderTopRightRadius: RADII.sheet,
    paddingHorizontal: 18, paddingTop: 10, paddingBottom: 28, gap: 8,
  },
  grabber: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.line, marginBottom: 8,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headText: { flex: 1, gap: 2 },
  title: { ...TYPE.headline, color: colors.textPrimary },
  sub: { ...TYPE.caption, color: colors.textSecondary },
  close: {
    minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET,
    borderRadius: RADII.pill, backgroundColor: colors.surfaceLight,
    alignItems: 'center', justifyContent: 'center',
  },
  error: { ...TYPE.caption, color: colors.errorInk },
  empty: { paddingVertical: 26, gap: 6 },
  emptyTitle: { ...TYPE.bodyLg, color: colors.textPrimary, fontWeight: '700' },
  emptyBody: { ...TYPE.caption, color: colors.textSecondary, lineHeight: 18 },
  list: { maxHeight: 380 },
  listContent: { gap: 8, paddingBottom: 4 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    minHeight: MIN_TOUCH_TARGET + 12, paddingHorizontal: 10, paddingVertical: 8,
    borderRadius: RADII.md, backgroundColor: colors.surfaceLight,
  },
  avatar: { width: 40, height: 40, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center' },
  initial: { ...TYPE.bodyLg, fontWeight: '800' },
  rowText: { flex: 1, gap: 1 },
  name: { ...TYPE.bodyLg, color: colors.textPrimary, fontWeight: '700' },
  handle: { ...TYPE.micro, color: colors.textSecondary },
  actions: { flexDirection: 'row', gap: 6 },
  decline: {
    minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: 12,
    borderRadius: RADII.pill, borderWidth: 1, borderColor: colors.line,
  },
  declineText: { ...TYPE.caption, color: colors.textSecondary, fontWeight: '700' },
  accept: {
    minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: 14,
    borderRadius: RADII.pill, backgroundColor: colors.primary,
  },
  acceptText: { ...TYPE.caption, color: inkOn(colors.primary), fontWeight: '800' },
});
