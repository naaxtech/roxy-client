# Roxy — TikTok-Formula Redesign: UX Plan & Sketches

> **Status:** design plan, awaiting approval on the three decisions in §8 before slice plans are written.
> **Branch:** `version2`. Baseline `9f98005` = the version1 APK.
> **Date:** 2026-08-05

**Goal:** One vertical full-screen feed carries every kind of Roxy content. A post shows which
communities its author belongs to. Tapping a profile opens her posts as a TikTok-style grid that drops
into a pager. Events and games are first-class cells, not a separate tab. Gamification stays.

**Architecture:** A single `FeedPager` owns vertical snap-paging and viewability. Cell components are
chosen per `post_type` through FlashList's recycling-pool API. The video subsystem subscribes to
"active item id AND item is video" — never to a bare index — because the pager is now mixed-media.

**Tech stack (pinned from `apps/mobile/package-lock.json`, 2026-08-05):** expo 51.0.39 ·
react-native 0.74.5 · @shopify/flash-list 1.6.4 · expo-av 14.0.7 · expo-image 1.13.0 ·
reanimated 3.10.1 · gesture-handler 2.16.2 · **Old Architecture** (no `newArchEnabled` anywhere).

---

## Global Constraints

These bind every task. All were verified against primary sources on 2026-08-05; each carries its source.

- **FlashList stays at 1.6.4.** Shopify has stopped supporting v1, and v2 is New-Architecture-only — this
  app is on the Old Architecture, so v2 is unreachable without an arch migration first.
  `// src: https://github.com/Shopify/flash-list · v2 README · 2026-08-05`
- **Never use `pagingEnabled`.** Broken on Android at exactly flash-list 1.6.4 + RN 0.74; closed unfixed.
  Keep `snapToInterval` + `disableIntervalMomentum` + `decelerationRate="fast"`, which is what
  `ReelsFeed.tsx:400-404` already does correctly.
  `// src: https://github.com/Shopify/flash-list/issues/1200 · 2026-08-05`
- **`getItemLayout` is unsupported in v1.** Use `estimatedItemSize` *and* `overrideItemLayout` — they do
  different jobs and both are needed.
  `// src: https://shopify.github.io/flash-list/docs/1.x/usage · 1.6.4 · 2026-08-05`
- **Viewability must use `viewAreaCoveragePercentThreshold`, not `itemVisiblePercentThreshold`.** The
  latter divides by the *item*, so a cell taller than the viewport can never become viewable. The former
  divides by the list's own measured height and is structurally immune.
  `// src: react-native v0.74.5 ViewabilityHelper.js · flash-list 1.6.4 ViewabilityHelper.ts · 2026-08-05`
- **`viewabilityConfig` and `onViewableItemsChanged` must be stable refs.** Changing them on the fly is
  explicitly unsupported. `// src: RN 0.74 FlatList docs (archive) · 2026-08-05`
- **A `<Video>` releases its decoder only on unmount or explicit `unloadAsync()`.** `pauseAsync` frees
  nothing; `source={undefined}` frees nothing. See §7 — this is a live bug.
  `// src: expo/expo@sdk-51 packages/expo-av/{src/Video.tsx, android/.../VideoView.java} · 14.0.7 · 2026-08-05`
- **Do not migrate to `expo-video`.** It is self-described as experimental at SDK 51 and is not installed.
  Post-SDK-upgrade slice. `// src: expo/expo@sdk-51 docs/.../sdk/video.mdx · 2026-08-05`
- **Assume very few safe concurrent decoders.** The limit is device-specific via
  `getMaxSupportedInstances()` — documented as *a hint for an upper bound that may in practice be less* —
  which expo-av does not expose; OEMs configure it in `media_codecs.xml`. The only spec'd number (6)
  applies solely to Media-Performance-Class handhelds.
  `// src: AOSP MediaCodecInfo.java javadoc · source.android.com/docs/core/media/oem · Android 15 CDD §5.1 · 2026-08-05`
  The related "prefer a single player instance" guidance is about **decoder reuse within an ExoPlayer
  instance**, and comes from the ExoPlayer team's blog — *not* from `developer.android.com/media/implement/playback-app`,
  which was fetched and says nothing about instance counts. Do not cite that page for it.
  `// src: https://medium.com/google-exoplayer/improved-decoder-reuse-in-exoplayer-ef4c6d99591d · 2026-08-05`
- **Every `expo-image` inside a recycled cell needs `recyclingKey`.** Documented cause of the previous
  cell's photo flashing on the next one.
  `// src: expo/expo@sdk-51 packages/expo-image/src/Image.types.ts · 1.13.0 · 2026-08-05`
- **Doc URLs in code must point at the archives.** `docs.expo.dev/versions/v51.0.0/**` and
  `reactnative.dev/docs/0.74/**` both 404 now. Use `github.com/expo/expo/tree/sdk-51/docs/...` and
  `reactnative-archive-august-2025.netlify.app/docs/0.74/`.
- **RLS on every new table, `TO authenticated` explicit on every policy.** A policy with no `TO` clause is
  `TO PUBLIC`, which includes `anon` — the role behind the publishable key baked into `eas.json`. This
  project has already shipped three production leaks from that exact omission (080, 082, 086).
- **Roxy is a wingwoman.** Never "the AI", "the assistant", "the chatbot" in any user-facing string.

---

## 1. Information architecture

Roxy today is four tabs — Grow · Discover · Connect · Build — plus a floating Roxy button. The redesign
collapses to TikTok's five-slot bar.

```
┌───────────────────────────────────────────────────────────┐
│                                                           │
│                     ( the one feed )                      │
│                                                           │
├───────────────────────────────────────────────────────────┤
│   ⌂        ⌕        ⊕        ✉        ◍                    │
│  Home   Discover  Create   Inbox   Profile                │
└───────────────────────────────────────────────────────────┘
```

| Slot | Holds | Where it came from |
|---|---|---|
| **Home** | The single vertical feed. Top: `For You · Following`, LIVE rail. | Discover FYP + Connect feed/reels + community feeds, merged |
| **Discover** | Search, communities, events, games, marketplace | old Discover's non-feed half + all of Build |
| **Create** | Post · video · event | the old FAB |
| **Inbox** | DMs, notifications, speed-date invites, **Roxy pinned at top** | Connect's chat half + the Roxy FAB |
| **Profile** | TikTok grid, gamification, settings | old Profile + Grow |

**Where the wingwoman goes.** Roxy becomes the pinned first conversation in Inbox, and her daily
greeting becomes a feed cell (§3). Burying a differentiator behind a tab would be a mistake; making her
a *conversation* and a *card* is more TikTok-native than a floating button and keeps the daily
gamified touchpoint inside the feed where retention is decided.

---

## 2. The feed cell

Full-bleed, one per screen. This is the video case; every other type keeps the same chrome so the feed
reads as one system.

```
┌─────────────────────────────────────────┐
│ For You          Following              │  ← top tabs, translucent
│  ● LIVE  ● LIVE  ● LIVE   (rail)        │  ← only when rooms are open
│                                         │
│                                         │
│                                         │
│            [ full-bleed media ]         │
│                                         │
│                                     ◍   │  ← author avatar + follow ⊕
│                                     ♡   │     like     1.2k
│                                     💬  │     comment    48
│                                     ⚑   │     save
│                                     ↗   │     share
│                                         │
│  @mara                                  │
│  sunday market with the girls 🌻        │  ← caption, 2 lines then "more"
│  #TheSapphicClub  #ManilaWLW  +2        │  ← community tags
│                                         │
└─────────────────────────────────────────┘
```

**Cell types, all in the one pager.** Each gets its own recycling pool via
`getItemType={(item) => item.post_type}` — mandatory, see §7.

| `post_type` | Renders as |
|---|---|
| `video` | autoplaying, muted, looping; poster until first frame |
| `photo` / `gallery` | full-bleed image, horizontal pager for multi-image |
| `standard` (text) | typographic card on the brand gradient — the "Notes" treatment |
| `poll` | question + tappable options, live result bars |
| `resource` / `roxy_link` | card with preview + open action |
| `event` | see §4 |
| `game` | see §4 |
| `roxy_greeting` | the daily wingwoman card + streak (§5) |

---

## 3. Community tags — and the safety rule

You asked: a user posts, and the post carries tags for the communities she belongs to.

**Schema.** New join table, because a post can carry several and `posts.community_id` already means
something different (the community she posted *into*).

```
post_communities ( post_id → posts, community_id → communities, PRIMARY KEY (post_id, community_id) )
```

`posts.community_id` stays as the primary/origin community. Tags default to it plus whichever of her
memberships she selects at compose time.

### The rule that must not be got wrong

**A tag is a disclosure.** It tells a stranger this woman is in that group. On a WLW app some of those
groups are closeted spaces, survivor spaces, questioning spaces. Publishing that set to everyone who
scrolls past is an outing risk, not a UI detail.

> **A private community's tag renders only to fellow members.** Public tags render to everyone.
> Enforced in RLS on `post_communities`, not in the client — the client is not a security boundary.

```
Viewer is a member of #SurvivorsCircle  →   #TheSapphicClub  #SurvivorsCircle  #ManilaWLW
Viewer is not                           →   #TheSapphicClub  #ManilaWLW
```

Note the second line shows no "+1" and no gap. A hidden tag must be *invisible*, not *redacted* — "+1
more" tells the viewer a hidden group exists, which is most of the leak.

Tapping a tag opens that community. Max 3 chips, then `+N` counting **visible** tags only.

---

## 4. Events and games — the part TikTok doesn't have

They live in three places, and the feed is the important one.

**As a feed cell.** Same full-bleed frame, different body. This is how they "exist in one feed".

```
┌─────────────────────────────────────────┐        ┌─────────────────────────────────────────┐
│         [ event cover image ]           │        │        [ game key art / loop ]          │
│                                         │        │                                         │
│  SAT 16 AUG · 6:00 PM                   │        │  🎮  TWO TRUTHS                         │
│  Sapphic Sunday Market                  │        │  Play with 3 others · 5 min             │
│  Poblacion, Makati                      │        │                                         │
│  ┌─────────────────────────────────┐    │        │  ┌─────────────────────────────────┐    │
│  │        I'm going  ·  24 going   │    │        │  │           ▶  Play                │    │
│  └─────────────────────────────────┘    │        │  └─────────────────────────────────┘    │
│  @thesapphicclub                        │        │  #TheSapphicClub                        │
│  #TheSapphicClub                        │        │                                         │
└─────────────────────────────────────────┘        └─────────────────────────────────────────┘
```

RSVP and Play happen **in the cell**. No navigation, no modal — one tap, optimistic, with rollback.
That is the whole reason to put them in the feed.

**In Discover**, browsable: `Communities · Events · Games · Shop`.
**On the community page**, as it is today.

---

## 5. Gamification, kept

TikTok has none of this; it is Roxy's. It surfaces without a tab of its own:

- **Profile header** — level, points, streak: `🌸 Bloom · 340 pts · 12-day streak`
- **Profile → Badges tab** — the full grid
- **Feed** — the daily `roxy_greeting` cell carries the streak and the day's nudge
- **Earn moments** — a toast over the feed, never a blocking modal

> **Blocked:** badges cannot ship as a social signal until an awarder exists. Nothing in this product
> has ever written `user_badge_progress` except a dev seed, and members can currently mint their own
> rows. Migration 086 (earned badges public) must not reach production before the award RPC and
> `REVOKE INSERT, UPDATE`. Tracked separately.

---

## 6. The profile — TikTok's formula

```
┌─────────────────────────────────────────┐
│  ←            @mara                 ⚙   │
│                                         │
│                  ◍                      │  ← avatar
│               @mara                     │
│   ┌────────┬────────┬────────┐          │
│   │  128   │  1.4k  │  8.9k  │          │
│   │following│followers│ likes │          │
│   └────────┴────────┴────────┘          │
│   🌸 Bloom · 340 pts · 12-day streak    │  ← Roxy's addition
│   she/her · lesbian                     │
│   sunday markets, bad films, good dogs  │
│   #TheSapphicClub  #ManilaWLW           │
│   ┌─────────────────────────────────┐   │
│   │        Message      Follow      │   │
│   └─────────────────────────────────┘   │
├──────────┬──────────┬───────────────────┤
│  ▦ Posts │  ♡ Liked │  ⬡ Badges         │
├──────────┴──────────┴───────────────────┤
│ ┌──────┐┌──────┐┌──────┐                │
│ │      ││      ││      │                │
│ │  ▶   ││      ││  ▶   │                │  ← 3-col grid, ▶ + view count
│ │ 1.2k ││ 840  ││ 4.1k │                │     on video items
│ └──────┘└──────┘└──────┘                │
│ ┌──────┐┌──────┐┌──────┐                │
│ │      ││      ││      │                │
│ └──────┘└──────┘└──────┘                │
└─────────────────────────────────────────┘
```

**Tapping a grid item opens the same `FeedPager`, scoped to her posts, positioned at that index.** Not
a detail screen. This is the one piece of TikTok's model the research could confirm from TikTok's own
documentation — their advertiser docs sell "Profile Feed placement", describing ads appearing *"within
a profile page… after scrolling through several organic videos"*, which only works if the profile is a
scrollable feed.
`// src: https://ads.tiktok.com/help/article/about-profile-feed-placement · read 2026-08-05`

That reuse is the main architectural payoff: **one pager component, three data sources** — For You,
Following, and one profile's posts.

---

## 7. Bugs this redesign must fix first

The research found live defects in the feed code that shipped in the version1 APK. They are cheap now
and expensive after the redesign is built on top of them.

**1. Video decoders are never released. (High)**
`FeedVideoPlayer.tsx:125-126` does `source={near ? { uri } : undefined}` with the comment *"Omitting
source unloads the clip."* **It does not.** `Video.tsx` has no `componentDidUpdate`; the only JS unload
is `componentWillUnmount`. On Android the `source` prop is a non-nullable `ReadableMap`, and
`VideoView#setSource` early-returns on a null uri *without* calling `mPlayerData.release()`. So the
number of live ExoPlayer instances equals the number of **mounted** cells — driven by
`drawDistance={pageH * 2}` — not the 5 that `DECODER_WINDOW = 2` implies. The cited source doesn't even
support the claim: `Video.types.ts` says a null source makes the component *display* nothing.
**Fix:** unmount `<Video>` outside the window and render the poster instead, or hold a ref and call
`unloadAsync()`.
`// src: expo/expo@sdk-51 {src/Video.tsx, android/.../VideoViewModule.kt, android/.../VideoView.java} · 14.0.7 · 2026-08-05`

**2. One recycling pool. (High for this redesign)**
`ReelsFeed.tsx:340` — `getItemType={() => 'reel'}`. Correct while every cell is a video; actively
harmful the moment a mixed feed exists, because FlashList will recycle a game cell's view into a video
cell and rebuild the whole render tree every swipe. Must key on `post_type`.

**3. Video lifecycle keyed on a bare index. (High for this redesign)**
`ReelCell.tsx:40` uses `activeIndex` alone, which carries no type information — it will cheerfully tell
a game cell to start playing. Derive the active *item*, then have the video subsystem subscribe to
"active id AND type is video".

**4. `expo-image` without `recyclingKey`. (Medium)** `FeedVideoPlayer.tsx:142-150`.

**5. Decoder-count comment is folklore. (Medium)** `FeedVideoPlayer.tsx:16-20` claims "commonly 4–8".
The real limit is device-specific and unexposed. Replace with the citable statement.

**6. Dead doc URL. (Low)** `useReducedMotion.ts:15` cites a 404.

---

## 8. Three decisions needed before slice plans are written

**D1 — Private-community tags.** §3 proposes hiding them from non-members entirely, with no "+N"
tell. Confirm, or say if you want all tags public.

**D2 — Captions are a hard blocker, and it changes the schema.**
`expo-av@14.0.7` has **no prop for subtitles, captions or text tracks** — I enumerated every prop in
`VideoProps` and `VideoNativeProps`. WCAG 2.2 SC 1.2.2 (captions for prerecorded audio) is **Level A**,
the lowest bar. Two compliant paths:
- (a) burn captions in at upload/transcode, or
- (b) store a timed transcript and render a custom overlay from `onPlaybackStatusUpdate`.

**Recommend (b).** It keeps the source video clean, and the timed transcript is exactly the
behavioural/emotional data the Thinqer AI arc needs. But it changes the upload pipeline and the `posts`
schema, so it is decided here, not mid-build.
`// src: expo/expo@sdk-51 packages/expo-av/src/Video.types.ts · 14.0.7 · 2026-08-05` · `https://www.w3.org/TR/WCAG22/`

**D3 — Google Play UGC policy becomes a ship-gate item.**
A TikTok-formula redesign moves Roxy squarely into "primary purpose is UGC", which requires: ToS/user-
policy acceptance **before** a user can upload, in-app reporting **and** blocking of both content and
users, ongoing moderation, and safeguards so monetisation doesn't encourage objectionable behaviour.
*"Apps whose primary purpose is featuring objectionable UGC will be removed from Google Play."*
Migration 008 gives `reports` and `blocks`, and 085 added `block_user` — the gap is the **upload-time
ToS gate** and demonstrable ongoing moderation.
`// src: https://support.google.com/googleplay/android-developer/answer/9876937 · read 2026-08-05`

---

## 9. What could not be verified — and why it matters

You said "exact same formula". The research made five distinct attempts at TikTok's current interface
and **failed to obtain authoritative, dated sources**: `support.tiktok.com` and `tiktok.com/support`
return JS shells with no content, the newsroom index carries nothing relevant, and open-web teardowns
are undated SEO filler.

Worse, there is positive evidence the answer moved: multiple 2026 sources report TikTok **changed the
profile layout in April 2026**, including a new "Grid" feature. Anything written from memory predates
that.

**Unverified, and deliberately not guessed:**
- the exact five bottom-nav destinations and their order (slot 2 varies by region and experiment
  between Discover, Friends and Shop)
- the profile tab set and order — *known* to have changed April 2026
- whether the profile pager opens positioned at the tapped item (strongly implied by the ads doc, never
  stated)
- how hashtags render on a cell and where a tap routes
- the right-rail action order

**The cheapest fix is you, with your phone, for ten minutes.** Screenshot current TikTok — a For You
cell, a profile, and a hashtag tap — date them, drop them in `docs/tiktok-reference/`. That is strictly
more reliable than anything on the open web, and the sketches above get corrected against it before any
of them is built. The right rail in §2 and the tab set in §6 are my best reconstruction, not verified
fact.

---

## 10. Slice sequence

Each slice ships working software and passes the gate on its own.

| # | Slice | Ships |
|---|---|---|
| **0** | Feed defects (§7) | The version1 feed stops leaking decoders. No visible change. |
| **1** | `FeedPager` extraction | One pager component, three sources; existing reels behaviour preserved |
| **2** | Mixed cells | photo · text · poll · resource render full-bleed in the pager |
| **3** | Community tags | `post_communities` + RLS + compose picker + chips (D1) |
| **4** | Profile grid | TikTok profile; grid tap → pager at index |
| **5** | Events & games as cells | in-cell RSVP and Play |
| **6** | Navigation | five-slot bar; Roxy pinned in Inbox; Grow/Build folded away |
| **7** | Gamification restore | award RPC + `REVOKE` + 086 pushed together |
| **8** | Compliance | upload-time ToS gate, moderation surface (D3), captions (D2) |

Slice 0 can start immediately — it is pure defect repair against verified sources and depends on none
of the open decisions.
