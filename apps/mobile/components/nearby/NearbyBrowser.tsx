import { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TouchableOpacity } from '../ui/PressableScale';
import { FadeIn, SkeletonGroup } from '../feedback/Skeleton';
import { CardSkeleton } from '../discover/V2Cards';
import { byTheme } from '../discover/byTheme';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useNearbyStore } from '../../store/nearbyStore';
import { TYPE } from '../../lib/typography';
import { RADII, SPACE, MARGIN, type ThemeColors } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { NEARBY_FETCH_MAX } from '../../lib/nearby';
import { activeNearbyFilters, removeNearbyFilter, DEFAULT_NEARBY_FILTERS } from '../../lib/nearbyFilters';
import { NearbyPrompt } from './NearbyPrompt';
import { NearbyRows } from './NearbyRows';
import { NearbyFilterSheet } from './NearbyFilterSheet';
import { useNearbyOrigin } from './useNearbyOrigin';
import { useNearbyResults } from './useNearbyResults';

const SKELETON_ROWS = 6;
/** The removable chip's painted height inside its 48 dp target (FilterChips' pill). */
const CHIP_HEIGHT = SPACE[6] + SPACE[0];

/**
 * The communities browser in nearby mode (`/communities?near=1`, the rail's
 * "See all"). Where it looks from ("Near your location" or "Near <city>",
 * never coordinates) with Change; Filters with a count; every active filter
 * as a removable chip; then up to 50 rows with the same loading, empty and
 * error states as the rail. An empty answer offers the one move that can
 * change it: clear the filters, or look farther.
 */
export function NearbyBrowser() {
  const colors = useThemeColors();
  const s = styles(colors);
  const n = useNearbyOrigin();
  const filters = useNearbyStore((st) => st.filters);
  const results = useNearbyResults(NEARBY_FETCH_MAX);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const active = activeNearbyFilters(filters);

  const setFilters = (next: typeof filters) => useNearbyStore.getState().setFilters(n.userId, next);

  const originLine = !n.origin
    ? null
    : n.origin.kind === 'city' ? `Near ${n.origin.city.label}` : 'Near your location';

  const status = n.locating ? 'loading' : results.status;

  let content;
  if (!n.origin && !n.locating) {
    content = (
      <NearbyPrompt denied={n.denied} problem={n.problem} onUseLocation={n.locateMe} onChooseCity={n.openCityPicker} />
    );
  } else if (status === 'loading') {
    content = (
      <SkeletonGroup testID="nearby-browser-loading" accessibilityLabel="Loading communities near you">
        {Array.from({ length: SKELETON_ROWS }, (_, i) => <CardSkeleton key={i} kind="row" />)}
      </SkeletonGroup>
    );
  } else if (status === 'error') {
    content = (
      <View style={s.state} testID="nearby-browser-error">
        <Text style={s.stateText}>Communities near you didn’t load. Check your connection and try again.</Text>
        <QuietPill label="Try again" onPress={results.reload} styles={s} />
      </View>
    );
  } else if (results.rows.length === 0) {
    content = (
      <View style={s.state} testID="nearby-browser-empty">
        {active.length > 0 ? (
          <>
            <Text style={s.stateText}>Nothing nearby matches these filters. Clear them to see everything near you.</Text>
            <QuietPill label="Clear filters" onPress={() => setFilters({ ...DEFAULT_NEARBY_FILTERS, categories: [] })} styles={s} />
          </>
        ) : (
          <>
            <Text style={s.stateText}>No communities near you yet. Look farther, or choose another city.</Text>
            <QuietPill label="Look farther" onPress={() => setFilters({ ...filters, radiusKm: 1000 })} styles={s} />
          </>
        )}
      </View>
    );
  } else {
    content = (
      <FadeIn>
        <NearbyRows rows={results.rows} />
      </FadeIn>
    );
  }

  return (
    <View style={s.screen} testID="nearby-browser">
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        {n.origin ? (
          <View style={s.toolbar}>
            <Text style={s.origin} numberOfLines={2}>{originLine}</Text>
            <View style={s.toolbarActions}>
              <TouchableOpacity
                onPress={n.openCityPicker}
                accessibilityRole="button"
                accessibilityLabel="Change where to look from"
                style={s.toolButton}
                testID="nearby-change-origin"
              >
                <Text style={s.toolLabel}>Change</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setFiltersOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={active.length > 0 ? `Filters, ${active.length} on` : 'Filters'}
                style={s.toolButton}
                testID="nearby-filters-button"
              >
                <Ionicons name="options-outline" size={SPACE[4] + SPACE[0]} color={colors.ink} accessibilityElementsHidden importantForAccessibility="no" />
                <Text style={s.toolLabel}>{active.length > 0 ? `Filters · ${active.length}` : 'Filters'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {n.origin && active.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} style={s.chipScroller}>
            {active.map((f) => (
              <TouchableOpacity
                key={f.key}
                onPress={() => setFilters(removeNearbyFilter(filters, f.key))}
                accessibilityRole="button"
                accessibilityLabel={`Remove filter: ${f.label}`}
                style={s.chipTarget}
                testID={`nearby-active-${f.key}`}
              >
                <View style={s.chip}>
                  <Text style={s.chipLabel} numberOfLines={1}>{f.label}</Text>
                  <Ionicons name="close" size={SPACE[3] + SPACE[0]} color={colors.onPinkContainer} accessibilityElementsHidden importantForAccessibility="no" />
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

        <View style={s.content}>{content}</View>
      </ScrollView>

      <NearbyFilterSheet
        visible={filtersOpen}
        filters={filters}
        onClose={() => setFiltersOpen(false)}
        onApply={(next) => {
          setFiltersOpen(false);
          setFilters(next);
        }}
      />
      {n.cityPicker}
    </View>
  );
}

function QuietPill({ label, onPress, styles: s }: { label: string; onPress: () => void; styles: ReturnType<typeof styles> }) {
  return (
    <TouchableOpacity onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={s.quietPill}>
      <Text style={s.toolLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

// Built once per theme, not on every render (jank audit #8).
const styles = byTheme((colors: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  body: { paddingTop: SPACE[2], paddingBottom: SPACE[7] },
  toolbar: { paddingHorizontal: MARGIN, gap: SPACE[1] },
  origin: { ...TYPE.body, color: colors.ink2 },
  toolbarActions: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE[1] },
  toolButton: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[1],
    minHeight: MIN_TOUCH_TARGET, paddingHorizontal: SPACE[3],
    borderRadius: RADII.pill, backgroundColor: colors.raised,
  },
  toolLabel: { ...TYPE.label, color: colors.ink },
  chipScroller: { flexGrow: 0, flexShrink: 0 },
  chips: { gap: SPACE[1], paddingHorizontal: MARGIN, alignItems: 'center' },
  chipTarget: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[0],
    height: CHIP_HEIGHT, paddingLeft: SPACE[3], paddingRight: SPACE[2],
    borderRadius: RADII.pill, backgroundColor: colors.pinkContainer,
  },
  chipLabel: { ...TYPE.label, color: colors.onPinkContainer },
  content: { paddingTop: SPACE[2] },
  state: { paddingHorizontal: MARGIN, paddingVertical: SPACE[2], gap: SPACE[2], alignItems: 'flex-start' },
  stateText: { ...TYPE.body, color: colors.ink2 },
  quietPill: {
    minHeight: MIN_TOUCH_TARGET, justifyContent: 'center',
    paddingHorizontal: SPACE[4], borderRadius: RADII.pill, backgroundColor: colors.raised,
  },
}));
