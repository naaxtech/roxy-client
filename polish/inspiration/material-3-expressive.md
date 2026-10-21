# Material 3 Expressive

Category: Design system update (Google, May 2025): springs instead of easing curves, a 35-shape library with shape morphing, emphasized type styles, and 14 new or updated components. Studied 2026-10-21 on m3.material.io in a real browser (session `roxy-artdir2`); page text saved to `D:/Temp/roxy-polish/artdir2/m3x-text/`.

Why it feels premium (3-5 principles, each one sentence):
- Motion is physics, not curves: every move is a spring (stiffness + damping), so a press, a drag that is let go, and an interrupted animation all land the same way; "spatial" springs (position, size, rotation, corner radius) overshoot a little and bounce into place, "effects" springs (colour, opacity) never overshoot (motion "How it works" page, m3x-2, m3x-7).
- Shape carries state: a pressed button in a standard button group squares off and widens while its neighbours give way (m3x-10: the pressed pause button is a wide rounded square in the dark primary, its neighbours stay light pills), and the loading indicator is a shape morphing through seven library shapes, not a spinning arc (m3x-14).
- Contrast of round and square is used on purpose ("tension"): fully rounded pills next to rounded squares, one element breaking the surrounding shape to draw the eye (shape principles page, m3x-2: square-ish tiles beside a pill FAB and a pill switch).
- Emphasis is a second, heavier set of the same type styles (15 baseline + 15 emphasized) used for selection, unread and the main action, so hierarchy comes from weight and size rather than colour alone (type scale page, m3x-5).
- Hero moments are rationed: "Stick to one or two hero moments in your product"; everything else uses the same few tokens (blog, tactic 7).

What it does on first run:
- Not a product, so no first run. The closest lesson is the blog's tactic 7: pick the one or two key, emotionally loaded interactions and make those sing; keep the rest consistent.

What it does with empty states:
- No empty-state guidance in the pages studied. The loading guidance applies: under 200 ms show nothing, 200 ms to 5 s use the morphing loading indicator, over 5 s use a determinate progress indicator (loading indicator guidelines). Roxy keeps skeletons at the final layout for lists and uses a loading indicator only for short, single waits.

Its signature interaction (the one thing people screenshot):
- Shape morph on press and selection (button groups, m3x-10) and the FAB that turns into the close button of its own menu (FAB menu, m3x-12: three tonal pill items with icon + label stacked above the FAB, which has become a round close "x" in the darker primary, all aligned to the trailing edge).

Its typography system (families, scale, weights):
- Observed on the type pages: Display Large 57/64, Headline Medium 28/36, Title Large 22/28, Body Large 16/24 (+0.5 tracking), each with an emphasized twin at a heavier weight (500 in the Roboto token set; the token module lists wght, wdth, ROND, opsz axes). Brand typeface on Display/Headline, plain typeface on Body/Label; Google uses Google Sans Flex, whose roundness the shapes echo ("M3 shapes and Google Sans Flex share roundness visual attributes").
- Language height (added Aug 2026, m3x-11): line height adapts by script. Small (base): Latin except Vietnamese, Cyrillic, Greek, Hebrew. Medium (~7% taller): Arabic, Chinese, Japanese, Korean, Hindi, Thai, Vietnamese and most others. Large (~30%): Burmese, Telugu. Extra large (~100%): Nastaliq. "Ignoring language height can lead to overlapping text and broken UI elements."

Its motion language (durations, easing, what moves and what doesn't):
- Spring tokens, read from the token table on the motion specs page (m3x-7, Android, scheme switched to Expressive), damping is a damping RATIO:

| Token | Expressive (ratio / stiffness) | Standard (ratio / stiffness) | Web curve stand-in (Expressive) |
|---|---|---|---|
| fast spatial | 0.6 / 800 | 0.9 / 1400 | cubic-bezier(0.42, 1.67, 0.21, 0.90), 350 ms |
| default spatial | 0.8 / 380 | 0.9 / 700 | cubic-bezier(0.38, 1.21, 0.22, 1.00), 500 ms |
| slow spatial | 0.8 / 200 | 0.9 / 300 | cubic-bezier(0.39, 1.29, 0.35, 0.98), 650 ms |
| fast effects | 1 / 3800 | 1 / 3800 | cubic-bezier(0.31, 0.94, 0.34, 1.00), 150 ms |
| default effects | 1 / 1600 | 1 / 1600 | cubic-bezier(0.34, 0.80, 0.34, 1.00), 200 ms |
| slow effects | 1 / 800 | 1 / 800 | cubic-bezier(0.34, 0.88, 0.34, 1.00), 300 ms |

- Speed by size: fast for small components (switches, buttons), default for things that cover part of the screen (bottom sheets), slow for full-screen moves. "All component motion is driven by two tokens: expressive fast spatial and expressive fast effects."
- Extended FAB: collapses to a FAB when scrolling down and extends again when scrolling up (m3x-13; the shape changes, the icon moves, the label fades). Never in the upper half of a phone screen, never on cards or toolbars.
- FAB menu: 2-6 related items, opens from a FAB only, the FAB transforms into the close button, trailing-edge aligned (left-aligned and mirrored in RTL), not used together with a floating toolbar or navigation rail.
- Corner radius scale: 0, 4, 8, 12, 16, 20 (new), 28, 32 (new), 48 (new), full (m3x-8). When nesting, use proportional "optical roundness", never the same radius inside and out.
- Navigation bar: the new flexible bar is shorter than the baseline 80 dp bar, has no shadow, and marks the active destination with a pill-shaped indicator in a contrasting tone behind a filled icon (m3x-17: a pale pill behind the filled star, label under the icon, all four labels always shown).

Translation to React Native 0.74 (Old Architecture, `react-native-reanimated` 3.10.1, `react-native-svg` 15.2.0, `expo-haptics` 13):
- Port the M3 tokens as PHYSICAL springs: `withSpring(v, { mass: 1, stiffness, damping })` with damping = 2·ratio·√stiffness: fast spatial 800 / 33.9, default spatial 380 / 31.2, slow spatial 200 / 22.6, fast effects 3800 / 123.3, default effects 1600 / 80.0, slow effects 800 / 56.6. The same numbers work in the legacy `Animated.spring` (used by `lib/motion.ts` today). Do NOT pass `dampingRatio` to reanimated 3.10: in `springUtils.ts` that key belongs to the duration-based variant (`{ duration, dampingRatio }`, duration defaults to 2000 ms), so `{ stiffness, dampingRatio }` alone would stretch every move to two seconds (verified in `node_modules/react-native-reanimated/src/reanimated2/animation/springUtils.ts` and `spring.ts`, 3.10.1).
- Shape morph without the Compose Shapes API: (a) corner morphs animate `borderRadius` (and `width` for button groups) with a spatial spring, which reanimated runs on the UI thread on Paper; (b) free-form morphs (Roxy's thinking indicator) use one `react-native-svg` `Path` whose `d` is interpolated in a worklet between shapes that were authored with the same number of cubic segments (`useAnimatedProps`). No new dependency.
- `useReducedMotion()` exists both in reanimated 3.10 and in the app (`hooks/useReducedMotion.ts`).
- Web export: reanimated springs run on web too; the curve table above is the fallback if a move must be a CSS transition.

What we will NOT take from it:
- The violet/lilac default palette of the M3 demos and dynamic (wallpaper) colour: violet is banned for Roxy; Roxy's colour is fixed.
- The petal shapes of the library: Flower, 4-leaf and 8-leaf clover, the scalloped "cookie" shapes, Soft burst and Puffy (rows 3-5 of the library grid in m3x-6) read as flowers, and Nicole has banned the flower everywhere. Roxy's own shape set is circle, pill, rounded square, the Roxy O, and a sharp 16-point burst for the RSVP seal only.
- Google Sans Flex: it is Google's own voice; on Roxy it would read as a Google app.
- Floating toolbars and the FAB menu on top of a navigation bar (M3 itself forbids pairing them); Roxy keeps one docked bar.
- Overshoot on everything: Roxy uses the expressive spatial spring for things that move or change shape, and effects springs (no overshoot) for colour, opacity and anything that carries text someone is reading.

Screenshots:
- polish/inspiration/shots/m3x-1.png (blog: "Start building with Material 3 Expressive", hero)
- polish/inspiration/shots/m3x-2.png (blog: motion-physics video frame: nav rail with pill indicator, tile buttons, pill FAB, switch, a soft morphing shape)
- polish/inspiration/shots/m3x-3.png (same video, later frame)
- polish/inspiration/shots/m3x-4.png (blog: expressive components video frame)
- polish/inspiration/shots/m3x-5.png (blog: visually emphasized typography)
- polish/inspiration/shots/m3x-6.png (blog: the 35-shape library grid beside a step-count screen)
- polish/inspiration/shots/m3x-7.png (motion specs: spring token table, Expressive scheme)
- polish/inspiration/shots/m3x-8.png (shape: corner radius scale)
- polish/inspiration/shots/m3x-9.png (shape morph page: library shapes morphing)
- polish/inspiration/shots/m3x-10.png (shape morph page: standard button group, pressed button squares off and widens)
- polish/inspiration/shots/m3x-11.png (type scale: language height categories)
- polish/inspiration/shots/m3x-12.png (FAB menu overview: three pill items above the FAB-turned-close-button)
- polish/inspiration/shots/m3x-13.png (extended FAB guidelines: collapses and expands on scroll)
- polish/inspiration/shots/m3x-14.png (loading indicator and contained loading indicator)
- polish/inspiration/shots/m3x-15.png (button groups overview)
- polish/inspiration/shots/m3x-16.png (toolbars overview)
- polish/inspiration/shots/m3x-17.png (navigation bar overview: pill active indicator, labels always on)
