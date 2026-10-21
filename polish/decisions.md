# Decisions

Append-only. Each entry: date, decision, who, why. Agents stop relitigating anything written here. A direction question that comes up mid-polish is written here as `OPEN:` and the agent stops; only Nicole closes it.

- 2026-10-20 Roxy is polished first; NERP waits for a NERP-Dev database. (Nicole)
- 2026-10-20 The Roxy 3.0 revamp is v0 and not good enough; the Art Director proposes an improved direction from real reference-app screenshots, `popular-web-designs` and Taste Skill v2. Brand name, logo and persona voice carry over. (Nicole)
- 2026-10-20 Roxy commits go straight to `main`; `main` synced to `hardening/launch-readiness` (merge 942ad17, tree unchanged). (Nicole)
- 2026-10-20 Live-first: each verified slice ships to roxy.expo.app (and Studio via sync) immediately; Verifier scores an EAS preview URL before the merge. (Nicole, mechanics by Orchestrator)
- 2026-10-20 Taste Skill v2 only (`design-taste-frontend`); web-only rules are read as principles for React Native. (Orchestrator: the other skills in the source plan no longer exist)
- 2026-10-20 Evidence screenshots stay out of git (`polish/evidence/` ignored). (Orchestrator: repo size)
- 2026-10-21 Reference-app screenshots (`polish/inspiration/shots/`, 30 MB of third-party App Store imagery) stay out of git too; the inspiration files cite them by path. Concept boards and their OFL fonts / public-domain painting are committed. (Orchestrator: size + third-party imagery in a mirrored repo)
- 2026-10-21 `main` takes `launch/integration` (merge 92638f4): roxy.expo.app was deployed from its head 9d4b0ac (Oct 12 00:23 CST) and prod has its migrations 130-135; main synced only to hardening would have rolled the live app back. (Orchestrator, from the Cartographer's bundle check)
- 2026-10-21 Design direction v1 NOT approved; revisions below. (Nicole)
- 2026-10-21 Roxy AI is the emotional AI companion, sister to the Roxy app (not an internal assistant). She is reached from the omnipresent floating Roxy button, which STAYS, and she helps the member. Members can switch Roxy AI on or off in Settings. User copy may call her "Roxy AI"; this supersedes the old "never call her AI" rule. (Nicole)
- 2026-10-21 The display font may change. The UI should feel snappier and nicer, in the spirit of Duolingo and Material 3 Expressive (https://m3.material.io/blog/building-with-m3-expressive). (Nicole)
- 2026-10-21 Messages gets a discreet mode, and discreet mode is a PREMIUM feature. (Nicole)
- 2026-10-21 Launch is worldwide: the app needs localisation plus a language setting. (Nicole)
- 2026-10-21 Light mode is the default theme. (Nicole)
- 2026-10-21 No flower count and no flower reaction, anywhere; it was only for testing. Remove it completely; reactions are the regular emoji set (`POST_REACTIONS`, shared with chat). (Nicole)
- 2026-10-21 Archive cover art is uploaded. Members can suggest edits, and Roxy admins approve them (already built: M158 member suggest-edit, S041 Studio revision queue, S039 staff cover edit). (Nicole)
- 2026-10-21 NERP-Dev database exists in the Supabase account nerp.naaxtech@gmail.com. (Nicole)
- 2026-10-21 Design direction v2 APPROVED by instruction: "deploy them to the code and site right away". v2 is locked as the build target; changes go through this file. (Nicole)
- 2026-10-21 Build order (Orchestrator): Wave 1 is the foundation (theme tokens with light default, fonts, M3 spring motion and press states, primary button with lip, nav bar), shipped live on its own. Wave 2 runs as parallel lanes: Roxy AI button + Settings switch + "Hello, Roxy"; Feed + emoji reactions; Discover/Messages/You; Archive covers. Each lane ships live after gates and a browser run.
- 2026-10-21 Assumptions for v2's open questions until Nicole says otherwise (all reversible): body face changes too (Commissioner); the Roxy O face ships as Roxy AI's mark, with an illustrator pass still owed; the FAB has one job (Roxy AI), and search and filter move to the headers; a per-member reaction table is added so the rail shows her own reaction (migration 136, applied under the standing grant); Roxy AI does NOT read the screen she was opened from. Held until Nicole answers: discreet mode and Premium (no dead "See Roxy Premium" button ships), launch languages (i18n infrastructure is built, translations wait), and feminine vs neutral address.
