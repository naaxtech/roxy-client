# Rules for every Roxy polish agent

Before any UI change: read `polish/design-direction.md`, this file, and `.claude/skills/design-taste-frontend/SKILL.md`. Run its pre-flight check (the items that apply to a React Native screen) before reporting.
Never introduce a color, font, radius, shadow, or spacing value that is not a token.

## Status
Design direction: PROPOSED, not locked. Until Nicole approves it, `apps/mobile/lib/theme.ts` (and the feed/nav/archive token files) is the only source of values, and no Polisher runs.

## Tokens
Live in `apps/mobile/lib/theme.ts`, `components/feed/feedChromeTokens.ts`, `components/nav/navTokens.ts`, `components/archive/archiveTokens.ts`. Text on a token fill uses `inkOn(fill)`. New values are added there as named tokens, never as literals in a component. (The Art Director appends the approved token table below.)

## Product invariants
- Nav: Feed · Discover · ＋Create (sheet) · Messages · You. Feature parity: features move or merge, never disappear.
- Roxy AI is the emotional AI companion (sister to the Roxy app), reached from the omnipresent floating Roxy button, which stays; members can switch her on or off in Settings. User copy may say "Roxy AI". Sister is the quieter companion. Dating is opt-in.
- Light mode is the default theme. Launch is worldwide: every string goes through localisation, and layouts survive longer translations and right-to-left scripts.
- Reactions are the regular emoji set (`lib/postReactions.ts` POST_REACTIONS, shared with chat). No flower reaction or flower count anywhere.
- Discreet mode in Messages is a premium feature.
- Block/mute/report on every surface; request-first DMs; LIVE = dot + word.
- Pushes, lock screens and share previews never show message text or a community, channel or event name by default.
- Every screen has designed loading, empty and error states that say what to do next.
- Never log PII.

## Engineering rules
- TDD: failing jest test first, then the fix; full gate set (`roxy-gates.sh`) before handing back.
- Work only in your own worktree and only on your feature's files. Never edit `polish/rubric.md`, `polish/matrix.md`, `polish/design-direction.md` or tests you were not asked to change.
- The bottom-right of every feed page is shared by the rail (`RAIL_GUTTER`), the Roxy FAB and the scrim band; anything placed there must clear both.
- Playwright against real data: only as `e2e-playwright@seed.roxy.app` and other `*@seed.roxy.app` accounts.
- Never delete files or unused functions; comment them instead (origin, why unused, when to use).
- A direction question goes to `polish/decisions.md` as `OPEN:` and you stop.

## Bans (from the source plan)
Generic gradient heroes, purple-blue AI glow, stock illustration, one-font-for-everything, cards inside cards, 3-column feature grids, placeholder text, "lorem", emoji in UI chrome.


## Proposed tokens (PROPOSED, not yet in theme.ts)

From `polish/design-direction.md` (status PROPOSED). Do not use until Nicole approves the direction; until then `theme.ts` and the feed/nav/archive token files stay the only source. Contrast for every pair is measured in the direction's Color section. "Replaces" names the existing key whose role the token takes; NEW means no current key.

### Colour (dark / light)

| Proposed token | Dark | Light | Replaces (file · key) |
|---|---|---|---|
| `ground` | #141113 | #F6F3F2 | theme.ts · `background` |
| `ground` (alt wash) | — | — | theme.ts · `backgroundAlt` (retired: one ground; screens that used it take `ground`) |
| `surface` | #1E1A1C | #FFFDFD | theme.ts · `surface` |
| `raised` | #2A2528 | #ECE7E6 | theme.ts · `surfaceLight` / `elevated()` |
| `line` | #3A3337 | #E0D9D8 | theme.ts · `line` |
| `control` | #6E6469 | #8C8186 | theme.ts · `lineStrong` |
| `ink` | #F7F2F4 | #1A1216 | theme.ts · `textPrimary` |
| `ink2` | #C3B8BD | #544A4F | theme.ts · `textSecondary` |
| `ink3` | #A1959B | #675C61 | theme.ts · `textMuted` |
| `pink` | #F22481 | #F22481 | theme.ts · `primary` (light changes from #D81368) |
| `pinkInk` | #FF6FA6 | #C0105C | theme.ts · `primaryInk` |
| `onPink` | #17080F | #17080F | theme.ts · `BRAND_INK` (#1A0A2E) for ink on pink and identity fills |
| (retired) | — | — | theme.ts · `secondary`, `secondaryInk` (lilac; violet is banned — social-not-romantic UI uses ink/ink2) |
| `warning` (also streak) | #F2B33D | #B07A10 | theme.ts · `gold`, `warning` |
| `warningInk` | #F6C766 | #8A5E06 | theme.ts · `goldInk` |
| `success` | #3CCB86 | #177A47 | theme.ts · `success` |
| `successInk` | #62DBA0 | #13703F | theme.ts · `successInk` |
| `danger` | #FF5D5D | #C8262C | theme.ts · `error` |
| `dangerInk` | #FF7B7B | #B21F25 | theme.ts · `errorInk` |
| `sister` | #9FB6C4 | #4F6B7C | theme.ts · `sister` |
| `sisterInk` | #B9CBD6 | #3E5868 | theme.ts · `sisterInk` |
| `roxy` = `pink` | #F22481 | #F22481 | theme.ts · `roxy` |
| `live` (dot, always with the word) | #FF5A2E | #E8481E | theme.ts · `LIVE_GRADIENT` (gradient retired; flat dot) |
| `BRAND_GRADIENT` (wordmark + app icon only) | #FF5A2E → #F22481 → #E0189A | same | theme.ts · `BRAND_GRADIENT` (value kept, use narrowed); navTokens/feedChromeTokens re-exports stop being used by the + button and FAB |
| `stage` | #0B0A0A | #0B0A0A | NEW (feed stage, always dark) |
| `fieldInk` / `fieldPaper` / `fieldPink` | #151113 / #F3F1F0 / #F22481 | same | NEW (text-post fields) ; feedChromeTokens · `BRAND_VEIL` retired (no gradient text cells) |
| `identity` fields: pink, tangerine, butter, sage, sky, rose | #F22481, #FF7A45, #F2C94C, #8FC4A0, #8FB8DE, #E8A0BF | same | theme.ts · `COMMUNITY_CHIP_COLORS` |
| `scrim` | 0.62 → 0.88 black, dp-anchored | same | feedChromeTokens · `MEDIA_SCRIM_*` (kept as is) |
| rail plate | none (glyph + 1px dark outline-shadow) | same | feedChromeTokens · `RAIL_BACKING`, `RAIL_BACKING_ALPHA` (retired; `CHROME_SHADOW` kept) |
| `devPanel` | unchanged | unchanged | theme.ts · `devPanel` (not a product colour) |

### Type

| Proposed token | Value | Replaces |
|---|---|---|
| `FONTS.display` | Bricolage Grotesque 700, 800 (`@expo-google-fonts/bricolage-grotesque` 0.4.1) | typography.ts · `FONTS.display` (Outfit 600–800) |
| `FONTS.text` | Figtree 400, 500, 600 | typography.ts · `FONTS.text` (700 dropped) |
| `FONTS.mono` | IBM Plex Mono 500 (`@expo-google-fonts/ibm-plex-mono` 0.4.1) | NEW (codes and IDs only) |
| `TYPE.meta` | Figtree 500 12/16 | typography.ts · `micro` (10) and `caption` (12) merge |
| `TYPE.body` | Figtree 400 15/21 | typography.ts · `body` (13/19) and `bodyLg` (15/22) merge |
| `TYPE.title` | Bricolage 700 20/24, -0.2 | typography.ts · `title` (17/22) |
| `TYPE.headline` | Bricolage 800 28/30, -0.5 | typography.ts · `headline` (21/27) |
| `TYPE.display` | Bricolage 800 44/44, -1.0 | typography.ts · `display` (28/33) |
| `TYPE.moment` | Bricolage 800 64/60, -2.0 | NEW |
| `TYPE.mono` | Plex Mono 500 13/18, +0.5 | NEW |

### Space, radius, elevation, motion

| Proposed token | Value | Replaces |
|---|---|---|
| `SPACE` | 4, 8, 12, 16, 20, 24, 32, 48, 64 | NEW (no spacing scale exists today) |
| `MARGIN` | 16 (20 on text posts) | NEW |
| `RADII.sm` | 8 | theme.ts · `RADII.sm` (10) |
| `RADII.md` | 20 | theme.ts · `RADII.md` (15) and `RADII.lg` (18) merge |
| `RADII.sheet` | 28 | theme.ts · `RADII.sheet` (26) |
| `RADII.pill` | 999 | theme.ts · `RADII.pill` |
| `CREST_RADIUS_RATIO` | 0.28 × crest size | NEW |
| `ELEVATION.float` | 0 12 32 rgba(0,0,0,0.55) (light 0.16) | NEW |
| `ELEVATION.pop` | 0 24 56 rgba(0,0,0,0.60) (light 0.22) | NEW |
| `MOTION.press` | 120 ms | theme.ts · `MOTION.fast` (160) |
| `MOTION.ui` | 200 ms | theme.ts · `MOTION.base` (220) |
| `MOTION.sheet` | 320 ms, bezier (.32,.72,0,1) | theme.ts · `MOTION.sheet`, `MOTION.bezier` (kept) |
| `MOTION.moment` | 600 ms, bezier (.22,1,.36,1) | NEW |
| `MOTION.exit` | bezier (.55,.055,.675,.19), 70% of entrance | NEW |
| `MOTION.pulse` | 1400 ms (LIVE dot only) | theme.ts · `MOTION.pulse` |
| `NAV` bar | plain full-width bar, 82 dp incl. home indicator | navTokens · `PILL_INSET`, `PILL_MIN_BOTTOM` (retired), `ACTIVE_TINT_ALPHA` (retired: active = ink, no tint) |
| touch target | 48 dp | lib/touchTargets.ts · `MIN_TOUCH_TARGET` (kept) |
| rail | 32 dp glyphs, 48 dp hit, 62 dp pitch | feedChromeTokens · `RAIL_GUTTER` (78, kept) |
