# Concept boards (PROPOSED direction)

## v2 boards (PROPOSED v2, 2026-10-21) — current

**The v1 boards below (`01-…` to `04-…`, `roxy-tokens.css`, `roxy-concepts.js`) are superseded by the v2 boards (Nicole's 2026-10-21 verdict: no flower, light first, keep the Roxy AI button). They are kept for history; do not build from them.**

HTML using `roxy-tokens-v2.css` (light-first v2 tokens) and `roxy-concepts-v2.js` (one outline icon set and the Roxy O mark), with the exact TTFs the `@expo-google-fonts` packages ship (`assets/Geologica_*`, `Commissioner_*`, `NotoSans{Arabic,Hebrew,Devanagari,Thai}_*`; CJK and emoji as Google Fonts `text=` subsets). Phones are 390 × 844; three-phone boards are 1266 × 968; all rendered to PNG at DPR 2 with Playwright (`D:/Temp/roxy-polish/artdir2/render2.cjs`). Every render: 0 console errors, 0 failed requests, every font loaded. `lint.mjs --app`: 0 FAIL, 0 WARN on all 10 files (kept exceptions carry a `taste-skill-ignore` reason). `inspect.mjs --app`: 0 FAIL on all 8 boards; allowed rules and the defended WARNs are listed in `polish/design-direction.md` › Bans. Every PNG was looked at and iterated for overlap, clipping, anything under the FAB, contrast, flower motifs, placeholder text and emoji in chrome.

| Board | What it shows | PNG |
|---|---|---|
| `v2-01-hello-roxy.html` | Signature 1 "Hello, Roxy": the Roxy O grows into the Roxy AI sheet over Discover | `v2-01-hello-roxy.png` |
| `v2-02-youre-in.html` | Signature 2 "You're in": brand-pink field, the membership card from the vouching community | `v2-02-youre-in.png` |
| `v2-03-invite-poster.html` | Signature 3: a community event as a poster, just after "I'm going" (16-point seal, ticket) | `v2-03-invite-poster.png` |
| `v2-04-feed-before-after.html` | v0 Feed (live screenshot, copied to `assets/v2-v0-feed-1-foryou.png`) vs the proposed Feed: double-tap burst, and the long-press reaction picker with Roxy tucked | `v2-04-feed-before-after.png` |
| `v2-05-fab-and-roxy-ai.html` | Discover at rest with Roxy's 88 × 88 lane, Discover scrolling with Roxy tucked, the Roxy AI chat full screen; uploaded and fallback Archive covers | `v2-05-fab-and-roxy-ai.png` |
| `v2-06-messages-discreet.html` | Messages normal · discreet on (Premium) · not Premium: the locked switch and the honest upgrade sheet | `v2-06-messages-discreet.png` |
| `v2-07-settings.html` | Settings (Roxy AI switch, language, theme) · Roxy AI switched off with Undo · the language picker | `v2-07-settings.png` |
| `v2-08-type-and-scripts.html` | The type system in every launch script, and an Arabic right-to-left Feed (what mirrors, what does not) | `v2-08-type-and-scripts.png` |

### v2 credits

- "elevator-tram Lisbon lamp was actually", CC0, via rawpixel / Openverse (`openverse:7baccc72-6a67-4021-94ec-fcaa5382e559`, https://www.rawpixel.com/image/11175931/image-road-public-domain-graffiti) → `assets/v2-lisbon-elevator-tram.jpg`.
- "Seoul Skyline Night 2018" by mauveine.kim, CC0, via Wikimedia Commons (https://commons.wikimedia.org/wiki/File:Seoul_Skyline_Night_2018.jpg) → `assets/v2-seoul-skyline-night.jpg`.
- David Henry Friston, "Carmilla (Laura in bed)" (1872), public domain, via Wikimedia Commons (https://commons.wikimedia.org/wiki/File:Friston,_Carmilla_(Laura_in_bed).jpg) → `assets/v2-cover-carmilla-friston.jpg`, standing in for an uploaded Archive cover.
- "Pompei - Sappho - MAN" (Roman fresco, Museo Archeologico Nazionale, Naples), photo by WolfgangRieger, public domain, via Wikimedia Commons (https://commons.wikimedia.org/wiki/File:Pompei_-_Sappho_-_MAN.jpg) → `assets/v2-cover-sappho-pompeii.jpg`, standing in for an uploaded Archive cover.
- Roxy wordmark: `apps/mobile/assets/brand/roxy-logo-mono-black.svg` / `-white.svg`, cropped to `assets/v2-roxy-wordmark-*.svg`.
- Fonts (SIL OFL): Geologica, Commissioner, IBM Plex Mono, Noto Sans Arabic / Hebrew / Devanagari / Thai / JP / SC / TC / KR, Noto Color Emoji (subset for the six reactions).
- Every name, community, event and message on the v2 boards (Amara Okafor, Inês R., Mariam K., Tolu Adeyemi, Sofía Marín, Ngozi, Hana, Lagos Sapphic Readers, Clovelly Dawn Dippers, Kraków Queer Climbers…) is fictional sample content. Script sample lines on v2-08 are sample copy for type only.

## v1 boards (superseded 2026-10-21)

HTML at 390x844 using `roxy-tokens.css` (the proposed tokens) and the exact TTFs the `@expo-google-fonts` packages ship (`assets/`), rendered to PNG at DPR 2 with Playwright (`D:/Temp/roxy-polish/artdir/render.cjs`). Every render: 0 console errors, 0 failed requests, nothing overflowing the phone. `lint.mjs` (Taste Skill v2): 0 FAIL, 0 WARN; every kept exception carries a `taste-skill-ignore` comment with its reason (media scrim, legibility shadow on media chrome, a floating toast, mono for a ticket code).

| Board | Moment | PNG |
|---|---|---|
| `01-give-her-a-flower.html` | Signature 1: double-tap gives a flower (frame at ~280 ms of the 600 ms bloom), first-flower toast | `01-give-her-a-flower.png` |
| `02-youre-in.html` | Signature 2: invite code accepted, the screen floods Roxy pink | `02-youre-in.png` |
| `03-invite-poster.html` | Signature 3: a community event as a poster, just after "I'm going" | `03-invite-poster.png` |
| `04-feed-before-after.html` | v0 Feed (`polish/evidence/v0/feed-1-foryou.png`, live build) beside the proposed Feed (a text post on the paper field) | `04-feed-before-after.png` |

## Last critique round (Taste Skill critique.md §4 shape)

ROUND 3
Seen in one second: a pink flower (01), a pink field with "You're in" (02), an orange poster (03), a sentence on paper (04).
Idea (one sentence): the flower women have given each other becomes Roxy's reaction, mark and moment.
Live thing: giving a flower (double-tap) and RSVP stamping the poster.
Layout words: full-bleed media / statement on a field / poster + facts list / statement on a field.
Scores: design 8 · usability 8 · creativity 8 · content 7 → overall 7.9.
Caps applied: none (scrim is the allowed gradient; floating toast is an overlay).
Fixed in rounds 1–2: the bloom was too large and carried a drop shadow (removed); the "8" live count lacked its word ("8 live"); the active segment had no marker; the "You're in" date line touched the lede; the RSVP stamp covered the share and more icons; placeholder guest-dot avatars were removed; the text post sat too high on the paper field; em dashes in titles.
Still short: the boards are stills, so motion is described, not shown; 01 uses a public-domain painting because there are no member photos to show; 04's v0 side is a real screenshot while the right side is a mock.

## Credits

- Eva Gonzalès, *The Bouquet of Violets* (about 1877–78), The Metropolitan Museum of Art, CC0, via Wikimedia Commons: https://commons.wikimedia.org/wiki/File:The_Bouquet_of_Violets_MET_Wrightsman118-CROP.jpg (`assets/eva-gonzales-bouquet-of-violets.jpg`). Used as stand-in post media; it is not Roxy content.
- Roxy wordmark: `apps/mobile/assets/brand/roxy-logo-mono-black.svg` (copied to `assets/`).
- Fonts (SIL OFL): Bricolage Grotesque, Figtree, IBM Plex Mono.
- Names in the boards (Maya, Ines R., Noor A.) and the communities' events are fictional sample content.
