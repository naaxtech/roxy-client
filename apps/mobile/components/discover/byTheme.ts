import type { ThemeColors } from '../../lib/theme';

/**
 * A theme-dependent style factory, built once per theme (jank audit #8).
 *
 * `const styles = byTheme((colors) => StyleSheet.create({ … }))` — then
 * `styles(colors)` in a render returns the same sheet every time for the same
 * theme object (`THEMES.light` / `THEMES.dark` are module constants), instead
 * of compiling every style object to atomic CSS again on react-native-web.
 */
export function byTheme<T>(factory: (colors: ThemeColors) => T): (colors: ThemeColors) => T {
  const cache = new WeakMap<ThemeColors, T>();
  return (colors) => {
    let sheet = cache.get(colors);
    if (sheet === undefined) {
      sheet = factory(colors);
      cache.set(colors, sheet);
    }
    return sheet;
  };
}
