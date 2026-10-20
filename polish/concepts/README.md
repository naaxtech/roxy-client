# Concept boards (PROPOSED direction)

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
