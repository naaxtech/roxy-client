# Roxy Wave 3 "Feel" — motion spec (Phase A, Motion Art Director)

2026-10-22. Read-only study of `main` (Wave 1) and `polish/wave2-integration` (88988a3, Wave 2 merged), `polish/features.md`, `design-direction.md` § Motion, `inspiration/material-3-expressive.md` + `duolingo.md`. New M3 shots: `D:/Temp/roxy-polish/wave3/motion/shots/m3m-*.{png,jpg}`; page text and sources: `.../motion/scratch/`. Static scanner (read-only, runs on any branch): `.../motion/feel-static-scan.cjs`.

Scope: motion, timing, feedback, perceived speed. No layout, colour, copy or feature changes; those are in §5 as proposals.

**Five-line summary**
1. The tokens are right (M3 Expressive springs in `lib/motion.ts`); what makes Roxy feel slower than Duolingo is plumbing: press feedback, sheets, the nav pill and the switch run on the JS thread through the legacy `Animated` + RN responder, and only 3 files use reanimated.
2. The web build (roxy.expo.app) has no screen transitions (native-stack on web toggles `display`), no pull-to-refresh (react-native-web's `RefreshControl` is an empty `View`) and jump-cut tab switches, so web and app already feel different.
3. Waiting is the biggest perceived-speed loss: 111 `<ActivityIndicator>` in 65 files, nothing is cached across launches, images pop in with no placeholder fade, and several actions (friend request, RSVP, channel send, comment send) wait for the server.
4. Sheets are a mix of 7 system "slide", 5 "fade" (the whole sheet fades, which M3 rules out) and scale "pop" (0.76 → 1) patterns. None can be dragged on the UI thread or interrupted cleanly. One `Sheet` primitive fixes all of them.
5. Phase B has 5 lanes plus one small primitives slice that goes first. Each lane is done when its budgets in §2 pass on Android at 360 dp and on web under 4× CPU throttle.

---

## 1. Why it feels smooth

### 1.1 M3 Expressive motion — what the earlier study did not cover

Studied on m3.material.io in a real browser on 2026-10-22. The spring token table, the shape library and the FAB menu are in `material-3-expressive.md` (m3x-*). The pages below are new.

| Finding | Source (page · shot) |
|---|---|
| **Speed follows size.** Fast is for small components (switch, button) and the colour of a switch handle; default is for things that cover part of the screen (bottom sheet); slow is for full-screen moves and full-screen content refresh. One spring serves taps, gestures and interruptions: "They handle gestures, interruptions, and retargeting animations seamlessly." | /styles/motion/overview/how-it-works · m3m-01 |
| **Transitions still use easing + duration** ("will eventually be updated to use the motion physics system"). Durations: short 50-200 ms (selection controls 200 ms, standard easing), medium 250-400 ms (FAB → sheet 400 ms, emphasized), long 450-600 ms (card → full screen 500 ms). Emphasized decelerate `cubic-bezier(0.05,0.7,0.1,1)`, standard `cubic-bezier(0.2,0,0,1)`. | /styles/motion/easing-and-duration/tokens-specs |
| **Six transition patterns.** *Container transform* is the strongest and most expressive pattern, so keep it for hero moments (m3m-02, FAB with a persistent container m3m-04). *Forward/backward*: use the platform defaults; Android fades while it slides a short distance, iOS uses parallax (m3m-05). *Lateral* is for peers such as tabs and carousels; never use it for top-level navigation. *Top level*: "The exiting screen quickly fades out and then the entering screen fades in" (m3m-06). *Enter/exit*: components expand away from the nearest edge, so a snackbar comes up from the bottom (m3m-07). *Skeleton loaders*: a subtle pulse, then "content quickly fades in on top of the skeleton loader" (m3m-03, m3m-08). | /styles/motion/transitions/transition-patterns |
| **What makes a good transition:** follow the reduced-motion setting ("subtle fades instead of intense sliding or scaling", "disable decorative effects like parallax or shape morphing"); keep the layout stable (skeletons, no pop-in shifts); no jump cuts; one coherent spatial model; one direction of movement; **clean fades** ("Fully fade out content before fading new content in"; "Don't fade a bottom sheet as it enters and exits"); a simple style ("Common transitions should not use overt style effects like bouncy springs"). | /styles/motion/transitions/applying-transitions |
| **Shape morph** belongs to the button group and the loading indicator, through a platform API. "Web is not currently available", so Roxy builds it herself (radius springs + one SVG path, as the direction already says). | /styles/shape/shape-morph |
| **Loading indicator.** Under 200 ms: show nothing. 200 ms to 5 s: the morphing loading indicator. Over 5 s: a determinate progress indicator. Never turn a loading indicator into a progress bar. Default size 48 dp (38 dp shape). The *contained* variant (a circle behind the shape) is used over content and **for pull-to-refresh**. Pull-to-refresh has a threshold: reversing the gesture past it cancels. The indicator stays in view until new content is visible. | /components/loading-indicator/guidelines + /specs · m3m-09 |
| **State layers:** hover 8%, focus 10%, **pressed 10%**, dragged 16%, at a fixed opacity in the content colour. Only one state layer at a time. | /foundations/interaction/states/state-layers · m3m-11 |
| **Predictive back** applies to bottom sheets, the navigation bar and search: the person can change their mind mid-swipe. | /foundations/interaction/gestures |

### 1.2 Other apps famous for smoothness (principles only; no layouts taken)

- **Apple, WWDC18 "Designing Fluid Interfaces"** (https://developer.apple.com/videos/play/wwdc2018/803, transcript https://nonstrict.eu/wwdcindex/wwdc2018/803):
  - Response: "people are really, really sensitive to latency", so watch every delay and timer.
  - Constant redirection and interruption: an interface where "the thought and gesture happen in parallel".
  - Touch and content move together one-to-one.
  - Hint in the direction the gesture is going.
  - Lightweight input, amplified output: preserve the gesture's momentum, and **project** where it would land (velocity + deceleration rate) instead of using only the release position.
  - Rubber-band at the edges.
  - Springs are described by damping and response, not duration. "Start with 100% damping"; "if a gesture has momentum… reward that momentum with a little bit of overshoot". In Music, tapping open Now Playing uses 100% damping and swiping it away uses 80%.
- **Instagram, Mike Krieger, "Secrets to Lightning Fast Mobile Design"** (summary: https://highscalability.com/3-secrets-to-lightning-fast-mobile-design-at-instagram):
  - Perform actions optimistically: likes, comments and follows register on screen while the request goes in the background.
  - Adaptively preload content.
  - "Move bits when no-one is watching": the upload starts before the share screen is done.
- **Threads, Meta Engineering, "How we think about Threads' iOS performance"** (https://engineering.fb.com/2024/12/18/ios/how-we-think-about-threads-ios-performance/):
  - "if someone has to stare at an app launch screen, activity spinner, or loading shimmer for too long, they'll just close the app".
  - They measure time-to-network-content (TTNC), %FIRE (the share of people with a frustrating image-render experience), navigation latency (from the tap until the screen has finished rendering its content) and creation-publish success.
  - In a boundary test they injected latency into profile, permalink and activity: "The more we added, the less often they would launch the app and the less time they would stay in it". The smallest injections were small or negligible on some views; the largest hurt every view.
- **Telegram** (https://telegram.org/blog/video-editor-gifs, https://telegram.org/blog/animated-backgrounds, https://telegram.org/blog/power-Saving):
  - Messages are "sent, edited and deleted with new smooth animations". Stickers "hop from your keyboard into the chat – with lightweight animations that won't affect your battery".
  - The animations are tuned "to make any phone feel powerful" and can be turned off on older devices. Smoothness on low-end Android is treated as a product feature.
- **Things 3** (https://culturedcode.com/things/features/):
  - "When you open a to-do, it smoothly transforms into a clear white piece of paper": the object you touch becomes the thing you open.
  - Details stay tucked away until asked for.
  - "Everything you do in Things is nicely animated", built on its own animation toolkit.
- **Duolingo** (already in `duolingo.md`; not redone): press-in on a hard lip, a selection is a full fill, celebration is rationed, and characters are run by a Rive state machine (https://blog.duolingo.com/world-character-visemes).
- **Android haptics principles** (https://developer.android.com/develop/ui/views/haptics/haptics-principles, https://developer.android.com/develop/ui/views/haptics/haptic-feedback):
  - Prefer crisp "clear" haptics. "Given the choice of buzzy haptics or no haptics for touch feedback", choose none.
  - "All haptic feedback methods respect the user's touch feedback settings by default". This covers `View.performHapticFeedback`, which expo-haptics 13 does **not** use: on Android it calls `Vibrator.vibrate(createWaveform…)` (read in `node_modules/expo-haptics/android/.../HapticsModule.kt`). Later expo-haptics adds `performAndroidHapticsAsync` (https://docs.expo.dev/versions/latest/sdk/haptics/).
- **Budgets from the platforms:** 60 fps is 16 ms per frame with about 10 ms of app work, and a response should land within 100 ms (https://web.dev/articles/rail). On Android, frames must render "in under 16ms" (https://developer.android.com/topic/performance/vitals/render). CLS of 0.1 or less is "good" (https://web.dev/articles/cls).

### 1.3 Roxy's feel rules (the synthesis Phase B builds to)

1. **Answer the finger, not the network.** Visual press-in lands within one frame, on the UI thread. Every member action shows its result before the request leaves; a failure rolls back with one sentence and Retry. (WWDC18 response · Krieger · Duolingo press-in)
2. **Everything can be interrupted.** Every spatial move is a spring that retargets from its current position and velocity. No input waits for an animation's completion callback. (M3 how-it-works · WWDC18)
3. **Gestures own the motion.** A drag follows 1:1. On release, the gesture's velocity goes into the spring (`withSpring(…, { velocity })`), and the end state is chosen by projected position, not by where the finger lifted. Edges rubber-band. Overshoot only after a gesture with momentum; tap-started moves use tokens with at most 1.5% overshoot (`spatial`, `calm`). (WWDC18)
4. **Speed by size, spatial vs effects.** Small controls use `fastSpatial`/`fastEffects`, sheets `spatial`, full-screen moments `slowSpatial`, colour and opacity never overshoot, and text being read moves only on `calm`. (M3 · direction § Motion)
5. **Plain transitions; one hero.**
   - Push/pop use the platform default (web gets an equivalent).
   - Tab switches are a quick fade with no slide.
   - Sheets rise from the bottom edge, and only the scrim fades.
   - Container transform is used only for the FAB → Roxy AI, the RSVP seal and the code cells → card.
   (M3 transitions)
6. **Stable layout, then content.** A skeleton at the final layout appears in the first frame, and content fades in on top with no shift and no stagger. (M3 skeletons · CLS)
7. **Waits by length.** Under 200 ms nothing; 200 ms to 5 s the Roxy loading indicator (the O squash, M3's shape-morph idea); over 5 s a determinate bar. Never a spinner. Pull-to-refresh has a threshold and stays visible until new content is on screen. (M3 loading indicator)
8. **Show what you know, then refresh.**
   - Second visits never show a loader.
   - Images arrive behind a placeholder and are prefetched before their cell scrolls in.
   - Uploads start as soon as the media is picked.
   (Threads TTNC/%FIRE · Krieger)
9. **Smoothness has a frame budget on the cheapest phone.** At 360 dp Android and under 4× CPU throttle on web: no frame over 16 ms while paging, and no JS task over 50 ms during an animation. (RAIL · Android vitals · Telegram)
10. **Haptics are crisp, rare and the system's.** Haptics fire only on the events in §3.3, never on web, and never as a substitute for visual feedback. They honour the phone's touch-feedback setting, and stay on under Reduce Motion (direction).
11. **Reduce Motion is a first-class mode, not a broken one.**
    - Spatial moves jump to their end state.
    - Effects become 120 ms fades.
    - Loops stop.
    - Shape morphs and bursts show their end state.
    - Haptics stay.
    (M3 applying transitions · direction)
12. **Celebrate rarely.** Roxy celebrates only the three signature moments plus the reaction burst; no confetti, no count-ups. (M3 "one or two hero moments" · Duolingo)

---

## 2. Budgets (measurable, each checkable by a script)

Device floor: a 360 dp Android on 4G (emulator: Pixel 3a-class image, 360×760 dp, "Fast 4G" network). On web: Chrome, 360×800 viewport, DPR 2, `hasTouch`, with CDP `Emulation.setCPUThrottlingRate({rate: 4})` for the floor runs. Production stays read-only (brief): every check below that would *press* a writer runs against a local export pointed at the local Supabase stack, never against roxy.expo.app. The read-only checks only press-in and then cancel (`touchcancel`), so nothing activates.

| ID | Budget | Script check | By hand (Nicole) | Baseline today |
|---|---|---|---|---|
| **F1** Press feedback | Visual press-in (scale, lip or state layer) within **1 frame** (≤ 16.7 ms) of touch-down, p95; still within 1 frame while the JS thread is busy for 100 ms. | **Web:** `feel/press.spec.ts`. CDP `Input.dispatchTouchEvent` touchStart on 20 controls (nav items, chips, rail buttons, rows, the primary button). In the page, read `event.timeStamp`, then poll each rAF until the element's computed `transform` scale is ≠ 1 or `[data-testid=press-state-layer]` exists. Then `touchCancel`. Pass: p95 ≤ 1 frame unthrottled, ≤ 2 frames at 4×. **Native:** a dev flag `EXPO_PUBLIC_FEEL_PROBE=1` logs `[feel] press <testID> <ms>` (gesture timestamp → first UI frame where the shared value changed, via reanimated `useFrameCallback`). `FEEL_PROBE_BUSY=100` blocks JS for 100 ms on press. Collect with `adb logcat -s ReactNativeJS`. | Developer options › "Show taps": the control dips as the dot appears, never after the finger lifts. | JS-thread `Animated` via the RN responder. `PressableScale` calls `setState` on every press-in (a re-render). The morph, nav-pill width and switch travel run on the JS driver (4 files). |
| **F2** Every pressable answers | 0 raw `Pressable` / `Touchable*` without press feedback, except scrim backdrops (allowlist with a reason). | `node feel-static-scan.cjs <repo> <branch>` → `F2_raw_pressable_no_feedback` = 0 after triage. | Tap every chip, row and card: each one dips. | **60 sites in 19 files**, including `FilterChips` (Discover chips), `VoteCard`, `ContentNoteChip`, `ChannelMessage(Actions)`, `ReportSheet`, archive entry ×15, channel screen ×7. Some are backdrops. |
| **F3** Push / pop | Settled in **200-400 ms**. The first frame after the tap already shows the transition (no jump cut on any platform). A back press or swipe mid-transition reverses from where the screen is. | **Web:** `feel/transition.spec.ts`. Click a read-only nav (post → detail, community → profile, You → Settings), then sample `[data-testid=screen-transition]` opacity and transform per rAF until stable. A `history.back()` at 100 ms must end on the old screen with no layer left half-faded. **Android:** `adb shell dumpsys gfxinfo <pkg> reset`, then 10 scripted pushes and pops (Maestro or `adb shell input tap`), then `dumpsys gfxinfo`: janky frames ≤ 5%. Screenrecord at 60 fps for the duration. | Open a post and go back 5 times fast: nothing stutters, and the swipe-back follows the finger (iOS). | Native: platform default, not set explicitly. **Web: jump cut** (native-stack web view toggles `display`). |
| **F4** Tab switch | The first frame shows the new tab's ground (no flash, no stale content). Content is faded in within **≤ 200 ms**. The nav pill settles ≤ 250 ms. No layout shift. | **Web:** Playwright taps each nav slot, samples frames, and asserts the content opacity ramp lasts ≥ 2 frames and ≤ 200 ms, with CLS 0 for the bar. | Switch tabs quickly: it feels instant but not abrupt. | Jump cut on all platforms. The pill width animates on the JS driver. |
| **F5** Sheets & modals | 95% of the travel in **≤ 250 ms**, settled ≤ 450 ms. A drag tracks the finger (≤ 1 px gap each frame). Release uses projected velocity. Tapping the scrim mid-open reverses from the current position (no frame jumps > 1/3 of the sheet). The sheet surface is never translucent; only the scrim fades. | **Web:** `feel/sheet.spec.ts` samples `translateY` and opacity per rAF for Create, Comments, Requests and the Report sheet (open, then interrupt at 100 ms). **Static:** `F5_modal_animationType_slide` + `_fade` = 0 (DevPanel exempt). | Open Create and flick it shut halfway: it turns around mid-air. | 7 `animationType="slide"` (system, not a spring, no drag), 5 `"fade"` (CreateSheet fades the whole sheet), the rest pop from scale 0.76 (`popIn.ts`). Hello Roxy drags through `PanResponder` (JS thread). |
| **F6** Feed paging & lists | **Web:** p95 rAF delta ≤ 16.7 ms unthrottled. At 4×: p95 ≤ 33.4 ms and ≤ 3 long animation frames > 100 ms per 10 page swipes. **Android floor:** janky frames ≤ 5%, p90 frame time ≤ 16 ms, 0 frozen frames (> 700 ms) over 10 feed pages and 3 long flings on Discover, Messages and You. | **Web:** `feel/frames.spec.ts` pages `[data-testid=reels-feed]` by `scrollBy` (read-only) with a rAF logger and `PerformanceObserver('long-animation-frame')`. **Android:** `feel/gfxinfo.sh` runs `dumpsys gfxinfo reset` → `adb shell input swipe` ×10 → parses "Janky frames", "90th percentile", "Number Frozen Frames". Optional: Flashlight (https://github.com/bamlab/flashlight). | Developer options › "Profile HWUI rendering › On screen as bars": the bars stay under the green line while paging. | Not measured (the Feel Inspector baselines this). `FeedPager.handleScroll` runs on JS about 60×/s. 15 plain `FlatList`s. |
| **F7** No loader where data is known | A second visit to any tab or screen within a session shows content in the first frame, with 0 `role=progressbar` within 1 s. With cache-first approved (§5 P2): cold start paints the last-known Feed cell and Discover rails before the network answers. | **Web:** Playwright visits A → B → A and asserts the first list row's testID is present at the first rAF and no progressbar appears within 1000 ms. **Static:** `F11_spinner_elements` → 0. | Open Messages, then You, then Messages again: no spinner, no skeleton. | **111 `<ActivityIndicator>` in 65 files.** No persisted cache (only theme and flags persist). |
| **F8** Skeleton first | When data is not in memory, the skeleton (final geometry) is visible ≤ **100 ms** after the tap. Content replaces it with a fade of ≥ 2 frames and ≤ 150 ms. No staggered row entrances. | Playwright on a local export with `page.route` delaying GETs by 800 ms (read-only): time from click to `[data-testid$=-loading]`, and the opacity ramp of the content. | Pull up Discover on slow Wi-Fi: grey shapes instantly, then content glides in. | Done on Discover rails, Archive rail, Archive list and event poster. The Feed stage skeleton pulses. Everywhere else is a spinner. |
| **F9** No layout shift | CLS ≤ **0.02** per screen load on Feed, Discover, Messages, You, Settings, community and event (stricter than web.dev's 0.1). The first 5 rows' y position at skeleton and at content state differ ≤ 1 px. | `PerformanceObserver('layout-shift')` from navigation to idle; bounding boxes of the skeleton rows vs the loaded rows. | Nothing jumps when content arrives. | Unknown (Inspector). Risks: avatars without fixed boxes, `NewPostsBanner` popping in. |
| **F10** Optimistic | Every member action changes the screen in the **same frame** as the release (≤ 16.7 ms), before any request resolves. A failure rolls back within 1 s with a snackbar and Retry. | **Jest (store level):** per action, the state flips before the first `await` (never-resolving supabase mock), and a rejection rolls back and surfaces an error. **Web, local stack only:** `page.route` holds the write and asserts the UI flipped within 1 frame of `pointerup`, then `abort()` and assert the rollback and snackbar. | Turn on airplane mode and react: the reaction shows at once, then politely undoes. | ✓ reactions, save, follow, join, DM send, Roxy AI send, poll, archive votes. ✗ friend request / accept (`friendStore` awaits first), comment send and channel send (composer spinner), RSVP (server-first by design: needs an instant pending state). |
| **F11** Single waits | 0 spinners. The Roxy loading indicator shows only after **200 ms** and then stays ≥ 400 ms (no flicker). Waits > 5 s (video upload) show a determinate bar. | **Static:** spinner count = 0. **Jest (fake timers):** `RoxyLoading` is absent at 199 ms, present at 200 ms, and not unmounted before 400 ms. | Fast actions never flash a loader. | 111 spinners. `PrimaryButton` busy = `ActivityIndicator`. |
| **F12** Reduce Motion | With the OS setting on: no translate or scale animation lasts more than 1 frame, every opacity change is ≤ 120 ms, loops are static (skeleton pulse, LIVE dot, blink, writing squash), and haptics still fire. | **Web:** `emulateMedia({ reducedMotion: 'reduce' })` + per-rAF sampling of the press, sheet, tab and push. **Static:** `F12_anim_without_reduce_motion` = 0. **Jest:** reduced-motion mocks assert no spatial spring starts. | Android › Accessibility › "Remove animations" (iOS: Reduce Motion): everything still works, nothing slides. | **15 animations in 8 files ignore it** (`TypingIndicator`, `FeedSkeleton`, `MessageRow` swipe, `CommentThread`, `PostActionRow`, `QuestionOfTheDayCard`, `welcome.tsx`, `speed-dating/result`). `lib/haptics.ts` turns haptics *off* under Reduce Motion (the direction says they stay). |
| **F13** Haptics | Haptics fire only on the §3.3 events, at most 1 per gesture, 0 on web. On Android, nothing happens when "Touch feedback" is off. | **Static:** the haptic call-site table equals §3.3 (scan `F13_haptic_call_*`). **Jest:** web → no call; reduced motion → the call still happens. **Device:** 1-minute manual check with touch feedback off. | Touch feedback off → silence. On → one soft tick per choice. | About 30 call sites beyond the direction's list: `chat/[id]` ×6, `chat/info` ×7, `messages/new` ×3, `MessageRow` ×3, `RequestsSheet`, `MessageActionSheet`, channels, poll, comment like ×2, daily prompt, archive ×2, `SelfControls`, `badges`. One direct `expo-haptics` import (`event/[id].tsx`). |
| **F14** Keyboard | The composer stays attached to the keyboard's top edge every frame while the keyboard animates (Android 11+, iOS), and the last message stays visible. On mobile web the composer sits on `visualViewport` (±1 px). | Code check: chat composers use `useAnimatedKeyboard`. Device: screenrecord + frame diff (`feel/keyboard-diff.cjs` over ffmpeg frames). | Tap into a chat: the composer rides up with the keyboard, no jump at the end. | `KeyboardAvoidingView` in 15 files. Android `softwareKeyboardLayoutMode: resize` → one jump at the end. |
| **F15** Images | Frame 1 shows a placeholder (blurhash or identity colour), never blank. Content images fade in ≤ 150 ms. ≤ 5% of feed cells still show a placeholder 300 ms after settle on Fast 4G ("%FIRE"). No avatar flicker on recycle. | **Web:** Playwright with `Network.emulateNetworkConditions` (Fast 4G): at each page settle, check that `img.complete && naturalWidth` by +300 ms; sample the avatar `src` across recycling. **Static:** `F15_expo_image_no_transition`, `F15_rn_image` → 0. | Flick through 10 posts on mobile data: photos are there when you land. | 0 expo-image `transition`s. Placeholders on ~3 of ~28 expo-image elements (`PhotoCell`, `PostMediaCarousel`, `VideoPostCard`). 10 files still on RN `Image`. No `Image.prefetch`. |
| **F16** JS headroom | No JS task > 50 ms while any animation runs. | **Web:** Long Animation Frames / Long Tasks during F3-F6 runs. **Native:** the `FEEL_PROBE` stall logger (`setInterval` drift > 50 ms). | — | Unknown (Inspector). |

---

## 3. Interaction inventory → motion map

Sources: `polish/features.md` (M001-M177; Studio S-rows are web admin and out of scope), the code on `polish/wave2-integration`, and the static scan (`scratch/scan-w2.json`).

Legend: ✓ done in Wave 1/2 · ◐ partial · ✗ missing. **Sound is OFF for every row; no sound effect is proposed.** Lane letters refer to §4.

### 3.1 The map

| # | Interaction (features.md rows) | Motion pattern | Token (lib/motion.ts) | Shape morph | Haptic (expo-haptics, via `lib/haptics`) | Reduce Motion | Code | Status → missing (lane) |
|---|---|---|---|---|---|---|---|---|
| 1 | **Tap / press**, every control (all rows) | Press-in: scale 0.96 + `ink` state layer; the one primary drops 3 dp onto its lip; big surfaces (rows, cards) get the layer only (`feedback="layer"`). Release springs back and is interruptible. | `fastSpatial` scale/lip/radius; `fastEffects` layer | Pill → radius 12 on press-in (M3 button group) | none | Jump to the pressed state; layer as a 120 ms fade | `components/ui/PressableScale.tsx`, `PrimaryButton.tsx` | ◐ W1 primitive in 147 files, but on the JS thread with a re-render per press. → UI-thread v3 (reanimated shared values; RNGH spike, §4 C0). Migrate 19 raw-`Pressable` files (C/B/D by owner). |
| 2 | **Toggle / switch**: Dating M105, Ghost M106, Roxy AI M173, previews M123, quiet hours M124, notification types M107, read receipts M094, channel bell M082 | Thumb travels; track colour cross-fades; thumb grows 20 → 24 dp while pressed. Theme (M023) is a connected button group: the selected segment fills and morphs to a full pill. | `fastSpatial` travel/size; `fastEffects` colour | Theme segment → full pill | `light` on the switch; `selection` on the theme segment | Jump; colour 120 ms fade | `components/ui/Switch.tsx`, `app/(tabs)/you/settings.tsx` | ◐ W2 switch (travel on the JS driver, colour snaps). → reanimated, colour spring, check the thumb grow (C). |
| 3 | **Chip / segment select**: Feed segments M028-030, Discover chips M062, events filter M069, economy M070, search scopes M073, archive chips M152, interests M013, vote 1-5 M154, poll M034, interest card M036 | The chip fill cross-fades to `pinkContainer` (no snap). The label weight switches instantly (text never animates). Feed segments: the 3 dp underline slides and resizes to the chosen word. The chosen chip scrolls into view natively. Poll result bars grow from 0 to their width; numbers do not count up. | `fastEffects` fill; `fastSpatial` underline, press; `spatial` poll bars | Press-in pill → 12 | `selection` (chips, segments, theme); poll vote: none | Underline jumps; fill 120 ms fade; bars at their width | `components/discover/FilterChips.tsx`, `app/(tabs)/feed/index.tsx`, `app/archive/index.tsx`, `components/feed/PollCell.tsx`, `components/archive/VoteCard.tsx` | ◐ haptics present; FilterChips uses a raw `Pressable` (its comment claims a morph that never happens); the underline jumps. → B (chips, archive, poll), A (segments). |
| 4 | **Tab switch**: nav bar M018/M019/M162 | M3 *top level*: the new destination's ground paints in frame 1, its **content** fades in. No slide (lateral is wrong for top-level). The pill grows 32 → 56 dp; the icon swaps to filled instantly; the bar recolours to stage colours on Feed with a colour cross-fade. | `effects` content fade (~170 ms); `fastSpatial` pill; `fastEffects` bar colour | Nav pill width | `selection` on change | No fade (instant), pill jumps | `components/nav/FloatingTabBar.tsx`, `app/(tabs)/_layout.tsx`, new `components/motion/TabFade.tsx` | ◐ pill (JS driver) + haptic ✓; content is a jump cut. → A. |
| 5 | **Push / pop screen**: post detail M049, video M050, community M075, channels M079, DM M088, chat info M091, edit M102, settings M104, member M117, notifications M121, event M128, shop M143, product M145, archive entry M153, search M073, onboarding steps M012-015, deep links M166-170 | Native: the platform default (iOS slide + parallax + swipe-back; Android system default), set explicitly with `gestureEnabled`. **Web:** `ScreenTransition` enter = translateX 32 dp → 0 + opacity 0 → 1; the screen revealed by a pop fades in. RTL mirrors x. Modal routes (archive review/edit/note/new) rise 48 dp + fade on web. | Web: `calm` (x) + `effects` (opacity) ≈ 200-250 ms; pop `fastEffects` | none (container transform only for hero moments) | none | Native `animation: 'fade'`; web opacity only, 120 ms | `app/_layout.tsx`, `app/**/_layout.tsx` (9 files), new `components/motion/ScreenTransition.tsx` | ◐ native ok-ish, web ✗. → A. |
| 6 | **Open / close sheet & modal**: comments M041/042, post safety M043, Mini Wins M045, Create M051, answer M064, requests M086, profile safety M118, cart M146, checkout M147, pending M010/M161, archive modals M156-160, message actions M081, GIFs M089, avatar M103, report M172 | One `Sheet`: rises from the bottom edge; the scrim fades (never the sheet). The drag tracks 1:1 on the UI thread. Release: projected position (WWDC) → dismiss if past 35% of the height or flung > 800 dp/s, otherwise spring back carrying the velocity. Interruptible. Menus and centred dialogs keep `popIn` from their anchor edge. Hero cases stay: FAB → Hello Roxy (container transform), Create key rotates 45° to × while its sheet rises. | `spatial` sheet + `effects` scrim; `fastSpatial` menu pop; the release spring takes `velocity` | Create key + → ×; FAB O → 80 dp avatar | none; FAB open = `light` | The sheet is simply there; scrim 120 ms fade | new `components/feedback/Sheet.tsx`; adopters: `components/nav/CreateSheet.tsx`, `components/roxy/HelloRoxySheet.tsx`, `components/feed/CommentSheet.tsx`, `components/messages/RequestsSheet.tsx`, `components/safety/ReportSheet.tsx`, `components/feed/MiniWinsSheet.tsx`, `components/profile/YouMoreMenu.tsx`, ~20 `animationType="none"` + `popIn` sheets | ◐ W2: Hello Roxy and Create springs ✓, but Create's `Modal animationType="fade"` fades the sheet; 7 system slides; scale pops. → C0 builds `Sheet`; adoption by owner (A Create, B comments/feed sheets, C Hello Roxy, D the rest). |
| 7 | **Pull-to-refresh**: Feed M028, Messages M084, notifications M121, profiles M097/M117, archive M152/M153, QOTD M127, tickets M116 | The M3 contained loading indicator, made Roxy's. While pulling, the O scales 0.6 → 1, tracking 1:1 with rubber-band past the 72 dp threshold. Crossing the threshold ticks once. On release past it, the O squashes (`RoxyWriting` morph) until **new content is visible**, then pops out while the content fades in. A release before the threshold cancels. On native the Feed pager keeps the system `RefreshControl` (a snap pager plus a custom gesture is risky), tinted with a theme token. | `fastSpatial` O scale/out; `fastEffects` content; loop = the existing writing cycle | Circle → squircle → pill → circle (existing O squash) | `selection` at the threshold (as the system control does) | No squash loop; a static O; content swaps with a 120 ms fade | new `components/feedback/RoxyRefresh.tsx`; sites: `FeedPager`, `ReelsFeed`, `ProfileShell`, `MessagesInbox`, `messages/index`, `notifications`, `archive/index`, `archive/[slug]`, `qotd/[id]`, `tickets`, `you/[userId]` (11) | ◐ native system spinner; **web ✗** (react-native-web `RefreshControl` renders an empty View). → C0 builds it (face vs faceless: §5 P1), B and D adopt. |
| 8 | **Feed paging**: M028-M037, community reels M077, full-screen video M050 | The pager snaps natively (FlashList `snapToInterval`; web CSS scroll-snap). Cell chrome moves with its cell; nothing animates on page change. Video plays on settle, not mid-drag. The next 2 cells are mounted (`drawDistance`) and their first image prefetched. | none (user-driven); video fade-in `fastEffects` | — | none | Same paging; no autoplay | `components/feed/FeedPager.tsx`, `ReelsFeed.tsx`, `FeedCell.tsx`, `PhotoCell.tsx`, `FeedVideoPlayer.tsx` | ◐ W2 structure ✓. → B: move `handleScroll` work off the JS frame (`useAnimatedScrollHandler` or `onMomentumScrollEnd`), add `Image.prefetch` of the next cells, measure F6. |
| 9 | **List load / skeleton → content**: Discover rails M062-072, communities M074, members M078, inbox M084, DM history M088, notifications M121, my people M114, tickets M116, badges M115, search M073, profile grids M097/M117, community tabs M075/M083, archive M152 | The skeleton at final geometry is frame 1. A shared pulse (one clock for all blocks) runs opacity 1 ↔ 0.55. Content fades in on top. **No stagger.** Under 200 ms (cached) render the content directly. "Load more" = skeleton rows at the end, not a spinner. | Pulse `SKELETON` (700 ms each way, UI thread); content `fastEffects` | — | none | Static skeleton; 120 ms fade | new `components/feedback/Skeleton.tsx`; done: `discover/Rail.tsx`, `archive/ArchiveRail.tsx`, `archive/index.tsx`, `event/[id].tsx`, `feed/FeedStageSkeleton.tsx`; retire `feed/FeedSkeleton.tsx` (scale pulse 1.04 at 180 ms, ignores RM) | ◐ 5 surfaces ✓; **65 files spin**. → B (discover, feed, archive, search, people, notifications), D (messages, chat, you, events, community tabs, tickets, badges). |
| 10 | **Send message**: DM M088/089, channel M080, Roxy AI M095, Sister M096, comments M041, thought replies M099 | The bubble appears in the same frame from the composer edge: rises 8 dp and fades in (text is read, so no overshoot). The list scrolls to the end natively. The composer clears at once. Sending → sent tick cross-fades. A failure keeps the bubble with the existing "not sent / retry" affordance and no shake. The send button scales in when text appears. Roxy AI: the O "writing" squash, then the reply arrives sentence by sentence (each rises 8 dp). | `calm` rise; `fastEffects` fade and tick; `fastSpatial` send button | Roxy's writing O | **none** (current `haptic('tap')` on send is removed) | No rise; 120 ms fade | `app/chat/[id].tsx` (optimistic ✓), `components/channels/ChannelComposer.tsx` (spinner ✗), `components/feed/CommentSheet.tsx` (spinner ✗), `app/roxy-chat.tsx` + `components/roxy/roxyConversation.ts` ✓, `components/chat/TypingIndicator.tsx` (legacy springs, no RM ✗) | ◐ → D (DM, channel, typing), B (comments), C (Roxy AI). |
| 11 | **React**: rail M039/M177, double-tap M040, DM reactions M089, channel M081, thoughts M099 | As specified in direction § Reactions: tap = ❤️ pop + button squish 0.85 → 1.12 → 1; double-tap = heart at the thumb + ring + 6 dots ≤ 480 ms; long-press 300 ms opens the picker (items stagger 20 ms from the button side, the finger-over emoji grows to 44 dp and lifts 26 dp); her +1 rolls one digit. | `fastSpatial` pop/squish/items; `effects` ring and exit; `spatial` picker | Reaction disc fill | `light` on commit; `selection` per emoji passed | No burst/pop/roll, instant states; **haptics stay** | `components/reactions/*`, `components/chat/MessageRow.tsx`, `components/channels/ChannelMessage.tsx` | ✓ W2 (legacy `Animated`, native driver). → C: run the burst on reanimated so a busy JS thread cannot eat it; give picker items a press state; RM keeps haptics (E). |
| 12 | **Follow / join / RSVP / save / add friend / bookmark / watchlist**: rail follow M039, join M076, add friend M078/M117, accept M086/M114, RSVP M129, join online M131, save M100, shop bookmark M144, watchlist M155 | Optimistic flip in frame 1. Label cross-fades and the button width springs to hug the new label (text never bounces). Join (primary, lipped) → Joined (`raised`): the lip collapses 3 → 0. **RSVP:** "I'm going" press drops the lip and shows a pending state at once (the loading indicator after 200 ms); when the ticket arrives the pill morphs into the 16-point seal (moment 3). A failure rolls back plus a snackbar with Retry. | `fastEffects` label/fill; `fastSpatial` width/lip; `slowSpatial` seal | Pill → 16-point seal (RSVP only) | none; RSVP seal lands = `medium` | Instant swap; the seal shown stamped | `store/followStore.ts` ✓, `store/communityStore.ts` ✓, `store/feedStore.ts` save ✓, `store/friendStore.ts` ✗, `app/event/[id].tsx` ◐, `components/events/GoingSeal.tsx` ✓, `store/archiveStore.ts` ✓ | ◐ → D (friend store, RSVP pending state, buttons in profile/community). |
| 13 | **Error / empty**: rails `-error/-empty`, not-found M119/134/151/163, crash M025, coming soon M164, failed optimistic writes | The error block fades in at the final layout: one sentence + Retry, no shake, no red flash. Retry goes back to the skeleton, not a spinner. Optimistic failures use the `Snackbar`: it rises from the bottom edge above the nav bar and the FAB lane, can be swiped down, and dismisses after 4-6 s (6 s with Undo). Empty states are static. | `fastEffects` error fade; `spatial` snackbar in, `effects` out | — | none (errors never buzz) | 120 ms fades | `components/ui/Snackbar.tsx` ✓ (setTimeout dismiss, no swipe), `components/discover/Rail.tsx` ✓; chat and archive own toasts | ◐ → C (snackbar swipe + host), D/B (replace ad-hoc toasts in `chat/[id]`, `archive/index`). |
| 14 | **Success / celebration**: You're in M011, RSVP seal M129, Hello Roxy M022, post published M052-054, order confirmed M148, match M140, badge M024 | Only the three signature moments (W2) plus the reaction burst. Post published: the composer sheet closes and the post is simply there (no confetti; `FirstPostCelebration` retired). Order confirmed and match: a calm push, no burst. Badge overlay: see §5 P6. | `slowSpatial` moments; `calm` elsewhere | Code cells → card; pill → seal; O → avatar | `success` You're in; `medium` seal; `light` FAB | End states shown; haptics stay | `app/(auth)/welcome-in.tsx` ✓, `app/event/[id].tsx` ✓, `components/roxy/HelloRoxySheet.tsx` ✓, `components/gamification/BadgeCelebration.tsx` (legacy springs + fade modal + success) | ✓ moments. → D: align or retire BadgeCelebration (needs Nicole). |
| 15 | **Keyboard appears**: every composer (M041, M080, M088, M095, M096, M099), auth and onboarding forms M001-M015, search M073, edit M102, answer M064 | The composer and the list's bottom inset track the keyboard frame by frame on the UI thread, and the last message stays pinned. Forms scroll the focused field into view natively. On mobile web the composer follows `visualViewport`. | none (follows the system curve) | — | none | Same (system motion) | 15 `KeyboardAvoidingView` files; chat: `app/chat/[id].tsx`, `app/roxy-chat.tsx`, `app/(tabs)/discover/community/channels/[communityId].tsx`, `components/feed/CommentSheet.tsx`, `components/grow/AnswerSheet.tsx`, `components/roxy/HelloRoxySheet.tsx` | ✗ on Android (`adjustResize` jumps at the end). → D (chat, channels, answer), B (comments), C (Roxy AI). Note the `useAnimatedKeyboard` caveat in §4. |
| 16 | **Image load**: photo cell M032, video poster M031, avatars (everywhere), covers M066/M152, posters M065, products M143/M145, profile grids M097, GIFs M089 | Frame 1 shows a placeholder (the post's blurhash, else its identity-colour field, else `raised`). Content images cross-dissolve in. Avatars in recycled lists use `recyclingKey` and no transition when cached (no flicker). Next feed cells and Discover poster rails are prefetched when idle. | `CROSS_DISSOLVE_MS` 150 (expo-image `transition`) | — | none | `transition` 0 | `components/ui/Avatar.tsx`, `components/feed/PhotoCell.tsx` (blurhash ✓), `FeedVideoPlayer.tsx`, `components/events/EventPoster.tsx`, archive covers; RN `Image` in 10 files | ◐ placeholders on ~3 of ~28 expo-image elements, 0 transitions, 0 prefetch. → B (feed, discover, archive, new `lib/imageLoading.ts`), C (Avatar), D (profile grids, chat GIFs). |
| 17 | **Scroll-linked**: FAB tuck M022, LIVE dot M044/M068, Roxy blink | FAB tucks to 40 dp on scroll down and returns on scroll up, at the top or at the end; the LIVE dot pulses 1400 ms; Roxy blinks every 4-7 s. Drive the tuck from a UI-thread scroll value, not JS `onScroll`. | `fastSpatial` tuck; `MOTION.pulse` | O tuck | none | Tuck = fade to the tucked state; dot steady; no blink | `components/ui/RoxyCompanionButton.tsx`, `components/discover/LiveDot.tsx`, `components/roxy/RoxyO.tsx` | ✓ W2. → C: tuck via shared scroll value (lower JS load). |
| 18 | **Swipe-to-reply, long-press menu**: DM M089, channel M081 | The bubble follows the finger 1:1 with rubber-band resistance; crossing the threshold ticks and shows the reply glyph; release springs back with velocity. Long-press opens the action sheet or picker. | `spatial` + gesture `velocity` | — | `selection` at the threshold; `selection` when a long-press opens a menu | No travel; the menu simply opens | `components/chat/MessageRow.tsx` (`PanResponder`, `friction: 7`), `ChannelMessage.tsx` | ◐ → D: RNGH `Pan` + `SPRING.spatial`. |

### 3.2 Token additions (`lib/motion.ts`, Lane C0)

Keep `SPRING` exactly as it is. Measured settle times (`scratch/spring-settle.cjs`; 0.5 px tolerance):

| Token | Overshoot | Settled, 24 px | 300 px | 800 px |
|---|---|---|---|---|
| `fastSpatial` | 9.4% | 208 ms | 350 ms | 444 ms |
| `spatial` | 1.4% | 192 ms | 417 ms | 447 ms |
| `slowSpatial` | 1.5% | 264 ms | 575 ms | 615 ms |
| `calm` | 0.1% | 177 ms | 224 ms | 337 ms |

For opacity (to within 1%), the effects tokens settle in: `fastEffects` 109 ms, `effects` 168 ms, `slowEffects` 237 ms.

These agree with M3's web stand-ins (350 / 500 / 650 ms).

```ts
export const REDUCED = { fadeMs: 120 } as const;                 // direction: effects become 120 ms fades
export const WAIT = { showAfterMs: 200, minShowMs: 400, determinateAfterMs: 5000 } as const; // M3 loading indicator
export const SKELETON = { low: 0.55, halfMs: 700 } as const;      // one shared clock (matches FeedStageSkeleton)
export const ENTER = { pushDp: 32, modalRiseDp: 48, messageRiseDp: 8 } as const;
export const GESTURE = {
  decelerationRate: 0.998,    // WWDC18 projection: x + v/1000 · r/(1−r)
  rubberBand: 0.55,           // common approximation of iOS rubber-banding: (1 − 1/(x·c/d + 1))·d
  dismissFraction: 0.35, flingDpPerS: 800, longPressMs: 300, refreshThresholdDp: 72,
} as const;
export const REST = { unit: 0.001, px: 0.5 } as const;            // see rule below
export const CROSS_DISSOLVE_MS = 150;
```

Rules that come with the tokens:
- **Animate a 0 → 1 progress and interpolate to pixels**, or pass `restDisplacementThreshold: REST.px`. With the default 0.001 on a pixel value, a 500 px sheet reports "finished" about 870 ms after start, although it looks done at about 250 ms. **Never gate input or unmount on the completion callback.**
- Reanimated 3.10 springs already default to `ReduceMotion.System`: under Reduce Motion they jump to the end (read once at launch; on web via `matchMedia`). Effects that must still fade under Reduce Motion pass `reduceMotion: ReduceMotion.Never` with `withTiming(…, { duration: REDUCED.fadeMs })`.
- On web, where a CSS transition is unavoidable, use the M3 curve stand-ins in `material-3-expressive.md`.

### 3.3 Haptic map (the contract for every call site)

| Kind | Fires on | iOS (expo-haptics) | Android (Lane E native path, `View.performHapticFeedback`) |
|---|---|---|---|
| `selection` | tab change; chip, segment, theme or radio choice; each emoji passed in the picker; swipe-to-reply threshold\*; long-press that opens a menu or picker\*; pull-to-refresh threshold\* | `selectionAsync` | `CLOCK_TICK` (`SEGMENT_TICK` on API 34+) |
| `light` | committed reaction; FAB → Roxy AI; switch toggled | `impactAsync(Light)` | `CONTEXT_CLICK` |
| `medium` | RSVP seal lands | `impactAsync(Medium)` | `CONFIRM` (API 30+), else `LONG_PRESS` |
| `success` | "You're in" | `notificationAsync(Success)` | `CONFIRM` (API 30+) |
| — | everything else: send, follow, save, poll vote, comment like, accept request, errors, scroll, keystrokes, web | — | — |

\* Additions to the direction's list (§5 P3). They follow platform conventions (the system pull-to-refresh and context menus tick).

Rules:
- Haptics stay under Reduce Motion: `lib/haptics.ts` must stop skipping them.
- Never on web.
- At most one per gesture.
- Always paired with a visual change.

---

## 4. Phase B — implementation lanes

### 4.1 Constraints every lane obeys

- **Expo 51 / RN 0.74.5, Old Architecture (Paper).**
  - reanimated 3.10.1: transform, opacity, `backgroundColor` and `borderRadius` update on the UI thread. `width`/`height` also run from the UI thread but trigger layout, so use them only for small controls (nav pill, button hug).
  - Physical springs only: `{ mass: 1, stiffness, damping }`, never `dampingRatio` without `duration` (2 s crawl).
  - Legacy `Animated` with `useNativeDriver: false` runs on the JS thread: no new uses.
- **RNGH 2.16.2:** `GestureDetector` + `Gesture.Tap/LongPress/Pan` with worklets. RNGH's own `Pressable` arrived in 2.22, so it is not available here.
- **`useAnimatedKeyboard`:** "disables the default Android behavior (resizing the view…) in the whole app" while mounted, and has drawbacks below Android 11 (reanimated docs). Mount it only on chat screens and test Android 10.
- **expo-haptics 13.0.1:** Android goes through `Vibrator`, not the touch-feedback-aware path. The fix is either a ~40-line local Expo module or a later SDK's `performAndroidHapticsAsync`. **Either needs a new installer build (EAS); web is unaffected.**
- **Web export parity (roxy.expo.app must behave like the app):**
  - native-stack has no transitions on web → `ScreenTransition`.
  - `RefreshControl` is a no-op on web → `RoxyRefresh`.
  - Reanimated and RNGH run on web on the main thread, so F1/F6 there are main-thread budgets.
  - The feed uses CSS scroll-snap on touch.
  - Haptics are none on web.
  - Reduce Motion comes from `prefers-reduced-motion`.
- **`useReducedMotion` (app hook)** starts `false` and subscribes once per instance (21 instances), so the first frame can animate for a member who asked for less motion. Replace it with one module-level store initialised synchronously from reanimated's launch value, then kept live by `AccessibilityInfo` (Lane C0).
- **Gates:** each lane keeps the full gate set (skill `roxy-platform`) and adds its budget checks. Ship live only after the read-only browser run (brief).

### 4.2 Lanes (disjoint file ownership; shared primitives land first)

**C0 — Primitives slice (first, small, Lane C's owner; everything else branches from it).**
New files only, plus `lib/motion.ts` tokens:
- `components/feedback/{Sheet,Skeleton,RoxyLoading,RoxyRefresh,SnackbarHost}.tsx`
- `components/motion/{ScreenTransition,TabFade}.tsx` (stubs that Lane A fills in)
- the single reduce-motion store in `hooks/useReducedMotion.ts`.

It includes the **PressableScale v3 spike**: reanimated shared values, with no `setState` on press-in. Then try an RNGH `Gesture.Tap().onBegin` worklet for UI-thread press-in. The spike must pass all four checks:
1. Press-in still shows within 1 frame with JS blocked for 100 ms.
2. TalkBack and VoiceOver activation works.
3. On web, keyboard Enter/Space activates with a focus ring.
4. A scroll inside FlashList cancels the press.

If 2-4 fail, keep the RN `Pressable` for semantics and ship only the reanimated, no-re-render version.

Done when: F1 passes on the four primitives, F11 jest timing passes, and F12 jest passes.

| Lane | Owns (exclusively) | Work | Done when |
|---|---|---|---|
| **A — Navigation & screen transitions** | `app/_layout.tsx`, `app/**/_layout.tsx`, `app/(tabs)/_layout.tsx`, `components/nav/**`, `app/(tabs)/feed/index.tsx`, `components/motion/**` | Explicit native-stack options (`animation: 'default'`, `'fade'` under RM, gestures on). Web `ScreenTransition` for push, pop and modal routes. `TabFade` (content-only fade, ground in frame 1). Nav pill and Create key on reanimated. CreateSheet onto `Sheet` (no Modal fade). Feed segment underline. Bar colour cross-fade on Feed. | F3, F4, F5 (Create), F12 for nav, on Android and on web at 4×. |
| **B — Feed, lists & images (perceived performance)** | `components/feed/**`, `components/discover/**`, `components/archive/**`, `app/(tabs)/discover/**` except `community/channels/**`, `app/archive/**` (not layouts), `app/search.tsx`, `app/people.tsx`, `app/notifications.tsx`, `store/feedStore.ts`, `store/archiveStore.ts`, `lib/announcements.ts`, new `lib/imageLoading.ts`, new `lib/cacheFirst.ts` | Pager scroll work off the JS frame. Prefetch the next cells' and posters' images. expo-image `transition`/`placeholder`/`cachePolicy` defaults. Skeletons replace spinners in owned files. FilterChips, VoteCard, ContentNoteChip and archive pressables onto `PressableScale`. Comment sheet onto `Sheet` + keyboard. `RoxyRefresh` on owned lists. Retire `FeedSkeleton`. Cache-first for Feed page 1 and Discover rails *if §5 P2 is approved*. | F6, F7, F8, F9, F15, F16 on Feed and Discover; F2 = 0 in owned files. |
| **C — Micro-interactions, shape morph, loading indicator** | `components/ui/**`, `lib/motion.ts`, `hooks/useReducedMotion.ts`, `components/reactions/**`, `components/roxy/**`, `app/roxy-chat.tsx`, `components/feedback/**` (after C0) | PressableScale v3 rollout (the 147 importers inherit it). Switch on reanimated with colour spring and thumb grow. PrimaryButton busy → `RoxyLoading`. Reaction burst on reanimated. Picker item press states. Snackbar swipe + host. Avatar image defaults. FAB tuck from a UI-thread scroll value. Roxy AI composer keyboard. | F1 (p95 ≤ 1 frame, busy-JS variant too), F2 = 0 in owned files, F11, F12 for these components. |
| **D — Feedback states in Messages, You, Events, chat** | `app/(tabs)/messages/**`, `app/(tabs)/you/**`, `app/chat/**`, `app/event/**`, `app/(tabs)/discover/community/channels/**`, every other top-level `app/*.tsx` not owned above (tickets, badges, qotd, support, speed-dating, business, product, community, sister-button…), `components/{messages,chat,channels,profile,events,grow,build,safety,account,donations,gamification,community}/**`, `store/friendStore.ts` and the other stores not owned above | Spinners → `Skeleton`/`RoxyLoading` (44 of the 65 spinner files are here; B has 20, C has 1; D may split into D1 Messages+chat / D2 You+events+the rest). Its share of the ~30 Modal sheets (23 `animationType="none"`, 17 of them via `popIn`; 7 slide; 5 fade) → `Sheet`. `RoxyRefresh` on owned lists. Optimistic friend request/accept, channel and comment-style sends, RSVP pending state. Chat keyboard tracking. Swipe-to-reply on RNGH. `TypingIndicator` on tokens + RM. Ad-hoc toasts → `SnackbarHost`. | F5, F7, F8, F10, F11, F12, F14 on Messages, DM, channel, You, Settings and event; F2 = 0 in owned files. |
| **E — Haptics & feel gates** | `lib/haptics.ts`, new `modules/roxy-haptics/**` (local Expo module: Android `performHapticFeedback`), `app.json` plugin entry if needed, new `scripts/feel/**`, `__tests__/feel/**` | Haptics kinds per §3.3. Stop skipping haptics under Reduce Motion. Android path honours the touch-feedback setting. Turn `feel-static-scan.cjs` into a jest gate (spinner count, raw pressables, RM guards, haptic call-site table, Modal animation types) that the owner lanes drive to green. Call-site removals and additions are made **by the lane that owns the file**, following E's failing test. | F13 (jest + device check), and the static half of F2, F5, F7, F11, F12 enforced in CI. A new Android preview build carries the module. |

Order: C0, then A, B, C, D and E in parallel. The merge order is E's gate last, so it lands green. Each lane ships live on its own after gates, a local export browser run and the read-only live comparison (brief, skill `roxy-platform` § Release).

---

## 5. Proposals that need Nicole (would change layout, colour, copy, features or the locked direction)

1. **P1 — The loading face.** The Roxy O is the loading indicator for single waits and for pull-to-refresh. Should it carry **Roxy AI's face** (eyes up, `think` mood), or be a **faceless pink O**? This matters most for members who switched Roxy AI off: showing her face there contradicts "the button is gone". Recommendation: faceless O everywhere except inside Roxy AI's own chat.
2. **P2 — Cache-first on cold start.** Showing the last-known Feed page and Discover rails before the network answers is the biggest perceived-speed win (Threads TTNC, Instagram). It stores member content on the device. Recommendation: cache Feed, Discover and her own profile only; never Messages names or previews on disk (discreet mode, a borrowed phone).
3. **P3 — Haptic map.**
   - Trim to the direction's list: this removes about 30 existing haptics in chat, chat info, new message, requests, poll vote, comment like, daily prompt, archive, follow controls and badges.
   - Add three platform-standard ticks: swipe-to-reply threshold, long-press opening a menu, pull-to-refresh threshold.
   - Fix Reduce Motion so haptics stay.

   The additions change the locked direction ("Nothing else buzzes"), so they need a `decisions.md` entry.
4. **P4 — Android haptics need a new installer.** The system touch-feedback setting can only be honoured through a small native module (or a later Expo SDK). The interim alternative is an in-app "Vibration" switch in Settings, which is a new row with new copy. Recommendation: the native module, no new row.
5. **P5 — Pressed state layer 8% → 10% in light.** M3's pressed opacity is 10% (m3m-11); v2 chose 8% light / 10% dark. Optional and tiny, but it is a colour value.
6. **P6 — Badge celebration overlay (M024).** It still celebrates with a fade modal, legacy springs and a success haptic on `badges.tsx`. The direction rations celebration to three moments and bans levels and points on her profile. Retire it, or keep it quiet (a snackbar)? This is a feature decision.
7. **P7 — Post published.** After the composer closes, a snackbar ("Posted" + "View") would confirm that the post is live. This is new copy. Without it, the post simply appears on her wall.
8. **Not proposed:** sound effects (all off; if ever, an opt-in setting, never on messages, reactions or anything private), lateral swipes between Feed segments (conflicts with the vertical pager and M3's top-level rule), and a container transform from event poster → event detail (M3: custom and excessive when frequent; the seal is the hero).

---

## Appendix

**New shots** (`D:/Temp/roxy-polish/wave3/motion/shots/`):
- m3m-01 spring speed table
- m3m-02 container transform
- m3m-03 skeleton loader text
- m3m-04 FAB container transform (persistent container)
- m3m-05 Android vs iOS forward/backward
- m3m-06 top-level fade
- m3m-07 enter/exit from the nearest edge (snackbar + FAB)
- m3m-08 skeleton → content fade
- m3m-09 pull-to-refresh guidance (the demo video did not load; the text is the citation)
- m3m-11 state-layer opacities

**Page text:** `scratch/m3-*.txt` (how-it-works, transition patterns, applying transitions, easing tokens, shape morph, loading indicator guidelines and specs, state layers, applying states, gestures, motion-physics blog). Fetched sources: `scratch/src*.txt`.

**Scanner baseline** (`node.exe feel-static-scan.cjs <repo> <branch> --json out.json`, 394 files on `polish/wave2-integration`):

| Check | Files | Count |
|---|---|---|
| Spinners | 65 | 111 |
| Raw `Pressable` with no feedback | 19 | 60 |
| Animations ignoring Reduce Motion | 8 | 15 |
| `KeyboardAvoidingView` | 15 | — |
| Plain `FlatList` | 15 | — |
| Modal `animationType="slide"` / `"fade"` | — | 7 / 5 |
| RN `Image` | 10 | — |
| expo-image with no transition | 12 | 13 |
| JS-driver animations | 4 | — |
| Legacy tension/friction springs | 6 | — |
| `useReducedMotion` instances | 21 | — |

Full per-file hits are in `scratch/scan-w2.json` (`main` in `scan-main.json`).
