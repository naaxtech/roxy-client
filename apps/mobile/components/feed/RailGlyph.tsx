import type { ComponentProps, ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RAIL_OUTLINE } from './feedChromeTokens';

/**
 * A white rail glyph or count with a drawn 1 dp dark outline (direction v2:
 * the rail has no plates). Four copies in `RAIL_OUTLINE.color`, offset one
 * outline-width up, down, left and right, sit under the white one, so every
 * edge of the glyph meets solid dark pixels whatever the photo behind it is.
 * A text shadow cannot promise that (WCAG has no way to score a blur), which
 * is why `feedChromeContrast.test.ts` scores this outline and not the shadow.
 */
const W = RAIL_OUTLINE.width;
/** Each copy shifted by one outline width; right/bottom follow so widths match. */
const OFFSETS = [
  { left: -W, right: W, top: 0, bottom: 0 },
  { left: W, right: -W, top: 0, bottom: 0 },
  { left: 0, right: 0, top: -W, bottom: W },
  { left: 0, right: 0, top: W, bottom: -W },
] as const;

type IconName = ComponentProps<typeof Ionicons>['name'];

export function OutlinedIcon({
  name, size, color = '#fff', testID,
}: { name: IconName; size: number; color?: string; testID?: string }): ReactElement {
  return (
    <View
      testID={testID}
      style={{ width: size, height: size }}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {OFFSETS.map((o) => (
        <View key={`${o.left}:${o.top}`} style={[s.layer, o]}>
          <Ionicons name={name} size={size} color={RAIL_OUTLINE.color} />
        </View>
      ))}
      <View style={[s.layer, s.flush]}>
        <Ionicons name={name} size={size} color={color} />
      </View>
    </View>
  );
}

export function OutlinedText({
  children, style, testID,
}: { children: string; style?: StyleProp<TextStyle>; testID?: string }): ReactElement {
  return (
    <View>
      <View
        style={StyleSheet.absoluteFill}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {OFFSETS.map((o) => (
          <Text
            key={`${o.left}:${o.top}`}
            style={[style, s.copy, o, { color: RAIL_OUTLINE.color }]}
            numberOfLines={1}
          >
            {children}
          </Text>
        ))}
      </View>
      <Text testID={testID} style={style} numberOfLines={1}>{children}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  copy: { position: 'absolute' },
  layer: { position: 'absolute' },
  flush: { left: 0, right: 0, top: 0, bottom: 0 },
});
