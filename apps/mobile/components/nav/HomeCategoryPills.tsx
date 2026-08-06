import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../hooks/useThemeColors';
import type { ThemeColors } from '../../lib/theme';
import { HOME_CATEGORIES, TAB_MIN_TOUCH } from './navTokens';

/**
 * Netflix's move, borrowed exactly: a horizontal row of rounded pills across
 * the top of Home. It is how Netflix gives Games first-class placement without
 * spending one of its four navigation slots, and it is how Events, Games, live
 * rooms and Build stay one tap from Home now that the bar is down to five.
 *
 * Every pill here resolves to a route that already exists. There is no pill for
 * the marketplace, because the app ships `/product/[id]` and no storefront
 * index to send anyone to — an affordance that goes nowhere is worse than one
 * honestly absent.
 */
export function HomeCategoryPills() {
  const colors = useThemeColors();
  const router = useRouter();
  const s = styles(colors);

  return (
    <View style={s.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.row}
      >
        {HOME_CATEGORIES.map((category) => (
          <TouchableOpacity
            key={category.key}
            style={s.pill}
            testID={`home-pill-${category.key}`}
            onPress={() => router.push(category.href)}
            accessibilityRole="button"
            accessibilityLabel={category.label}
            activeOpacity={0.75}
          >
            <Ionicons name={category.icon} size={15} color={colors.roxy} />
            <Text style={s.label}>{category.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  wrap: { marginTop: 2 },
  row: { gap: 8, paddingRight: 16, paddingVertical: 2 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: TAB_MIN_TOUCH,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.textPrimary + '14',
  },
  label: { color: colors.textPrimary, fontSize: 13.5, fontWeight: '700', letterSpacing: -0.2 },
});
