# Roxy: brief

## What it is
Roxy is a community-first social app for lesbians and women who love women (WLW), under the Thinqer brand. A member opens a TikTok-style vertical feed that carries every kind of post (video, photo, text card, poll, resource, Roxy link) and lives in Discord-style communities with channels. Dating is opt-in and never the main thing. The WLW Archive is a community-rated library of WLW media.

Two apps:
- `apps/mobile` (Expo; its web export is the tester build at roxy.expo.app): members.
- `apps/studio` (Next.js): community owners, sellers and Roxy staff.

## Who it is for
WLW at every life stage, from questioning to long-partnered. The product promise is "a home at every stage", so nobody has to leave when her life changes.

## The wedge
Most WLW spaces are either dating apps (you leave when you match) or general social apps (not safe, not hers). Roxy is the safe, warm, community-first home that stays useful after dating.

## Product invariants (non-negotiable for every agent)
- Nav: Feed · Discover · ＋Create (a sheet, not a route) · Messages · You.
- Feature parity: features move or merge, never disappear.
- Roxy AI is the emotional AI companion, sister to the Roxy app, reached from the omnipresent floating Roxy button; members can switch her on or off in Settings. Sister is the quieter companion. Dating is opt-in.
- Safety first: block/mute/report on every surface, request-first DMs, LIVE = dot + word, deliberate loading/empty/error states, never log PII.
- Privacy outside the app: a push, lock screen or share preview never shows message text or a community, channel or event name by default, because that can out someone.

## Design truth today (v0, to be improved)
`docs/handoff/roxy-3.0/` (README, PROMPT, `Roxy App.dc.html` prototype) and `apps/mobile/lib/theme.ts`. Nicole's verdict on 2026-10-20: the existing revamp is not good enough. The Art Director improves on it.

## Live URLs
- Members web build: https://roxy.expo.app (EAS Hosting, owner `thinqerhq`)
- Studio: Vercel project `roxy-studio` (fed by `sync-studio.yml`)
