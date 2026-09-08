import { View, Text, StyleSheet } from 'react-native';
import { THEMES, RADII, inkOn } from '../../lib/theme';
import { TYPE } from '../../lib/typography';

/** The values `events.event_type` actually stores. */
export type EventMode = 'online' | 'in_person' | 'hybrid';

/**
 * The word for each mode.
 *
 * `hybrid` gets its own word rather than being folded into one of the other two.
 * Calling a hybrid event "ONLINE" sends a woman to bed for something there was a
 * room full of people at; calling it "IN PERSON" sends her across London for
 * something she could have opened. Neither is a rounding error.
 */
export function eventModeLabel(mode: EventMode): string {
  if (mode === 'online') return 'ONLINE';
  if (mode === 'hybrid') return 'BOTH';
  // Anything unexpected reads as in-person, the answer that assumes least about
  // a row we do not understand — and never an empty pill.
  return 'IN PERSON';
}

function spoken(mode: EventMode): string {
  if (mode === 'online') return 'Online event';
  if (mode === 'hybrid') return 'Both online and in person';
  return 'In person event';
}

/**
 * IN PERSON / ONLINE / BOTH.
 *
 * Whether an event is something you travel to or something you open is the most
 * consequential fact on the card — it decides whether she books a train — so it
 * is always a word. The colour pairing (in-person pink, online lilac) is a
 * second signal layered on top, never the only one.
 *
 * `THEMES.dark` fills are used in both themes: the badge sits on cover art,
 * which is dark whatever the app's theme is, and `inkOn()` picks its own ink.
 */
export function EventModeBadge({ mode }: { mode: EventMode }) {
  const fill = mode === 'online'
    ? THEMES.dark.secondary
    : mode === 'hybrid'
      ? THEMES.dark.gold
      : THEMES.dark.primary;

  return (
    <View
      testID="event-mode-badge"
      style={{ ...s.badge, backgroundColor: fill }}
      accessibilityLabel={spoken(mode)}
    >
      <Text testID="event-mode-badge-text" style={[s.text, { color: inkOn(fill) }]}>
        {eventModeLabel(mode)}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: RADII.pill,
  },
  text: { ...TYPE.micro, fontWeight: '800' },
});
