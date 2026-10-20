# v0 audit — Roxy 3.0 as shipped on roxy.expo.app

Date: 2026-10-20. Build: live https://roxy.expo.app, signed in as the seed account `e2e-playwright@seed.roxy.app` (read-only: only sign-in, tab, segment, Create-open and Close were clicked). Viewport 390x844, DPR 2, isMobile, hasTouch. Script: `D:/Temp/roxy-polish/artdir/v0-capture.cjs`; console errors during the run: 0. Screenshots: `polish/evidence/v0/` (gitignored, on D:).

**Backend note.** The production Supabase was degraded during this audit (orchestrator, 2026-10-20: auth/rest flapping, sign-ins of 18–30 s). Run 1 (`v0-capture.cjs`) caught Discover's first screen and the Feed's Communities segment while they were still loading; those two captures are labelled **backend degraded** below and are not counted against the design. A second run (`v0-recapture.cjs`: one context, one sign-in, storageState saved to scratch, up to 75 s per screen) captured the same screens loaded (`*-retry.png`), and those are what is judged. The design is also judged from the v0 prototype, `docs/handoff/roxy-3.0/Roxy App.dc.html`, opened locally with no backend (`polish/evidence/v0/proto-*.png`).

Judged against `polish/rubric.md` (bar: every cell >= 4; signature moments 5 on Delight), the Taste Skill v2 house rules and app-screen rules, and the principles in `polish/inspiration/*.md`. Scores are for Visual / States / Copy / Delight only, because those are what screenshots can prove; Correctness, Performance and Accessibility need the Inspector.

## Verdict in one paragraph

v0 is a violet app wearing an orange-pink gradient on every surface. The gradient that should belong to the logo is on the + button, the FAB, the Edit pill, every Discover card, every text post, the onboarding hero, the disabled Continue button, the community cover and the inbox initials, so it means nothing anywhere. Under it, the structure is a template: tracked-caps eyebrow pills on almost every block, icons in tinted squares, cards inside sheets inside cards, emoji in chrome, gradient blocks where pictures belong, and three to-do lists before a new member sees one real post. Apart from one seed photo in the Communities feed, no screen shows a real picture: every cover, member, community, shop and archive title is a gradient block. Nothing on any screen is something a member would screenshot for a friend. The Archive's copy and the code-gate's safety sentence are the only parts with a voice of their own.

## Systemic failures (each seen on 3+ screens)

| # | Failure | Where (evidence) | Why it fails |
|---|---|---|---|
| S1 | Violet/indigo ground (`#14082A` family) with lilac secondary | every screen | Taste Skill bans violet/indigo as the generated-app hue; HER (`her.md`) and Cash App (`cashapp.md`) show that one owned field colour reads stronger than a tinted dark |
| S2 | Brand gradient used as decoration | onboarding-1/2/3, feed-1-foryou, feed-2-following, discover-3/4, you-1, community-1, messages-1, roxy-chat-1 | Gradient = identity only (theme.ts says so itself, and v0 breaks its own rule). Taste Skill: no gradients on grounds, buttons, cards, text |
| S3 | No real imagery anywhere; gradient rectangles stand in for covers, posters, shops, members, communities, archive art | discover-1-retry (Archive, Top 10 members), discover-2-retry, discover-3/4, archive-1/2, community-1; prototype proto-2-discover, proto-5-you, proto-6-community | Critique cap: "fewer than four real pictures: design cannot exceed 6.5". Lex, HER and Partiful carry identity through real photos and posters |
| S4 | Tracked-caps eyebrows and pills | feed-1-foryou "YOUR FIRST FIVE MINUTES", messages-1 "DIRECT", "COMMUNITY CHATS", "WINGWOMAN", "PRIVATE", every inbox row "CHANNELS", discover "SHOP", "COMMUNITY", "GAME", archive "SORT", feed-2-following "REPRO 0921" | Banned (Taste Skill 2nd wave). They repeat the section name the heading already says |
| S5 | Icons in gradient tinted squares | feed-0-mini-wins-sheet, create-sheet, discover-4 Games, messages-1 initials, roxy-chat-1 | Banned on app screens ("an icon in a coloured circle or tinted square on every card: 0 of 23") |
| S6 | Emoji in UI chrome | feed streak "🔥", messages "💗", community "💬", archive chips "🎬 📺 📖", roxy-chat "😄 💜 👀 💕 💭 💛 🌈" | Ban list (plan + Taste Skill) |
| S7 | (Not scored: backend degraded.) Loading states were seen only while the backend was degraded: discover-1 (four spinners at 7 s) and feed-2-communities (a wordless skeleton). The retry shots loaded. Whether v0's loading design meets the rubric (skeleton at the final layout, labels shown at once) is left to the Inspector on a healthy backend | discover-1.png, feed-2-communities.png (backend degraded) | — |
| S8 | Chrome overload on the Feed | feed-1-foryou: ~20 controls (streak chip, search, live chip, 3 segments, card + close, 6 rail plates, author, FAB, 5-slot pill nav, badge "20") | TikTok (`tiktok.md`) runs 5 thin glyphs and two words; content owns the screen. Here content is a card at ~40% of the screen |
| S9 | First run is homework | feed-0-mini-wins-sheet (3 tasks), feed-1-foryou (4 steps), you-1 ("Add a photo…") | BeReal, Locket and Partiful make the first action the core loop. Roxy's first sight is three checklists |
| S10 | One soft radius (14–20) on everything; floating pill nav | all | Taste Skill: radius is bimodal, nav is a plain bar; the floating pill is a warned tell |
| S11 | Type has no scale or voice | all | Outfit + Figtree are both friendly geometric sans; largest step 28; feed body 13. Taste Skill: two or three sizes far apart; one face with character |

## Per screen

### Onboarding — code gate, welcome, sign in
Evidence: `polish/evidence/v0/onboarding-1-code-gate.png`, `onboarding-2-welcome.png`, `onboarding-3-sign-in.png`
- The top half is a full-bleed orange-to-pink gradient with the wordmark sitting in a white rounded box with a drop shadow, which reads as a splash-screen placeholder. Generic gradient hero (banned).
- The "welcome" screen is the sign-in form; the returning member never sees a welcome, and a new one never sees what Roxy is: no people, no community, no post. Compare Partiful (`partiful-3`) and HER (`her-3`): one candid photo says who it is for.
- The disabled Continue is a muddy brown-to-maroon gradient with a grey label, so it reads broken rather than waiting. The Sign In button is white on a gradient whose orange end measures about 3:1.
- Good: "Every member is invited by a community that vouches for her. That's how we keep this place safe." Keep that sentence; it is the brand.
- Rubric: Visual 2 · States 3 · Copy 4 · Delight 1.

### Feed — For you
Evidence: `feed-0-mini-wins-sheet.png`, `feed-1-foryou.png` (`-2`…`-4` are identical: a mouse wheel did not advance the pager on web; touch swiping was not tested)
- The first open of the day opens a Mini Wins sheet over the feed: a bordered card inside the sheet, three tasks with gradient icon tiles and progress bars ("React to 3 posts 0/3"). Chores before content, and the "React to 3 posts" task asks for engagement before she has seen a post.
- The first For you item is not a post; it is a "YOUR FIRST FIVE MINUTES / 4 small steps to feel at home" checklist card floating on a violet-magenta gradient. The vertical feed promise (full-bleed content) is broken on screen one.
- The rail is six near-black rounded-square plates (`RAIL_BACKING` 0.82) stacked like a toolbar; with the FAB below it and the pill nav under that, the bottom-right holds eight targets.
- Rubric: Visual 2 · States 3 · Copy 3 · Delight 1.

### Feed — Following
Evidence: `feed-2-following.png`
- A text post set big in white on the same violet-to-magenta gradient. The type-as-content idea is right (Lex's text posts prove it), but because every text post gets the same gradient, every text post looks the same and looks like an AI splash. A decorative flower glyph and a tracked pill eyebrow ("REPRO 0921") add noise.
- Rubric: Visual 2 · States 3 · Copy 2 (seed test copy) · Delight 2.

### Feed — Communities
Evidence: `feed-2-communities-retry.png` (judged); `feed-2-communities.png` (backend degraded: wordless skeleton, not scored)
- Loaded: a landscape black-and-white photo letterboxed in the middle of a black page, so 60% of the "full-bleed" screen is black bars. The caption is an explainer from "Roxy Official" ("Posts live on your profile now. Follow someone and they show up here.") — the app talking about itself inside the content slot.
- The rail is inconsistent: the heart and comment sit on black plates, save and share do not; a pause glyph floats top-right. The Roxy FAB sits under the rail again.
- Rubric: Visual 2 · States 3 · Copy 2 · Delight 1.

### Discover
Evidence: `discover-1-retry.png`, `discover-2-retry.png`, `discover-3.png`, `discover-4.png` (judged); `discover-1.png`, `discover-2.png` (backend degraded: four spinners, "Browse all 0", not scored)
- Loaded: "The WLW Archive" rail of poster-shaped gradient placeholders with a dark caps pill ("SERIES", "BOOKS", "MOVIES") and a green "✿ 5.0" pill on each; real titles below ("The L Word", "Tipping the Velvet"). The posters are where cover art belongs.
- "Top 10 members": pink-violet gradient tiles with a "MEMBER" pill and an outlined numeral (1, 2) beside them. The member has no face; the stroked numeral is the Netflix trope without the poster that makes it work.
- The chip row (All, Archive, Events, Shops, Live) is cut off at the right edge with no fade or affordance.
- "Events": "Nothing on the calendar yet." — honest, but it offers no next step.
- Every card in "WLW economy", "Communities" and "Games" is a gradient rectangle with an uppercase pill that repeats the section name ("SHOP", "COMMUNITY", "GAME"). Communities are faceless. This is the feature-card-row tell in rail form.
- The Roxy FAB covers content twice: the second Top 10 card ("Jessa Brigole Tester", `discover-1-retry.png`) and the second Games card ("Speed Da…", `discover-4.png`). The FAB-occlusion rule exists for the feed and is broken here.
- Rubric: Visual 2 · States 3 · Copy 3 · Delight 1.

### Create sheet
Evidence: `create-sheet.png`
- "Create / What are you making?" with five rows, each a gradient icon tile. Four of five are locked ("Community accounts host events here. Everyone else uses Roxy Studio.", "Community admins open rooms in Roxy Studio.", "Approved sellers only…", "Game submissions go through Roxy Studio."). For a regular member the sheet is a list of no's. Feature parity is honoured, but the layout gives the no's equal weight to the one yes.
- Rubric: Visual 2 · States 3 · Copy 3 · Delight 1.

### Messages
Evidence: `messages-1.png`, `messages-2.png`
- Roxy and Sister are two outlined cards with pills ("WINGWOMAN", "PRIVATE") and the emoji "💗"; they are told apart by hue alone (pink border vs lilac border).
- Every community row carries the same "CHANNELS" pill and a gradient initial tile; the pill adds nothing because every row is a channel.
- A dev-voice footer: "Who can message you: Everyone — requests first · request-first inbox · change in Settings →".
- Empty direct messages: "No private messages" + "Start a chat" is fine but generic.
- Rubric: Visual 2 · States 3 · Copy 2 · Delight 1.

### You
Evidence: `you-1.png`, `you-2.png`, `you-3.png`
- Gradient cover, gradient-ring avatar, "⚡1" level badge, "15 XP" bar, gradient Edit pill: gamification is the loudest thing on her own profile.
- A pink-bordered nudge card ("Add a photo so friends recognise you") sits above the tabs; the empty Posts tab says "No photos or videos yet".
- The lower half of the screen is empty in all three captures; scrolling reveals nothing. Mini Wins, tickets, saved, dating and ghost modes are not on the first screen (behind ☰), against the 3.0 brief's "two taps from anywhere".
- Rubric: Visual 2 · States 3 · Copy 3 · Delight 1.

### Community + channel
Evidence: `community-1.png`, `community-2.png`, `channel-1.png`
- Community: a lilac-to-blue gradient cover, a "QG" lilac crest tile, a stats card that lists "LIVE On air" as a statistic, tabs, then an info card with "💬" and a second Join button. The empty state reuses the personal-profile sentence ("Anything you post with a picture lands here. Words go in Thoughts.") on a community, which does not make sense there.
- Good: "Queer Gamers • LIVE" follows the dot + word rule.
- Channel: functional (channel chips, "Start of # general", composer), but flat and 60% empty, with a maroon disabled Send. Discord (`discord.md`) shows who is around, presence and voice; here the channel feels like nobody is home.
- Rubric: Visual 2 · States 2 · Copy 2 · Delight 1.

### Archive
Evidence: `archive-1.png`, `archive-2.png`
- The best screen in v0: real titles and an editorial voice ("The one that got there first. Dated in places and worth knowing anyway."). It fails on form: emoji in every filter chip ("✦ Everything 45", "🎬 Movies 12", "📺 Series 10", "📖"), a "SORT" tracked label, gradient placeholders with a type label (TV, BOOK, FILM, MUSIC) where cover art belongs, a green "✿ 5.0" pill (the only green in the app outside success), and every row a bordered card.
- Rubric: Visual 3 · States 3 · Copy 4 · Delight 2.

### Roxy (wingwoman) chat
Evidence: `roxy-chat-1.png`
- A sparkle ✦ in a gradient circle (the universal "AI" glyph), "always on — replies instantly", "Ask me anything", four gradient chips each starting with an emoji. Visually and verbally this is the generic AI-chatbot template, which is exactly what the brief forbids Roxy to be.
- Rubric: Visual 2 · States 3 · Copy 2 · Delight 1.

## The prototype (design intent, no backend)

Evidence: `proto-0-overview.png`, `proto-1-feed.png` … `proto-10-event.png` (the 412x915 frame, cropped from a 1440-wide page).

The live build is a faithful rendering of the prototype, so v0's problems are in the design, not in the implementation. The prototype shows the same violet ground, the same brand gradient on the + button, the FAB, covers, posts and cards, the same caps pills ("SHOP", "EVENT", "LIVE", "WINGWOMAN", "PRIVATE", "IN PERSON", "ONLINE · AUDIO", "4 CHANNELS"), the same tinted icon squares in Create, the same emoji in rows, and a glowing FAB. Its Roxy chat (`proto-8-roxy.png`) is the same "always on — replies instantly / Ask Roxy anything…" chatbot template.

Where the prototype is stronger than the live build, and the proposal keeps the intent:
- The feed opens on a real post (a lino print with a product tag, `proto-1-feed.png`), not a checklist.
- You (`proto-5-you.png`) puts the Dating and Ghost toggles, the streak, tickets, saved and Sell on Roxy on the first screen; the live build hides them behind ☰.
- The community page (`proto-6-community.png`) shows presence: "84 online now · Maya, Priya, Tasha and others".
- The event sheet (`proto-10-event.png`) is one object with clear facts and a safety line ("Public venue · hosted by WLW London mods · attendee list visible to members only").

## Top 5 problems, in order of what to fix first

1. **No idea, only a gradient** (S1, S2). v0 has no visual idea that belongs to WLW or to Roxy; a violet ground with a sunset gradient on everything could be any 2024 AI app. The prototype has the same problem, so this is a direction problem. Fix the idea and the palette before any component.
2. **The feed is not the content** (S8, S9). Screen one is a checklist card under twenty controls, and a loaded photo post sits letterboxed in black bars. The core loop (see a woman's post, give it something, go to her community) is buried.
3. **Template furniture everywhere** (S4, S5, S6, S10). Eyebrow pills, tinted icon squares, emoji, nested cards and one soft radius are the ten-second tells that a stranger reads as "made by AI".
4. **Faceless: gradient blocks where faces, covers and posters belong** (S3). Members, communities, shops, archive titles and events are all the same gradient rectangle with a caps pill, and the FAB lands on top of them on Discover.
5. **Roxy herself reads as a chatbot** (roxy-chat-1, proto-8-roxy, messages-1). The persona that should be the most human thing in the app has the sparkle icon and the "ask me anything" voice.

Not counted: loading states seen only while the backend was degraded (S7).

## What carries over

- The safety sentence on the code gate and the Archive's editorial voice.
- LIVE as dot + word.
- The `inkOn()` / fill-vs-ink rule and the contrast test discipline in `theme.ts`.
- The flower (✿) as the reaction: it is the one owned symbol in v0. The proposal makes it the signature.
- The wordmark and its orange-to-pink ramp, kept for the logo only.
