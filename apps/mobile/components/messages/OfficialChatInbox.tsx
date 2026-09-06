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
  type OfficialCommunity,
} from '../../lib/officialCommunity';
import { ComingSoon } from '../features/ComingSoon';

/**
 * Public inbox: one row, Roxy Official, into community channels.
 */
export function OfficialChatInbox() {
  const colors = useThemeColors();
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const s = styles(colors);

  const [community, setCommunity] = useState<OfficialCommunity | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const row = await fetchOfficialCommunity();
    setCommunity(row);
    if (row && userId) await ensureOfficialMembership(userId, row.id);
    setLoading(false);
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  if (!loading && !community) {
    return <ComingSoon feature="officialChat" />;
  }

  return (
    <SafeAreaView style={s.safe} testID="official-chat-inbox">
      <ScreenHeader title="Chat" eyebrow="Roxy Official" />
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 48 }} />
      ) : community ? (
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
    </SafeAreaView>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 18,
    paddingVertical: 16,
    paddingHorizontal: 14,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: RADII.lg,
    backgroundColor: colors.surface,
  },
  ava: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceLight,
  },
  text: { flex: 1, gap: 2 },
  name: { ...TYPE.bodyLg, color: colors.textPrimary, fontWeight: '700' },
  sub: { ...TYPE.body, color: colors.textSecondary },
});
