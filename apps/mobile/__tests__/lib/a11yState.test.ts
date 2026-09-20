import { a11yState } from '../../lib/a11yState';

/**
 * The bug this file exists for.
 *
 * `accessibilityState={{ selected }}` is the React Native API, and on iOS and
 * Android it is correct. On react-native-web 0.19 it renders NOTHING — no
 * `aria-selected`, no `aria-expanded`, in either state. Verified in the running
 * web build: the focused tab came out as
 * `<div role="tab" tabindex="0" aria-label="Feed">` with no selected state at
 * all, which is a WCAG 2.2 SC 4.1.2 failure — a tablist where assistive tech
 * cannot tell which tab is current.
 *
 * RNW documents its own flattened `accessibility*` props instead, and both
 * React Native 0.74 and RNW 0.19 accept the `aria-*` props. So `aria-*` is the
 * one spelling that lands on every platform, and this helper emits it —
 * alongside `accessibilityState`, which stays because it is still the native
 * API and is what the component tests query.
 *
 * src: https://necolas.github.io/react-native-web/docs/accessibility/ · react-native-web 0.19.13 · 2026-08-19
 * src: https://reactnative-archive-august-2025.netlify.app/docs/0.74/accessibility · react-native 0.74.5 · 2026-08-19
 */
describe('a11yState', () => {
  it('emits the aria prop the web build actually reads', () => {
    expect(a11yState({ selected: true })).toEqual({
      accessibilityState: { selected: true },
      'aria-selected': true,
    });
  });

  it('emits false states rather than dropping them', () => {
    // A tab that is not selected has to SAY it is not selected. Omitting the
    // attribute is what the broken path already did, and it reads to a screen
    // reader as "no such state", not as "off".
    expect(a11yState({ selected: false })).toEqual({
      accessibilityState: { selected: false },
      'aria-selected': false,
    });
  });

  it.each([
    ['expanded', 'aria-expanded'],
    ['checked', 'aria-checked'],
    ['disabled', 'aria-disabled'],
    ['busy', 'aria-busy'],
  ] as const)('maps %s to %s', (key, aria) => {
    const out = a11yState({ [key]: true });
    expect(out).toHaveProperty(aria, true);
    expect(out.accessibilityState).toEqual({ [key]: true });
  });

  it('carries every key of a compound state', () => {
    expect(a11yState({ disabled: true, busy: true })).toEqual({
      accessibilityState: { disabled: true, busy: true },
      'aria-disabled': true,
      'aria-busy': true,
    });
  });

  it('passes a mixed checkbox through unchanged', () => {
    // `checked` is the one key whose type is not boolean. Coercing it would
    // turn a partially-selected group into a plain "checked".
    expect(a11yState({ checked: 'mixed' })).toEqual({
      accessibilityState: { checked: 'mixed' },
      'aria-checked': 'mixed',
    });
  });

  it('emits nothing for a key that was not asked for', () => {
    const out = a11yState({ selected: true });
    expect(out).not.toHaveProperty('aria-disabled');
    expect(out).not.toHaveProperty('aria-checked');
    expect(out).not.toHaveProperty('aria-expanded');
    expect(out).not.toHaveProperty('aria-busy');
  });

  it('returns only the accessibilityState envelope for an empty state', () => {
    expect(a11yState({})).toEqual({ accessibilityState: {} });
  });
});
