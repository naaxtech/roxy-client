# Roxy polish: adapted spec

Source plan: `D:/Work/NXT Business/NERP-Roxy-Polish-Orchestration.md` (Nicole). That plan stands; this file records only where the repos forced a change, and the decisions Nicole made on 2026-10-20. Where the two disagree, this file wins for Roxy.

## Decisions (Nicole, 2026-10-20)
1. Roxy goes first. NERP starts once a NERP-Dev Supabase project and keys exist (every NERP env file on this machine targets production).
2. Design: the current Roxy 3.0 revamp is v0 and "not good". The Art Director studies the reference apps from real screenshots, the `popular-web-designs` system library and Taste Skill v2, critiques v0 and proposes a clearly better direction. The brand name, logo and persona voice carry over; the visual system may change. Nicole approves; then it is frozen (changes go through `decisions.md`).
3. Branch: Roxy commits go straight to `main`. `main` was synced to `hardening/launch-readiness` on 2026-10-20 (merge 942ad17, tree identical to e98bc1a).
4. Live-first: every verified change ships to the hosted builds right away, so Nicole tests on real URLs.
5. Phase 0–2 run unattended and stop at Nicole's design-direction approval.

## Pipeline changes forced by the repo
- **Taste Skill.** The repo now ships one skill, `design-taste-frontend` v2 (installed at `.claude/skills/design-taste-frontend`). The `soft-skill`, `minimalist-skill`, `output-skill`, `redesign-skill` and `imagegen-frontend-mobile` installs in the source plan no longer exist. Taste Skill is written for websites; Roxy is React Native (Expo 51), so agents apply its principles and the pre-flight items that make sense on a phone, never its Tailwind/Framer code. Set `TASTE_SKILL_HISTORY=D:/Temp/roxy-polish/taste-history.json` (keeps C: clean).
- **Tokens.** The only token source is `apps/mobile/lib/theme.ts` (plus `components/feed/feedChromeTokens.ts`, `components/nav/navTokens.ts`, `components/archive/archiveTokens.ts`). The approved direction may change token values; it adds tokens there, never literals in components.
- **Concept boards.** No image generator is available. Boards are HTML mockups at 390×844 rendered to PNG in a real browser (`polish/concepts/`).
- **Evidence.** `polish/evidence/` is gitignored (thousands of PNGs per pass). Matrix cells carry the path; the files stay on D:.
- **Slice flow (live-first, worktrees, main-only).**
  1. Polisher works in its own worktree `roxy-client-worktrees/polish-<id>` on branch `polish/<id>` from `main`, touching only its feature.
  2. Lead runs the full gate set (`roxy-gates.sh`) on the slice.
  3. Lead deploys the slice's web export to an EAS Hosting preview URL (`eas deploy` without `--prod`).
  4. Verifier scores the preview URL blind.
  5. Orchestrator writes the scores; if every touched cell holds, the lead fast-forwards `main`, pushes, and runs `npm run host:deploy` so roxy.expo.app carries it.
  6. An Android installer (`eas build --profile preview`) is cut at the end of each pass, so web and installer stay in parity.
  Studio changes reach `roxy-studio` through `sync-studio.yml` on push to main.
- **Inspector runtime.** Real browser (Playwright) on the web build: 360×800 and 390×844 (phone) and 1440×900, CDP network throttling at Fast 4G. Writes only as seed accounts (`*@seed.roxy.app`); never a real tester. Undo through the app's own path.
- **Scope.** Rows cover `apps/mobile` (members) and `apps/studio` (community owners, sellers, staff). The landing site (roxy-lp) is out of scope.
- **CI guardrails (Phase 9).** The TODO/FIXME/lorem/placeholder/mock ban applies to production source only (`apps/mobile/{app,components,lib,hooks,store}`, `apps/studio/{app,components,lib}`), never to `__tests__`, `__mocks__` or e2e specs.

## Files
`brief.md`, `rubric.md` (verbatim), `features.md` (Cartographer), `inspiration/` + `design-direction.md` + `concepts/` + `rules/CLAUDE.md` (Art Director), `matrix.md` (Orchestrator only), `decisions.md`, `LIVE.log` (append-only progress), `evidence/` (gitignored).
