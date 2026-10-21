# Proposed tokens v2: replacement for `polish/rules/CLAUDE.md` › "## Proposed tokens"

Status: PROPOSED v2 — awaiting Nicole's approval (2026-10-21).

Why this file exists: the brief asked the Art Director to replace the "## Proposed tokens" section of `polish/rules/CLAUDE.md` with v2. Writing to `CLAUDE.md` was blocked for this agent (protected agent-instruction file, no consent), so the replacement is staged here verbatim. Whoever has permission replaces everything from `## Proposed tokens (PROPOSED, not yet in theme.ts)` to the end of `polish/rules/CLAUDE.md` with the section below (from the `##` line down). Nothing else in `CLAUDE.md` changes.

---

## Proposed tokens (PROPOSED v2, not yet in theme.ts)

From `polish/design-direction.md` v2 (status PROPOSED v2, 2026-10-21; the v1 table is in git at 0475cf3). Do not use until Nicole approves the direction; until then `theme.ts` and the feed/nav/archive token files stay the only source. Light is the default theme and is listed first. Contrast for every pair is measured in the direction's Color section (91 pairs). Board reference implementation: `polish/concepts/roxy-tokens-v2.css`. "Replaces" names the existing key whose role the token takes; NEW means no current key.

### Colour (light / dark)

| Proposed token | Light (default) | Dark | Replaces (file · key) |
|---|---|---|---|
| `ground` | #F6F3F2 | #141113 | theme.ts · `background` |
| (retired) | — | — | theme.ts · `backgroundAlt` (one ground; screens that used it take `ground`) |
| `surface` | #FFFDFD | #1E1A1C | theme.ts · `surface` |
| `raised` | #ECE7E6 | #2A2528 | theme.ts · `surfaceLight` / `elevated()` |
| `line` | #E0D9D8 | #3A3337 | theme.ts · `line` |
| `control` | #8C8186 | #6E6469 | theme.ts · `lineStrong` |
| `ink` / `ink2` / `ink3` | #1A1216 / #544A4F / #675C61 | #F7F2F4 / #C3B8BD / #A1959B | theme.ts · `textPrimary` / `textSecondary` / `textMuted` |
| `pink` (the one action) | #C8126A | #F22481 | theme.ts · `primary` (light #D81368 → #C8126A) |
| `onPink` | #FFFFFF | #17080F | theme.ts · `BRAND_INK` (#1A0A2E) on pink |
| `pinkInk` (pink text, links) | #C8126A (= `pink`) | #FF6FA6 | theme.ts · `primaryInk` |
| `pinkLip` (3 dp lip under the primary button) | #8E0C4A | #A5145A | NEW |
| `pinkContainer` | #FFD9E7 | #5A1236 | NEW (nav pill, selected chip, her reaction disc, her chat bubbles, discreet banner, tonal Join) |
| `onPinkContainer` | #5C0A31 | #FFD9E7 | NEW (never `pink` text on `pinkContainer`: 4.35:1) |
| `brandPink` / `onBrandPink` | #F22481 / #17080F | same | NEW (brand field, Roxy O ring on the stage); `onBrandPink` also inks every identity fill (replaces `BRAND_INK`) |
| `inverse` / `onInverse` / `inversePink` | #2B2427 / #F7F2F4 / #FF9EC3 | #F1ECEA / #1A1216 / #C8126A | NEW (snackbars and their Undo) |
| `premium` / `onPremium` | #F2C94C / #1A1216 | same | NEW (Premium tag and lock badge only) |
| (retired) | — | — | theme.ts · `secondary`, `secondaryInk` (lilac; violet is banned) |
| `warning` (also streak) / `warningInk` | #B07A10 / #8A5E06 | #F2B33D / #F6C766 | theme.ts · `gold`, `warning` / `goldInk` |
| `success` / `successInk` | #177A47 / #13703F | #3CCB86 / #62DBA0 | theme.ts · `success` / `successInk` |
| `danger` / `dangerInk` | #C8262C / #B21F25 | #FF5D5D / #FF7B7B | theme.ts · `error` / `errorInk` |
| `sister` / `sisterInk` | #4F6B7C / #3E5868 | #9FB6C4 / #B9CBD6 | theme.ts · `sister` / `sisterInk` |
| `roxy` (the Roxy O ring) | = `pink` (`brandPink` on the stage) | #F22481 | theme.ts · `roxy` |
| `live` (dot, always with the word) | #E8481E | #FF5A2E | theme.ts · `LIVE_GRADIENT` (retired; flat dot) |
| `BRAND_GRADIENT` | #FF5A2E → #F22481 → #E0189A, wordmark and app icon only | same | theme.ts · `BRAND_GRADIENT` (value kept, use narrowed; navTokens/feedChromeTokens re-exports stop being used by Create and the FAB) |
| `stage` / `stageRaised` | #0B0A0A / #262124 | same (always dark) | NEW (feed stage; active nav pill on the Feed) |
| `fieldInk` / `fieldPaper` / `brandPink` | #151113 / #F3F1F0 / #F22481 | same | NEW (text-post fields); feedChromeTokens · `BRAND_VEIL` retired |
| `identity`: pink, tangerine, butter, sage, sky, rose | #F22481, #FF7A45, #F2C94C, #8FC4A0, #8FB8DE, #E8A0BF | same | theme.ts · `COMMUNITY_CHIP_COLORS` (violet #7B45F5 removed); also fallback archive covers |
| `scrim` | 0.62 → 0.88 black, dp-anchored | same | feedChromeTokens · `MEDIA_SCRIM_*` (kept) |
| rail plate | none (white glyph + 1 dp dark outline-shadow) | same | feedChromeTokens · `RAIL_BACKING`, `RAIL_BACKING_ALPHA` (retired; `CHROME_SHADOW` kept) |
| `devPanel` | unchanged | unchanged | theme.ts · `devPanel` (not a product colour) |

### Type

| Proposed token | Value | Replaces |
|---|---|---|
| `FONTS.display` | Geologica 700, 800 (`@expo-google-fonts/geologica` 0.4.2) | typography.ts · `FONTS.display` (Outfit 600–800) |
| `FONTS.text` | Commissioner 400, 500, 600 (`@expo-google-fonts/commissioner` 0.4.1) | typography.ts · `FONTS.text` (Figtree) |
| `FONTS.mono` | IBM Plex Mono 500 (`@expo-google-fonts/ibm-plex-mono` 0.4.1) | NEW (codes only) |
| `FONTS_BY_SCRIPT` | latin, vietnamese, cyrillic, greek → brand faces; arabic → Noto Sans Arabic 400/600/700; hebrew → Noto Sans Hebrew 400/600/700; devanagari → Noto Sans Devanagari 400/600/700; thai → Noto Sans Thai 400/600/700; CJK and every other script → the system font | NEW (UI picks by app language; member content by its first strong character) |
| `TYPE.meta` | Commissioner 500 12/16 (emphasized 600) | typography.ts · `micro` (10) and `caption` (12) merge |
| `TYPE.body` | Commissioner 400 15/22 (emphasized 600) | typography.ts · `body` (13/19) and `bodyLg` (15/22) merge |
| `TYPE.label` / `TYPE.button` | Commissioner 600 15/20 · 16/20 | typography.ts · `label` |
| `TYPE.title` | Geologica 700 20/24, -0.2 (emphasized 800) | typography.ts · `title` (17/22) |
| `TYPE.headline` | Geologica 800 28/32, -0.4 | typography.ts · `headline` (21/27) |
| `TYPE.display` | Geologica 800 40/42, -0.8 | typography.ts · `display` (28/33) |
| `TYPE.moment` | Geologica 800 56/56, -1.4 | NEW |
| `TYPE.mono` | Plex Mono 500 13/18, +0.5 | NEW |
| `LEADING_BY_SCRIPT` (body) | base 22; vietnamese 24; arabic 16/26; devanagari, thai 26; CJK 24; burmese, telugu +30% | NEW; tracking 0 and no uppercase or italics outside Latin, Cyrillic, Greek |

### Space, radius, elevation, shape

| Proposed token | Value | Replaces |
|---|---|---|
| `SPACE` | 4, 8, 12, 16, 20, 24, 32, 48, 64 | NEW |
| `MARGIN` | 16 (20 on text posts) | NEW |
| `RADII.sm` | 8 | theme.ts · `RADII.sm` (10) |
| `RADII.press` | 12 (press-morph target, Create key) | NEW |
| `RADII.md` | 20 | theme.ts · `RADII.md` (15) and `RADII.lg` (18) merge |
| `RADII.sheet` | 28 | theme.ts · `RADII.sheet` (26) |
| `RADII.pill` | 999 | theme.ts · `RADII.pill` |
| `CREST_RADIUS_RATIO` | 0.28 × crest size | NEW |
| `ELEVATION.float` | light 0 10 28 rgba(26,18,22,.16) + 0 2 6 rgba(26,18,22,.10); dark 0 10 28 rgba(0,0,0,.5) | NEW (FAB, reaction picker, menus, snackbars) |
| `ELEVATION.pop` | 0 -2 10 rgba(26,18,22,.10) over the scrim | NEW (sheets; tone does the lift) |
| `LIP` | 3 dp hard offset in `pinkLip`, no blur | NEW (the one primary button) |
| `CARD_EDGE` | 6 dp hard offset rgba(23,8,15,.18), no blur | NEW (the "You're in" membership card only) |
| `SHAPES` | circle, pill, rounded square, 2:3 cover, 16-point burst (RSVP seal only); no petal, clover or cookie shapes | NEW |

### Motion and haptics

Reanimated: `withSpring(v, { mass: 1, stiffness, damping })`. Never pass `dampingRatio` without `duration` in 3.10: it switches to the duration-based spring (default 2000 ms).

| Proposed token | stiffness / damping (M3 ratio) | Replaces |
|---|---|---|
| `SPRING.fastSpatial` | 800 / 33.9 (0.6) | lib/motion.ts · `PRESS_SPRING`; theme.ts · `MOTION.fast` |
| `SPRING.spatial` | 380 / 31.2 (0.8) | lib/motion.ts · `SNAP_SPRING`; theme.ts · `MOTION.sheet` |
| `SPRING.slowSpatial` | 200 / 22.6 (0.8) | NEW (signature moments) |
| `SPRING.fastEffects` | 3800 / 123.3 (1.0) | theme.ts · `MOTION.base` (colour changes) |
| `SPRING.effects` | 1600 / 80.0 (1.0) | NEW |
| `SPRING.slowEffects` | 800 / 56.6 (1.0) | NEW |
| `SPRING.calm` | 700 / 47.6 (0.9, M3 standard) | NEW (text being read, page pushes) |
| `PRESS` | scale 0.96 + state layer `ink` 8% (dark 10%) on press-in; pills morph to radius 12; the primary drops 3 dp onto its lip | NEW |
| `MOTION.pulse` | 1400 ms (LIVE dot only) | theme.ts · `MOTION.pulse` |
| `HAPTIC` | selection: tab, chip, segment, picker slide; light: reaction, opening Roxy AI, switch; medium: RSVP seal; success: "You're in" | NEW (`expo-haptics`) |
| reduced motion | spatial → jump to end; effects → 120 ms fade; bursts and moments skipped; Roxy does not blink | hooks/useReducedMotion.ts (kept) |

### Nav, FAB, rail, reactions

| Proposed token | Value | Replaces |
|---|---|---|
| `NAV` | M3 flexible bar, docked, 64 dp + inset, no shadow; active = filled icon on a 56 × 32 `pinkContainer` pill (Feed: `stageRaised`), labels always on at 12/16; Create = 52 × 40 `pink` key, radius 12, label for screen readers | navTokens · `PILL_INSET`, `PILL_MIN_BOTTOM` (retired), `ACTIVE_TINT_ALPHA` (retired) |
| `FAB` | Roxy O, 56 dp, 16 dp from the end edge and from the bar | RoxyCompanionButton sizes |
| `FAB_MINI` | 40 dp, centred on the screen edge (20 dp visible), eyes closed; hit area 48 × 28 | NEW (tucked while scrolling down) |
| `FAB_LANE` | 88 × 88 dp, bottom end corner; nothing readable or tappable inside at rest; list bottom padding +88 | NEW |
| rail | 32 dp glyphs, 48 dp hit, lowest control at the top of `FAB_LANE` | feedChromeTokens · `RAIL_GUTTER` (78, kept) |
| reaction disc | 48 dp `pinkContainer` with her emoji at 26 dp | NEW |
| reaction picker | 64 dp `surface` pill, 6 × 44 dp cells, emoji 30 dp; hovered 44 dp, lifted 26 dp | NEW |
| touch target | 48 dp | lib/touchTargets.ts · `MIN_TOUCH_TARGET` (kept) |
