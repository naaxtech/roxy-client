import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PressableScale } from '../ui/PressableScale';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII, inkOn } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';

/** What her own profile is missing, most visible first. */
export function profileGaps(p: { avatar_url?: string | null; bio?: string | null }): ('photo' | 'bio')[] {
  const gaps: ('photo' | 'bio')[] = [];
  if (!p.avatar_url) gaps.push('photo');
  if (!(p.bio ?? '').trim()) gaps.push('bio');
  return gaps;
}

const dismissKey = (userId: string) => `roxy.profileNudge.dismissed.${userId}`;

/**
 * "Add a photo so friends recognise you" on her own profile (PRO-09).
 *
 * 19 of 23 members had no photo and 10 no bio, and nothing ever asked. Shown
 * only while something is missing, dismissible for good, and a tap goes
 * straight to the editor. Never shown on anyone else's profile.
 */
export function ProfileNudge({
  userId, avatarUrl, bio, onOpen,
}: {
  userId: string;
  avatarUrl: string | null | undefined;
  bio: string | null | undefined;
  onOpen: () => void;
}) {
  const colors = useThemeColors();
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(dismissKey(userId))
      .then((v) => { if (!cancelled) setDismissed(v === '1'); })
      .catch(() => { if (!cancelled) setDismissed(false); });
    return () => { cancelled = true; };
  }, [userId]);

  const gaps = profileGaps({ avatar_url: avatarUrl, bio });
  if (dismissed !== false || gaps.length === 0) return null;

  const title = gaps[0] === 'photo' ? 'Add a photo so friends recognise you' : 'Add a line about you';
  const body = gaps.length === 2
    ? 'A photo and a short bio make it easier to say hi.'
    : gaps[0] === 'photo' ? 'Any photo you like — it doesn’t have to be your face.' : 'One sentence is plenty. It’s the first thing people read.';

  const s = StyleSheet.create({
    card: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      marginHorizontal: 16, marginBottom: 10, padding: 12,
      borderRadius: RADII.md, backgroundColor: colors.surface,
      borderWidth: 1, borderColor: colors.primary,
    },
    icon: {
      width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.primary,
    },
    copy: { flex: 1, gap: 2 },
    title: { ...TYPE.body, color: colors.textPrimary, fontWeight: '800' },
    body: { ...TYPE.caption, color: colors.textSecondary },
    close: { minWidth: MIN_TOUCH_TARGET - 12, minHeight: MIN_TOUCH_TARGET - 12, alignItems: 'center', justifyContent: 'center' },
  });

  return (
    <PressableScale feedback="layer" onPress={onOpen} accessible={false}>
      <View style={s.card} testID="profile-complete-nudge" accessibilityRole="button" accessibilityLabel={`${title}. ${body}`}>
        <View style={s.icon}>
          <Ionicons name={gaps[0] === 'photo' ? 'camera-outline' : 'create-outline'} size={18} color={inkOn(colors.primary)} />
        </View>
        <View style={s.copy}>
          <Text style={s.title}>{title}</Text>
          <Text style={s.body}>{body}</Text>
        </View>
        <PressableScale
          onPress={() => {
            setDismissed(true);
            void AsyncStorage.setItem(dismissKey(userId), '1').catch(() => undefined);
          }}
          style={s.close}
          testID="profile-complete-nudge-dismiss"
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={8}
        >
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </PressableScale>
      </View>
    </PressableScale>
  );
}
