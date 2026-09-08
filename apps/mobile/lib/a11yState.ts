/**
 * One spelling of accessibility state that lands on every platform Roxy ships.
 *
 * `accessibilityState={{ selected }}` is the React Native API and is correct on
 * iOS and Android. On react-native-web 0.19 it is INERT: the DOM comes out with
 * no `aria-selected` and no `aria-expanded`, in either state. That was verified
 * in the running web build, not inferred — the focused tab rendered as
 * `<div role="tab" tabindex="0" aria-label="Feed">`, a tablist in which nothing
 * tells assistive technology which tab is current. WCAG 2.2 SC 4.1.2.
 *
 * RNW documents its own flattened `accessibility*` props instead of the state
 * object, so the two libraries disagree about the shape. What they agree on is
 * `aria-*`: React Native has accepted those as aliases since 0.71 and RNW reads
 * them natively. So this helper emits `aria-*` — and keeps `accessibilityState`
 * beside it, because that is still the native API and the one the component
 * tests query. Both carry the same value, so there is nothing to conflict.
 *
 * Spread it, do not nest it:
 *
 *     <TouchableOpacity {...a11yState({ selected: isFocused })} />
 *
 * src: https://necolas.github.io/react-native-web/docs/accessibility/ · react-native-web 0.19.13 · 2026-08-19
 * src: https://reactnative-archive-august-2025.netlify.app/docs/0.74/accessibility · react-native 0.74.5 · 2026-08-19
 */

/** The subset of `AccessibilityState` this app actually expresses. */
export type A11yState = {
  selected?: boolean;
  expanded?: boolean;
  /** `'mixed'` is a real value for a partially-selected group, not a boolean. */
  checked?: boolean | 'mixed';
  disabled?: boolean;
  busy?: boolean;
};

export type A11yStateProps = {
  accessibilityState: A11yState;
  'aria-selected'?: boolean;
  'aria-expanded'?: boolean;
  'aria-checked'?: boolean | 'mixed';
  'aria-disabled'?: boolean;
  'aria-busy'?: boolean;
};

const ARIA_NAME = {
  selected: 'aria-selected',
  expanded: 'aria-expanded',
  checked: 'aria-checked',
  disabled: 'aria-disabled',
  busy: 'aria-busy',
} as const satisfies Record<keyof A11yState, string>;

export function a11yState(state: A11yState): A11yStateProps {
  const props: A11yStateProps = { accessibilityState: state };

  for (const key of Object.keys(state) as (keyof A11yState)[]) {
    const value = state[key];
    // `undefined` means "this element has no such state", which is not the same
    // claim as `false`. Only the explicit false is worth announcing; the absent
    // key is exactly what the broken path already produced.
    if (value === undefined) continue;
    Object.assign(props, { [ARIA_NAME[key]]: value });
  }

  return props;
}
