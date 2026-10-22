Status: APPROVED v2 by Nicole on 2026-10-21 ("deploy them to the code and site right away"). Locked; changes go through `polish/decisions.md`.

# Design Direction — Roxy (v2)

Art Director proposal v2, 2026-10-21. It revises v1 (git commit 0475cf3) to Nicole's 2026-10-21 verdict, which is binding (`polish/decisions.md`). Evidence: `polish/inspiration/material-3-expressive.md` (new; studied on m3.material.io in a real browser, shots `polish/inspiration/shots/m3x-1.png` to `m3x-17.png`), the "Revisit for direction v2" section of `polish/inspiration/duolingo.md`, the other inspiration files, `polish/inspiration/v0-audit.md` (`polish/evidence/v0/`), and the v2 concept boards in `polish/concepts/` (list below). Nothing here is in `apps/mobile/lib/theme.ts`. The v2 token map is staged in `polish/proposed-tokens-v2.md` (writing it into `polish/rules/CLAUDE.md` was blocked for this agent; see that file). Scratch for this revision (font metadata, contrast script, specimens, inspector reports): `D:/Temp/roxy-polish/artdir2/`.

**v2 concept boards** (light first, 390 × 844 phones at 2×, real fonts): `polish/concepts/v2-01-hello-roxy.png`, `v2-02-youre-in.png`, `v2-03-invite-poster.png` (the three signature moments), `v2-04-feed-before-after.png`, `v2-05-fab-and-roxy-ai.png`, `v2-06-messages-discreet.png`, `v2-07-settings.png`, plus `v2-08-type-and-scripts.png` (every launch script and an Arabic right-to-left feed). Shared board code: `roxy-tokens-v2.css`, `roxy-concepts-v2.js`.

## Changes from v1 (Nicole 2026-10-21)

| # | Nicole's verdict | What v2 does |
|---|---|---|
| 1 | Keep the floating Roxy button; it opens Roxy AI; members can switch her off (M173) | The FAB stays on Feed, Discover and You and opens Roxy AI in one tap. She gets a reserved **lane** (88 × 88 dp, bottom end corner, above the bar): the Feed rail starts above the lane, lists end 88 dp higher, and at rest nothing readable or tappable sits under her. While a list scrolls down she **tucks in** (40 dp, eyes closed, half off the screen edge), the M3 extended-FAB behaviour made Roxy's own. Her mark is new and ownable: **the Roxy O**, the O of the wordmark with a face in it. Settings has the Roxy AI switch; off removes the button and closes the lane (boards v2-04, v2-05, v2-07). |
| 2 | The display font may change; snappier and nicer, Duolingo + M3 Expressive | M3 Expressive studied on the real pages (springs, shape and shape morph, emphasized type, FAB menu, extended FAB, button groups, loading indicator, toolbars, navigation bar) and Duolingo re-read for snappiness. Result: M3's spring tokens ported exactly to reanimated 3.10, press-in feedback on every control, a Duolingo lip on the one primary button, shape morph in six named places, emphasized type styles, and a new type pair (Geologica + Commissioner) chosen partly for script coverage. |
| 3 | Light mode is the default | Light is the reference theme and every pair was re-measured light-first (91 pairs, table below). The feed stage stays dark for media in both themes. Settings offers Light · Dark · Match phone. |
| 4 | No flower anywhere; reactions are the regular emoji set | The flower is gone: no flower reaction, count, mark, crest, seal or illustration, and M3's petal-like shapes are banned too. Reactions are `POST_REACTIONS` (shared with chat): double-tap = ❤️ with a snappy burst; long-press = the six-emoji picker; the rail shows her reaction and the total (v2-04). Signature moment 1 is now "Hello, Roxy" (v2-01). |
| 5 | Discreet mode in Messages is Premium (M175); Premium does not exist yet (M176) | Designed the switch, the discreet inbox, the locked state and an honest upgrade sheet; Premium gets entry points only, and what M176 needs is listed (v2-06). |
| 6 | Worldwide launch: localisation and a language setting (M174) | Script coverage of every proposed family measured from Google Fonts metadata; per-script fallbacks (Noto) with sizes and leading; rules for 35-40% longer text; right-to-left rules (what flips, what never does); locale-aware dates, numbers and plurals; the language picker (v2-07, v2-08). English stays the source voice; Taglish is not a default. |
| 7 | Archive covers are uploaded; members suggest edits; admins approve | Uploaded covers at 2:3; a designed type cover when an entry has none; "Add a cover" and "Suggest an edit" entry points into the existing M158 / S041 / S039 flow (v2-05 shows uploaded and fallback covers). |
| 8 | Keep what v1 got right; re-decide nav in light of M3 Expressive | Kept: warm neutrals (no violet), the gradient on the logo only, one primary per screen, bimodal radii, LIVE = dot + word, the dark feed stage, "You're in" and the event poster (both redrawn without flowers). Nav re-decided: the M3 Expressive flexible navigation bar, docked full width, pill active indicator, labels always on; Feed · Discover · ＋Create · Messages · You unchanged. |

## One-line brand feeling

Walking into a room full of women who were expecting you: bold, warm, a bit cheeky, and safe. v2 adds: it answers the instant you touch it.

The idea, in the Taste Skill's sentence form: **on Roxy, the O in Roxy's own name is a face that is always there for you**: the round button in the corner is the O of the wordmark, and it looks back. (Competitor test: HER, Lex or Instagram cannot say this sentence; the mark is made from Roxy's letters and belongs to Roxy AI, the companion only Roxy has.) The O also gives the system its shapes: the full circle (Roxy, avatars, reactions), the pill (actions) and the rounded square (crests and pressed states).

## Audience and device

- **Who:** lesbians and women who love women at every life stage, from questioning to long-partnered (`polish/brief.md`), now **worldwide**. Some are out to everyone, some to almost no one; in some places being out costs a job or a family's peace. What shows outside the app (pushes, previews, share images) and on screen when someone else is looking (discreet mode) is design material.
- **Where she uses it:** a phone in one hand, often in public, often where someone could glance over. Short feed bursts; longer evenings in channels, DMs and with Roxy AI.
- **Languages:** English first, every string translatable (M174). Latin, Vietnamese, Cyrillic and Greek in the brand faces; Arabic, Hebrew, Devanagari and Thai in matched Noto families; Chinese, Japanese and Korean in the phone's own CJK font.
- **Device floor:** a 360 dp Android on 4G; top end a 430 pt iPhone. Expo 51, RN 0.74.5, Old Architecture, `react-native-reanimated` 3.10.1 (installed); the web export at roxy.expo.app behaves the same.
- **Themes:** **light is the default** and the design reference; dark ships with the same roles. The feed stage is always dark; text posts bring their own field.

## Style skill

**Taste Skill v2** (`.claude/skills/design-taste-frontend`), app-screen run (`references/app-screens.md`), `TASTE_SKILL_HISTORY=D:/Temp/roxy-polish/taste-history.json`. v1 took `true-black-flat` for a dark-first app. With light now the default, v2 draws **`accent-ladder`** (`draw.mjs --app --kind community --keep palette --style accent-ladder`, seed 540576178, sheet `D:/Temp/roxy-polish/artdir2/draw-accent-ladder.txt`). Its move is Roxy's light theme exactly: **one brand hue at full strength only on small marks** (the one filled button, the Create key, the Roxy O ring, the unread dot) and **its pale tint doing the area work** (`pinkContainer`: the active nav pill, selected chips and language row, her reaction disc, her own chat bubbles, the discreet banner). Colour budget 3-10%. Its "off-style" list is kept as bans: the full hue on large areas, a second accent family, "a gradient on the trial chip or upgrade button", violet or indigo. Face choices taken: the ladder built from the brand's own pink instead of the dealt raspberry, and the product's own objects in the lead block (posters, covers, photos). Redraw note: the sheet deals DM Sans 400-700; Roxy overrides type with a display face for voice and with families that cover the launch scripts (Typography). Web-only rules are read as principles; phone pre-flight items are under Bans and are checked on every board.

**popular-web-designs** systems, and what each decided:

| System | What Roxy takes | Where |
|---|---|---|
| Airbnb (`templates/airbnb.md`) | One accent with a story; warm near-black text (#222222); paid tiers get their own small colour (Luxe purple #460479, Plus magenta #92174d) instead of a restyled product | Pink as the one accent; Premium gets one small butter tag, never a restyled screen |
| Pinterest (`pinterest.md`) | Warm olive/sand neutrals instead of steel greys; a font stack with Japanese fallbacks "reflecting global reach" | Warm ground/raised greys; per-script font stacks |
| Wise (`wise.md`) | Buttons answer by changing size (`scale(1.05)` on hover), pill buttons, a heavy display used with conviction | On touch there is no hover, so the size change moves to press-in (scale 0.96); Geologica 800 for moments |
| Spotify (`spotify.md`) | Content-first darkness for media | The always-dark feed stage |
| Revolut (`revolut.md`) | Zero shadows; depth from colour contrast | Nothing at rest has a shadow; cards separate by tone |
| Linear (`linear.app.md`) | Hierarchy by luminance steps | ink / ink2 / ink3 |
| Uber (`uber.md`) | Two faces, strict roles | Display vs text split; mono only for codes |

**Material 3 Expressive** (`polish/inspiration/material-3-expressive.md`) supplies the spring tokens, the shape-morph vocabulary, emphasized type, the extended-FAB scroll behaviour, the FAB-menu rules (and why Roxy does not use one) and the flexible navigation bar. **Duolingo** (`duolingo.md`, revisit section) supplies press-in feedback, the hard lip on the primary button, flat full-fill selection, celebration rationed to real success, and a character that carries emotion.

## Typography

**Decision:** display **Geologica** 700/800, text **Commissioner** 400/500/600, mono **IBM Plex Mono** 500 (codes only), with per-script fallbacks. All SIL OFL, all on npm as `@expo-google-fonts/*`, loaded with `expo-font` ~12 (installed). Versions checked on the npm registry 2026-10-21.

| Role | Family | Weights | Package |
|---|---|---|---|
| Display | **Geologica** | 700, 800 | `@expo-google-fonts/geologica` 0.4.2 (`Geologica_700Bold`, `Geologica_800ExtraBold`) — NEW |
| Text / UI | **Commissioner** | 400, 500, 600 | `@expo-google-fonts/commissioner` 0.4.1 — NEW |
| Mono | **IBM Plex Mono** | 500 | `@expo-google-fonts/ibm-plex-mono` 0.4.1 — NEW (invite, ticket and member numbers) |

**Why v1's Bricolage Grotesque + Figtree (and v0's Outfit) go: script coverage.** Subsets from Google Fonts' own metadata (`https://fonts.google.com/metadata/fonts`, fetched 2026-10-21; table saved as `D:/Temp/roxy-polish/artdir2/fontcheck.md`):

| Family | Latin + Ext | Vietnamese | Cyrillic | Greek | Arabic | Hebrew | Devanagari | Thai | CJK |
|---|---|---|---|---|---|---|---|---|---|
| Outfit (v0 display) | yes | — | — | — | — | — | — | — | — |
| Figtree (v0/v1 text) | yes | — | — | — | — | — | — | — | — |
| Bricolage Grotesque (v1 display) | yes | yes | — | — | — | — | — | — | — |
| Rubik (considered) | yes | — | yes | — | yes | yes | — | — | — |
| **Geologica** (v2 display) | yes | yes | yes | yes | — | — | — | — | — |
| **Commissioner** (v2 text) | yes | yes | yes | yes | — | — | — | — | — |
| IBM Plex Mono | yes | yes | yes | — | — | — | — | — | — |
| Noto Sans Arabic · Hebrew · Devanagari · Thai | yes | — | (Hebrew: Cyrillic Ext) | — | Arabic | Hebrew | Devanagari | Thai | — |
| Noto Sans JP · SC · TC · KR | yes | yes | yes | — | — | — | — | — | yes (npm packages 52-96 MB each) |

With Figtree, a Russian, Ukrainian, Greek or Vietnamese interface falls back glyph by glyph to the system font, mixing two typefaces inside one word. Geologica and Commissioner keep one voice across Latin, Vietnamese, Cyrillic and Greek (rendered and checked on v2-08). Character: Geologica 800 is a chunky grotesque with softly rounded joins: the friendly weight M3 Expressive gets from Google Sans Flex, without borrowing Google's face (Google Sans Flex also lacks Cyrillic and Greek). Commissioner is an open text face with a large x-height that stays clear at 12-15 dp. Compared side by side with Bricolage, Rubik, Nunito, Fredoka, Google Sans Flex and Onest (`D:/Temp/roxy-polish/artdir2/specimen.png`, `specimen2.png`): Rubik covers Arabic and Hebrew but reads generic; Nunito and Fredoka read childish for adult women. Weight: the brand files used are 0.90 MB (Geologica 2, Commissioner 3, Plex Mono 1).

**Scale** (dp; at most four steps on one screen). Geologica is wider than Bricolage, so the two big steps come down (44 → 40, 64 → 56).

| Step | Family / weight | Size / leading | Tracking | Use |
|---|---|---|---|---|
| `meta` | Commissioner 500 (emph 600) | 12 / 16 | 0 | timestamps, counts, helper text; the floor |
| `body` | Commissioner 400 (emph 600) | 15 / 22 | 0 | captions, messages, rows |
| `label` / `button` | Commissioner 600 | 15 / 20 · 16 / 20 | 0 | row titles, chips (14/18), buttons |
| `title` | Geologica 700 (emph 800) | 20 / 24 | -0.2 | screen, sheet and card titles |
| `headline` | Geologica 800 | 28 / 32 | -0.4 | Discover / Messages / You titles, Roxy AI's greeting, text posts over 80 characters |
| `display` | Geologica 800 | 40 / 42 | -0.8 | text posts of 30-80 characters, small poster titles |
| `moment` | Geologica 800 | 56 / 56 | -1.4 | text posts under 30 characters, "You're in", poster titles |
| `mono` | Plex Mono 500 | 13 / 18 | +0.5 | codes only |

**Emphasized styles (M3 Expressive).** Each text step has an emphasized twin one weight up at the same size. Use it for state, not decoration: unread rows, the selected chip and nav label, button labels, her own reaction count, Roxy AI's name in her header. At most one emphasized line per row.

**Rules.** Sentence case; no tracked capitals, eyebrows or italic accent words. Display never below 20 dp; Commissioner never above 17 except buttons. Tabular figures on every number that updates. Headlines two lines at most in English at 360 dp, three in translation. Text posts pick their step by length.

**Per-script fallbacks.** The type tokens resolve their family from the **UI language's script**; member content (posts, messages, names) resolves from the **first strong character of the string** (a Unicode range check), so an Arabic post inside an English interface still gets Noto Sans Arabic and right alignment. Leading follows M3's language-height categories (type-scale page, `m3x-11`: base = Latin except Vietnamese, Cyrillic, Greek, Hebrew; ~7% taller = Arabic, Chinese, Hindi, Japanese, Korean, Thai, Vietnamese and most others; ~30% taller = Burmese, Telugu), rounded up to the 2 dp grid and opened further where stacked marks need it. Every row below is rendered on board v2-08.

| Script | UI family (weights) | Package | body | title · headline · display | Tracking | Notes |
|---|---|---|---|---|---|---|
| Latin, Latin Ext | Geologica + Commissioner | above | 15 / 22 | 20/24 · 28/32 · 40/42 | as scale | — |
| Vietnamese | same | same | 15 / 24 | 20/26 · 28/34 · 40/48 | as scale | stacked diacritics need the extra leading |
| Cyrillic, Greek | same | same | 15 / 22 | as Latin | as scale | — |
| Arabic | Noto Sans Arabic 400 / 600 / 700 | `@expo-google-fonts/noto-sans-arabic` 0.4.3 | **16 / 26** | 20/30 · 26/40 (700) · 34/50 | **0** | right to left; never letter-space (it breaks the joins); display at 700 |
| Hebrew | Noto Sans Hebrew 400 / 600 / 700 | `…/noto-sans-hebrew` 0.4.1 | 15 / 22 | 20/26 · 28/34 · 40/46 | 0 | right to left |
| Devanagari (Hindi, Marathi, Nepali) | Noto Sans Devanagari 400 / 600 / 700 | `…/noto-sans-devanagari` 0.4.1 | 15 / 26 | 20/30 · 26/38 · 36/52 | 0 | marks above and below the line |
| Thai | Noto Sans Thai 400 / 600 / 700 (loopless) | `…/noto-sans-thai` 0.4.2 | 15 / 26 | 20/30 · 26/38 · 36/52 | 0 | Noto Sans Thai Looped is the option if Thai testers ask for it in long reading |
| Chinese, Japanese, Korean | **the phone's system CJK font** (iOS PingFang / Hiragino Sans / Apple SD Gothic Neo; Android Noto Sans CJK), system bold for display | none (the Noto JP/SC/TC/KR packages are 52-96 MB) | 15 / 24 | 20/28 · 24/32 · 32/42 | 0 | display a step smaller (CJK reads larger per character); no italics |
| Any other script | system font | — | 15 / 24 | as CJK | 0 | Burmese and Telugu +30% leading |

The four Noto families at three weights add 1.53 MB. Load only the active language's script at start; other scripts' fonts load on first use (`expo-font`). Never apply uppercase, italics or negative tracking outside Latin, Cyrillic and Greek.

## Color

**The rule:** colour carries meaning or identity, never decoration. Grounds are warm neutrals; pink marks the one action and the selected state; identity colours belong to communities, events and fallback covers; semantics are for state; butter marks Premium and nothing else. The brand gradient (#FF5A2E → #F22481 → #E0189A) stays on the wordmark and the app icon only.

| Role | Light (default) | Dark | Job |
|---|---|---|---|
| `ground` | #F6F3F2 | #141113 | page |
| `surface` | #FFFDFD | #1E1A1C | cards, sheets, others' chat bubbles |
| `raised` | #ECE7E6 | #2A2528 | inputs, chips at rest, quiet buttons, skeletons |
| `line` | #E0D9D8 | #3A3337 | rules inside settings cards and inputs only |
| `control` | #8C8186 | #6E6469 | outlined controls, switch-off outline, radio rings |
| `ink` / `ink2` / `ink3` | #1A1216 / #544A4F / #675C61 | #F7F2F4 / #C3B8BD / #A1959B | text steps |
| `pink` (the action) | **#C8126A** | #F22481 | the one primary button, Create, Roxy O ring, switch on, unread dot |
| `onPink` | **#FFFFFF** | #17080F | label on `pink` |
| `pinkInk` | #C8126A (same as `pink`) | #FF6FA6 | pink as text and links |
| `pinkLip` | #8E0C4A | #A5145A | the 3 dp lip under the primary button |
| `pinkContainer` / `onPinkContainer` | #FFD9E7 / #5C0A31 | #5A1236 / #FFD9E7 | selection and her own things (nav pill, chips, reaction disc, her bubbles, discreet banner, tonal Join). Never `pink` text on it (4.35:1, FAIL) |
| `brandPink` / `onBrandPink` | #F22481 / #17080F | same | the "You're in" field, the Roxy O ring on the dark stage; `onBrandPink` inks every identity fill (white on #F22481 fails at 3.93:1) |
| `inverse` / `onInverse` / `inversePink` | #2B2427 / #F7F2F4 / #FF9EC3 | #F1ECEA / #1A1216 / #C8126A | snackbars and their Undo |
| `premium` / `onPremium` | #F2C94C / #1A1216 | same | the Premium tag and lock badge only |

Why the light action pink moves from #F22481 to **#C8126A**: on a light ground the brand pink cannot carry a white label (3.93:1), and v1's dark label on hot pink read heavy in a light UI. #C8126A carries white at 5.60:1, stays in the same pink family next to the logo, and doubles as text on light grounds (5.07:1 on `ground`). The hot brand pink keeps its job as a field ("You're in") and as the Roxy O ring on the dark stage.

**The always-dark feed stage:** `stage` #0B0A0A behind media in both themes; `stageRaised` #262124 for the active nav pill on the Feed; chrome is white glyphs with a 1 dp dark outline; the caption band keeps v0's dp-anchored scrim (0.62 → 0.88 black, `feedChromeTokens`). Text posts bring one of three fields: `fieldInk` #151113, `fieldPaper` #F3F1F0, `brandPink` #F22481 (with `onBrandPink`).

**Identity fields** (crests, posters, member initials, fallback covers; never chrome): pink #F22481, tangerine #FF7A45, butter #F2C94C, sage #8FC4A0, sky #8FB8DE, rose #E8A0BF, each with `onBrandPink` ≥ 4.96:1. They replace `COMMUNITY_CHIP_COLORS` and its violet #7B45F5.

**Semantic** (light fill / ink · dark fill / ink): success #177A47 / #13703F · #3CCB86 / #62DBA0; warning (also streak) #B07A10 / #8A5E06 · #F2B33D / #F6C766; danger #C8262C / #B21F25 · #FF5D5D / #FF7B7B; live dot #E8481E · #FF5A2E, always with the word; Sister #4F6B7C / #3E5868 · #9FB6C4 / #B9CBD6.

**Measured contrast, light first** (WCAG 2.2 relative luminance; `D:/Temp/roxy-polish/artdir2/contrast.cjs` on `palette-v2.json`, 2026-10-21; text needs 4.5:1, non-text marks 3:1; 50 light, 29 dark, 12 stage pairs). The three FAIL rows are there on purpose: they are rules ("never pink text on `pinkContainer`", "no white label on the brand pink").

| Theme | Pair | Text / mark | On | Ratio | Needs | Result |
|---|---|---|---|---|---|---|
| light | ink on ground | `ink` #1A1216 | `ground` #F6F3F2 | 16.66:1 | 4.5:1 | pass |
| light | ink on surface | `ink` #1A1216 | `surface` #FFFDFD | 18.14:1 | 4.5:1 | pass |
| light | ink on raised | `ink` #1A1216 | `raised` #ECE7E6 | 15.01:1 | 4.5:1 | pass |
| light | ink2 on ground | `ink2` #544A4F | `ground` #F6F3F2 | 7.70:1 | 4.5:1 | pass |
| light | ink2 on surface | `ink2` #544A4F | `surface` #FFFDFD | 8.39:1 | 4.5:1 | pass |
| light | ink2 on raised | `ink2` #544A4F | `raised` #ECE7E6 | 6.94:1 | 4.5:1 | pass |
| light | ink3 on ground | `ink3` #675C61 | `ground` #F6F3F2 | 5.80:1 | 4.5:1 | pass |
| light | ink3 on surface | `ink3` #675C61 | `surface` #FFFDFD | 6.32:1 | 4.5:1 | pass |
| light | ink3 on raised | `ink3` #675C61 | `raised` #ECE7E6 | 5.23:1 | 4.5:1 | pass |
| light | pink as text/link on ground | `pink` #C8126A | `ground` #F6F3F2 | 5.07:1 | 4.5:1 | pass |
| light | pink as text/link on surface | `pink` #C8126A | `surface` #FFFDFD | 5.52:1 | 4.5:1 | pass |
| light | pink as text on raised | `pink` #C8126A | `raised` #ECE7E6 | 4.57:1 | 4.5:1 | pass |
| light | onPink (white) label on pink fill | `onPink` #FFFFFF | `pink` #C8126A | 5.60:1 | 4.5:1 | pass |
| light | onPinkContainer on pinkContainer (selected chip, nav pill icon, her reaction) | `onPinkContainer` #5C0A31 | `pinkContainer` #FFD9E7 | 10.59:1 | 4.5:1 | pass |
| light | pink text on pinkContainer | `pink` #C8126A | `pinkContainer` #FFD9E7 | 4.35:1 | 4.5:1 | FAIL |
| light | ink on pinkContainer | `ink` #1A1216 | `pinkContainer` #FFD9E7 | 14.30:1 | 4.5:1 | pass |
| light | onBrandPink on brandPink (hero field: You're in) | `onBrandPink` #17080F | `brandPink` #F22481 | 4.96:1 | 4.5:1 | pass |
| light | white on brandPink (rejected) | `white` #FFFFFF | `brandPink` #F22481 | 3.93:1 | 4.5:1 | FAIL |
| light | pink fill as a mark on ground (FAB, switch track; non-text) | `pink` #C8126A | `ground` #F6F3F2 | 5.07:1 | 3:1 | pass |
| light | pink fill as a mark on surface (non-text) | `pink` #C8126A | `surface` #FFFDFD | 5.52:1 | 3:1 | pass |
| light | FAB face (white) inside pink ring (non-text) | `white` #FFFFFF | `pink` #C8126A | 5.60:1 | 3:1 | pass |
| light | onInverse on inverse (snackbar) | `onInverse` #F7F2F4 | `inverse` #2B2427 | 13.70:1 | 4.5:1 | pass |
| light | inversePink action on inverse (snackbar Undo) | `inversePink` #FF9EC3 | `inverse` #2B2427 | 7.90:1 | 4.5:1 | pass |
| light | successInk on ground | `successInk` #13703F | `ground` #F6F3F2 | 5.57:1 | 4.5:1 | pass |
| light | successInk on surface | `successInk` #13703F | `surface` #FFFDFD | 6.06:1 | 4.5:1 | pass |
| light | warningInk on ground | `warningInk` #8A5E06 | `ground` #F6F3F2 | 5.16:1 | 4.5:1 | pass |
| light | warningInk on surface | `warningInk` #8A5E06 | `surface` #FFFDFD | 5.62:1 | 4.5:1 | pass |
| light | dangerInk on ground | `dangerInk` #B21F25 | `ground` #F6F3F2 | 6.10:1 | 4.5:1 | pass |
| light | dangerInk on surface | `dangerInk` #B21F25 | `surface` #FFFDFD | 6.65:1 | 4.5:1 | pass |
| light | surface label on success fill | `surface` #FFFDFD | `success` #177A47 | 5.30:1 | 4.5:1 | pass |
| light | surface label on danger fill | `surface` #FFFDFD | `danger` #C8262C | 5.50:1 | 4.5:1 | pass |
| light | ink label on warning fill | `ink` #1A1216 | `warning` #B07A10 | 4.94:1 | 4.5:1 | pass |
| light | sisterInk on ground | `sisterInk` #3E5868 | `ground` #F6F3F2 | 6.79:1 | 4.5:1 | pass |
| light | sisterInk on surface | `sisterInk` #3E5868 | `surface` #FFFDFD | 7.40:1 | 4.5:1 | pass |
| light | live dot on ground (non-text, always with the word) | `liveDot` #E8481E | `ground` #F6F3F2 | 3.54:1 | 3:1 | pass |
| light | live dot on surface (non-text) | `liveDot` #E8481E | `surface` #FFFDFD | 3.85:1 | 3:1 | pass |
| light | control outline on ground (switch off track, inputs; non-text) | `control` #8C8186 | `ground` #F6F3F2 | 3.40:1 | 3:1 | pass |
| light | control outline on surface (non-text) | `control` #8C8186 | `surface` #FFFDFD | 3.70:1 | 3:1 | pass |
| light | onPremium on premium tag | `onPremium` #1A1216 | `premium` #F2C94C | 11.59:1 | 4.5:1 | pass |
| light | onBrandPink on crest tangerine | `onBrandPink` #17080F | `crestTangerine` #FF7A45 | 7.53:1 | 4.5:1 | pass |
| light | onBrandPink on crest butter | `onBrandPink` #17080F | `crestButter` #F2C94C | 12.28:1 | 4.5:1 | pass |
| light | onBrandPink on crest sage | `onBrandPink` #17080F | `crestSage` #8FC4A0 | 9.81:1 | 4.5:1 | pass |
| light | onBrandPink on crest sky | `onBrandPink` #17080F | `crestSky` #8FB8DE | 9.35:1 | 4.5:1 | pass |
| light | onBrandPink on crest rose | `onBrandPink` #17080F | `crestRose` #E8A0BF | 9.47:1 | 4.5:1 | pass |
| light | onBrandPink on crest pink | `onBrandPink` #17080F | `crestPink` #F22481 | 4.96:1 | 4.5:1 | pass |
| light | ink2 on pinkContainer (meta on a selected row) | `ink2` #544A4F | `pinkContainer` #FFD9E7 | 6.61:1 | 4.5:1 | pass |
| light | switch off thumb (control) on raised track (non-text) | `control` #8C8186 | `raised` #ECE7E6 | 3.06:1 | 3:1 | pass |
| light | primary button lip vs ground (non-text edge) | `#8E0C4A` #8E0C4A | `ground` #F6F3F2 | 8.26:1 | 3:1 | pass |
| light | nav inactive label (ink2) on ground | `ink2` #544A4F | `ground` #F6F3F2 | 7.70:1 | 4.5:1 | pass |
| light | success fill (ticket check, non-text) on surface | `success` #177A47 | `surface` #FFFDFD | 5.30:1 | 3:1 | pass |
| dark | ink on ground | `ink` #F7F2F4 | `ground` #141113 | 16.94:1 | 4.5:1 | pass |
| dark | ink on surface | `ink` #F7F2F4 | `surface` #1E1A1C | 15.55:1 | 4.5:1 | pass |
| dark | ink on raised | `ink` #F7F2F4 | `raised` #2A2528 | 13.61:1 | 4.5:1 | pass |
| dark | ink2 on ground | `ink2` #C3B8BD | `ground` #141113 | 9.75:1 | 4.5:1 | pass |
| dark | ink2 on surface | `ink2` #C3B8BD | `surface` #1E1A1C | 8.95:1 | 4.5:1 | pass |
| dark | ink2 on raised | `ink2` #C3B8BD | `raised` #2A2528 | 7.83:1 | 4.5:1 | pass |
| dark | ink3 on ground | `ink3` #A1959B | `ground` #141113 | 6.51:1 | 4.5:1 | pass |
| dark | ink3 on surface | `ink3` #A1959B | `surface` #1E1A1C | 5.97:1 | 4.5:1 | pass |
| dark | ink3 on raised | `ink3` #A1959B | `raised` #2A2528 | 5.23:1 | 4.5:1 | pass |
| dark | pinkInk on ground | `pinkInk` #FF6FA6 | `ground` #141113 | 7.22:1 | 4.5:1 | pass |
| dark | pinkInk on surface | `pinkInk` #FF6FA6 | `surface` #1E1A1C | 6.62:1 | 4.5:1 | pass |
| dark | pinkInk on raised | `pinkInk` #FF6FA6 | `raised` #2A2528 | 5.79:1 | 4.5:1 | pass |
| dark | onPink label on pink fill | `onPink` #17080F | `pink` #F22481 | 4.96:1 | 4.5:1 | pass |
| dark | white label on pink fill (rejected) | `white` #FFFFFF | `pink` #F22481 | 3.93:1 | 4.5:1 | FAIL |
| dark | onPinkContainer on pinkContainer | `onPinkContainer` #FFD9E7 | `pinkContainer` #5A1236 | 10.37:1 | 4.5:1 | pass |
| dark | pink fill as a mark on ground (non-text) | `pink` #F22481 | `ground` #141113 | 4.78:1 | 3:1 | pass |
| dark | onInverse on inverse (snackbar) | `onInverse` #1A1216 | `inverse` #F1ECEA | 15.70:1 | 4.5:1 | pass |
| dark | inversePink on inverse (snackbar Undo) | `inversePink` #C8126A | `inverse` #F1ECEA | 4.78:1 | 4.5:1 | pass |
| dark | successInk on ground | `successInk` #62DBA0 | `ground` #141113 | 10.86:1 | 4.5:1 | pass |
| dark | warningInk on ground | `warningInk` #F6C766 | `ground` #141113 | 11.86:1 | 4.5:1 | pass |
| dark | dangerInk on ground | `dangerInk` #FF7B7B | `ground` #141113 | 7.48:1 | 4.5:1 | pass |
| dark | dangerInk on surface | `dangerInk` #FF7B7B | `surface` #1E1A1C | 6.86:1 | 4.5:1 | pass |
| dark | ground label on success fill | `ground` #141113 | `success` #3CCB86 | 9.00:1 | 4.5:1 | pass |
| dark | ground label on danger fill | `ground` #141113 | `danger` #FF5D5D | 6.23:1 | 4.5:1 | pass |
| dark | sisterInk on ground | `sisterInk` #B9CBD6 | `ground` #141113 | 11.24:1 | 4.5:1 | pass |
| dark | live dot on ground (non-text) | `liveDot` #FF5A2E | `ground` #141113 | 6.03:1 | 3:1 | pass |
| dark | control outline on ground (non-text) | `control` #6E6469 | `ground` #141113 | 3.30:1 | 3:1 | pass |
| dark | control outline on surface (non-text) | `control` #6E6469 | `surface` #1E1A1C | 3.03:1 | 3:1 | pass |
| dark | onPremium on premium tag | `onPremium` #1A1216 | `premium` #F2C94C | 11.59:1 | 4.5:1 | pass |
| stage | white on stage | `white` #FFFFFF | `stage` #0B0A0A | 19.77:1 | 4.5:1 | pass |
| stage | white on stageRaised (nav active pill on Feed) | `white` #FFFFFF | `stageRaised` #262124 | 15.84:1 | 4.5:1 | pass |
| stage | brandPink FAB on stage (non-text) | `brandPink` #F22481 | `stage` #0B0A0A | 5.03:1 | 3:1 | pass |
| stage | fieldPaper text on fieldInk card | `fieldPaper` #F3F1F0 | `fieldInk` #151113 | 16.63:1 | 4.5:1 | pass |
| stage | fieldInk text on fieldPaper card | `fieldInk` #151113 | `fieldPaper` #F3F1F0 | 16.63:1 | 4.5:1 | pass |
| stage | onBrandPink text on brandPink field card | `onBrandPink` #17080F | `brandPink` #F22481 | 4.96:1 | 4.5:1 | pass |
| stage | lightInk2 on fieldPaper card | `lightInk2` #544A4F | `fieldPaper` #F3F1F0 | 7.55:1 | 4.5:1 | pass |
| stage | nav inactive label (#C3B8BD) on stage | `#C3B8BD` #C3B8BD | `stage` #0B0A0A | 10.27:1 | 4.5:1 | pass |
| stage | feed meta #E3DCDF on scrim top (0.62 black over a white frame) | `#E3DCDF` #E3DCDF | `#616161` #616161 | 4.59:1 | 4.5:1 | pass |
| stage | Roxy O face disc on brandPink ring (non-text) | `#FFFDFD` #FFFDFD | `brandPink` #F22481 | 3.88:1 | 3:1 | pass |
| stage | Caption white on scrim top (0.62 black over white frame) | #FFFFFF | #616161 | 6.19:1 | 4.5:1 | pass |
| stage | Secondary 82% white on scrim top | #e3e3e3 | #616161 | 4.83:1 | 4.5:1 | pass |

## Spacing, radius, elevation, shape

- **Base unit 4.** Scale 4, 8, 12, 16, 20, 24, 32, 48, 64. Screen margin 16 (20 on text posts). Inside a group 8-12; between groups 24-32.
- **Touch:** every control ≥ 48 dp (`MIN_TOUCH_TARGET`); rows 56 / 64 / 72; buttons 52; rail glyphs 32 in 48 targets.
- **Radius, bimodal plus one press step** (M3's corner scale, `m3x-8`, trimmed to Roxy's set): `sm` 8 (inputs, code cells, small tiles, archive covers), `md` 20 (cards, posters, chat bubbles, snackbars), `sheet` 28 (sheet top corners, the membership card), `pill` (buttons, chips, nav indicator, FAB). **`press` 12** exists only as the press-morph target and for the Create key. Crests are squircles at 28% of their size. Nested radii step down (28 → 20 → 8, M3's "optical roundness"). No 10/14/15/18/26.
- **Elevation, only on what floats:** `float` (FAB, reaction picker, menus, snackbars) = 0 10 28 rgba(26,18,22,.16) + 0 2 6 rgba(26,18,22,.10) in light, 0 10 28 rgba(0,0,0,.5) in dark. `pop` (sheets) = 0 -2 10 rgba(26,18,22,.10): sheets sit on a scrim, so tone does the lift and the shadow only edges it. Cards separate from the ground by one tone step. Hard offsets, never blurs, for physical edges: the primary button's 3 dp lip (`pinkLip`) and the membership card's 6 dp edge.
- **Shape library (Roxy's, not M3's 35):** circle (Roxy O, avatars, reaction disc), pill (actions, chips, nav pill), rounded square (crests, pressed state, Create), the 2:3 cover, and one **16-point burst** for the RSVP seal only. Banned: M3's Flower, 4-leaf and 8-leaf clovers, the scalloped "cookie" shapes, Soft burst and Puffy (`m3x-6`): they read as flowers.
- **Where shape morph is used, and nowhere else:** (1) every pill-shaped control on press-in, full → 12 radius while scaling to 0.96 (M3 button groups, `m3x-10`); (2) the nav pill growing 32 → 56 dp wide on selection; (3) the Create key turning 45° into a close × while the Create sheet rises; (4) the Roxy O FAB growing into the Roxy AI sheet's 80 dp avatar (container transform); (5) the "I'm going" pill becoming the 16-point seal; (6) the eight invite-code cells merging into one membership card. Roxy AI's "writing" indicator is the O squashing circle → squircle → pill → circle (M3's loading-indicator idea in Roxy's own shapes). Never morph a container while someone is reading the text in it.
- **On RN 0.74 Old Architecture:** radius and width morphs are `borderRadius` / `width` driven by reanimated springs on the UI thread; free-form morphs (writing indicator, seal, code cells) are one `react-native-svg` `Path` whose `d` a worklet interpolates between shapes authored with the same number of cubic segments (`useAnimatedProps`). No Skia, Lottie or Rive.
- **Navigation:** the M3 Expressive **flexible navigation bar**, docked full width, no shadow: 64 dp plus the bottom inset; five slots Feed · Discover · ＋Create · Messages · You; labels always shown (12/16, emphasized when active); active = filled icon on a 56 × 32 pill in `pinkContainer` (on the Feed: `stageRaised` with white); Create is a 52 × 40 `pink` key, radius 12, white + (its "Create" label is for screen readers); unread is an 8 dp `pink` dot. Full width leaves room for labels 40% longer than English. M3 also rules out a floating toolbar together with a navigation bar, so screens use top app bars and sheets, never a second floating bar.

## Motion

Physics, not curves (M3 Expressive). Port each M3 token as a **physical spring**: `withSpring(v, { mass: 1, stiffness, damping })` with damping = 2·ζ·√stiffness. Do **not** pass `dampingRatio` to reanimated 3.10.1 without a duration: in `springUtils.ts` that key belongs to the duration-based spring (`{ duration, dampingRatio }`, duration defaults to 2000 ms), so it would stretch every move to two seconds (checked in `node_modules/react-native-reanimated/src/reanimated2/animation/springUtils.ts` and `spring.ts`). The same numbers work in the legacy `Animated.spring`. `expo-haptics` ~13.0.1 for touch.

| Token | M3 Expressive (stiffness / ζ) | Reanimated `{ stiffness, damping }`, mass 1 | Use |
|---|---|---|---|
| `SPRING.fastSpatial` | 800 / 0.6 | 800 / 33.9 | press-in and release, chips, switch thumb, nav pill, reaction pop and squish, FAB tuck, picker items |
| `SPRING.spatial` | 380 / 0.8 | 380 / 31.2 | sheets (Roxy AI, Create, upgrade), the FAB → sheet morph, picker open and close, snackbar in |
| `SPRING.slowSpatial` | 200 / 0.8 | 200 / 22.6 | full-screen moments: the "You're in" flood and card, the seal's travel |
| `SPRING.fastEffects` | 3800 / 1 | 3800 / 123.3 | colour and state-layer changes on press and selection |
| `SPRING.effects` | 1600 / 1 | 1600 / 80.0 | scrims, fades, the burst ring |
| `SPRING.slowEffects` | 800 / 1 | 800 / 56.6 | full-screen crossfades |
| `SPRING.calm` | 700 / 0.9 (M3 standard) | 700 / 47.6 | page pushes, toasts, anything carrying text being read |
| `MOTION.pulse` | — | 1400 ms opacity 1 → 0.4 | the LIVE dot only |

Spatial springs (position, size, rotation, radius) may overshoot; effects springs (colour, opacity) never do. These replace `lib/motion.ts` `SNAP_SPRING` (tension 420, friction 16) and `PRESS_SPRING` (tension 380, friction 12). On the web export reanimated springs run as they are; where a CSS transition is unavoidable, use M3's curve stand-ins listed in `material-3-expressive.md`.

**Press states (Duolingo + M3).** Every control answers on press-in, inside one frame, not on release.
- **The one primary button per screen:** `pink` face on a 3 dp `pinkLip`; press-in drops the face 3 dp onto the lip (`fastSpatial`); release springs back. Disabled: `raised` face, `ink3` label, no lip.
- **Everything else pressable:** scale 0.96 on press-in (`fastSpatial`) plus a state layer of `ink` at 8% (dark 10%) via `fastEffects`; pills and chips also morph to radius 12.
- **Selection** is a full flat fill in `pinkContainer` with the emphasized label: no glow, no outline.
- **Optimistic state:** a tap changes the screen before the network answers; a failure rolls back with one sentence and Retry.

**Haptics** (`expo-haptics`): `selectionAsync` on tab change, chip / segment / theme selection and each emoji the finger passes in the picker; `impactAsync(Light)` on a committed reaction, on opening Roxy AI from the FAB and on a switch; `impactAsync(Medium)` when the RSVP seal lands; `notificationAsync(Success)` on "You're in". Nothing else buzzes: not scrolling, not errors, not keystrokes.

**What moves:** presses, the reaction burst and picker, the nav pill, sheets, the FAB tuck and its morph into Roxy AI, Roxy's blink (every 4-7 s at rest) and glance, her writing indicator, the three signature moments, the LIVE dot. **What never moves:** text someone is reading (it may slide in with `calm`, never bounce), rail positions, list rows on load (no staggered fade-ins), the logo. No confetti. Numbers do not count up; her own +1 rolls one digit (`fastEffects`).

**Reduced motion** (`useReducedMotion()`, in reanimated 3.10 and `hooks/useReducedMotion.ts`): spatial springs jump to their end state; effects become 120 ms fades; the burst, the seal's travel and the card merge are skipped (end state shown); Roxy neither blinks nor glances; the LIVE dot is steady; the FAB tuck becomes a fade to the tucked state. Haptics stay.

## Signature moments

1. **Hello, Roxy** (FAB → Roxy AI; `polish/concepts/v2-01-hello-roxy.png`). She taps the O: it squishes (`fastSpatial`), a light haptic, and the circle grows into the 80 dp avatar sitting on the top edge of the Roxy AI sheet as the sheet rises over Discover (`spatial`, container transform). Roxy's face goes from `open` to `happy`; the greeting arrives line by line, not letter by letter: "Evening, Amara. / How are you, really?" then "I'm here for the big stuff and the small stuff. Pick one or just start typing." Three suggestions ("I'm nervous about an event", "Help me write my intro", "I just want to talk"); the pressed one morphs to a rounded square in `pinkContainer`. Composer "Message Roxy AI"; "Only you see this chat."; "Roxy AI is an AI and can get things wrong." Why this replaces the flower: Roxy AI is the emotional companion only Roxy has (Nicole), the O is made from the wordmark, M3 advises spending expressiveness on one or two key emotional interactions, and Duolingo shows that a character carries feeling better than a sparkle icon.
2. **You're in** (onboarding; `v2-02-youre-in.png`). The eight code cells snap together (shape morph) into one white membership card; the screen floods `brandPink`; the card settles at -3° on a hard 6 dp edge (`slowSpatial`); success haptic. "You're in, Amara." / "Your card is ready. Show it to the friend who sent you the code." Card: the vouching community's crest and name ("Lagos Sapphic Readers, vouched for you"), "Amara Okafor", "Member since 21 October 2026", member number in mono, the wordmark. One ink button "Come in"; "Share your card"; "A shared card never names the community unless you add it." Kept because it earns it: Roxy's safety story (every member is vouched for) turned into the one artifact she sends her friend. The flower is gone; the card is the hero.
3. **The invite is a poster** (community events; `v2-03-invite-poster.png`). Each event is a poster in its community's identity colour, title at `moment` ("Full moon swim", Clovelly Dawn Dippers, Sydney). "I'm going" morphs from a pill into the 16-point seal that stamps the poster's corner at 9° (`slowSpatial` + medium haptic); the ticket row appears with a mono code. Who is going is visible only to people going; the exact meeting point is only on the ticket; the link preview names neither the event nor the club. Kept from v1, with the flower plate replaced by the event's own picture in flat identity shapes (a full moon over the sea).

The reaction burst is the everyday interaction, not a signature moment: Duolingo celebrates only real success, and a reaction is feedback.

## Copy voice

Roxy talks like the friend who knows everyone at the party: warm, direct, a bit cheeky, never clinical, never a product manual. Short sentences, sentence case, contractions. She says "women" plainly and uses in-group words members use ("sapphic", "WLW", "your people") without forcing them. Errors say what happened and what to do next. Emoji belong to members' content and reactions, never to the interface.

**Roxy AI** speaks for herself: emotionally literate, curious, honest that she is an AI when it matters, never pretending to be a person, never "assistant", "chatbot", "ask me anything" or "always on". She never sells (no Premium pitch in her replies) and never reads a post or screen she was not asked about. Sister speaks less and softer.

**Source language:** English is the source; translators get a voice brief (warm, direct, a bit cheeky, never clinical) and informal "you" (tu, du, tú) by default. Taglish is not a default.

| v0 / v1 | v2 |
|---|---|
| "Hey! I'm Roxy 😄 Your WLW wingwoman 💜 Ask me anything…" (v0) | "Evening, Amara. How are you, really?" |
| "always on — replies instantly" (v0) | "Only you see this chat." |
| "Roxy companion menu" (v0 FAB label) | "Roxy AI" (hint: "Opens your chat with Roxy AI") |
| "Your first flower. Flowers, not likes." (v1) | (gone) |
| Settings row, new | "Roxy AI · Your companion, one tap away on Feed, Discover and You" |
| Switching her off, new | "Roxy AI is off. The round button is gone from your screens." · Undo |
| Discreet, locked, new | "Keep your chats to yourself" · "For when someone can see your screen. Discreet mode comes with Roxy Premium" · "See Roxy Premium" · "Not now" |
| Archive, no cover, new | "Add a cover" · "Something wrong or missing? Suggest an edit" |
| Language switch to right to left, new | "Switching to العربية turns Roxy right to left. Roxy will restart." · "Restart now" · "Not now" |
| "No private messages" (v0) | "No messages yet. When someone writes, it waits here as a request until you say yes." |
| "Nothing on the calendar yet." (v0) | "Nothing on the calendar yet. Your communities post events here first." |
| "Browse all 0 →" (v0) | (hidden until there is something to browse) |

## Bans

From the plan, unchanged: generic gradient heroes, purple-blue AI glow, stock illustration, one font for everything, cards inside cards, 3-column feature grids, placeholder text, lorem, emoji in UI chrome.

Added, each with its reason:
- **The flower, anywhere:** reaction, count, mark, crest, seal, illustration, and M3's petal-like shapes (Flower, clovers, cookies, Soft burst, Puffy) (Nicole, 2026-10-21).
- Violet, indigo and lilac anywhere, including M3's demo purples (v0 ground #14082A, secondary #A78BFA).
- The brand gradient anywhere except the wordmark and the app icon (S2); the only other gradient is the neutral media scrim. No gradient on the Premium button or tag.
- Glow, glass, backdrop blur; shadows on resting elements (only the FAB, picker, menus, snackbars and sheets float).
- Tracked-caps eyebrows and pills that repeat a heading (S4); icons in tinted squares (S5); the sparkle ✦ as Roxy's mark.
- **A FAB over text or a control at rest** (the lane rule); a FAB menu; a floating pill nav; a floating toolbar together with the nav bar (M3 forbids it too).
- Spinners as a loading state: lists load as skeletons at their final layout; single waits of 0.2-5 s show Roxy's writing indicator (M3: nothing under 200 ms, a progress bar over 5 s).
- XP bars, levels and points on her own profile; confetti; count-up numbers; overshoot on text being read.
- Letterboxed media in the feed.
- Location, guest names or event names shown by default anywhere outside the person's own view.
- Words: "assistant", "chatbot", "ask me anything", "always on", "unlock", "seamless", "journey". ("Roxy AI" as her name is allowed since 2026-10-21.)
- **Premium dark patterns:** countdowns, fake scarcity, pre-selected trials, confirmshaming, an upgrade sheet that opens by itself or repeats, upsell inside Roxy AI's replies or on content, and paywalling any safety feature (block, report, mute, request-first messages, private lock-screen previews).
- Negative tracking, uppercase or italics on non-Latin scripts; fixed-width text boxes; sentences built by concatenation.

**Taste Skill pre-flight items that apply on a phone**, checked on every board: one dominant thing per screen; a title on every screen; two or three type sizes doing the work; equal 16 dp margins; no blank band taller than half the screen; one accent; every word ≥ 4.5:1; every target ≥ 48 dp; nothing over a headline; nothing under the FAB at rest; every state designed (loading, empty, error) with the next step in words. Tool results on the v2 boards (2026-10-21): `lint.mjs --app` 0 FAIL, 0 WARN on all 10 files. `inspect.mjs --app`: 0 FAIL on all 8 boards, with these rules allowed and why: `covered-text` on v2-01 and v2-06 (the modal scrim dims the screen behind an open sheet), `emoji` on v2-04 (the reactions are member content, POST_REACTIONS), `text-shadow` on v2-04 and v2-08 (legibility shadows on media chrome, today's `CHROME_SHADOW`), `font-count` on v2-08 (it is the script specimen). Remaining WARNs, defended: three faces where a code is shown (mono has one job), `moment`-size titles on the two moment screens, three h1s on three-phone boards, colour share from photos, and end-of-list space (`D:/Temp/roxy-polish/artdir2/inspect-final.txt`).

## What changes from v0 and why

| Change | v0 evidence (`polish/evidence/v0/`) | Why |
|---|---|---|
| Violet ground → warm neutrals, **light first** (#F6F3F2), dark #141113 | every screen | Violet is the generated-app hue; light is Nicole's default; warm neutrals let photos and one pink carry the brand |
| Gradient on everything → gradient on the logo only; one flat pink action with a lip | onboarding-1, feed-1-foryou, discover-3/4, you-1 | A gradient on twenty surfaces means nothing (S2); the lip makes the one action feel pressable (Duolingo) |
| Outfit + Figtree → Geologica + Commissioner, Noto per script; body 13 → 15 | all | Voice, plus Cyrillic, Greek and Vietnamese in the same faces for a worldwide launch |
| Static presses and timing curves → press-in feedback and M3 Expressive springs | all | Snappier: feedback on touch-down, physics that land the same when interrupted |
| Feed: checklist card under ~20 controls → the post is the screen; five glyphs, no plates | feed-1-foryou | TikTok grammar; core loop first |
| Heart (and v1's flower) → the shared emoji set with a burst and a picker | feed-1-foryou rail | Nicole: regular emoji, one vocabulary with chat |
| Gradient FAB on the rail and on Discover cards → the Roxy O in her own lane, tucking on scroll | feed-1-foryou, discover-1-retry, discover-4 | Nicole keeps the FAB; the lane and the tuck end the occlusion the audit found |
| FAB menu (Search Roxy, Filter this view, Roxy) → one job: Roxy AI | feed-1-foryou | M3: a FAB menu needs 2-6 related actions; search and filter move to the headers they belong to |
| Floating pill nav → M3 flexible navigation bar with a pill indicator | all | M3 Expressive's bar; full width leaves room for translated labels |
| Roxy chat sparkle + "ask me anything" → Roxy AI with a face, honest about being an AI | roxy-chat-1, proto-8-roxy | An emotional companion needs a character, not the AI sparkle |
| Three first-run checklists → one nudge at a time, in place | feed-0-mini-wins-sheet, feed-1-foryou, you-1 | First run is the core loop |
| Gradient blocks → real pictures: members' photos, identity-colour crests and posters, uploaded archive covers with a designed fallback | discover-1-retry, archive-1, community-1 | Faces, posters and covers are the content |
| Caps pills, tinted icon squares, emoji in chrome → words, 24 dp outline icons, sentence case | messages-1, create-sheet, archive-1 | Template tells |
| Radii 10/15/18/26 → 8 / 20 / 28 / pill (+12 press) | all | Bimodal radius, M3's scale trimmed |
| English hard-coded → string catalogue, language picker, right to left | (M174 missing) | Worldwide launch |
| Messages always show names and previews → discreet mode (Premium) | messages-1 | Someone can see her screen |

## Inspector persona

**Mariam, 33.** (Fictional; built from the brief and Nicole's 2026-10-21 decisions, not from research data.) She lives in Amman and uses Roxy in Arabic, switching to English to read some communities. Out to two friends and her sister; her mother borrows her phone for video calls. A book club in her city vouched for her. Her phone is a mid-range Android, 360 dp wide, on 4G; light mode by day, dark at night. She opens Roxy AI on hard evenings, and she would leave any app that showed a group's name on her lock screen or in her inbox while her mother held the phone.

Score as Mariam:
- In Arabic at 360 dp, does every screen mirror correctly, does any label truncate, and do her friends' Latin names sit correctly inside Arabic sentences?
- If her mother picked up the phone right now, would anything out her: the inbox, a preview, a share image, a notification?
- Does every tap answer at once, and does anything bounce while she is reading?
- Does Roxy AI feel like someone who cares, and is she honest about being an AI?
- **What she would show a friend:** her "You're in" card (community hidden), an event poster dropped into her group chat. What she keeps to herself: Roxy AI's hello on a hard evening.

Before scoring layout, run the same screens once in Vietnamese (stacked diacritics) and once in German (longest labels).

## Screen notes

**Feed** (v2-04). One post fills the screen on `stage` in both themes; the nav bar on the Feed takes stage colours. Top: three segment words (For you · Following · Communities; they scroll if a translation overflows) with a 3 dp underline on the active one, "8 live" with the dot, search. On Communities, an "All communities" filter chip under the segments (v0's "Filter this view", moved from the FAB). Right rail, from the top of Roxy's lane upward: reaction button, comment, save, share, more; 32 dp glyphs in 48 dp targets, counts in `meta`, no plates. Bottom start: avatar, "Inês R. · 2 h", "in Lisboa Sapphic Walks" with its crest, caption two lines, end margin 88 in the lane band. Double-tap ❤️; long-press the reaction button for the picker (Reactions below). Text posts in Geologica at the length-chosen step on their field; photos fill the frame (landscape crops to 4:5 with "View whole photo"). End of feed: "You're caught up. Your communities are talking in Messages."

**Discover** (v2-01 behind the sheet, v2-05). `headline` title, a 52 dp pill search field on `raised` ("Search people, communities, events"), a chip row (For you · Events · Communities · Archive · Shops · Live · Games) that scrolls with an end fade. Sections with a `title` heading and "See all" only when there is more: This week (posters in identity colours, two full plus a peek: "Boulders & pierogi", Kraków Queer Climbers; "Book swap, chapter 9", Lagos Sapphic Readers; "Karaoke", Sáficas São Paulo), Communities for you (72 dp rows, 48 dp crest squircle, "2,310 members · 61 here now", tonal Join), From the Archive (covers), Live now (dot + "LIVE · 14 listening"), Shops, Games, Top 10 members (photo-first, rank as a plain number). Lists end 88 dp higher; Roxy tucks on scroll.

**Create sheet.** Pressing Create turns the key 45° into a close × as the sheet rises (`spatial`). Title "Make something". One large row: "Post — a photo, a video or a few words". Below, one quiet line each for what else exists and who can do it ("Events, rooms and games come from communities. Ask an admin of one you're in." · "Sell on Roxy — apply from You."). 24 dp outline icons in `ink2`, no tinted tiles.

**Messages and discreet mode** (v2-06). `headline` "Messages", the discreet switch (an eye-off icon button) and compose. Pinned rows: **Roxy AI** (the O avatar, her last line "Your hello for Sunday is ready", unread dot; no FAB on this screen) and **Sister** ("Just for you. Nothing leaves here."). Then Requests ("2 waiting"), people, and a Communities group with crests and channel previews. Unread rows use the emphasized style and a pink dot.
- *Discreet on (Premium member):* the eye button sits on a `pinkContainer` pill and a banner says "Discreet is on. Tap a chat to open it." Names become an initial ("T."), photos become neutral `raised` circles, crests become neutral squares named "Community chat", previews become "1 new message" / "Conversation", Sister becomes "Private space", counts stay. Opening a chat asks for Face ID, fingerprint or the phone passcode (on by default with discreet) and re-locks when she leaves the app; while discreet is on, the app-switcher snapshot is a plain ground with the wordmark. Pushes are unaffected (already private by default).
- *Not Premium:* the same eye button wears a small butter lock badge. Tapping it, and only that, opens a sheet: a before/after preview built from her own top rows, "Keep your chats to yourself", "For when someone can see your screen. Discreet mode comes with Roxy Premium", three ticks ("Names, photos and previews hidden in Messages", "Chats open with Face ID or your passcode", "On and off with one tap, whenever you like"), and a box "Free for everyone, always: private lock-screen previews, request-first messages, block and report." Buttons: "See Roxy Premium" (primary) and "Not now" (text button, full width). No timer, no discount, no repeat; it never opens by itself.

**You.** Header: photo, name, pronouns, one line about her; Edit as a quiet `raised` pill. The two switches that matter, Dating and Ghost, as plain rows with a one-line explanation each. Mini Wins (today's three, streak count in `warningInk`), Tickets & orders, Saved, Sell on Roxy, **Roxy Premium** (entry point), Settings & safety. No XP bar, no level badge. Posts · Thoughts · Saved tabs below. Lists end 88 dp higher; Roxy tucks on scroll.

**Settings** (v2-07). First group, the three choices people come for: **Roxy AI** (the O at 44 dp, "Your companion, one tap away on Feed, Discover and You", an M3 switch 52 × 32: on = `pink` track with a white thumb that grows 20 → 24 dp when pressed; off = `raised` track with a `control` outline and thumb); **Language** (current value, e.g. "English (UK)", and a chevron → the picker); **Theme** as a connected button group Light · Dark · Match phone (the selected segment fills `pink` with a check and morphs to a full pill; Light is the default). Then Privacy and safety (Discreet mode with a Premium tag, "Who can message me · Anyone, as a request first", "Notifications · Lock-screen previews off"), Roxy Premium ("See what's included"), Account ("Account and data · Export your data, delete your account, sign out"). Turning Roxy AI off: the button leaves Feed, Discover and You at once and her lane closes; a snackbar says "Roxy AI is off. The round button is gone from your screens." with Undo for 6 seconds; no confirm, no guilt. The row then reads "Off. Turn her on any time."; "Your chat with Roxy AI · Kept on your account. Only you can see it." and "Delete my Roxy AI chat" (danger ink) stay available.

**Language picker** (Settings › Language, v2-07). A search field ("Search languages"); "From your phone" (the device languages from `expo-localization` `getLocales()`; English (UK) marked "Roxy's first language"); "All languages", each row the endonym in its own script and font with its name in the current interface language under it; right-to-left languages carry a "Right to left" tag. The selected row is a full `pinkContainer` fill with a radio. Picking a left-to-right language applies at once with a snackbar and Undo; picking one that changes direction opens a sheet ("Switching to العربية turns Roxy right to left. Roxy will restart." · "Restart now" · "Not now").

**Community + channel.** Header: crest squircle in its identity colour, name in `title`, "1,240 members · 84 here now" with three faces, one Join (the screen's primary, with lip) or Joined (`raised`). Tabs only when populated. Empty state: "No posts here yet. Members' posts land here when they share to Queer Gamers." Channel: Discord-style flat list (avatar, name, time, text), channel chips under the header, presence ("Priya and 3 others are here"), long-press a message for the same reaction picker, the composer on `surface` with a pink send that appears only when there is text.

**Archive.** Keep the editorial voice. **Covers are uploaded** (M158 member suggestion, S041 review queue, S039 staff edit): shown at 2:3, radius 8, no text over them (v2-05: Carmilla, Book · 1872; Sappho, Poems · c. 600 BCE). **No cover:** a designed type cover, not a placeholder: an identity-colour field picked from the entry id, the title in Geologica 800 at 18/20, bottom start, three lines max, no icon (v2-05: Rafiki, Film · 2018), with an "Add a cover" text button under it that opens Suggest an edit with the cover field focused. Every entry ends with "Something wrong or missing? Suggest an edit", also in the entry's more menu. After sending: "Sent to the Archive team. It shows here once it's approved." Title, year and type under the cover; "4.4 from 7 members" in words; filter chips without emoji ("Everything 45", "Films 12", "Series 10", "Books"); rows separated by space, not bordered cards.

**Onboarding.** Code gate on `ground`: the wordmark, the safety sentence word for word, the code in Plex Mono in eight 8-radius cells (the active cell outlined 2 dp in `pink`), Continue as the primary with its lip, visibly waiting (`raised`, `ink3`) until the code is complete; a small language button at the top end ("English") opens the picker before anything else. Accepted → moment 2. Returning members: "Welcome back." above the sign-in form. Notification and privacy choices one per screen, previews off by default; Roxy AI is introduced once ("This is Roxy AI. Tap her any time. You can switch her off in Settings.").

**Roxy AI chat + FAB** (v2-01, v2-05). The sheet opens at about 60% of the screen and drags up to the full chat (`/roxy-chat`): back, the O at 40 dp, "Roxy AI", "Only you see this chat", more (Clear chat, Report a reply, Turn off Roxy AI). Her bubbles on `surface` (radius 20, 6 on the tail corner) with her O at 32 dp; the member's bubbles in `pinkContainer`. Suggestion chips after her replies ("Yes, draft it", "What should I bring?"). While she writes: the O in `think` mood squashing through Roxy's shapes, "Roxy AI is writing"; replies arrive by sentence. Composer on `surface` with a 1.5 dp outline and a `pink` send. Footer: "Roxy AI can be wrong. Keep passwords and addresses to yourself." If a member mentions harming herself, Roxy AI answers with care and offers Sister's support resources as a card; that flow must be designed with care professionals before launch. FAB details below.

## The Roxy AI button (FAB)

- **Mark:** the Roxy O: a 56 dp circle in `pink` (on the dark stage `brandPink`) with a `#FFFDFD` face disc at 64% of its diameter, two eyes glancing toward the content and a lopsided smile. Moods: `open` (rest), `happy` (greeting, success), `rest` (eyes closed: tucked, or off in Settings), `think` (eyes up, flat mouth: writing). In right to left only her glance mirrors. Accessibility label "Roxy AI", hint "Opens your chat with Roxy AI". The app icon stays the wordmark.
- **The lane:** `FAB_LANE` 88 × 88 dp at the bottom end corner above the nav bar; the FAB sits 16 dp from the edge and 16 dp above the bar. On Feed the rail's lowest control starts at the lane's top, and captions in the bottom band keep an end margin of 88. On Discover and You, lists end 88 dp higher, so the last item can always scroll clear; rails show two full cards plus a peek. **At rest nothing readable or tappable sits in the lane** (checked on v2-04 and v2-05; extend the `fab-occlusion` e2e from Feed to Discover and You).
- **Scroll behaviour (M3 extended FAB, made Roxy's; corrected 2026-10-23, see decisions):** wherever list content fills her lane she rests tucked: 40 dp, eyes closed, her inner edge on the margin line so 16 dp shows (the margin, never over a row's controls) (`fastSpatial`). She is out at 56 dp only where her lane is empty: at the end of a list, on a list that fits the screen, and on Feed. A tap on the tucked O opens Roxy AI (a collapsed FAB keeps its action). Tucked hit area: the margin strip, 16 × 48 dp. On Feed (a pager) she never tucks, except while the reaction picker or a sheet is open.
- **Tap:** light haptic and the O grows into the Roxy AI sheet (moment 1). Long-press does the same: no FAB menu (M3: a FAB menu needs 2-6 related actions; Roxy's FAB has one job). v0's "Search Roxy" moves to the search buttons on Feed and Discover, and "Filter this view" becomes the "All communities" chip on Feed › Communities: both move, neither disappears.
- **Where she is not:** `FAB_SUPPRESSED_ON` stays (her own chat, Messages and chats, where she is a pinned row, Sister, live rooms, speed dating). Off in Settings (M173): the button leaves at once, the lane closes and the rail drops to 16 dp above the bar.

## Reactions

The regular emoji set, `POST_REACTIONS` = ❤️ 😂 😮 😢 😡 💜 (`lib/postReactions.ts`, shared with chat). No flower. Board v2-04.

- **Double-tap a post** = ❤️ (the set's first). The heart pops where the thumb was: 80 dp, scale 0 → 1.15 → 1 with a -8° turn (`fastSpatial`, with initial velocity), a white 3 dp ring expanding and fading (`effects`), six 8-10 dp dots in identity colours flying 24-40 dp and gone within 480 ms; then it shrinks into the rail's reaction button, which squishes 0.85 → 1.12 → 1, and a light haptic lands with it.
- **The rail's reaction button:** an outline "add reaction" glyph until she reacts; then her emoji on a 48 dp `pinkContainer` disc (dark: #5A1236). Under it the post's total in `meta`, tabular, compact by locale (1,205 · 1.2K · 1,2 k · 1.2万). Tap = ❤️. **Long-press** (300 ms) = the picker.
- **The picker:** a 64 dp `surface` pill with the six emoji at 30 dp in 44 dp cells, springing out of the button (`spatial`; items `fastSpatial` with a 20 ms stagger from the button's side); the post dims. The emoji under her finger grows to 44 dp and lifts 26 dp, with a selection haptic as she slides; letting go on an emoji commits it (it pops onto the button, light haptic); letting go outside cancels. Tapping an emoji works too (one hand, accessibility). In chat the same picker opens above a long-pressed message.
- **Counts:** the rail shows the total; post detail shows the breakdown as chips in the set's order (`reactionsOn()`), hers in `pinkContainer`. No "who reacted" list: the backend keeps tallies, not ballots (`postReactions.ts`). Double-tapping again replays a smaller burst and adds nothing.
- **Retired, commented never deleted (M177):** `DoubleTapLike.tsx`, `LikeBurst.tsx`, `FirstPostCelebration.tsx`, the flower in `PostActionRow.tsx`, v1's first-flower toast.

## Worldwide: language, layout, right to left (M174)

- **Strings:** every string goes through a catalogue keyed by meaning, with ICU plurals (Russian one/few/many/other, Arabic zero/one/two/few/many/other, Japanese other only). Never build a sentence by concatenation. Interpolated member names are wrapped in Unicode isolates (U+2068 … U+2069) so "Inês R. reacted" lays out correctly inside Arabic.
- **35-40% longer text:** no fixed widths on text; buttons hug their label (min 88 dp) and sheet buttons are full width; button labels one line, row labels two, then ellipsis with the full text in the accessibility label; headlines may take three lines in translation; segment and chip rows scroll sideways instead of truncating (the active item scrolled into view); every nav label has a short form of 9 characters or fewer in the catalogue, used when the long one does not fit at 360 dp. QA builds get a pseudo-locale (accents, +40% length) and a pseudo right-to-left locale; the Inspector scores both at 360 dp.
- **Right to left (Arabic, Hebrew, Persian, Urdu):** `I18nManager.allowRTL` / `forceRTL`; changing direction needs a restart (Settings explains and offers it). **Flips:** reading order and paddings (start/end), back and forward chevrons, the Feed rail (to the left edge), Roxy's lane (bottom left), caption alignment, row order (avatar on the right), nav order (Feed on the right), horizontal rails (start from the right), swipe-to-reply, switch thumbs, non-media progress bars, the sheet close button, Roxy's glance. **Never flips:** photos and videos, the vertical feed pager, media controls and timelines, the wordmark and app icon, emoji, codes, phone numbers and other left-to-right runs (isolated), digits inside a number, clocks, the camera and maps. Board v2-08 shows an Arabic feed with Arabic-Indic digits.
- **Dates, numbers, plurals:** dates and relative times with `date-fns` ^3.6 (installed) and its locales; 12/24-hour clock and first weekday from `expo-localization` ~15.0.3 (installed, `getCalendars()`); numbers with `Intl.NumberFormat` in the active locale (compact counts, the locale's own digits). Hermes' Intl support for `PluralRules`, `RelativeTimeFormat` and compact notation must be checked on device; polyfill with `@formatjs` where missing.
- **Voice:** see Copy voice. Feminine address in gendered languages is an open question.

## Premium entry point (M176)

Premium does not exist yet; v2 designs only its entry points and what it must not do. **Entry points:** the locked discreet switch in Messages, the Discreet mode row in Settings, a "Roxy Premium" row in Settings and on You. Never in the Feed, never on content, never in Roxy AI's mouth, never as a pop-up. **What M176 needs before discreet mode can ship:** what else Premium includes and its price per storefront; App Store and Google Play billing for the subscription (store rules for digital subscriptions; Stripe only on web), through RevenueCat (`react-native-purchases`) or an edge function that verifies receipts; an entitlements table with RLS and a server-checked flag; restore purchases; manage and cancel within two taps; a neutral billing descriptor wherever Roxy controls it, because a statement line can out someone; and a lapse path that never reveals names by surprise (a heads-up in Messages a few days before discreet ends, and on the day a one-time sheet "Discreet mode is off now" before the inbox shows names).

## New dependencies

Installed and used as they are (`apps/mobile/package.json`): `react-native-reanimated` ~3.10.0 (3.10.1), `react-native-svg` 15.2.0, `react-native-gesture-handler` ~2.16.0 (long-press and slide in the picker), `expo-haptics` ~13.0.1, `expo-font` ~12.0.0, `expo-localization` ~15.0.3, `date-fns` ^3.6.0, `expo-linear-gradient` ~13.0.2 (media scrim only). Not needed: Lottie, Rive, Skia, `expo-blur`.

NEW (all work on the Old Architecture; SDK 51 versions from `expo/bundledNativeModules.json`, fonts from npm):

| Package | Version | For | Native rebuild |
|---|---|---|---|
| `@expo-google-fonts/geologica` | 0.4.2 | display face | no (font assets) |
| `@expo-google-fonts/commissioner` | 0.4.1 | text face | no |
| `@expo-google-fonts/ibm-plex-mono` | 0.4.1 | codes | no |
| `@expo-google-fonts/noto-sans-arabic` · `-hebrew` · `-devanagari` · `-thai` | 0.4.3 · 0.4.1 · 0.4.1 · 0.4.2 | script fallbacks (3 weights each, 1.53 MB in total) | no |
| `i18next` + `react-i18next` (or `i18n-js`) | current; pick at M174 | string catalogue, ICU plurals | no |
| `@formatjs/intl-pluralrules` (+ `intl-relativetimeformat` if Hermes lacks it) | current | plurals and relative time on Hermes | no |
| `expo-updates` | ~0.25.27 | restart after a right-to-left switch (`reloadAsync`); alternative: ask her to reopen the app | yes |
| `expo-local-authentication` | ~14.0.1 | discreet mode: open chats with Face ID / fingerprint / passcode (`NSFaceIDUsageDescription`) | yes |
| `expo-screen-capture` | ~6.0.1 | discreet mode: plain app-switcher snapshot, optional screenshot block in Messages | yes |
| `react-native-purchases` (RevenueCat), or own receipt checks | decide at M176 | Premium store billing | yes |

## Open questions for Nicole

1. **Type:** Geologica + Commissioner replace Outfit / Figtree (and v1's Bricolage), mainly so Cyrillic, Greek and Vietnamese keep the brand faces. OK to change the body face too?
2. **The Roxy O:** is a face in the O of the wordmark right as Roxy AI's mark (the app icon stays the wordmark)?
3. **One-job FAB:** OK that the FAB only opens Roxy AI and v0's "Search Roxy" and "Filter this view" move to the Feed and Discover headers?
4. **Feminine address in translations:** Roxy is for women, so gendered languages (Arabic, Spanish, French, Hebrew…) would address members in the feminine by default. Add a neutral option in Settings?
5. **Launch languages:** which ship first? That decides the fonts bundled, the translation budget and whether right to left is in release one.
6. **Premium:** what else it includes, the price, and RevenueCat vs our own receipt checks. Discreet mode needs `expo-local-authentication` (a native build).
7. **Her reaction across sessions:** the backend counts reactions but does not remember who gave which, so the rail cannot show her own reaction after a reload. Add a per-member reaction table (a migration)?
8. **Roxy AI and context:** may Roxy AI read the post or screen she was opened from when the member asks ("Help me reply to this")? That needs consent copy and a check of the AI provider's data terms.
9. **Theme "Match phone":** OK as a third option? `profiles.theme_preference` may need a `system` value.
10. **Token map:** `polish/rules/CLAUDE.md` is write-protected for the Art Director; the v2 section is staged in `polish/proposed-tokens-v2.md` for whoever applies it.
