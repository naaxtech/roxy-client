import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { TYPE } from '../../lib/typography';
import { RADII, SPACE, type ThemeColors } from '../../lib/theme';
import { springTo } from '../../lib/motion';
import { SUPPORTER_PERKS, type SupporterPerk } from '../../lib/supporter';

/**
 * The perks in plain words (spec 2026-10-26 §1 › Paywall; owner decisions of
 * the same day). Each one is enforced on the server in slice S2; the copy says
 * what she gets, never "unlock" (direction › Bans › Words).
 */
export const PERK_COPY: Record<SupporterPerk, { icon: keyof typeof Ionicons.glyphMap; title: string; line: string }> = {
  chapters: {
    icon: 'earth-outline',
    title: 'City chapters anywhere',
    line: 'Join in-person chapters in any city, not just the ones near you.',
  },
  incognito: {
    icon: 'eye-off-outline',
    title: 'Incognito',
    line: 'Only people you follow, chat with or share a community with can see your profile.',
  },
  banner: {
    icon: 'color-palette-outline',
    title: 'Profile banner and skins',
    line: 'Put a banner on your profile and pick a skin for it.',
  },
  merchant: {
    icon: 'storefront-outline',
    title: 'Apply to sell',
    line: 'Open a shop on Roxy. The team reviews every application.',
  },
  sticker: {
    icon: 'ribbon-outline',
    title: 'Supporter sticker',
    line: 'A small mark next to your name, wherever it shows.',
  },
};

/** The headline when a perk gate opened the paywall (`?reason=`). */
export const PERK_LEAD: Record<SupporterPerk, string> = {
  chapters: 'Join chapters in any city',
  incognito: 'Be seen only by your people',
  banner: 'Make your profile yours',
  merchant: 'Sell on Roxy',
  sticker: 'Wear the Supporter sticker',
};

/** The perks with `lead` first, the rest in the spec's order. */
export function orderedPerks(lead: SupporterPerk | null): SupporterPerk[] {
  return lead ? [lead, ...SUPPORTER_PERKS.filter((p) => p !== lead)] : [...SUPPORTER_PERKS];
}

export function SupporterPerks({ lead = null }: { lead?: SupporterPerk | null }) {
  const colors = useThemeColors();
  const s = styles(colors);
  return (
    <View style={s.list} testID="supporter-perks">
      {orderedPerks(lead).map((perk) => {
        const copy = PERK_COPY[perk];
        return (
          <View key={perk} style={s.row} testID={`supporter-perk-${perk}`}>
            <Ionicons name={copy.icon} size={24} color={colors.ink2} />
            <View style={s.copy}>
              <Text style={s.title}>{copy.title}</Text>
              <Text style={s.line}>{copy.line}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/**
 * The Supporter tag: butter is Premium's colour and nothing else's (direction
 * › Color), `onPremium` on `premium` at 11.59:1. `pop` springs it in once
 * (the success state); under Reduce Motion it is simply there.
 */
export function SupporterTag({ pop = false }: { pop?: boolean }) {
  const colors = useThemeColors();
  const reduced = useReducedMotion();
  const scale = useSharedValue(pop && !reduced ? 0.8 : 1);
  useEffect(() => {
    if (pop && !reduced) scale.value = withSpring(1, springTo('spatial'));
  }, [pop, reduced, scale]);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View
      style={[tagStyles.tag, { backgroundColor: colors.premium }, animated]}
      testID="supporter-tag"
      accessible
      accessibilityLabel="Roxy Supporter"
    >
      <Ionicons name="ribbon" size={16} color={colors.onPremium} />
      <Text style={[tagStyles.label, { color: colors.onPremium }]}>Supporter</Text>
    </Animated.View>
  );
}

const tagStyles = StyleSheet.create({
  tag: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: SPACE[0],
    paddingHorizontal: SPACE[2], paddingVertical: SPACE[0], borderRadius: RADII.pill,
  },
  label: { ...TYPE.meta, fontFamily: TYPE.label.fontFamily },
});

const styles = (colors: ThemeColors) => StyleSheet.create({
  list: { gap: SPACE[3] },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE[3] },
  copy: { flex: 1 },
  title: { ...TYPE.label, color: colors.ink },
  line: { ...TYPE.body, color: colors.ink2 },
});
