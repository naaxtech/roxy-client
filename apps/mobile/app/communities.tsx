import { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { useCommunityStore } from '../store/communityStore';
import { useThemeColors } from '../hooks/useThemeColors';
import { CommunitiesBrowser } from '../components/community/CommunitiesBrowser';

/**
 * Root route for Discover's Communities rail "See all" link.
 *
 * `CommunitiesBrowser` used to live inline as Connect's Communities subtab;
 * the 3.0 redesign deleted `connect/index.tsx` along with the tab, and the
 * component survived the cut with no screen left to render it — a rail
 * capped at 12 cards had nowhere to send her for the rest. This route
 * restores it as a destination rather than a tab, which is all a "see all"
 * link needs.
 */
export default function CommunitiesScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const hydrate = useCommunityStore((s) => s.hydrate);

  // CommunitiesBrowser reads the store directly and does not hydrate itself.
  // Discover already hydrates on its own mount, but a member can land here
  // straight from a deep link or a cold start where Discover never ran.
  useEffect(() => { void hydrate(user?.id); }, [user?.id, hydrate]);

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 16, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: colors.surface,
    },
    backBtn: { padding: 4 },
    headerTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        {/* A cold-start deep link to /communities has nothing behind it, and an
            unconditional `back()` there is a button that does nothing. Discover
            is where this route is reached from, so it is where "back" means. */}
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/discover'))}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back-outline" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Communities</Text>
      </View>
      <CommunitiesBrowser />
    </SafeAreaView>
  );
}
