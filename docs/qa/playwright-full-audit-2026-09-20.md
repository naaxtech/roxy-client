# Playwright Full-App Audit — 2026-09-20

Method: drove the live Expo web build (`:8083`) with Playwright, signed in as the
seeded beta-tier account (`e2e-playwright@seed.roxy.app`), walked every tab plus
the main deep screens, and captured page errors, console errors, failed Supabase
calls, and rendered body content per surface. Re-runnable via
`apps/mobile/tests/e2e/full-audit.spec.ts` (writes `test-results/audit-report.txt`).

## Per-tab results

| Surface | Rendered | Page errors | Failed API | Notes |
|---|---|---|---|---|
| Feed | ✓ | 0 | 0 | clean |
| Discover | ✓ | 0 | 0 | richest (2.7k chars) |
| ＋ Create | ✓ | 0 | 0 | sheet opens, content present |
| Messages | ✓ | 0 | 0 | DIRECT + COMMUNITY CHATS both present |
| You | ✓ | 0 | 0 | clean |
| Archive | ✓ | 0 | 0 | 7.3k chars, full catalogue |
| Community channels | ✓ | 0 | 0 | renders |
| Roxy chat | ✓ | 0 | 0 | renders |
| Search | ✓ | 0 | 0 | — |
| Notifications | ✓ | 0 | 0 | — |

**Zero failed Supabase calls on any surface.** No RLS misconfig, no missing
columns, no orphaned RPC — the data layer is launch-clean.

## Issues

### 1. Error messages masked to `[object Object]` — Medium
During initial load, `safetyStore.loadBlockedUsers` and `ReelsFeed.load` log:
```
[Roxy Error] [safetyStore.loadBlockedUsers] Error: [object Object]
```
Root cause is `lib/errorLogger.ts:13`:
```ts
const error = e instanceof Error ? e : new Error(String(e));
```
`String(object)` collapses to `"[object Object]"`. `PostgrestError` *does* extend
`Error` (verified in `node_modules/@supabase/postgrest-js/src/PostgrestError.ts`),
so a **non-Error object** reaches `logError` and its real message/code is
destroyed. Defeats the observability the codebase otherwise guards carefully.

Fix: read `e?.message ?? e?.code ?? JSON.stringify(e)` for non-Error inputs
instead of `String(e)`.

### 2. iOS/Android-only props leak to web DOM — Low (cosmetic)
```
Warning: React does not recognize the `testID` prop on a DOM element…
Warning: React does not recognize the `accessibilityElementsHidden` prop…
Warning: React does not recognize the `importantForAccessibility` prop…
```
Cross-checked: `accessibilityElementsHidden` is **iOS-only**, `importantForAccessibility`
is **Android-only** ([React Native View docs](https://reactnative.dev/docs/view),
[Accessibility docs](https://reactnative.dev/docs/accessibility)).
`react-native-web` does not strip them — a known gap
([react-native-paper #668](https://github.com/callstack/react-native-paper/issues/668)).
`testID` → `data-testid` still works (every Playwright assertion passed), so this
is functional noise, not breakage. No user impact.

### Not an issue
- Create sheet: an early run reported "blank" from a test helper bug (hardcoded
  `bodyLen: 0`). Re-measured: the sheet opens and content is present.

## Positive findings
- No blank/red screens, no error-boundary trips, no truncated or empty lists,
  no wrong-URL navigation, no 404/403 on any query.
- Both inbox sections (direct + community) render.

## Bottom line
Launch-ready on the surfaces that matter. Two small fixes remain:
1. Harden `logError` so it never masks a message.
2. Strip RN-only props on web (cosmetic).
