import { Text, TextInput } from 'react-native';
import { FONTS } from './typography';

type WithDefaults = { defaultProps?: { style?: unknown } };

/**
 * Figtree is the Claude Design UI face. Outfit is display only.
 *
 * React Native will not pick a custom family from `fontWeight` alone, so a
 * label that only sets weight silently falls back to the system face and the
 * prototype's type never shows up. Setting the default once means every Text
 * that does not name a family inherits Figtree; titles that set Outfit still
 * win because their style is more specific.
 */
export function applyBrandType(): void {
  const text = Text as typeof Text & WithDefaults;
  const input = TextInput as typeof TextInput & WithDefaults;
  text.defaultProps = {
    ...text.defaultProps,
    style: [{ fontFamily: FONTS.text.regular }, text.defaultProps?.style],
  };
  input.defaultProps = {
    ...input.defaultProps,
    style: [{ fontFamily: FONTS.text.regular }, input.defaultProps?.style],
  };
}
