# Rubric (copied verbatim from the Polish Orchestration doc, Section 5)

Each feature is scored 1–5 on every dimension. **A score without a screenshot and one sentence of evidence is rejected.**

| Dimension      | 1 (broken)                                  | 3 (acceptable)                                  | 5 (world-class)                                                                 |
|----------------|---------------------------------------------|-------------------------------------------------|---------------------------------------------------------------------------------|
| Correctness    | Fails happy path or throws console errors   | Happy path works, some edge cases fail          | Every edge case handled, zero console errors, idempotent actions                |
| States         | Blank screens on empty/loading/error        | All states exist, some are plain text           | Every state is designed, says what to do next, and matches direction            |
| Flow           | Dead ends, unclear next step                | Reachable in ≤3 steps, next step usually clear  | Shortest possible path, next step always obvious, back/escape always works      |
| Copy           | Dev wording, raw error strings              | Clear, but generic                              | In voice, plain, specific, Taglish where it fits, errors tell you the fix       |
| Visual         | Off-token colors/spacing, misaligned        | On-token, aligned, but flat                     | Hierarchy obvious at a glance, feels expensive, passes Taste Skill pre-flight   |
| Interaction    | No feedback on actions                      | Feedback exists, no undo, confirms missing      | Instant feedback, undo on destructive, optimistic UI, keyboard works            |
| Motion         | None or janky                               | Transitions exist, inconsistent timing          | Motion explains state, consistent durations, never blocks the user              |
| Mobile         | Cut off or unusable at 360px                | Usable at 360px, some tight targets             | Designed for 360px, 44px targets, thumb-reachable primary action               |
| Performance    | >3s on throttled 4G, layout shift           | <2s, minor shift                                | <1s on throttled 4G, zero CLS, skeletons match final layout                     |
| Accessibility  | Contrast fails, no labels                   | AA contrast, most labels                        | AA everywhere, focus order correct, screen-reader walkthrough makes sense       |
| Consistency    | Differs from sibling features               | Mostly matches                                  | Indistinguishable in behavior and style from every other feature                |
| Delight        | Nothing memorable                           | Clean but forgettable                           | One moment someone would screenshot or show a friend                            |

**Bar:** every cell ≥ 4. Signature-moment features must score 5 on Delight.

Inspector personas (score *as* this person):
- **NERP:** Tita Marites, 55, runs a hardware store, Samsung A-series, 4G, has never used an ERP.
- **Roxy:** defined in `design-direction.md` ("Inspector persona"), approved with the direction.

Roxy note: "Taglish where it fits" applies only if the approved direction says the audience uses it; otherwise read Copy as "in Roxy's voice".
