import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII, inkOn, type ThemeColors } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { comingSoonCopy, type Feature } from '../../lib/features';
import { useAccess } from '../../hooks/useAccess';
import { AccountStatusTag } from '../account/AccountStatusTag';

type Props = {
  feature: Feature;
};

/**
 * The public-launch placeholder. One screen, one promise: this part of Roxy
 * is not open yet, and Archive is.
 */
export function ComingSoon({ feature }: Props) {
  const colors = useThemeColors();
  const router = useRouter();
  const { kind } = useAccess();
  const copy = comingSoonCopy(feature, kind);
  const s = styles(colors);
  const waiting = kind === 'pending';

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.wrap} testID="coming-soon">
        <AccountStatusTag />
        <Text style={s.eyebrow}>{waiting ? 'Waiting for approval' : '✿ Coming soon'}</Text>
        <Text style={s.title}>{copy.title}</Text>
        <Text style={s.body}>{copy.body}</Text>
        <TouchableOpacity
          style={s.cta}
          onPress={() => router.replace('/(tabs)/feed' as never)}
          accessibilityRole="button"
          accessibilityLabel="Back to Archive"
          testID="coming-soon-archive"
        >
          <Text style={s.ctaText}>Back to Archive</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  eyebrow: {
    ...TYPE.caption,
    color: colors.primary,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  title: {
    ...TYPE.display,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    ...TYPE.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  cta: {
    marginTop: 8,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADII.pill,
    backgroundColor: colors.primary,
  },
  ctaText: {
    ...TYPE.bodyLg,
    color: inkOn(colors.primary),
    fontWeight: '700',
  },
});
