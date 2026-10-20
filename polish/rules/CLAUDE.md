# Rules for every Roxy polish agent

Before any UI change: read `polish/design-direction.md`, this file, and `.claude/skills/design-taste-frontend/SKILL.md`. Run its pre-flight check (the items that apply to a React Native screen) before reporting.
Never introduce a color, font, radius, shadow, or spacing value that is not a token.

## Status
Design direction: PROPOSED, not locked. Until Nicole approves it, `apps/mobile/lib/theme.ts` (and the feed/nav/archive token files) is the only source of values, and no Polisher runs.

## Tokens
Live in `apps/mobile/lib/theme.ts`, `components/feed/feedChromeTokens.ts`, `components/nav/navTokens.ts`, `components/archive/archiveTokens.ts`. Text on a token fill uses `inkOn(fill)`. New values are added there as named tokens, never as literals in a component. (The Art Director appends the approved token table below.)

## Product invariants
- Nav: Feed · Discover · ＋Create (sheet) · Messages · You. Feature parity: features move or merge, never disappear.
- Roxy is a "wingwoman": never AI, assistant or chatbot in user-facing copy. Sister is the quieter companion. Dating is opt-in.
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
