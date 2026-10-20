Status: PROPOSED — awaiting Nicole's approval

# Design Direction — Roxy

Art Director proposal, 2026-10-20. Evidence: `polish/inspiration/*.md` (14 reference apps, screenshots in `polish/inspiration/shots/`), `polish/inspiration/v0-audit.md` (live build + prototype, `polish/evidence/v0/`), concept boards in `polish/concepts/`. Nothing here is in `apps/mobile/lib/theme.ts` yet; the proposed token map is appended to `polish/rules/CLAUDE.md`.

## One-line brand feeling

Walking into a room full of women who were expecting you: bold, warm, a bit cheeky, and safe.

The idea, in the Taste Skill's sentence form: **on Roxy, the flower women have given each other for a very long time becomes the reaction, the mark and the moment** — a five-petal flower in Roxy pink replaces the like, sits in the crest of every celebration, and is the one shape only Roxy owns. (Competitor test: put HER, Lex or Instagram in the sentence and it stops working; v0 already used ✿ as its react glyph, so the idea is grown from Roxy's own material, not imported.)

## Audience and device

- **Who:** lesbians and women who love women at every life stage, from questioning to long-partnered (`polish/brief.md`). Some are out to everyone, some to almost no one, so what shows outside the app (pushes, previews, widgets, location) is a design material, not a setting.
- **Where she uses it:** a phone, held in one hand, often at night, often in public (bus, queue, office). The feed is read in short bursts; channels and DMs in longer evening sessions.
- **Device floor:** a 360dp-wide Android on 4G (the rubric's mobile row is "designed for 360px"); the top end is a 430pt iPhone. Expo 51, RN 0.74.5, Old Architecture; the web export at roxy.expo.app must look and behave the same.
- **Themes:** dark is the default and the design reference; light ships with the same roles. The feed stage is always dark (photos and video read best there), except text posts, which bring their own field.

## Style skill

**Taste Skill v2** (`.claude/skills/design-taste-frontend`), applied through its app-screen run (`references/app-screens.md`). `draw.mjs --app --kind community --keep palette` dealt two styles; this direction takes **`true-black-flat`** (seed 1565931516, sheet saved in `D:/Temp/roxy-polish/artdir/draw-true-black.txt`) and its move: elevation by lightness alone, no borders or shadows on resting cards, colour confined to meaning (data, the action, identity), the primary made primary by a single owned fill. Its "face" choices are taken as: a warm near-black ground (the style's own option for a home), Roxy pink as the one hue, and one element only this product has (the flower). Redraw note: the style deals Inter at 400–600 with nothing above 20px; Roxy overrides the type with a display face because a consumer social app's first screen has to carry a voice (Taste Skill: "give the product a face"). React Native reading: the web-only rules (Tailwind, CSS scroll scenes, inspector thresholds) are read as principles; the pre-flight items that apply on a phone are listed under Bans and in each screen note.

**popular-web-designs** systems, and what each decided:

| System | What Roxy takes | Where |
|---|---|---|
| Spotify (`templates/spotify.md`) | "Content-first darkness": a near-black tone ladder (#121212 → #181818 → #1f1f1f) so media is the only colour; pill buttons; a compact 10–24px UI scale | Dark surface ladder, the always-dark feed stage, pill controls |
| Revolut (`revolut.md`, plus the app screenshots) | Zero shadows; depth from tone; display at medium/heavy weight with negative tracking; primary by inversion | Elevation (2 levels, nothing at rest), display tracking |
| Airbnb (`airbnb.md`) | One singular brand accent with a story (Rausch, its first street address) and warm, not cold, near-black text | Roxy pink as the only accent; warm-tinted neutrals (#1A1216, #141113) |
| Wise (`wise.md`) | A heavy display at very tight leading as identity, beside a plain text face; a full colour field used with conviction | Bricolage 800 at 0.94–1.0 leading; the pink field on "You're in" |
| Uber (`uber.md`) | Two faces, strict roles, no decorative type | Display vs text split, no italics or accent words |
| Linear (`linear.app.md`) | Text hierarchy by luminance steps (primary / secondary / tertiary), near-white instead of #fff on dark | ink / ink2 / ink3 |
| Apple (`apple.md`) | Shadow only on what physically floats | `float` and `pop` only on toasts, menus and sheets |

## Typography

All three families are free (SIL OFL) and ship as `@expo-google-fonts/*` packages loadable with `expo-font` (versions checked on npm 2026-10-20).

| Role | Family | Weights | Package |
|---|---|---|---|
| Display | **Bricolage Grotesque** | 700, 800 | `@expo-google-fonts/bricolage-grotesque` 0.4.1 (`BricolageGrotesque_700Bold`, `_800ExtraBold`) |
| Body / UI | **Figtree** (kept from v0) | 400, 500, 600 | `@expo-google-fonts/figtree` 0.4.1 (already installed) |
| Mono | **IBM Plex Mono** | 500 | `@expo-google-fonts/ibm-plex-mono` 0.4.1 (`IBMPlexMono_500Medium`) |

Why: Bricolage is a grotesque with real character (slightly condensed, ink-trap-like joins, a confident heavy weight) that reads bold and warm without being cute; it replaces Outfit, which is a friendly geometric too close to Figtree to give contrast (v0 audit S11). Figtree stays because it is clear at 12–15px on Android, already loaded, and keeps continuity. Mono has one job.

**Scale** (dp; six steps, at most four on any one screen):

| Step | Family / weight | Size / leading | Tracking | Use |
|---|---|---|---|---|
| `meta` | Figtree 500 | 12 / 16 | 0 | timestamps, counts under rail glyphs, community line, helper text (floor: nothing smaller) |
| `body` | Figtree 400 (600 for labels) | 15 / 21 | 0 | captions, messages, list rows, buttons (16/20 600 on 52dp buttons) |
| `title` | Bricolage 700 | 20 / 24 | -0.2 | screen titles, sheet titles, card titles |
| `headline` | Bricolage 800 | 28 / 30 | -0.5 | section heads on Discover and You, short text posts over 90 characters |
| `display` | Bricolage 800 | 44 / 44 | -1.0 | text posts of 40–90 characters, event poster titles on small posters |
| `moment` | Bricolage 800 | 64 / 60 | -2.0 | text posts under 40 characters, poster titles, "You're in" |
| `mono` | Plex Mono 500 | 13 / 18 | +0.5 | invite codes, ticket codes, order numbers only |

Rules:
- Display faces never go below 20dp; Figtree never above 17 except on buttons.
- Sentence case everywhere. No tracked capitals, no eyebrow labels, no italic accent words.
- Every number that updates (flower counts, members, prices, timers) uses tabular figures (`fontVariant: ['tabular-nums']`).
- Headlines are two lines at most at 360dp; text posts pick their step by length (moment → display → headline) so a long post never becomes a wall at 64.
- The feed body moves from 13 (v0) to 15: v0's 13 is below what she can read on a bus.

## Color

**The rule:** colour carries meaning or identity, never decoration. Grounds are warm neutrals; Roxy pink marks the one action or the one owned moment; identity colours belong to communities and events; semantics are only for state. The brand gradient (#FF5A2E → #F22481 → #E0189A) stays on the wordmark and the app icon and nowhere else (v0 audit S2).

**Brand**
- `pink` #F22481 — the action fill (one primary per screen), the flower when given, the Create button, the unread dot, the "You're in" field. Under 5% of any ordinary screen.
- `onPink` #17080F — the ink on every pink or identity fill. White on pink measures 3.93:1 and fails, so the label is dark (this continues v0's `inkOn()` rule).
- `pinkInk` — pink as text or link: #FF6FA6 dark, #C0105C light.
- Roxy the wingwoman *is* the brand pink; Sister is a cool, quiet blue-grey (`sister`), never violet.

**Surfaces and ink**

| Role | Dark | Light |
|---|---|---|
| `ground` | #141113 | #F6F3F2 |
| `surface` (one step) | #1E1A1C | #FFFDFD |
| `raised` (two steps; inputs, chips, pressed rows) | #2A2528 | #ECE7E6 |
| `line` (list rules and inputs only) | #3A3337 | #E0D9D8 |
| `control` (outlined controls, switch tracks) | #6E6469 | #8C8186 |
| `ink` | #F7F2F4 | #1A1216 |
| `ink2` | #C3B8BD | #544A4F |
| `ink3` | #A1959B | #675C61 |

**The always-dark feed stage**
- `stage` #0B0A0A behind all media; the nav bar takes `stage` on the Feed.
- Media chrome: white glyphs with a 1px dark outline-shadow, no plates; the caption band keeps v0's dp-anchored scrim (0.62 → 0.88 black), which measures 6.19:1 for white over a pure-white frame.
- Text posts bring one of three fields, chosen by the author: `fieldInk` #151113 (paper ink on it), `fieldPaper` #F3F1F0 (light ink on it), `fieldPink` #F22481 (`onPink` on it). No gradients.

**Identity fields** (community crests, member initials, event posters; never chrome): pink #F22481, tangerine #FF7A45, butter #F2C94C, sage #8FC4A0, sky #8FB8DE, rose #E8A0BF. Each carries `onPink` at ≥ 4.96:1. They replace `COMMUNITY_CHIP_COLORS` and drop its violet (#7B45F5).

**Semantic**

| Role | Dark fill / ink | Light fill / ink |
|---|---|---|
| success | #3CCB86 / #62DBA0 | #177A47 / #13703F |
| warning (also streak gold) | #F2B33D / #F6C766 | #B07A10 / #8A5E06 |
| danger | #FF5D5D / #FF7B7B | #C8262C / #B21F25 |
| live dot (always with the word LIVE or "8 live") | #FF5A2E | #E8481E |
| sister | #9FB6C4 / #B9CBD6 | #4F6B7C / #3E5868 |

**Measured contrast** (WCAG 2.2 relative luminance, computed by `D:/Temp/roxy-polish/artdir/contrast.cjs` from `palette.json`; text needs 4.5:1, non-text marks 3:1). The one FAIL is listed on purpose: it is why labels on pink are dark.

| Theme | Pair | Text / mark | On | Ratio | Needs | Result |
|---|---|---|---|---|---|---|
| dark | ink on ground | `ink` #F7F2F4 | `ground` #141113 | 16.94:1 | 4.5:1 | pass |
| dark | ink on surface | `ink` #F7F2F4 | `surface` #1E1A1C | 15.55:1 | 4.5:1 | pass |
| dark | ink on raised | `ink` #F7F2F4 | `raised` #2A2528 | 13.61:1 | 4.5:1 | pass |
| dark | ink2 on ground | `ink2` #C3B8BD | `ground` #141113 | 9.75:1 | 4.5:1 | pass |
| dark | ink2 on surface | `ink2` #C3B8BD | `surface` #1E1A1C | 8.95:1 | 4.5:1 | pass |
| dark | ink2 on raised | `ink2` #C3B8BD | `raised` #2A2528 | 7.83:1 | 4.5:1 | pass |
| dark | ink3 on ground | `ink3` #A1959B | `ground` #141113 | 6.51:1 | 4.5:1 | pass |
| dark | ink3 on surface | `ink3` #A1959B | `surface` #1E1A1C | 5.97:1 | 4.5:1 | pass |
| dark | ink3 on raised | `ink3` #A1959B | `raised` #2A2528 | 5.23:1 | 4.5:1 | pass |
| dark | pinkInk (link/active label) on ground | `pinkInk` #FF6FA6 | `ground` #141113 | 7.22:1 | 4.5:1 | pass |
| dark | pinkInk on surface | `pinkInk` #FF6FA6 | `surface` #1E1A1C | 6.62:1 | 4.5:1 | pass |
| dark | pinkInk on raised | `pinkInk` #FF6FA6 | `raised` #2A2528 | 5.79:1 | 4.5:1 | pass |
| dark | onPink label on pink fill | `onPink` #17080F | `pink` #F22481 | 4.96:1 | 4.5:1 | pass |
| dark | white label on pink fill (rejected option) | `white` #FFFFFF | `pink` #F22481 | 3.93:1 | 4.5:1 | FAIL |
| dark | pink fill as a mark on ground (non-text) | `pink` #F22481 | `ground` #141113 | 4.78:1 | 3:1 | pass |
| dark | successInk on ground | `successInk` #62DBA0 | `ground` #141113 | 10.86:1 | 4.5:1 | pass |
| dark | successInk on surface | `successInk` #62DBA0 | `surface` #1E1A1C | 9.97:1 | 4.5:1 | pass |
| dark | warningInk on ground | `warningInk` #F6C766 | `ground` #141113 | 11.86:1 | 4.5:1 | pass |
| dark | warningInk on surface | `warningInk` #F6C766 | `surface` #1E1A1C | 10.89:1 | 4.5:1 | pass |
| dark | dangerInk on ground | `dangerInk` #FF7B7B | `ground` #141113 | 7.48:1 | 4.5:1 | pass |
| dark | dangerInk on surface | `dangerInk` #FF7B7B | `surface` #1E1A1C | 6.86:1 | 4.5:1 | pass |
| dark | dangerInk on raised | `dangerInk` #FF7B7B | `raised` #2A2528 | 6.01:1 | 4.5:1 | pass |
| dark | sisterInk on ground | `sisterInk` #B9CBD6 | `ground` #141113 | 11.24:1 | 4.5:1 | pass |
| dark | sisterInk on surface | `sisterInk` #B9CBD6 | `surface` #1E1A1C | 10.31:1 | 4.5:1 | pass |
| dark | live dot on ground (non-text) | `liveDot` #FF5A2E | `ground` #141113 | 6.03:1 | 3:1 | pass |
| dark | live dot on surface (non-text) | `liveDot` #FF5A2E | `surface` #1E1A1C | 5.54:1 | 3:1 | pass |
| dark | control outline on ground (non-text) | `control` #6E6469 | `ground` #141113 | 3.30:1 | 3:1 | pass |
| dark | control outline on surface (non-text) | `control` #6E6469 | `surface` #1E1A1C | 3.03:1 | 3:1 | pass |
| dark | ink on success fill | `ground` #141113 | `success` #3CCB86 | 9.00:1 | 4.5:1 | pass |
| dark | ink on warning fill | `ground` #141113 | `warning` #F2B33D | 10.09:1 | 4.5:1 | pass |
| dark | ink on danger fill | `ground` #141113 | `danger` #FF5D5D | 6.23:1 | 4.5:1 | pass |
| light | ink on ground | `ink` #1A1216 | `ground` #F6F3F2 | 16.66:1 | 4.5:1 | pass |
| light | ink on surface | `ink` #1A1216 | `surface` #FFFDFD | 18.14:1 | 4.5:1 | pass |
| light | ink on raised | `ink` #1A1216 | `raised` #ECE7E6 | 15.01:1 | 4.5:1 | pass |
| light | ink2 on ground | `ink2` #544A4F | `ground` #F6F3F2 | 7.70:1 | 4.5:1 | pass |
| light | ink2 on surface | `ink2` #544A4F | `surface` #FFFDFD | 8.39:1 | 4.5:1 | pass |
| light | ink2 on raised | `ink2` #544A4F | `raised` #ECE7E6 | 6.94:1 | 4.5:1 | pass |
| light | ink3 on ground | `ink3` #675C61 | `ground` #F6F3F2 | 5.80:1 | 4.5:1 | pass |
| light | ink3 on surface | `ink3` #675C61 | `surface` #FFFDFD | 6.32:1 | 4.5:1 | pass |
| light | ink3 on raised | `ink3` #675C61 | `raised` #ECE7E6 | 5.23:1 | 4.5:1 | pass |
| light | pinkInk on ground | `pinkInk` #C0105C | `ground` #F6F3F2 | 5.48:1 | 4.5:1 | pass |
| light | pinkInk on surface | `pinkInk` #C0105C | `surface` #FFFDFD | 5.97:1 | 4.5:1 | pass |
| light | pinkInk on raised | `pinkInk` #C0105C | `raised` #ECE7E6 | 4.94:1 | 4.5:1 | pass |
| light | onPink label on pink fill | `onPink` #17080F | `pink` #F22481 | 4.96:1 | 4.5:1 | pass |
| light | pink fill as a mark on ground (non-text) | `pink` #F22481 | `ground` #F6F3F2 | 3.56:1 | 3:1 | pass |
| light | successInk on ground | `successInk` #13703F | `ground` #F6F3F2 | 5.57:1 | 4.5:1 | pass |
| light | successInk on surface | `successInk` #13703F | `surface` #FFFDFD | 6.06:1 | 4.5:1 | pass |
| light | warningInk on ground | `warningInk` #8A5E06 | `ground` #F6F3F2 | 5.16:1 | 4.5:1 | pass |
| light | warningInk on surface | `warningInk` #8A5E06 | `surface` #FFFDFD | 5.62:1 | 4.5:1 | pass |
| light | dangerInk on ground | `dangerInk` #B21F25 | `ground` #F6F3F2 | 6.10:1 | 4.5:1 | pass |
| light | dangerInk on surface | `dangerInk` #B21F25 | `surface` #FFFDFD | 6.65:1 | 4.5:1 | pass |
| light | dangerInk on raised | `dangerInk` #B21F25 | `raised` #ECE7E6 | 5.50:1 | 4.5:1 | pass |
| light | sisterInk on ground | `sisterInk` #3E5868 | `ground` #F6F3F2 | 6.79:1 | 4.5:1 | pass |
| light | sisterInk on surface | `sisterInk` #3E5868 | `surface` #FFFDFD | 7.40:1 | 4.5:1 | pass |
| light | live dot on ground (non-text) | `liveDot` #E8481E | `ground` #F6F3F2 | 3.54:1 | 3:1 | pass |
| light | live dot on surface (non-text) | `liveDot` #E8481E | `surface` #FFFDFD | 3.85:1 | 3:1 | pass |
| light | control outline on ground (non-text) | `control` #8C8186 | `ground` #F6F3F2 | 3.40:1 | 3:1 | pass |
| light | control outline on surface (non-text) | `control` #8C8186 | `surface` #FFFDFD | 3.70:1 | 3:1 | pass |
| light | surface on success fill (label) | `surface` #FFFDFD | `success` #177A47 | 5.30:1 | 4.5:1 | pass |
| light | surface on danger fill (label) | `surface` #FFFDFD | `danger` #C8262C | 5.50:1 | 4.5:1 | pass |
| light | ink on warning fill (label) | `ink` #1A1216 | `warning` #B07A10 | 4.94:1 | 4.5:1 | pass |
| stage | white on stage | `white` #FFFFFF | `stage` #0B0A0A | 19.77:1 | 4.5:1 | pass |
| stage | fieldPaper text on fieldInk card | `fieldPaper` #F3F1F0 | `fieldInk` #151113 | 16.63:1 | 4.5:1 | pass |
| stage | fieldInk text on fieldPaper card | `fieldInk` #151113 | `fieldPaper` #F3F1F0 | 16.63:1 | 4.5:1 | pass |
| stage | onPink text on fieldPink card | `onPink` #17080F | `fieldPink` #F22481 | 4.96:1 | 4.5:1 | pass |
| stage | pink flower (liked) on stage (non-text) | `pink` #F22481 | `stage` #0B0A0A | 5.03:1 | 3:1 | pass |
| stage | live dot on stage (non-text) | `liveDot` #FF5A2E | `stage` #0B0A0A | 6.36:1 | 3:1 | pass |
| stage | onPink on crest tangerine | `onPink` #17080F | `crestTangerine` #FF7A45 | 7.53:1 | 4.5:1 | pass |
| stage | onPink on crest butter | `onPink` #17080F | `crestButter` #F2C94C | 12.28:1 | 4.5:1 | pass |
| stage | onPink on crest sage | `onPink` #17080F | `crestSage` #8FC4A0 | 9.81:1 | 4.5:1 | pass |
| stage | onPink on crest sky | `onPink` #17080F | `crestSky` #8FB8DE | 9.35:1 | 4.5:1 | pass |
| stage | onPink on crest rose | `onPink` #17080F | `crestRose` #E8A0BF | 9.47:1 | 4.5:1 | pass |
| stage | light ink2 on paper text card | `lightInk2` #544A4F | `fieldPaper` #F3F1F0 | 7.55:1 | 4.5:1 | pass |
| stage | light live dot on paper card (non-text) | `liveDotLight` #E8481E | `fieldPaper` #F3F1F0 | 3.47:1 | 3:1 | pass |
| stage | pink fill on paper card (non-text) | `pink` #F22481 | `fieldPaper` #F3F1F0 | 3.49:1 | 3:1 | pass |
| stage | Caption white on scrim top (0.62 black over white frame) | #FFFFFF | #616161 | 6.19:1 | 4.5:1 | pass |
| stage | Secondary 82% white on scrim top | #e3e3e3 | #616161 | 4.83:1 | 4.5:1 | pass |

## Spacing, radius, elevation

- **Base unit 4.** Scale: 4, 8, 12, 16, 20, 24, 32, 48, 64. Screen margin 16 (20 on text posts). Gap inside a group 8–12; between groups 24–32.
- **Touch:** every control ≥ 48dp (keeps `MIN_TOUCH_TARGET`); rail glyphs 32 inside a 48 hit area at a 62dp pitch; list rows 56 (one line) / 72 (two lines); buttons 52.
- **Radius, bimodal:** `sm` 8 (inputs, small media tiles), `md` 20 (cards, posters, media in lists), `sheet` 28 (bottom-sheet top corners), `pill` 999 (buttons, chips, segments, Create). Crest squircles use 28% of their size. Nested radii step down (20 → 8). No 10/15/18/26 in-betweens (v0 audit S10).
- **Elevation, two levels, nothing at rest:** `float` = 0 12 32 rgba(0,0,0,0.55) for toasts, menus and the composer; `pop` = 0 24 56 rgba(0,0,0,0.60) for sheets and dialogs. Cards separate from the ground by one tone step (`surface`), never by a border plus a shadow. In light theme the same two levels at 0.16 / 0.22 alpha.
- **Navigation:** a plain full-width bottom bar on `ground` (on `stage` in the Feed), labels under icons, Create as a pink pill in the middle. The floating pill bar goes.

## Motion

Built with `react-native-reanimated` 3.10 (`withTiming`, `withSpring`) and `expo-haptics`; Lottie is not needed.

| Token | Value | Use |
|---|---|---|
| `press` | 120 ms, ease-out | scale 0.97 on press, colour on chips and toggles |
| `ui` | 200 ms, ease-out | segment underline, toasts in, tab switch crossfade, rail flower fill |
| `sheet` | 320 ms, `cubic-bezier(.32,.72,0,1)` (kept from v0) | sheets, page pushes; exit at 70% (224 ms) with `ease-exit` |
| `moment` | 600 ms, ease-out `cubic-bezier(.22,1,.36,1)` | the three signature moments only |
| `ease-exit` | `cubic-bezier(.55,.055,.675,.19)` | things leaving for good |
| live pulse | 1.4 s opacity 1 → 0.4 on the dot only | LIVE dot |

- **What moves:** the flower bloom, sheets, the pager snap, the "You're in" field fill, the RSVP stamp, toasts, the LIVE dot.
- **What never moves:** text someone is reading, the nav bar, rail positions, list rows on load (no staggered fade-ins), numbers (no counting up), the logo. No bounce or overshoot on interface elements; no confetti.
- **Haptics:** `Haptics.impactAsync(Light)` on giving a flower and on RSVP; `notificationAsync(Success)` on "You're in". Nothing else buzzes.
- **Reduced motion** (`useReducedMotion()` / `AccessibilityInfo.isReduceMotionEnabled`): every moment keeps its end state and drops travel and scale — the bloom becomes a 120 ms fill of the rail flower, the pink field appears without the wipe, the stamp appears without rotation, the LIVE dot is steady. Haptics stay.

## Signature moments

1. **Give her a flower** (Feed; board `polish/concepts/01-give-her-a-flower.png`). Double-tap a post: a pink five-petal flower blooms where her thumb was (scale 0.6 → 1, -8° turn, three small petals drift 16–24dp and fade, 600 ms), the rail flower fills pink, a light haptic. The very first time, one toast: "Your first flower. Flowers, not likes." The count under the rail is flowers given. It is Roxy's own symbol in place of a heart, so the screenshot can only be Roxy. (Duolingo: celebration only at the moment of success; TikTok: the double-tap grammar members already have.)
2. **You're in** (onboarding; board `02-youre-in.png`). When her invite code is accepted, the whole screen floods Roxy pink, a giant ink flower turns in from the corner, and it says "You're in, Maya." with who vouched for her and the date she joined; one ink button, "Come in". It is the membership card she sends to the friend who invited her. (Cash App and Headspace: a whole colour field with conviction; BeReal/Locket: one artifact, one moment.)
3. **The invite is a poster** (community events; board `03-invite-poster.png`). Every event is a poster in its community's identity colour with the title set at `moment` size. "I'm going" stamps a round pink seal onto the poster's corner (rotate 9°, 600 ms) and the page gains a ticket with a mono code. Guest lists are visible only to people going, the exact address lives on the ticket, and the share preview never names the event or the community. (Partiful and HER: the invite as a poster; Roxy's privacy rule: what is shareable is the feeling, not the facts.)

## Copy voice

Roxy talks like the friend who knows everyone at the party: warm, direct, a bit cheeky, never clinical, never a product manual. Short sentences, sentence case, contractions. She says "women" plainly and uses in-group words members use ("sapphic", "WLW", "your people") without forcing them. Roxy the wingwoman is never AI, an assistant or a chatbot, never "always on", never "ask me anything". Sister speaks less and softer. Errors say what happened and what to do next. Emoji belong to members' own posts, never to the interface.

| v0 | Proposed |
|---|---|
| "Hey! I'm Roxy 😄 Your WLW wingwoman 💜 Ask me anything…" | "Hey, I'm Roxy. Tell me about her." |
| "always on — replies instantly" | "Your wingwoman" |
| "YOUR FIRST FIVE MINUTES / 4 small steps to feel at home" | (gone: the first screen is a post; one nudge at a time, in place) |
| "No private messages" | "No messages yet. When someone writes, it waits here as a request until you say yes." |
| "Nothing on the calendar yet." | "Nothing on the calendar yet. Your communities post events here first." |
| "Browse all 0 →" | (hidden until there is something to browse) |
| "Who can message you: Everyone — requests first · request-first inbox · change in Settings →" | "Anyone can send a request. You decide who gets through." |

Taglish: not proposed until Nicole confirms the launch audience (open question).

## Bans

From the plan, unchanged: generic gradient heroes, purple-blue AI glow, stock illustration, Inter-only everything (one-font-for-everything), cards inside cards, 3-column feature grids, placeholder text, lorem, emoji in UI chrome.

Added, with the v0 evidence that earns each:
- Violet, indigo and lilac anywhere in the interface (v0 ground #14082A, secondary #A78BFA).
- The brand gradient anywhere except the wordmark and the app icon (S2). No gradients on buttons, cards, covers or text posts; the only gradient is the neutral black scrim under media text.
- Glow, glass, backdrop blur, and shadows on resting elements.
- Tracked-caps eyebrows and pills that repeat a heading ("SHOP", "COMMUNITY", "CHANNELS", "WINGWOMAN") (S4).
- Icons in tinted squares or circles (S5); the sparkle ✦ as Roxy's mark.
- The floating pill nav and a FAB that sits on content (S10, discover-1-retry, discover-4).
- Spinners as a loading state: skeletons at the final layout with labels shown at once.
- XP bars, levels and point counts on her own profile; confetti; count-up numbers.
- Media letterboxed on black bars inside the feed (feed-2-communities-retry): photos fill the frame at 4:5 or the stage's own ratio, with the full image one tap away.
- Location, distance, guest names or event names shown by default anywhere outside the person's own view.
- The words AI, assistant, chatbot, "ask me anything", "always on", "unlock", "seamless", "journey".

Taste Skill pre-flight items that apply on a phone, checked on every screen: one dominant thing per screen; a title on every screen; two or three type sizes doing the work; equal 16dp margins; no blank band taller than half the screen; one accent; every word ≥ 4.5:1; every target ≥ 48dp; nothing over a headline; every state designed (loading, empty, error) with the next step in words.

## What changes from v0 and why

| Change | v0 evidence (`polish/evidence/v0/`) | Why |
|---|---|---|
| Violet ground → warm near-black (#141113); light theme on warm grey-white (#F6F3F2) | every screen; proto-* | Violet is the generated-app hue (Taste Skill ban); a warm neutral lets photos and the one pink carry the brand (Spotify, Revolut) |
| Gradient on everything → gradient on the logo only; one flat pink action | onboarding-1, feed-1-foryou, discover-3/4, you-1, community-1, messages-1 | A gradient on twenty surfaces means nothing; v0's own `theme.ts` comment already says "identity only" |
| Outfit + Figtree → Bricolage Grotesque display + Figtree text; feed body 13 → 15 | all; feed-2-following | Two friendly geometrics gave no contrast; a face with character gives Roxy a voice (Wise, Uber) |
| Feed: checklist card under ~20 controls → the post is the screen; rail of 5 glyphs, no plates, no FAB in the corner | feed-1-foryou, feed-2-communities-retry | TikTok grammar; the core loop first (BeReal, Locket) |
| Heart → flower | feed-1-foryou rail | v0's ✿ was the one owned symbol; it becomes the signature (moment 1) |
| Three first-run checklists → one nudge at a time, in place, after she has seen posts | feed-0-mini-wins-sheet, feed-1-foryou, you-1 | First run is the core loop (BeReal, Partiful); Mini Wins stays as a quiet card on You, not a sheet over the feed |
| Gradient blocks → real pictures: members' photos, community crests in identity colours, archive cover art, event posters | discover-1-retry, discover-2-retry, archive-1, community-1 | Faces and posters are the content (Lex, HER, Partiful); identity colours are flat fields with dark ink |
| Caps pills, tinted icon squares, emoji in chrome → words, plain 24dp outline icons, sentence case | messages-1, create-sheet, archive-1 | Template tells (Taste Skill registry) |
| Floating pill nav → plain bottom bar; Create as a pink pill | all | Taste Skill: a plain bar; pills float only when something truly floats |
| Roxy chat sparkle + "ask me anything" → Roxy's own pink flower crest, a person's voice | roxy-chat-1, proto-8-roxy | She is a wingwoman, not a chatbot (brief invariant) |
| Create: four locked rows equal to the one open row → the open action large, the locked ones as one quiet line each with who can unlock them | create-sheet | Feature parity kept, hierarchy fixed |
| Radii 10/15/18/26 → 8 / 20 / 28 / pill | all | Bimodal radius (Taste Skill), fewer values |

## Inspector persona

**Dani, 31.** (Fictional; built from the brief, not from research data.) She is out to her friends and her sister, not to everyone at work. A local queer book club vouched for her, which is how she got her Roxy code. Her phone is a mid-range Android at 360dp wide, usually on 4G, held in one hand on the bus home; at night she reads with the brightness down. She is not looking for a date tonight; she might be one day, and she wants that to be her choice. She has left apps that showed her location to strangers or sent push previews that named a group.

Score as Dani:
- Can she use it one-handed, at 360dp, on a slow connection, without a spinner holding the screen?
- Would anything on screen out her if her colleague glanced at it, or if it showed up as a notification or a link preview?
- Does Roxy (the wingwoman) feel like a friend or like a bot?
- **What she would screenshot or show a friend:** the "You're in" card, sent to the friend who invited her; an event poster dropped into her group chat (its preview naming neither the event nor the club); the first time someone gave her post a flower.

## Screen notes

**Feed.** One post fills the screen on `stage`. Top: three segment words (For you · Following · Communities) with a 2dp underline on the active one, "8 live" with the dot, search. Right rail, bottom-up from 116dp: more, share, save, comment, flower (each glyph 32dp, white, counts in `meta`), no plates. Bottom-left: avatar (identity colour + initial or photo), name · time, "in <community>" with its crest, caption 2 lines. Text posts set in Bricolage at the length-chosen step on their own field. Photos fill the frame; landscape photos crop to 4:5 with "View whole photo" on tap. Streak lives on You, not as a chip here. The Roxy FAB leaves the feed (open question 1). End of feed: "You're caught up. Your communities are talking in Messages."

**Discover.** A search field on top, then rails each with a plain heading and "See all" only when there is more: Live now (dot + word), This week's events (posters), Communities (crest + name + one line + "84 here now"), The WLW Archive (real cover art), Shops (product photos), Games. Top 10 members stays, photo-first, with the rank as a plain number beside the name (no stroked numerals, no gradient tiles). Chip row scrolls with a right-edge fade. No FAB over cards.

**Create sheet.** Title "Make something". One large row: "Post — a photo, a video or a few words" opening the composer. Below, a short list of what else exists, each one line with who can do it: "Events, rooms and games come from communities. Ask an admin of one you're in." and "Sell on Roxy — apply from You." No tinted icon tiles; 24dp outline icons in `ink2`.

**Messages.** Roxy and Sister pinned as the first two rows (not cards): Roxy's crest is the pink flower, line "Your wingwoman"; Sister's is a quiet blue-grey circle, line "Just for you. Nothing leaves here." Then Requests (count), then people, then community channels grouped under their community with the crest. No caps pills. Row previews show text as today; a "discreet" mode that hides them inside the app is open question 3.

**You.** Header: photo, name, pronouns, one line about her; Edit as a quiet raised pill. Directly under it the two switches that matter, Dating and Ghost, as plain rows with a one-line explanation each. Then Mini Wins (today's three, small, with the streak count in `warning` ink), Tickets & orders, Saved, Sell on Roxy, Settings & safety. No XP bar, no level badge. Posts / Thoughts / Saved tabs below.

**Community + channel.** Community header: crest in its identity colour (square, 28% radius), name in `title`, "1,240 members · 84 here now" with three faces, one Join button (pink) or Joined (raised). Tabs only when populated. The community's own empty state: "No posts here yet. Members' posts land here when they share to Queer Gamers." Channel: Discord-style flat message list (avatar, name, time, text; no bubbles), channel chips under the header, presence ("Priya and 3 others are here"), the composer on `surface` with a pink send only when there is text.

**Archive.** Keep the editorial voice. Real cover art at 2:3 with `sm` radius; title, year, "4.4 from 7 members" in words, no green pill (the score is ink; only "loved" lists get the flower). Filter chips without emoji ("Everything 45", "Films 12", "Series 10", "Books"). Rows separated by space, not bordered cards.

**Onboarding.** Code gate: the wordmark on `ground` (no white box, no gradient hero), the safety sentence kept word for word, the code in Plex Mono in eight separate cells, a pink Continue that is visibly waiting (raised fill, `ink3` label) until the code is complete. Accepted → moment 2. Returning members: a real welcome ("Welcome back.") above the sign-in form, with a photo from the member's own communities where one exists, otherwise type alone. Notification and privacy choices come next, one per screen, previews off by default.

## Open questions for Nicole

1. **The Roxy FAB.** It covers content on Discover and crowds the Feed's rail corner (v0 audit). Proposal: Roxy moves into Messages as the first pinned row and into the You header; the floating button goes. Feature parity holds (she moves, she does not disappear). OK?
2. **Display face.** Outfit is replaced by Bricolage Grotesque (Figtree stays). OK to change the brand's display type?
3. **Discreet mode.** Should Messages offer a mode that hides previews and community names inside the app too (for members who hand their phone to others)? That is a feature, so it needs your call.
4. **Audience and language.** Is the launch audience in the Philippines? If yes, Roxy's wingwoman lines may use Taglish where it fits; the interface copy stays English.
5. **Default theme.** Dark is proposed as the default with light fully supported. Keep dark first?
6. **Flower counts.** Public under the rail (as proposed) or visible only to the author? Private counts are kinder and less like a vanity metric.
7. **Imagery rights.** The Archive needs real cover art and Discover needs member and community photos. Is there a source and licence for cover art (publisher assets, TMDB, Open Library), or do entries fall back to type-only covers in identity colours?
