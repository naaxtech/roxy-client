# Duolingo

Category: Learning / habit app (daily streak loop, gamified lessons)

Why it feels premium (3-5 principles, each one sentence):
- Every interactive tile is a physical object: a light 2px outline with a thicker bottom edge, so a tap visibly "presses" it and the selected state is a full flat fill (milk tile goes blue), never a glow.
- Colour is a job, not a mood: green = correct and progress, the pink bolt = energy, gold = a hot combo bar; the ground stays white so those colours mean something.
- One hero object per screen (the picture choices, the chess board, the sentence) with everything else small and grey.
- Characters are drawn in one flat, chunky, geometric style with the same line weight as the UI icons, so the illustration and the interface feel like one hand made them.
- The voice is lowercase and short ("fun, bite-sized lessons", "practice conversations"): confident without shouting.

What it does on first run:
- Not visible in the store set. The public site (duolingo-3) shows the pattern: one big friendly headline ("The most fun way to learn languages, chess, and more!"), one filled green primary ("GET STARTED") and one outlined secondary ("I ALREADY HAVE AN ACCOUNT"). The first ask is a choice (which course, screenshot 1 lists Spanish…Korean with flags), not a form.

What it does with empty states:
- Not shown in the store screenshots. Inference only: the course list (screenshot 1) shows that "nothing yet" is answered with a short list of concrete first choices rather than an illustration and a sentence.

Its signature interaction (the one thing people screenshot):
- The streak and the lesson-complete celebration: the progress bar turning gold with sparkles on a combo (screenshot 4), and the streak count people post. The artifact is a number that belongs to you.

Its typography system (families, scale, weights):
- Observed: one heavy rounded sans for headlines (lowercase, ~bold/heavy, very tight leading) and a rounded sans for UI at medium/bold; prompts ("Select the correct image") ~18-20px bold dark grey; chip labels ~15px medium. Very few sizes: headline, prompt, label.
- From Duolingo's public brand site (not measured here): Feather Bold for display, DIN Next Rounded for text.

Its motion language (durations, easing, what moves and what doesn't):
- Not observable in still screenshots. Visible static cues: the gold sparkle on the combo bar and the pressed-tile bottom edge imply short press feedback and a celebratory burst only at milestones. Duolingo has written publicly about animating its characters with Rive; the board, text and chips do not decorate-move.

What we will NOT take from it:
- The mascot-led cartoon world and childlike bright rainbow of section colours (orange, lilac, green, blue, red) — Roxy's members are adults and safety-sensitive.
- Guilt mechanics around streak loss; Roxy already says "No streak police".
- ALL-CAPS button labels.

Screenshots:
- polish/inspiration/shots/duolingo-1.png (App Store iPhone screenshots 1-5)
- polish/inspiration/shots/duolingo-2.png (App Store screenshot 6)
- polish/inspiration/shots/duolingo-3.png (duolingo.com at 390px)
- polish/inspiration/shots/duolingo-4.png (App Store listing page)

## Revisit for direction v2 (2026-10-21): what makes it snappy

Nicole asked for "snappier and nicer, in the spirit of Duolingo". Re-read from the same shots plus two public sources: Duolingo's engineering blog on its Rive character animation (https://blog.duolingo.com/world-character-visemes/, 2022) and Rive's case study on Lily's video call (https://rive.app/blog/duolingo-s-ai-powered-video-call-brings-lily-to-life, 2025). Third-party design-system write-ups that quote exact Duolingo hex values and pixel sizes were read but are not cited as fact.

- **The press is physical and instant.** Buttons and answer tiles have a hard, darker lip under the face (no blur), and the face drops onto the lip on touch-down, before the finger lifts (duolingo-1, duolingo-3). Feedback happens on press-in, not on release. Roxy: the one primary button per screen carries a 3 dp lip in a darker pink and sinks 3 dp on press-in; everything else answers press-in with a scale to 0.96 on the fast spatial spring.
- **Selection is a full fill, never a glow.** A chosen tile turns into a flat field of colour with the same shape (duolingo-1). Roxy: selected chips, her reaction and the active nav item take the flat `pinkContainer` fill.
- **Feedback says right or wrong in under a second, then gets out of the way.** The answer bar slides up in a colour that means the result. Roxy has no right or wrong, so the equivalent is: every tap answers within one frame (optimistic state), and errors arrive as one sentence with the next step.
- **Celebration is earned and rare.** Sparkles and the gold combo bar appear only on a streak or a lesson finished (duolingo-4). Roxy celebrates only at the three signature moments; reactions get a small burst, not confetti.
- **A character carries the emotion.** Duolingo's characters blink, nod and react to what you do, driven by a Rive state machine whose files stay under a megabyte (Rive case study). Roxy AI gets a face the same way, drawn with `react-native-svg` and moved with reanimated (no Rive runtime needed for blinks, a glance and four expressions).

What we still will NOT take: the cartoon world, streak guilt, uppercase button labels, and the rainbow of section colours.

