import { Image as ExpoImage } from 'expo-image';
import { NO_TRANSITION, IMAGE_CACHE } from '../../lib/imageLoading';
import { View, Text, StyleSheet } from 'react-native';
import { initialsOf } from '../ui/Avatar';
import { identityFor, inkOn } from '../../lib/theme';
import { FONTS } from '../../lib/typography';

/** Crests are squircles at 28% of their size (direction › Spacing, radius). */
export const CREST_RADIUS_RATIO = 0.28;

/** The initials take a bit over a third of the crest, like the v2 boards. */
const INITIALS_RATIO = 0.36;

interface Props {
  /** The community's name: its initials when there is no uploaded crest. */
  name: string;
  /** A stable id for the identity colour. Falls back to the name. */
  seed?: string | null;
  /** An uploaded crest or avatar image, shown instead of the initials. */
  uri?: string | null;
  size: number;
  testID?: string;
}

/**
 * A community's crest (design direction v2 › Color, identity fields): a
 * squircle in the community's identity colour carrying its initials in
 * Geologica, or the crest the community uploaded. Never a gradient, never a
 * generic icon: the initials are what tell "Lagos Sapphic Readers" from
 * "Late Bloomers" at a glance. Ink is `inkOn(fill)` (`onBrandPink` on every
 * identity colour, ≥ 4.96:1).
 *
 * Used by Discover's community rows, the Messages Communities group, the
 * community header and the Communities list.
 */
export function Crest({ name, seed, uri, size, testID }: Props) {
  const fill = identityFor(seed ?? name);
  const box = {
    width: size,
    height: size,
    borderRadius: Math.round(size * CREST_RADIUS_RATIO),
  };
  if (uri) {
    return (
      <ExpoImage
        transition={NO_TRANSITION}
        cachePolicy={IMAGE_CACHE}
        source={{ uri }}
        style={[s.image, box] as never}
        contentFit="cover"
        testID={testID ? `${testID}-photo` : undefined}
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View style={[box, s.field, { backgroundColor: fill }]} testID={testID}>
      <Text
        style={[
          s.initials,
          { color: inkOn(fill), fontSize: Math.round(size * INITIALS_RATIO) },
        ]}
        allowFontScaling={false}
        numberOfLines={1}
      >
        {initialsOf(name)}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  field: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  image: { overflow: 'hidden' },
  initials: { fontFamily: FONTS.display.extrabold },
});
