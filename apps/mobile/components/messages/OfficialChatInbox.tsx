import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { useThemeColors } from '../../hooks/useThemeColors';
import { ScreenHeader } from '../ui/ScreenHeader';
import { TYPE } from '../../lib/typography';
import { RADII, type ThemeColors } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import {
  ensureOfficialMembership,
  fetchOfficialCommunity,
  fetchOwnedCommunities,
  type OfficialCommunity,
} from '../../lib/officialCommunity';
import { ComingSoon } from '../features/ComingSoon';
import { useAccess } from '../../hooks/useAccess';
import { comingSoonCopy } from '../../lib/features';

/**
 * Public inbox: one row, Roxy Official, into community channels.
 */
export function OfficialChatInbox() {
  const colors = useThemeColors();
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { can, kind } = useAccess();
  const showOwned = can('communities') && !can('dms');
  const s = styles(colors);
  const lockedCopy = comingSoonCopy('officialChat', kind);

  const [community, setCommunity] = useState<OfficialCommunity | null>(null);
  const [owned, setOwned] = useState<OfficialCommunity[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const row = await fetchOfficialCommunity();
    setCommunity(row);
    if (row && userId) await ensureOfficialMembership(userId, row.id);
    if (showOwned && userId) setOwned(await fetchOwnedCommunities(userId));
    else setOwned([]);
    setLoading(false);
  }, [userId, showOwned]);

  useEffect(() => {
    if (kind === 'pending') return;
    void load();
  }, [kind, load]);

  if (kind === 'pending') {
    return (
      <SafeAreaView style={s.safe} testID="official-chat-inbox">
        <ScreenHeader title="Messages" />
        <View style={s.locked} testID="official-chat-locked">
          <View style={s.ava}>
            <Ionicons name="lock-closed" size={22} color={colors.primary} />
          </View>
          <Text style={s.lockedEyebrow}>Waiting for approval</Text>
          <Text style={s.name}>{lockedCopy.title}</Text>
          <Text style={s.lockedBody}>{lockedCopy.body}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!loading && !community) {
    return <ComingSoon feature="officialChat" />;
  }

  const dmsCopy = comingSoonCopy('dms', kind);

  return (
    <SafeAreaView style={s.safe} testID="official-chat-inbox">
      <ScreenHeader title="Messages" />
      <Text style={s.section} testID="inbox-section-direct" accessibilityRole="header">DIRECT</Text>
      <View style={s.directLocked} testID="inbox-direct-locked">
        <View style={s.ava}>
          <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.textMuted} />
        </View>
        <View style={s.text}>
          <Text style={s.name}>{dmsCopy.title}</Text>
          <Text style={s.sub} numberOfLines={2}>{dmsCopy.body}</Text>
        </View>
      </View>
      <Text style={s.section} testID="inbox-section-community" accessibilityRole="header">COMMUNITY CHATS</Text>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 48 }} />
      ) : (
        <>
          {community ? (
            <TouchableOpacity
              style={s.row}
              onPress={() => router.push(`/community/channels/${community.id}` as never)}
              accessibilityRole="button"
              accessibilityLabel={`${community.name} community chat`}
              testID="official-chat-row"
            >
              <View style={s.ava}>
                <Ionicons name="chatbubbles" size={22} color={colors.primary} />
              </View>
              <View style={s.text}>
                <Text style={s.name}>{community.name}</Text>
                <Text style={s.sub} numberOfLines={2}>
                  {community.description ?? 'Official updates and community chat.'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
          {owned.map((row) => (
            <TouchableOpacity
              key={row.id}
              style={s.row}
              onPress={() => router.push(`/community/channels/${row.id}` as never)}
              accessibilityRole="button"
              accessibilityLabel={`${row.name} community chat`}
              testID={`owned-chat-row-${row.id}`}
            >
              <View style={s.ava}>
                <Ionicons name="people" size={22} color={colors.primary} />
              </View>
              <View style={s.text}>
                <Text style={s.name}>{row.name}</Text>
                <Text style={s.sub} numberOfLines={2}>
                  {row.description ?? 'Community chat.'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
          {showOwned ? (
            <TouchableOpacity
              style={s.row}
              onPress={() => router.push('/communities' as never)}
              accessibilityRole="button"
              accessibilityLabel="Browse communities"
              testID="browse-communities-row"
            >
              <View style={s.ava}>
                <Ionicons name="compass" size={22} color={colors.primary} />
              </View>
              <View style={s.text}>
                <Text style={s.name}>Communities</Text>
                <Text style={s.sub}>Open community chat beyond Official.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  section: {
    ...TYPE.micro, color: colors.textMuted, fontWeight: '800',
    letterSpacing: 1.4, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 14,
    marginBottom: 8,
    paddingVertical: 11,
    paddingHorizontal: 12,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: RADII.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  ava: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceLight,
  },
  text: { flex: 1, gap: 2 },
  name: { ...TYPE.body, color: colors.textPrimary, fontWeight: '700' },
  sub: { ...TYPE.caption, color: colors.textSecondary },
  locked: {
    marginHorizontal: 14,
    marginTop: 16,
    padding: 18,
    gap: 8,
    borderRadius: RADII.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  lockedEyebrow: {
    ...TYPE.micro,
    color: colors.primaryInk,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  lockedBody: { ...TYPE.body, color: colors.textSecondary, lineHeight: 20 },
  directLocked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 14,
    marginBottom: 8,
    paddingVertical: 11,
    paddingHorizontal: 12,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: RADII.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    opacity: 0.92,
  },
});
