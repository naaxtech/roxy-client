import { useEffect, useState, type ReactNode } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Sheet } from '../feedback/Sheet';
import { PrimaryButton } from '../ui/PrimaryButton';
import { TouchableOpacity } from '../ui/PressableScale';
import { FilterChips } from '../discover/FilterChips';
import { byTheme } from '../discover/byTheme';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE, emphasized } from '../../lib/typography';
import { RADII, SPACE, MARGIN, type ThemeColors } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import type { NearbyRadiusKm } from '../../lib/nearbyCoords';
import {
  CATEGORY_CHIPS, DEFAULT_NEARBY_FILTERS, JOIN_CHIPS, MEETS_CHIPS, RADIUS_CHIPS,
  toggleCategory, type NearbyFilters, type RadiusKey,
} from '../../lib/nearbyFilters';

interface Props {
  visible: boolean;
  /** What is applied now; the sheet starts from it each time it opens. */
  filters: NearbyFilters;
  onApply: (next: NearbyFilters) => void;
  onClose: () => void;
}

function fresh(f: NearbyFilters): NearbyFilters {
  return { ...f, categories: [...f.categories] };
}

/**
 * Nearby filters (spec › Filters): distance, kind of community (several at
 * once), how it meets, who can join. Choices are a draft until "Show
 * communities", the sheet's one primary button; Reset puts the defaults back
 * in the draft. Reopening starts from what is applied, never from an
 * abandoned draft. The chips are Discover's `FilterChips` (radios, and
 * checkboxes for the kinds), so they press, fill and tick the same way.
 */
export function NearbyFilterSheet({ visible, filters, onApply, onClose }: Props) {
  const colors = useThemeColors();
  const s = styles(colors);
  const [draft, setDraft] = useState<NearbyFilters>(() => fresh(filters));

  useEffect(() => {
    if (visible) setDraft(fresh(filters));
    // Only opening resets the draft; a filters change while open is ours.
  }, [visible]);

  return (
    <Sheet visible={visible} onClose={onClose} accessibilityLabel="Filters" testID="nearby-filters" style={s.sheet}>
      <ScrollView contentContainerStyle={s.body}>
        <Text style={s.title} accessibilityRole="header">Filters</Text>
        <Group label="Distance" styles={s}>
          <FilterChips
            chips={RADIUS_CHIPS}
            value={String(draft.radiusKm) as RadiusKey}
            onChange={(k) => setDraft((d) => ({ ...d, radiusKm: Number(k) as NearbyRadiusKm }))}
            label="Distance"
            testID="nearby-filter-radius"
          />
        </Group>
        <Group label="Kind of community" styles={s}>
          <FilterChips
            multiple
            chips={CATEGORY_CHIPS}
            values={draft.categories}
            onToggle={(c) => setDraft((d) => toggleCategory(d, c))}
            label="Kind of community"
            testID="nearby-filter-category"
          />
        </Group>
        <Group label="Meets" styles={s}>
          <FilterChips
            chips={MEETS_CHIPS}
            value={draft.meets}
            onChange={(m) => setDraft((d) => ({ ...d, meets: m }))}
            label="Meets"
            testID="nearby-filter-meets"
          />
        </Group>
        <Group label="Who can join" styles={s}>
          <FilterChips
            chips={JOIN_CHIPS}
            value={draft.openOnly ? 'open' : 'all'}
            onChange={(j) => setDraft((d) => ({ ...d, openOnly: j === 'open' }))}
            label="Who can join"
            testID="nearby-filter-join"
          />
        </Group>
      </ScrollView>
      <View style={s.footer}>
        <PrimaryButton label="Show communities" onPress={() => onApply(fresh(draft))} testID="nearby-filters-apply" />
        <TouchableOpacity
          onPress={() => setDraft(fresh(DEFAULT_NEARBY_FILTERS))}
          accessibilityRole="button"
          accessibilityLabel="Reset filters"
          style={s.reset}
          testID="nearby-filters-reset"
        >
          <Text style={s.resetLabel}>Reset</Text>
        </TouchableOpacity>
      </View>
    </Sheet>
  );
}

function Group({ label, children, styles: s }: { label: string; children: ReactNode; styles: ReturnType<typeof styles> }) {
  return (
    <View style={s.group}>
      <Text style={s.groupLabel}>{label}</Text>
      {children}
    </View>
  );
}

// Built once per theme, not on every render (jank audit #8).
const styles = byTheme((colors: ThemeColors) => StyleSheet.create({
  sheet: { paddingTop: SPACE[1] },
  body: { gap: SPACE[4], paddingBottom: SPACE[2] },
  title: { ...TYPE.title, color: colors.ink, paddingHorizontal: MARGIN },
  group: { gap: SPACE[0] },
  groupLabel: { ...emphasized('meta'), color: colors.ink2, paddingHorizontal: MARGIN },
  footer: { gap: SPACE[1], paddingHorizontal: MARGIN, paddingTop: SPACE[2], paddingBottom: SPACE[3] },
  reset: {
    minHeight: MIN_TOUCH_TARGET, alignSelf: 'center', justifyContent: 'center',
    paddingHorizontal: SPACE[4], borderRadius: RADII.pill,
  },
  resetLabel: { ...TYPE.label, color: colors.ink },
}));
