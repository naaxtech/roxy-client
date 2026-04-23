# Content Feed — Design Spec
**Date:** 2026-04-24
**Apps:** apps/mobile
**Status:** Approved

---

## Goal

Fully implement the Roxy content feed: a continuous-scroll mixed-media feed where static posts (text, photo, gallery) render as Rednote-style cards, video posts show a tappable thumbnail that launches a full-screen TikTok-style player, and a unique Roxy Link post type lets users share in-app games, rooms, and events inline. Comments get a full overhaul: one level of replies, per-comment likes, and media attachments (photo, GIF).

---

## Architecture

```
DISCOVER TAB
  └── Feed subtab (default)
        └── FeedScreen — FlashList, continuous scroll
              ├── StaticPostCard  (text / photo / gallery)
              │     └── tap → PostDetailScreen (Rednote-style scroll page)
              │           └── inline comments + sticky action bar
              ├── VideoPostCard   (thumbnail + ▶ + duration)
              │     └── tap → VideoPlayerScreen (TikTok full-screen pager)
              │           └── CommentSheet (slides over video)
              └── RoxyLinkCard   (game / room / event)
                    └── tap → deep link to entity OR PrivacyGateSheet
```

The feed lives in the Discover tab as a new `feed` subtab (added alongside existing `events` and `games` subtabs). The current discover/index.tsx gets a `feed` subtab added at the front.

---

## Post Types

### Existing (keep, extend)
- `standard` → renamed behaviour: text-only card
- `event` → keep for community event posts (not the same as Roxy Link)

### New
- `photo` — single photo, natural aspect ratio
- `gallery` — 2–10 photos, horizontal swipe within card
- `video` — thumbnail in feed, full-screen player on tap
- `roxy_link` — in-app link to game, room, or community event

---

## DB Schema — Migration 045

### Extend `posts` table

```sql
ALTER TABLE public.posts
  -- new post_type values
  DROP CONSTRAINT posts_post_type_check,
  ADD CONSTRAINT posts_post_type_check CHECK (
    post_type IN ('standard','event','poll','resource','photo','gallery','video','roxy_link')
  ),
  -- video fields
  ADD COLUMN video_url            text,
  ADD COLUMN video_thumbnail_url  text,
  ADD COLUMN video_duration_secs  integer,
  ADD COLUMN video_aspect_ratio   text CHECK (video_aspect_ratio IN ('4:5','16:9','1:1')),
  -- photo/gallery (reuses existing media_urls[] — no change needed)
  -- roxy link fields
  ADD COLUMN link_type            text CHECK (link_type IN ('game','room','event')),
  ADD COLUMN link_entity_id       uuid,
  ADD COLUMN link_community_id    uuid REFERENCES public.communities(id) ON DELETE SET NULL,
  -- engagement
  ADD COLUMN like_count           integer NOT NULL DEFAULT 0,
  ADD COLUMN save_count           integer NOT NULL DEFAULT 0;
```

### Extend `comments` table

```sql
ALTER TABLE public.comments
  ADD COLUMN parent_id     uuid REFERENCES public.comments(id) ON DELETE CASCADE,
  ADD COLUMN like_count    integer NOT NULL DEFAULT 0,
  ADD COLUMN media_url     text,
  ADD COLUMN gif_url       text,
  -- content can now be null if media_url or gif_url is present
  DROP CONSTRAINT comments_content_check,
  ADD CONSTRAINT comments_content_check CHECK (
    char_length(content) <= 1000 AND
    (content IS NOT NULL OR media_url IS NOT NULL OR gif_url IS NOT NULL)
  );

CREATE INDEX idx_comments_parent ON public.comments(parent_id);
```

### New: `post_likes` table

```sql
CREATE TABLE public.post_likes (
  post_id    uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "post_likes_select" ON public.post_likes FOR SELECT TO authenticated USING (true);
CREATE POLICY "post_likes_insert" ON public.post_likes FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "post_likes_delete" ON public.post_likes FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Trigger: sync posts.like_count
CREATE OR REPLACE FUNCTION public.update_post_like_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.posts SET like_count = like_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.posts SET like_count = GREATEST(0, like_count - 1) WHERE id = OLD.post_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_post_like_count
  AFTER INSERT OR DELETE ON public.post_likes
  FOR EACH ROW EXECUTE FUNCTION public.update_post_like_count();
```

### New: `post_saves` table

```sql
CREATE TABLE public.post_saves (
  post_id    uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

ALTER TABLE public.post_saves ENABLE ROW LEVEL SECURITY;
CREATE POLICY "post_saves_select" ON public.post_saves FOR SELECT TO authenticated USING (true);
CREATE POLICY "post_saves_insert" ON public.post_saves FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "post_saves_delete" ON public.post_saves FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Trigger: sync posts.save_count
CREATE OR REPLACE FUNCTION public.update_post_save_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.posts SET save_count = save_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.posts SET save_count = GREATEST(0, save_count - 1) WHERE id = OLD.post_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_post_save_count
  AFTER INSERT OR DELETE ON public.post_saves
  FOR EACH ROW EXECUTE FUNCTION public.update_post_save_count();
```

### New: `comment_likes` table

```sql
CREATE TABLE public.comment_likes (
  comment_id uuid NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);

ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "comment_likes_select" ON public.comment_likes FOR SELECT TO authenticated USING (true);
CREATE POLICY "comment_likes_insert" ON public.comment_likes FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "comment_likes_delete" ON public.comment_likes FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Trigger: sync comments.like_count
CREATE OR REPLACE FUNCTION public.update_comment_like_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.comments SET like_count = like_count + 1 WHERE id = NEW.comment_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.comments SET like_count = GREATEST(0, like_count - 1) WHERE id = OLD.comment_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_comment_like_count
  AFTER INSERT OR DELETE ON public.comment_likes
  FOR EACH ROW EXECUTE FUNCTION public.update_comment_like_count();
```

### Storage: `post-media` bucket

```sql
INSERT INTO storage.buckets (id, name, public) VALUES ('post-media', 'post-media', true);

-- Read: public
CREATE POLICY "post_media_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'post-media');

-- Upload: authenticated, path must start with their user_id
CREATE POLICY "post_media_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'post-media' AND
    auth.uid()::text = (storage.foldername(objects.name))[1]
  );

-- Delete: own files only
CREATE POLICY "post_media_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'post-media' AND
    auth.uid()::text = (storage.foldername(objects.name))[1]
  );
```

Path convention: `{user_id}/{post_id}/{filename}` for photos, `{user_id}/{post_id}/video.mp4` + `{user_id}/{post_id}/thumb.jpg` for video.

---

## TypeScript Types

### `types/index.ts` — extend Post and Comment

```ts
export type PostType = 'standard' | 'event' | 'poll' | 'resource' | 'photo' | 'gallery' | 'video' | 'roxy_link';
export type LinkType = 'game' | 'room' | 'event';
export type VideoAspectRatio = '4:5' | '16:9' | '1:1';

export interface Post {
  id: string;
  author_id: string;
  community_id: string;
  content: string;
  media_urls: string[];           // photos for photo/gallery posts
  post_type: PostType;
  is_pinned: boolean;
  is_flagged: boolean;
  reaction_counts: Record<string, number>;
  comment_count: number;
  like_count: number;
  save_count: number;
  // video
  video_url: string | null;
  video_thumbnail_url: string | null;
  video_duration_secs: number | null;
  video_aspect_ratio: VideoAspectRatio | null;
  // roxy link
  link_type: LinkType | null;
  link_entity_id: string | null;
  link_community_id: string | null;
  created_at: string;
  updated_at: string;
  // joined
  profiles?: { display_name: string; avatar_url: string | null };
}

export interface Comment {
  id: string;
  post_id: string;
  author_id: string;
  parent_id: string | null;
  content: string | null;
  media_url: string | null;
  gif_url: string | null;
  like_count: number;
  created_at: string;
  // joined
  profiles?: { display_name: string; avatar_url: string | null };
  replies?: Comment[];         // populated client-side after fetch
}
```

---

## Store — `feedStore.ts` (full rewrite)

```ts
interface FeedState {
  // feed
  posts: Post[];
  loading: boolean;
  loadingMore: boolean;
  cursor: string | null;          // created_at of last post for pagination
  hasMore: boolean;

  // user interaction state (keyed by post_id)
  likedPostIds: Set<string>;
  savedPostIds: Set<string>;

  // video queue (post IDs of video posts in current feed order)
  videoQueue: string[];

  // actions
  fetchFeed: (communityId?: string) => Promise<void>;
  fetchMoreFeed: (communityId?: string) => Promise<void>;
  toggleLike: (postId: string) => Promise<void>;
  toggleSave: (postId: string) => Promise<void>;
  upsertPost: (post: Post) => void;
  incrementReaction: (postId: string, emoji: string) => void;
}
```

Pagination uses `created_at < cursor` keyset pattern. Page size: 15 posts. `videoQueue` is derived from `posts` filtered to `post_type === 'video'` in feed order — used by `VideoPlayerScreen` to know what to show when swiping.

---

## File Map

### Create
```
supabase/migrations/045_feed_v2.sql

apps/mobile/types/feed.ts                          ← PostType, LinkType, VideoAspectRatio (re-exported from index.ts)

apps/mobile/components/feed/FeedCard.tsx           ← dispatcher: renders correct card by post_type
apps/mobile/components/feed/StaticPostCard.tsx     ← text / photo / gallery card
apps/mobile/components/feed/VideoPostCard.tsx      ← thumbnail + ▶ + duration badge
apps/mobile/components/feed/RoxyLinkCard.tsx       ← game / room / event inline card
apps/mobile/components/feed/PostActionRow.tsx      ← ♡ like · ✦ save · 💬 count · ↗ share
apps/mobile/components/feed/CommentThread.tsx      ← single comment + its replies + reply input
apps/mobile/components/feed/CommentSheet.tsx       ← bottom sheet for video post comments
apps/mobile/components/feed/PrivacyGateSheet.tsx   ← "join community to access" bottom sheet
apps/mobile/components/feed/RoxyLinkPicker.tsx     ← picker sheet for create post: game/room/event

apps/mobile/app/(tabs)/discover/post/[postId].tsx  ← Rednote-style static post detail screen
apps/mobile/app/(tabs)/discover/video/[postId].tsx ← TikTok full-screen video pager
```

### Modify
```
supabase/migrations/ (new file 045)
apps/mobile/types/index.ts                         ← extend Post, Comment interfaces
apps/mobile/store/feedStore.ts                     ← full rewrite (see Store section)
apps/mobile/app/(tabs)/discover/index.tsx          ← add 'feed' subtab, render FeedScreen
apps/mobile/app/(tabs)/discover/community/create-post.tsx  ← add type picker + branching composers
apps/mobile/app/(tabs)/discover/community/post/[postId].tsx ← redirect to new post detail
```

---

## Component Designs

### FeedCard.tsx
Dispatcher only. Reads `post.post_type` and renders the matching card. No business logic.

```
post_type === 'photo' | 'gallery' | 'standard'  →  <StaticPostCard />
post_type === 'video'                            →  <VideoPostCard />
post_type === 'roxy_link'                        →  <RoxyLinkCard />
```

### StaticPostCard.tsx

```
┌──────────────────────────────────┐
│ ● @username  ·  2h               │  author row
│ ┌────────────────────────────┐   │
│ │                            │   │  photo: full width, natural aspect ratio
│ │     [photo or gallery]     │   │  gallery: horizontal ScrollView pagingEnabled
│ │                            │   │           within this zone only
│ │              ● ● ○ ○       │   │  dots only for gallery (2+ photos)
│ └────────────────────────────┘   │  text post: no image zone, gradient bg card
│ Caption text, up to 3 lines      │  "Show more" if > 3 lines
│ ♡ 142  ✦ 88  💬 38  ↗           │  PostActionRow
└──────────────────────────────────┘
```

Props: `post: Post`, `onPress: () => void`, `onLike`, `onSave`, `onComment`, `isLiked`, `isSaved`

### VideoPostCard.tsx

```
┌──────────────────────────────────┐
│ ● @username  ·  5h               │  author row
│ ┌────────────────────────────┐   │
│ │                            │   │
│ │                            │   │
│ │    [thumbnail image]       │   │  aspect ratio from post.video_aspect_ratio
│ │                            │   │  default 4:5 if null
│ │         ▶                  │   │  play icon centered, 48×48
│ │                            │   │
│ │                      0:42  │   │  duration badge bottom-right
│ └────────────────────────────┘   │
│ Caption text (1 line)            │
│ ♡ 890  ✦ 12  💬 14  ↗           │  PostActionRow
└──────────────────────────────────┘
```

Props: `post: Post`, `onPress: () => void`, `onLike`, `onSave`, `onComment`, `isLiked`, `isSaved`

Tapping the card (not the action row) calls `onPress` → navigates to `video/[postId]`.
Tapping 💬 in action row → navigates to `video/[postId]?openComments=true`.

### RoxyLinkCard.tsx

Three sub-renders based on `post.link_type`:

```
GAME:
┌──────────────────────────────────┐
│ ● @username  ·  1h               │
│ ┌────────────────────────────┐   │
│ │ 🎮  Trivia Night           │   │
│ │     WLW General  ·  Live   │   │
│ │     👥 4 playing now       │   │
│ │     [ Join Game ]          │   │
│ └────────────────────────────┘   │
│ "come join us!!"                 │
│ ♡ 22  ✦ 3  💬 7  ↗              │
└──────────────────────────────────┘

ROOM:
│ 🎙  Chill & Chat              │
│     Live  ·  👥 12 in room    │
│     [ Join Room ]             │

EVENT:
│ 📅  WLW Mixer                 │
│     Sat 26 Apr  ·  7:00 PM   │
│     📍 Online                 │
│     [ RSVP / View ]           │
```

Tapping the CTA button:
- If `link_community_id` is null or user is already a member → deep-link to entity
- If community is private and user is not a member → open `PrivacyGateSheet`

### PostActionRow.tsx

```
♡ 142   ✦ 88   💬 38   ↗
```

- ♡: filled/purple when liked. Tapping toggles optimistically then calls `toggleLike`.
- ✦: filled when saved. Tapping toggles optimistically then calls `toggleSave`.
- 💬: shows `comment_count`. Tapping navigates to post detail (static) or opens comment sheet (video).
- ↗: share sheet (React Native `Share.share`).

### PostDetailScreen — `post/[postId].tsx`

Full Rednote-style scrollable page. Structure:

```
ScrollView (flex: 1)
  ├── Author row: avatar · display_name · follow button · ···
  ├── Media zone:
  │     photo  → Image, full width, natural aspect ratio
  │     gallery → horizontal ScrollView pagingEnabled + dots
  │     text   → styled quote card (no media zone)
  ├── Caption: full text, no truncation
  ├── Hashtags row
  ├── Divider
  └── Comments section (CommentThread list, inline)

StickyActionBar (position absolute bottom, blurs content behind):
  ♡ like_count   ✦ save_count   [  Add a comment...  ]  ↗
  📷  GIF  😊   ← shown when input focused
```

Tapping "Add a comment" focuses the input in the sticky bar. Tapping "Reply" under a comment sets `replyingTo` state and shows "Replying to @username" chip in the input. Submitting creates a comment with `parent_id` set.

### VideoPlayerScreen — `video/[postId].tsx`

Full-screen TikTok-style pager.

```
FlatList (pagingEnabled, vertical, showsVerticalScrollIndicator: false)
  └── each item: full screen (height: SCREEN_HEIGHT)
        ├── Video player (expo-av or expo-video)
        │     autoplay when snapped into view
        │     muted: false (sound on by default, user can mute)
        │     loop: true
        ├── Gradient overlay (bottom 40% of screen)
        ├── Bottom-left: author · caption · hashtags
        └── Right rail: ♡ count · ✦ · 💬 count · ↗ · ···

Top-left: ← back (returns to feed, scroll position preserved)
Top-right: 🔇/🔊 mute toggle
```

Video queue = all video posts from `feedStore.videoQueue`. The pager initialises at `initialScrollIndex` = index of the tapped `postId` in the queue.

Tapping 💬 on the right rail → opens `CommentSheet` (slides up, video continues playing).

### CommentSheet.tsx (for video)

Bottom sheet, 85% screen height, DragHandle at top.

```
Header: "Comments (38)"  ×
─────────────────────────
CommentThread list (ScrollView)
  each top-level comment:
    ● avatar  @username  · time           ♡ 14
    comment text or [photo] or [GIF]
    Reply
    ↳ replies (indented 28px, max 1 level)
       [View N more replies] if > 2 replies

─────────────────────────
[  Add a comment...  ]   Post
📷  GIF  😊
```

### CommentThread.tsx

Reusable — used in both `PostDetailScreen` (inline) and `CommentSheet` (sheet). Same props, same behaviour.

Props:
```ts
{
  postId: string;
  comments: Comment[];           // top-level only; replies nested as comment.replies
  currentUserId: string;
  onLikeComment: (commentId: string) => void;
  onReply: (comment: Comment) => void;
  likedCommentIds: Set<string>;
}
```

Replies collapsed by default to first 2. "View N more replies" tap expands inline. No second-level nesting — the reply input always creates a direct child of the top-level comment.

### PrivacyGateSheet.tsx

```
┌──────────────────────────────┐
│  ▬▬▬                         │
│  🔒  This is inside           │
│      "Sapphic Book Club"     │
│      a private community.    │
│                              │
│  Join to access:             │
│  [ Request to Join ]  primary│
│  [ Cancel           ]  ghost │
└──────────────────────────────┘
```

Props: `communityId`, `communityName`, `visible`, `onClose`

### Create Post — type picker + branching composers

```
STEP 1: Type picker screen
┌──────────────────────────────┐
│ ← New Post                   │
│──────────────────────────────│
│  ┌──────┐ ┌──────┐ ┌──────┐ │
│  │  📝  │ │  📷  │ │  🎬  │ │
│  │ Text │ │Photo/│ │Video │ │
│  │      │ │Gallery│ │      │ │
│  └──────┘ └──────┘ └──────┘ │
│  ┌────────────────────────┐  │
│  │  🔗  Roxy Link         │  │
│  │  Share a game, room,   │  │
│  │  or community event    │  │
│  └────────────────────────┘  │
└──────────────────────────────┘

STEP 2A: Text composer (existing, keep)
STEP 2B: Photo/Gallery composer
  - up to 10 photos, picker + reorder
  - first photo = cover
  - caption field
STEP 2C: Video composer
  - pick video from library (max 3 min for MVP)
  - thumbnail auto-generated or user picks frame
  - caption field
STEP 2D: Roxy Link composer
  - RoxyLinkPicker sheet (see below)
  - caption field
```

### RoxyLinkPicker.tsx

Bottom sheet. Shows only entities the user has access to:

```
┌────────────────────────┐
│ ← Link to...           │
│────────────────────────│
│ 🎮 Games               │
│    Trivia Night    ▸   │
│    Word Scramble   ▸   │
│────────────────────────│
│ 🎙 Rooms               │
│    Chill & Chat    ▸   │
│────────────────────────│
│ 📅 Community Events    │
│    WLW Mixer       ▸   │
│    Book Club       ▸   │
└────────────────────────┘
```

Tapping an entity sets `link_type`, `link_entity_id`, `link_community_id` on the post draft and closes the picker.

---

## Feed Query

```sql
SELECT
  p.*,
  pr.display_name, pr.avatar_url,
  pl.user_id IS NOT NULL AS is_liked,
  ps.user_id IS NOT NULL AS is_saved
FROM posts p
JOIN profiles pr ON pr.id = p.author_id
LEFT JOIN post_likes pl ON pl.post_id = p.id AND pl.user_id = auth.uid()
LEFT JOIN post_saves ps ON ps.post_id = p.id AND ps.user_id = auth.uid()
WHERE p.created_at < :cursor
ORDER BY p.created_at DESC
LIMIT 15
```

This gives the current user's like/save state in one query — no second round-trip.

---

## Video Playback

Use `expo-av` (`Video` component from `expo-av`) — already in the Expo SDK, no new native package needed. Guard it:

```ts
// lib/video.ts
let ExpoVideo: any = null;
try {
  ExpoVideo = require('expo-av').Video;
} catch {}
export const isVideoAvailable = () => ExpoVideo !== null;
```

`VideoPlayerScreen` renders `ExpoVideo` full-screen. Pause on scroll away (detected via `FlatList.onViewableItemsChanged`), play when snapped into view.

---

## Navigation

```
// Static post tap
router.push(`/(tabs)/discover/post/${postId}`);

// Video tap
router.push(`/(tabs)/discover/video/${postId}`);

// Video tap with comments open
router.push(`/(tabs)/discover/video/${postId}?openComments=true`);
```

Feed scroll position is preserved because the video player is a new route pushed on the stack — the feed screen is not unmounted.

---

## GIF Support

Use [Tenor API](https://developers.google.com/tenor) (free tier) for GIF search in comment composer. Fetch in a `GifPickerSheet` component. Selected GIF URL stored in `comments.gif_url`. GIFs render as `<Image>` with `resizeMode="cover"` — no autoplay needed for comments.

---

## Emotional AI Data Value

Every interaction here generates training-relevant signals:
- Like/save patterns → content preference model
- Comment text sentiment → emotional state signal
- Roxy Link shares → social graph + game/room/event affinity
- Video watch completion (tracked via `onPlaybackStatusUpdate`) → engagement depth signal
- Reply chains → relationship formation signal
- Time between post and first like/comment → content resonance latency

Log all of the above (anonymised, no content) via `ObservabilityService`.

---

## Error Handling

- Feed load error → "Could not load feed. Tap to retry" full-width banner
- Video load failure → thumbnail stays visible with ⚠️ icon, no crash
- Comment submit failure → optimistic update rolled back, toast error
- Like/save failure → optimistic update rolled back silently (no toast for these)
- GIF picker network error → "GIF search unavailable" inline message
- RoxyLinkCard entity not found (deleted game/room) → card shows "This content is no longer available"

---

## Testing Requirements

### Unit tests — `__tests__/`

```
feedStore.test.ts
  - fetchFeed populates posts and videoQueue
  - fetchMoreFeed appends to posts, advances cursor
  - toggleLike optimistically updates likedPostIds and like_count
  - toggleLike rolls back on error
  - toggleSave optimistically updates savedPostIds and save_count

PostActionRow.test.tsx
  - renders like count correctly
  - filled heart when isLiked=true
  - calls onLike when ♡ pressed
  - calls onSave when ✦ pressed

StaticPostCard.test.tsx
  - renders text post without image zone
  - renders photo post with Image
  - renders gallery dots for 2+ photos, no dots for 1 photo
  - calls onPress when card tapped

VideoPostCard.test.tsx
  - renders thumbnail image
  - renders ▶ play icon
  - renders duration badge
  - calls onPress when tapped

RoxyLinkCard.test.tsx
  - renders game type with 🎮 icon
  - renders room type with 🎙 icon
  - renders event type with 📅 and formatted date
  - calls onJoin when CTA pressed

CommentThread.test.tsx
  - renders top-level comments
  - collapses replies beyond 2, shows "View N more"
  - expands replies on tap
  - calls onLikeComment when ♡ pressed
  - calls onReply when Reply pressed
```

### Integration test checklist (manual)
- [ ] Feed loads on Discover tab, shows mixed card types
- [ ] Tapping video card opens full-screen player at correct video
- [ ] Swiping in player moves to next/prev video in queue
- [ ] Back from player returns to feed at exact scroll position
- [ ] Tapping static card opens Rednote-style detail page
- [ ] Inline comments load on detail page
- [ ] Reply creates comment with correct parent_id
- [ ] Like on comment increments like_count, filled heart shown
- [ ] Unlike on comment decrements like_count
- [ ] Like on post persists after navigate away and back
- [ ] Save on post persists after navigate away and back
- [ ] RoxyLinkCard CTA → deep link to entity if public
- [ ] RoxyLinkCard CTA → PrivacyGateSheet if private community
- [ ] Create post → type picker → photo composer → submit → appears in feed
- [ ] Create post → video → thumbnail shown correctly in feed card

---

## Migration Order

```
Next migration number: 045
File: supabase/migrations/045_feed_v2.sql
```

Apply with: `npx supabase db push`

---

## Out of Scope (future)

- Video trimming / in-app editing
- Story-style ephemeral posts (24h)
- Post scheduling
- Poll post type (exists in DB, not wired to UI)
- GIF reactions on posts (only on comments for now)
- Full-text search across feed posts
