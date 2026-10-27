import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Sheet } from '../feedback/Sheet';
import { Skeleton, SkeletonGroup } from '../feedback/Skeleton';
import { TouchableOpacity } from '../ui/PressableScale';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII, SPACE, MARGIN, type ThemeColors } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { CITY_QUERY_MAX, CITY_QUERY_MIN, GEONAMES_ATTRIBUTION, cityLabel, searchCities, type CityOption } from '../../lib/nearby';
import type { ChosenCity } from '../../lib/nearbyPrefs';
import { byTheme } from '../discover/byTheme';

/** She pauses this long before the search goes out: one request per pause, not per letter. */
export const CITY_SEARCH_DEBOUNCE_MS = 300;
/** The search field matches Discover's search pill. */
const FIELD_HEIGHT = 52;
/** A city row: one line of "City, Region, Country", 56 dp (direction › rows 56 / 64 / 72). */
const ROW_MIN = 56;
const SKELETON_ROWS = 4;

type Status = 'idle' | 'loading' | 'ready' | 'error';

/**
 * How the sheet offers her location instead of a city:
 *  - `ask`: she has not said no. "Use my location instead" (her tap asks).
 *  - `settings`: she said no, on a phone. Only "Turn on location in
 *    Settings", which opens the app's Settings page and asks nothing.
 *  - `none`: she said no and there is no Settings page to send her to (web).
 */
export type CityPickerLocationOffer = 'ask' | 'settings' | 'none';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** She picked a city: its id and the words to show for it. */
  onChoose: (city: ChosenCity) => void;
  location: CityPickerLocationOffer;
  onUseLocation: () => void;
  onOpenSettings: () => void;
}

/**
 * "Choose a city" (spec › Client): `search_cities` from two characters,
 * debounced, with answers to a superseded search dropped. Results read
 * "City, Region, Country". Her location is offered at the top, so the
 * keyboard never covers it, and only in a way that cannot re-ask after she
 * said no (`location`, spec › Safety 2: "asks no more"). The GeoNames credit
 * (CC BY 4.0) sits under the results.
 *
 * What she types goes only into the RPC (POST, never logged) and is cleared
 * each time the sheet opens. The sheet keeps one height while she types, so
 * results arriving never move the field under her thumb.
 */
export function CityPickerSheet({ visible, onClose, onChoose, location, onUseLocation, onOpenSettings }: Props) {
  const colors = useThemeColors();
  const s = styles(colors);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [rows, setRows] = useState<CityOption[]>([]);
  const latest = useRef(0);

  const run = useCallback(async (q: string) => {
    const mine = ++latest.current;
    setStatus('loading');
    const result = await searchCities(q);
    if (mine !== latest.current) return;
    if (result === null) {
      setStatus('error');
      return;
    }
    setRows(result);
    setStatus('ready');
  }, []);

  // A fresh field every time she opens it.
  useEffect(() => {
    if (!visible) return;
    latest.current += 1;
    setQuery('');
    setRows([]);
    setStatus('idle');
  }, [visible]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < CITY_QUERY_MIN) {
      latest.current += 1;
      setRows([]);
      setStatus('idle');
      return undefined;
    }
    const timer = setTimeout(() => { void run(q); }, CITY_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, run]);

  let body;
  if (status === 'idle') {
    body = <Text style={s.note} testID="city-picker-hint">Type at least two letters of the city.</Text>;
  } else if (status === 'loading') {
    body = (
      <SkeletonGroup testID="city-picker-loading" accessibilityLabel="Searching cities">
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <View key={i} style={s.row}>
            <Skeleton radius={RADII.pill} style={s.skeletonLine} />
          </View>
        ))}
      </SkeletonGroup>
    );
  } else if (status === 'error') {
    body = (
      <View style={s.state} testID="city-picker-error">
        <Text style={s.note}>Couldn’t search cities. Check your connection and try again.</Text>
        <TouchableOpacity
          onPress={() => void run(query.trim())}
          accessibilityRole="button"
          accessibilityLabel="Try searching again"
          style={s.quietPill}
        >
          <Text style={s.quietLabel}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  } else if (rows.length === 0) {
    body = (
      <Text style={s.note} testID="city-picker-empty">
        No cities start with that. Check the spelling, or try the nearest bigger city.
      </Text>
    );
  } else {
    body = rows.map((c) => {
      const label = cityLabel(c);
      return (
        <TouchableOpacity
          key={c.id}
          onPress={() => onChoose({ id: c.id, label })}
          accessibilityRole="button"
          accessibilityLabel={label}
          feedback="layer"
          style={s.row}
          testID={`city-option-${c.id}`}
        >
          <Text style={s.rowText} numberOfLines={2}>{label}</Text>
        </TouchableOpacity>
      );
    });
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      accessibilityLabel="Choose a city"
      testID="city-picker"
      style={s.sheet}
    >
      <Text style={s.title} accessibilityRole="header">Choose a city</Text>
      {location === 'ask' ? (
        <TouchableOpacity
          onPress={onUseLocation}
          accessibilityRole="button"
          accessibilityLabel="Use my location instead"
          feedback="layer"
          style={s.locationRow}
          testID="city-use-location"
        >
          <Ionicons name="locate-outline" size={SPACE[5]} color={colors.ink2} accessibilityElementsHidden importantForAccessibility="no" />
          <Text style={s.rowText}>Use my location instead</Text>
        </TouchableOpacity>
      ) : null}
      {location === 'settings' ? (
        <TouchableOpacity
          onPress={onOpenSettings}
          accessibilityRole="button"
          accessibilityLabel="Open Settings to turn on location"
          accessibilityHint="Opens Roxy's page in your phone's Settings"
          feedback="layer"
          style={s.locationRow}
          testID="city-open-settings"
        >
          <Ionicons name="settings-outline" size={SPACE[5]} color={colors.ink2} accessibilityElementsHidden importantForAccessibility="no" />
          <Text style={s.rowText}>Turn on location in Settings</Text>
        </TouchableOpacity>
      ) : null}
      <View style={s.fieldWrap}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search for a city"
          placeholderTextColor={colors.ink3}
          accessibilityLabel="Search for a city"
          autoCorrect={false}
          autoCapitalize="words"
          autoComplete="off"
          returnKeyType="search"
          maxLength={CITY_QUERY_MAX}
          style={s.field}
          testID="city-picker-input"
        />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.results}>
        {body}
      </ScrollView>
      <Text style={s.credit} testID="city-picker-attribution">{GEONAMES_ATTRIBUTION}</Text>
    </Sheet>
  );
}

// Built once per theme, not on every render (jank audit #8).
const styles = byTheme((colors: ThemeColors) => StyleSheet.create({
  sheet: { height: '75%', gap: SPACE[2], paddingTop: SPACE[1] },
  title: { ...TYPE.title, color: colors.ink, paddingHorizontal: MARGIN },
  locationRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACE[2],
    minHeight: MIN_TOUCH_TARGET, paddingHorizontal: MARGIN,
  },
  fieldWrap: { paddingHorizontal: MARGIN },
  field: {
    ...TYPE.body, color: colors.ink,
    height: FIELD_HEIGHT, paddingHorizontal: SPACE[4],
    borderRadius: RADII.pill, backgroundColor: colors.raised,
  },
  results: { paddingBottom: SPACE[6] },
  row: { minHeight: ROW_MIN, justifyContent: 'center', paddingHorizontal: MARGIN },
  rowText: { ...TYPE.body, color: colors.ink, flexShrink: 1 },
  skeletonLine: { height: SPACE[2], width: '70%' },
  state: { paddingHorizontal: MARGIN, gap: SPACE[2], alignItems: 'flex-start' },
  note: { ...TYPE.body, color: colors.ink2, paddingHorizontal: MARGIN, paddingVertical: SPACE[2] },
  quietPill: {
    minHeight: MIN_TOUCH_TARGET, justifyContent: 'center',
    paddingHorizontal: SPACE[4], borderRadius: RADII.pill, backgroundColor: colors.raised,
  },
  quietLabel: { ...TYPE.label, color: colors.ink },
  credit: { ...TYPE.meta, color: colors.ink3, paddingHorizontal: MARGIN, paddingBottom: SPACE[2] },
}));
