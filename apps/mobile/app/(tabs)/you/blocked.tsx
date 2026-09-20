import { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafetyStore, type BlockedProfile } from '../../../store/safetyStore';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { TYPE } from '../../../lib/typography';
import { RADII } from '../../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';
import { confirmAction, showAlert } from '../../../lib/confirm';

/**
 * Who she has blocked, and the way back.
 *
 * 085 built `block_user` and `blocked_user_ids` and no unblock, so a block was
 * permanent by accident — the prototype's "Blocked" row (markup 899) opened a
 * toast because there was nothing to open. Migration 093 adds `unblock_user`
 * and `blocked_profiles`; this is the screen they were for.
 *
 * It says **Blocked**, not "Blocked & muted" as the prototype does. There is no
 * mute in this app and there never has been. A screen that implies one would
 * have her believe she has a quieter option than blocking, and go looking for
 * it.
 *
 * The undo is gated on the affected-row count the RPC returns, not on the
 * absence of an error — PostgREST answers 200 for a write that matched nothing,
 * and a list that removes her on a no-op is telling a woman that someone can
 * reach her again when he cannot, or the reverse.
 */
export default function BlockedScreen() {
  const router = useRouter();
  const colors = useThemeColors();

  const blockedProfiles = useSafetyStore((s) => s.blockedProfiles);
  const loading = useSafetyStore((s) => s.loadingBlocks);
  const loadError = useSafetyStore((s) => s.blockLoadError);
  const loadBlockedProfiles = useSafetyStore((s) => s.loadBlockedProfiles);
  const unblockUser = useSafetyStore((s) => s.unblockUser);

  const [working, setWorking] = useState<string | null>(null);

  useEffect(() => { void loadBlockedProfiles(); }, [loadBlockedProfiles]);

  const handleUnblock = useCallback(async (person: BlockedProfile) => {
    const name = person.display_name ?? person.username ?? 'her';
    const confirmed = await confirmAction(
      `Unblock ${name}?`,
      'She will be able to see your posts and message you again. You can block her again at any time.',
      'Unblock'
    );
    if (!confirmed) return;

    setWorking(person.id);
    const undone = await unblockUser(person.id);
    setWorking(null);

    if (!undone) {
      showAlert('Still blocked', 'We could not unblock her. She is still blocked — try again in a moment.');
    }
  }, [unblockUser]);

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 16, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    backBtn: { minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
    title: { ...TYPE.title, color: colors.textPrimary },
    state: { padding: 24, gap: 10, alignItems: 'center' },
    stateText: { ...TYPE.body, color: colors.textSecondary, textAlign: 'center' },
    retry: {
      ...TYPE.body, color: colors.roxy, fontWeight: '700',
      minHeight: MIN_TOUCH_TARGET, textAlignVertical: 'center',
    },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 16, paddingVertical: 12, minHeight: MIN_TOUCH_TARGET,
    },
    avatar: {
      width: 40, height: 40, borderRadius: 20,
      backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
    },
    avatarText: { ...TYPE.body, color: colors.textSecondary, fontWeight: '700' },
    who: { flex: 1 },
    name: { ...TYPE.body, color: colors.textPrimary, fontWeight: '700' },
    handle: { ...TYPE.caption, color: colors.textMuted },
    unblock: {
      minHeight: MIN_TOUCH_TARGET, justifyContent: 'center',
      paddingHorizontal: 14, borderRadius: RADII.pill,
      borderWidth: 1, borderColor: colors.surfaceLight,
    },
    unblockText: { ...TYPE.caption, color: colors.roxy, fontWeight: '700' },
    separator: { height: 1, backgroundColor: colors.surface, marginLeft: 68 },
  });

  const renderBody = () => {
    if (loading && blockedProfiles.length === 0) {
      return (
        <View style={s.state} testID="blocked-loading">
          <ActivityIndicator color={colors.roxy} />
        </View>
      );
    }

    if (loadError && blockedProfiles.length === 0) {
      return (
        <View style={s.state} testID="blocked-error">
          <Text style={s.stateText}>Could not load your blocked list.</Text>
          <TouchableOpacity
            onPress={() => void loadBlockedProfiles()}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            testID="blocked-retry"
          >
            <Text style={s.retry}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (blockedProfiles.length === 0) {
      return (
        <View style={s.state} testID="blocked-empty">
          <Text style={s.stateText}>
            You have not blocked anyone. Long-press any post to block, report or hide it.
          </Text>
        </View>
      );
    }

    return (
      <FlatList
        data={blockedProfiles}
        keyExtractor={(p) => p.id}
        testID="blocked-list"
        ItemSeparatorComponent={() => <View style={s.separator} />}
        renderItem={({ item }) => {
          const name = item.display_name ?? item.username ?? 'Someone';
          const busy = working === item.id;
          return (
            <View style={s.row} testID={`blocked-row-${item.id}`}>
              <View style={s.avatar}>
                <Text style={s.avatarText}>{name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={s.who}>
                <Text style={s.name} numberOfLines={1}>{name}</Text>
                {item.username ? (
                  <Text style={s.handle} numberOfLines={1}>@{item.username}</Text>
                ) : null}
              </View>
              <TouchableOpacity
                style={s.unblock}
                onPress={() => void handleUnblock(item)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`Unblock ${name}`}
                testID={`blocked-unblock-${item.id}`}
              >
                {busy
                  ? <ActivityIndicator color={colors.roxy} />
                  : <Text style={s.unblockText}>Unblock</Text>}
              </TouchableOpacity>
            </View>
          );
        }}
      />
    );
  };

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/you/settings'))}
          style={s.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back-outline" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={s.title}>Blocked</Text>
      </View>
      {renderBody()}
    </SafeAreaView>
  );
}
