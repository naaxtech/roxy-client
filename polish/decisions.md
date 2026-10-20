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
