# Task 6 Report — Grow hero differentiation per roxy-home-v1 peg

**Status:** Done
**Commit:** `136819c` — style(grow): peg-exact hero split — Roxy bubble vs compact happening card

## What changed

### `apps/mobile/app/(tabs)/grow/index.tsx` — Zone 1 Roxy Hero
Replaced the full-gradient `LinearGradient` hero card with a flat section on the
screen background. The gradient ring + sparkles icon is preserved on the avatar
(now the brand gradient itself, since it no longer sits atop a gradient hero).
Greeting message moved into a `surface`-colored speech-bubble card (radius 18,
border `roxy + '22'`). Below the row: a compact self-sizing gradient pill "✦ Ask
Roxy" (minHeight 44, paddingHorizontal 22, hugs content — not full width) next to
a round ghost mic button (surface bg, roxy-colored icon). Routes, handlers
(`router.push('/(tabs)/grow/roxy-chat')`), and the `greetingLoading` branch are
byte-identical in behavior — only re-homed into the bubble. Removed now-unused
styles: `rhTop`, `rhName`, `rhBadge`, `slideRow`-equivalent hero wrapper
gradient; added `rhRow`, `rhBubble`.

Text sketch:
```
 ⬤(56, gradient ring+✦)   ┌─────────────────────────────┐
                          │ Good morning, Jo 🌸  (surface│
                          │ bubble, roxy+22 border)      │
                          └─────────────────────────────┘
 [✦ Ask Roxy]  (◎ mic)
 (gradient pill,           (ghost circle,
  44 min-h, hug-content)    surface bg)
```

### `apps/mobile/components/grow/HappeningTonightCard.tsx` — slide layout only
Reworked `renderSlide`'s JSX from `slideRow` + `slideBottom` wrapper into one
flat row: `iconPlate` (44px, was 52) — `middleCol` (flex 1, vertically centered:
pill label, 1-line title @16.5, 1-line meta) — `rightCol` (alignItems flex-end,
justifyContent space-between: countdown/LIVE pill on top, "Join now" pill
at the bottom, minHeight 36/paddingHorizontal 16, was 40/20). Countdown digit
boxes shrunk to 14px font (was 16), tighter padding/labels. `slide` minHeight
104 (was 148), paddings tightened to 12–14 (was 16/14). Dots row, data loading,
auto-advance interval, and `openItem` navigation untouched.

Text sketch:
```
┌───────────────────────────────────────────────────────────┐
│ ⬤44  HAPPENING TONIGHT                    STARTS IN        │
│ icon  Speed Dating Round               [04]:[46]:[21]      │
│       7:00 PM · Community                 HRS MIN SEC      │
│                                          (Join now)         │
└───────────────────────────────────────────────────────────┘
   minHeight ~104, brand gradient card unchanged (outer only)
```
Live/room variant swaps the countdown block for a LIVE pill, right-aligned
same as before.

## QA loop (from apps/mobile)
- `npx eslint . --ext .ts,.tsx --max-warnings 0` → clean, 0 warnings.
- `npx tsc --noEmit` → 0 errors.
- `npx jest --ci --passWithNoTests` → 58 suites / 348 tests passed (baseline 348, matched — includes `__tests__/components/grow/HappeningTonightCard.test.tsx`).

## Concerns
- `apps/studio/package-lock.json` had a pre-existing uncommitted modification unrelated to this task; left untouched and unstaged per "never edit files outside your task's scope."
- Verified only against tsc/eslint/jest — did not run a visual/simulator pass against the peg image beyond manual layout reasoning (no `run`/screenshot tool invoked this task). Recommend a quick Expo web preview before merge to confirm the bubble/pill proportions read correctly against `docs/brand/roxy-home-v1-light.jpeg`.

## Follow-up fix: iOS shadow rendering (session-25-subagent-batch)
- **File:** `apps/mobile/app/(tabs)/grow/index.tsx` line 278
- **Change:** Removed `overflow: 'hidden',` from `rhBtn` style (clips iOS shadow; borderRadius handles corner clipping)
- **QA:** `npx tsc --noEmit` ✓ | `npx eslint "app/(tabs)/grow/index.tsx" --max-warnings 0` ✓
