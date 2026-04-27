# Content Feed — Design Spec
**Date:** 2026-04-24
**Apps:** apps/mobile
**Status:** Approved

---

## Goal

Fully implement the Roxy content feed: a continuous-scroll mixed-media feed where static posts (text, photo, gallery) render as Rednote-style cards, video posts show a tappable thumbnail that launches a full-screen TikTok-style player, and a unique Roxy Link post type lets users share in-app games, rooms, and events inline. Comments get a full overhaul: one level of replies, per-comment likes, and media attachments (photo, GIF). The architecture is designed to evolve from a simple engagement-weighted feed at launch to a vector-similarity interest engine at scale — without any component code changing.

---

## Architecture

```
DISCOVER TAB
  └── Feed subtab (default, added alongside Events + Games)
        └── FeedScreen — FlashList, continuous scroll
              ├── StaticPostCard  (text / photo / gallery)
              │     └── tap → PostDetailScreen (Rednote-style scroll page)
              │           └── inline comments + sticky action bar
              ├── VideoPostCard   (thumbnail + ▶ + duration badge)
              │     └── tap → VideoPlayerScreen (TikTok full-screen pager)
              │           └── CommentSheet (slides over video, video keeps playing)
              └── RoxyLinkCard   (game / room / community event)
                    └── tap → deep link to entity  OR  PrivacyGateSheet
```

### The feed is a function, not a query

Components never interact with the algorithm. They call one thing:

```ts
feedStore.fetchFeed(userId) → Post[]
```

The algorithm behind this call is swapped as Roxy scales. Phase 1 is a SQL
score formula. Phase 2 adds vector similarity. Phase 3 adds a neural ranking
layer. No component changes — only the store's implementation changes.

---

## Post Types

### Existing (kept, schema extended)
- `standard` → text-only card
- `event` → community event post (separate from Roxy Link)

### New
- `photo` — single image, natural aspect ratio
- `gallery` — 2–10 images, horizontal swipe within card
- `video` — thumbnail card in feed, full-screen HLS player on tap
- `roxy_link` — in-app link to game, room, or community event

---

## Feed UX

### Feed (continuous scroll, all types)

Every post is a card in a vertical scroll list. No forced full-screen paging.
Card height follows content naturally — no forced frame, no viewport mismatch.

```
┌────────────────────────────────┐
│ ● @username  ·  2h             │  author row
│ ┌──────────────────────────┐   │
│ │                          │   │  PHOTO: full width, natural ratio
│ │     [image]              │   │  GALLERY: horizontal swipe within
│ │              ● ● ○ ○     │   │           this zone, dot indicators
│ └──────────────────────────┘   │
│ Caption text, up to 3 lines    │  "Show more" if truncated
│ ♡ 142  ✦ 88  💬 38  ↗         │  action row
└────────────────────────────────┘

┌────────────────────────────────┐
│ ● @username  ·  5h             │  author row
│ ┌──────────────────────────┐   │
│ │                          │   │
│ │                          │   │
│ │    [thumbnail image]     │   │  VIDEO: 4:5 portrait (default)
│ │                          │   │         16:9 landscape if recorded that way
│ │         ▶                │   │         1:1 square — respects native ratio
│ │                          │   │         NO forced crop
│ │                    0:42  │   │  duration badge bottom-right
│ └──────────────────────────┘   │
│ Caption (1 line, truncated)    │
│ ♡ 890  ✦ 12  💬 14  ↗         │
└────────────────────────────────┘

┌────────────────────────────────┐
│ ● @username  ·  3h             │  TEXT: no image zone
│                                │        gradient or surface-color bg
│   "post text, large            │        font scales to content length
│    centered typography,        │
│    quote-card style"           │
│                                │
│ ♡ 312  ✦ 41  💬 95  ↗         │
└────────────────────────────────┘

┌────────────────────────────────┐
│ ● @username  ·  1h             │  ROXY LINK
│ ┌──────────────────────────┐   │
│ │ 🎮  Trivia Night         │   │
│ │     WLW General · Live   │   │
│ │     👥 4 playing now     │   │
│ │     [ Join Game ]        │   │
│ └──────────────────────────┘   │
│ "come join us!!"               │
│ ♡ 22  ✦ 3  💬 7  ↗            │
└────────────────────────────────┘
```

### Video — full-screen TikTok player (on tap)

```
┌──────────────────────────────┐
│ ×  back to feed              │  top-left — returns to feed,
│                        🔇/🔊 │  scroll position preserved
│                              │
│  ████ VIDEO PLAYING ████     │  full screen, HLS adaptive,
│  ████                ████    │  autoplay when snapped in,
│  ████                ████    │  pause when swiped away
│                              │
│  ● @username                 │  bottom-left overlay
│  "caption text"              │
│  #tag1 #tag2                 │
│                        ♡ 890 │  right rail
│                        ✦     │
│                        💬 14 │
│                        ↗     │
│  ━━━━━━━━━━─────────────     │  progress bar
└──────────────────────────────┘
     swipe up → next video
     swipe down → prev video
     tap 💬 → CommentSheet slides up
              video keeps playing behind it
```

Video queue = all video posts from `feedStore.videoQueue` in feed order.
Pager initialises at `initialScrollIndex` = index of tapped post in queue.
`FlatList windowSize={3}` — renders 1 above + 1 below current only.
Preload next video (`video.loadAsync()`) while current is playing.

### Static post detail — Rednote-style scroll page

```
┌──────────────────────────────┐
│  ← Post  @username  ···      │  header
│──────────────────────────────│
│  ┌────────────────────────┐  │
│  │  image / gallery       │  │  full width, natural ratio
│  │              ● ● ○ ○   │  │  gallery: swipe within this zone
│  └────────────────────────┘  │
│  Full caption, no truncation │
│  #tag1  #tag2                │
│──────────────────────────────│
│  Comments (38)               │  inline, not a sheet
│                              │
│  ● @you  · 30m               │
│    love this 💜              │  ♡ 3
│    Reply                     │
│    ↳ ● @maya  · 15m          │  one level of indent
│       @you same!!            │  ♡ 5
│    [View 2 more replies]     │  collapsed by default
│                              │
│  ● @jess  · 1h               │
│    [📷 photo attachment]     │
│    ♡ 9  Reply                │
│                              │
└──────────────────────────────┘
┌──────────────────────────────┐  sticky — never scrolls
│ ♡ 142  ✦ 88  [comment...] ↗ │
│ 📷  GIF  😊  (when focused)  │
└──────────────────────────────┘
```

---

## DB Schema — Migration 045

Next migration number: **045**
File: `supabase/migrations/045_feed_v2.sql`

### Extend `posts`

```sql
ALTER TABLE public.posts
  -- new post_type values
  DROP CONSTRAINT posts_post_type_check,
  ADD CONSTRAINT posts_post_type_check CHECK (
    post_type IN ('standard','event','poll','resource','photo','gallery','video','roxy_link')
  ),
  -- video
  ADD COLUMN video_url              text,
  ADD COLUMN video_thumbnail_url    text,
  ADD COLUMN video_duration_secs    integer,
  ADD COLUMN video_aspect_ratio     text CHECK (video_aspect_ratio IN ('4:5','16:9','1:1')),
  -- roxy link
  ADD COLUMN link_type              text CHECK (link_type IN ('game','room','event')),
  ADD COLUMN link_entity_id         uuid,
  ADD COLUMN link_community_id      uuid REFERENCES public.communities(id) ON DELETE SET NULL,
  -- engagement (separate from reaction_counts — like is first-class)
  ADD COLUMN like_count             integer NOT NULL DEFAULT 0,
  ADD COLUMN save_count             integer NOT NULL DEFAULT 0,
  -- feed algorithm
  ADD COLUMN feed_score             float NOT NULL DEFAULT 0,
  ADD COLUMN community_resonance    float NOT NULL DEFAULT 1.0,
  -- image optimisation
  ADD COLUMN blurhash               text,
  -- content lifecycle
  ADD COLUMN deleted_at             timestamptz,
  -- Phase 2 vectors — nullable, populated when embedding pipeline is live
  ADD COLUMN post_tags              text[] DEFAULT '{}',
  ADD COLUMN content_vector         vector(64),    -- retrieval (fast ANN)
  ADD COLUMN content_vector_full    vector(512);   -- ranking (precise similarity)

-- Soft-delete index
CREATE INDEX idx_posts_deleted   ON public.posts(deleted_at) WHERE deleted_at IS NOT NULL;
-- Feed score index (what the feed query orders by)
CREATE INDEX idx_posts_feed_score ON public.posts(community_id, feed_score DESC)
  WHERE deleted_at IS NULL;
-- Phase 2: HNSW index on content_vector — add when vectors are populated
-- CREATE INDEX idx_posts_vector ON public.posts
--   USING hnsw (content_vector vector_cosine_ops) WITH (m=16, ef_construction=64);
```

### Extend `comments`

```sql
ALTER TABLE public.comments
  ADD COLUMN parent_id    uuid REFERENCES public.comments(id) ON DELETE CASCADE,
  ADD COLUMN like_count   integer NOT NULL DEFAULT 0,
  ADD COLUMN media_url    text,
  ADD COLUMN gif_url      text,
  ADD COLUMN deleted_at   timestamptz,
  -- content nullable when media or gif present
  DROP CONSTRAINT comments_content_check,
  ADD CONSTRAINT comments_content_check CHECK (
    (content IS NULL OR char_length(content) <= 1000) AND
    (content IS NOT NULL OR media_url IS NOT NULL OR gif_url IS NOT NULL)
  );

CREATE INDEX idx_comments_parent ON public.comments(parent_id)
  WHERE parent_id IS NOT NULL;
CREATE INDEX idx_comments_post_top ON public.comments(post_id, created_at)
  WHERE parent_id IS NULL AND deleted_at IS NULL;
```

### New: `post_likes`

```sql
CREATE TABLE public.post_likes (
  post_id    uuid NOT NULL REFERENCES public.posts(id)    ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pl_select" ON public.post_likes FOR SELECT TO authenticated USING (true);
CREATE POLICY "pl_insert" ON public.post_likes FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "pl_delete" ON public.post_likes FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.sync_post_like_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.posts SET like_count = like_count + 1 WHERE id = NEW.post_id;
  ELSE
    UPDATE public.posts SET like_count = GREATEST(0, like_count - 1) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER trg_post_like_count
  AFTER INSERT OR DELETE ON public.post_likes
  FOR EACH ROW EXECUTE FUNCTION public.sync_post_like_count();
```

### New: `post_saves`

```sql
CREATE TABLE public.post_saves (
  post_id    uuid NOT NULL REFERENCES public.posts(id)    ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
ALTER TABLE public.post_saves ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ps_select" ON public.post_saves FOR SELECT TO authenticated USING (true);
CREATE POLICY "ps_insert" ON public.post_saves FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "ps_delete" ON public.post_saves FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.sync_post_save_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.posts SET save_count = save_count + 1 WHERE id = NEW.post_id;
  ELSE
    UPDATE public.posts SET save_count = GREATEST(0, save_count - 1) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER trg_post_save_count
  AFTER INSERT OR DELETE ON public.post_saves
  FOR EACH ROW EXECUTE FUNCTION public.sync_post_save_count();
```

### New: `comment_likes`

```sql
CREATE TABLE public.comment_likes (
  comment_id uuid NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);
ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cl_select" ON public.comment_likes FOR SELECT TO authenticated USING (true);
CREATE POLICY "cl_insert" ON public.comment_likes FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "cl_delete" ON public.comment_likes FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.sync_comment_like_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.comments SET like_count = like_count + 1 WHERE id = NEW.comment_id;
  ELSE
    UPDATE public.comments SET like_count = GREATEST(0, like_count - 1) WHERE id = OLD.comment_id;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER trg_comment_like_count
  AFTER INSERT OR DELETE ON public.comment_likes
  FOR EACH ROW EXECUTE FUNCTION public.sync_comment_like_count();
```

### New: `seen_posts`

Prevents reshowing content the user has already scrolled past.
Purged via n8n cron after 30 days.

```sql
CREATE TABLE public.seen_posts (
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  post_id    uuid NOT NULL REFERENCES public.posts(id)    ON DELETE CASCADE,
  seen_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
ALTER TABLE public.seen_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sp_own" ON public.seen_posts FOR ALL TO authenticated USING (user_id = auth.uid());
CREATE INDEX idx_seen_posts_user ON public.seen_posts(user_id, seen_at DESC);
```

### Feed score function

```sql
CREATE OR REPLACE FUNCTION public.compute_feed_score(
  p_likes    integer,
  p_comments integer,
  p_saves    integer,
  p_created  timestamptz
) RETURNS float LANGUAGE sql IMMUTABLE AS $$
  SELECT
    (p_likes * 1.0 + p_comments * 4.0 + p_saves * 3.0)
    * exp(-0.0578 * EXTRACT(EPOCH FROM (now() - p_created)) / 3600.0);
    -- Single decay rate for all post types at launch.
    -- Calibrate per post_type after 60 days of engagement data.
    -- Half-life ≈ 12 hours. Posts > 7 days old score ≈ 0 naturally.
$$;
```

### `profiles` — extend for Phase 2 vectors and consent flag

```sql
ALTER TABLE public.profiles
  ADD COLUMN interest_vector         vector(512),   -- Phase 2, null until populated
  ADD COLUMN behavioural_consent     boolean NOT NULL DEFAULT false;
  -- behavioural_consent: user opts in to dwell-time signal collection
  -- Must be true before any scroll/dwell events are logged
```

### Storage: `post-media` bucket

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('post-media', 'post-media', true);

CREATE POLICY "post_media_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'post-media');

CREATE POLICY "post_media_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'post-media' AND
    auth.uid()::text = (storage.foldername(objects.name))[1]
  );

CREATE POLICY "post_media_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'post-media' AND
    auth.uid()::text = (storage.foldername(objects.name))[1]
  );
```

Storage path convention: `{user_id}/{post_id}/{filename}`

---

## TypeScript Types

### `types/index.ts` — extend Post and Comment

```ts
export type PostType =
  | 'standard' | 'event' | 'poll' | 'resource'
  | 'photo' | 'gallery' | 'video' | 'roxy_link';

export type LinkType = 'game' | 'room' | 'event';
export type VideoAspectRatio = '4:5' | '16:9' | '1:1';

export interface Post {
  id: string;
  author_id: string;
  community_id: string;
  content: string;
  media_urls: string[];
  post_type: PostType;
  is_pinned: boolean;
  is_flagged: boolean;
  reaction_counts: Record<string, number>;
  comment_count: number;
  like_count: number;
  save_count: number;
  feed_score: number;
  blurhash: string | null;
  deleted_at: string | null;
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
  // joined at query time
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
  deleted_at: string | null;
  created_at: string;
  // joined
  profiles?: { display_name: string; avatar_url: string | null };
  replies?: Comment[];   // populated client-side after fetch, never from DB join
}
```

---

## Store — `feedStore.ts`

```ts
interface FeedState {
  posts: Post[];
  loading: boolean;
  loadingMore: boolean;
  cursor: string | null;          // created_at of oldest loaded post
  hasMore: boolean;
  newPostCount: number;           // realtime — "N new posts" banner count

  // user interaction state — bulk-fetched at init, no JOIN per page
  likedPostIds: Set<string>;
  savedPostIds: Set<string>;

  // video queue — post IDs of video posts in current feed order
  // used by VideoPlayerScreen to populate the swipeable pager
  videoQueue: string[];

  // actions
  init: (userId: string) => Promise<void>;       // bulk-fetch liked/saved IDs
  fetchFeed: (communityIds: string[]) => Promise<void>;
  fetchMoreFeed: (communityIds: string[]) => Promise<void>;
  toggleLike: (postId: string) => Promise<void>;
  toggleSave: (postId: string) => Promise<void>;
  markSeen: (postId: string) => void;            // batched, writes to seen_posts
  acceptNewPosts: () => void;                    // user tapped "N new posts" banner
  upsertPost: (post: Post) => void;
}
```

### Liked/saved bulk fetch at init (no JOIN in feed query)

```ts
init: async (userId) => {
  const [likes, saves] = await Promise.all([
    supabase.from('post_likes').select('post_id').eq('user_id', userId),
    supabase.from('post_saves').select('post_id').eq('user_id', userId),
  ]);
  set({
    likedPostIds: new Set(likes.data?.map(r => r.post_id) ?? []),
    savedPostIds: new Set(saves.data?.map(r => r.post_id) ?? []),
  });
}
```

### Feed query (Phase 1)

```ts
// feedStore.fetchFeed
const { data } = await supabase
  .from('posts')
  .select('*, profiles(display_name, avatar_url)')
  .in('community_id', communityIds)
  .is('deleted_at', null)
  .not('id', 'in', `(${Array.from(seenPostIds).join(',')})`)
  .order('feed_score', { ascending: false })
  .limit(15);
```

### Optimistic like/save with rollback

```ts
toggleLike: async (postId) => {
  const wasLiked = get().likedPostIds.has(postId);
  // optimistic update
  set(s => ({
    likedPostIds: wasLiked
      ? new Set([...s.likedPostIds].filter(id => id !== postId))
      : new Set([...s.likedPostIds, postId]),
    posts: s.posts.map(p => p.id === postId
      ? { ...p, like_count: p.like_count + (wasLiked ? -1 : 1) }
      : p),
  }));
  // persist
  const { error } = wasLiked
    ? await supabase.from('post_likes').delete().eq('post_id', postId)
    : await supabase.from('post_likes').insert({ post_id: postId });
  // rollback on error
  if (error) {
    set(s => ({
      likedPostIds: wasLiked
        ? new Set([...s.likedPostIds, postId])
        : new Set([...s.likedPostIds].filter(id => id !== postId)),
      posts: s.posts.map(p => p.id === postId
        ? { ...p, like_count: p.like_count + (wasLiked ? 1 : -1) }
        : p),
    }));
  }
}
```

---

## Image Optimisation — `lib/media.ts`

```ts
const SUPABASE_STORAGE_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1`;

// All image rendering goes through this helper.
// Swap SUPABASE_STORAGE_URL to Cloudflare Images URL here when migrating — zero component changes.
export function getPostImageUrl(
  path: string,
  variant: 'thumb' | 'feed' | 'detail'
): string {
  const params: Record<string, string | number> = {
    thumb:  { width: 120, quality: 60, format: 'avif' },
    feed:   { width: 400, quality: 75, format: 'avif' },
    detail: { width: 800, quality: 85, format: 'avif' },
  }[variant];

  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString();

  return `${SUPABASE_STORAGE_URL}/render/image/public/post-media/${path}?${qs}`;
}
```

AVIF serves ~50% smaller than JPEG, ~20% smaller than WebP at equivalent quality.
`expo-image` renders AVIF natively on iOS 16+ and Android API 31+.
Older devices receive the Supabase fallback (JPEG) automatically.

**Blurhash** — computed on-device at upload time using the `blurhash` npm package
(no new native module — pure JS). Stored as a 20-char string in `posts.blurhash`.
`expo-image` renders it as a placeholder while the real image loads.

---

## Video Pipeline — Cloudflare Stream

Do not use Supabase Storage for raw video. Cloudflare Stream handles
transcoding, HLS adaptive bitrate, and CDN delivery.

**Pricing (2025):** $1 / 1,000 min stored · $5 / 1,000 min delivered · encoding free.
At 1,000 videos × avg 1 min ≈ $1/month stored. Effectively free at early scale.

**Upload flow:**

```
Mobile
  ↓  POST /edge-function/get-video-upload-url
Edge function
  ↓  Cloudflare Stream API → { uploadURL, videoId }
  ↓  Returns { uploadURL, videoId } to mobile
Mobile
  ↓  PUT uploadURL ← direct upload, no Supabase bandwidth used
  ↓  Shows upload progress
Cloudflare
  ↓  Transcodes → HLS (360p / 720p / 1080p adaptive) + thumbnail
  ↓  Fires webhook → /edge-function/cloudflare-video-webhook
Edge function
  ↓  Saves video_url (HLS manifest), video_thumbnail_url, video_duration_secs
     to the post record
```

`video_url` stored as Cloudflare HLS manifest:
`https://customer-xxx.cloudflarestream.com/{videoId}/manifest/video.m3u8`

`expo-av` plays HLS natively on iOS and Android. AV1 codec delivered automatically
by Cloudflare for compatible devices (50% better compression than H.264).

**Client-side pre-upload compression:** enforce 3-minute max duration and
720p resolution cap before the upload URL is requested. Use `expo-video-thumbnails`
to extract the cover frame and generate the blurhash before upload.

---

## Feed Algorithm

### Phase 1 — Engagement-weighted recency (ship now)

n8n cron runs every 15 minutes, updates `feed_score` for posts < 7 days old:

```sql
UPDATE public.posts
SET feed_score = public.compute_feed_score(like_count, comment_count, save_count, created_at)
WHERE created_at > now() - interval '7 days'
  AND deleted_at IS NULL;
```

Posts > 7 days old: `feed_score` decays to ~0 naturally. No special handling.

**Decay rate is a single value at launch.** The decay formula is instrumented
from day one via dwell-time logging. After 60 days of engagement data, calibrate
per-`post_type` decay rates from actual half-life measurements per content type.
Do not guess these values — measure them.

### Phase 2 — Vector similarity interest matching (10k+ users)

Activated when `content_vector` columns are populated. Requires choosing an
embedding model (OpenAI `text-embedding-3-small` or a hosted sentence-transformer).
At post creation: edge function generates `content_vector` (64-dim) and
`content_vector_full` (512-dim) using Matryoshka-capable embeddings.
At profile interest update: regenerate `interest_vector` (512-dim).

Two-stage retrieval:
1. Fast ANN on `content_vector` (64-dim) → top 100 candidates
2. Precise cosine similarity on `content_vector_full` (512-dim) → rerank top 15

Add HNSW index when vectors are populated:
```sql
CREATE INDEX idx_posts_vector ON public.posts
  USING hnsw (content_vector vector_cosine_ops) WITH (m=16, ef_construction=64);
```

**Phase 3 note:** When posts exceed ~5M and HNSW degrades under constant inserts,
migrate the vector index to StreamingDiskANN (pgvectorscale extension) or an
external ANN service (Pinecone / Qdrant). The feed query interface does not change.

### Realtime new posts — "N new posts" banner

Supabase Realtime listens for `INSERT` on `posts` where `community_id IN joined_ids`.
On new post arrival: increment `feedStore.newPostCount`.
Never auto-inject mid-scroll — show a floating banner:

```
┌──────────────────────┐
│  ↑  3 new posts      │  ← tap: scroll to top + insert new posts
└──────────────────────┘
```

---

## Scroll Dwell Logging (consent-gated)

Dwell time is the most honest engagement signal — users linger on content
that resonates emotionally even without tapping. Collected only when
`profile.behavioural_consent = true`.

```ts
// FeedCard — measures time post is visible in viewport
const visibleSince = useRef<number | null>(null);

// passed to FlashList viewabilityConfig
onViewableItemsChanged: ({ viewableItems }) => {
  const isVisible = viewableItems.some(v => v.item.id === post.id && v.isViewable);
  if (isVisible && !visibleSince.current) {
    visibleSince.current = Date.now();
  } else if (!isVisible && visibleSince.current) {
    const dwellMs = Date.now() - visibleSince.current;
    if (profile.behavioural_consent) {
      ObservabilityService.logFeedDwell({
        postId: post.id,
        postType: post.post_type,
        dwellMs,
      });
    }
    visibleSince.current = null;
  }
}
```

**Consent UI:** A one-time prompt in the onboarding flow and Settings.
"Help Roxy personalise your feed by allowing usage pattern analysis.
Your data stays private and is never sold." [Allow] [Not now]

This data feeds Phase 2 interest model training via n8n aggregation pipeline.

---

## n8n Jobs

| Job | Trigger | What it does |
|---|---|---|
| `feed-score-updater` | Cron every 15 min | `UPDATE posts SET feed_score = compute_feed_score(...)` for posts < 7 days |
| `seen-posts-purge` | Cron daily | `DELETE FROM seen_posts WHERE seen_at < now() - interval '30 days'` |
| `soft-delete-purge` | Cron daily | Deletes storage objects for posts where `deleted_at < now() - 30 days`, then hard-deletes rows |
| `dwell-aggregator` | Cron daily | Aggregates PostHog dwell events into per-post engagement signal table (Phase 2 prep) |
| `vector-tagger` | DB webhook: posts INSERT | Calls edge function → generates `post_tags`, `content_vector`, `content_vector_full` (Phase 2, off by default) |

---

## File Map

### Create
```
supabase/migrations/045_feed_v2.sql

apps/mobile/lib/media.ts                              ← getPostImageUrl() helper
apps/mobile/lib/feedAlgorithm.ts                      ← phase detection, query builder, decay constants
apps/mobile/lib/videoUpload.ts                        ← Cloudflare Stream upload flow

supabase/functions/get-video-upload-url/index.ts      ← Edge fn: Cloudflare upload URL
supabase/functions/cloudflare-video-webhook/index.ts  ← Edge fn: webhook receiver

apps/mobile/components/feed/FeedCard.tsx              ← dispatcher by post_type
apps/mobile/components/feed/StaticPostCard.tsx        ← text / photo / gallery
apps/mobile/components/feed/VideoPostCard.tsx         ← thumbnail + ▶ + duration
apps/mobile/components/feed/RoxyLinkCard.tsx          ← game / room / event link
apps/mobile/components/feed/PostActionRow.tsx         ← ♡ ✦ 💬 ↗
apps/mobile/components/feed/FeedSkeleton.tsx          ← shimmer placeholder cards
apps/mobile/components/feed/CommentThread.tsx         ← comment + replies (shared)
apps/mobile/components/feed/CommentSheet.tsx          ← bottom sheet for video
apps/mobile/components/feed/PrivacyGateSheet.tsx      ← join community prompt
apps/mobile/components/feed/RoxyLinkPicker.tsx        ← entity picker for create post
apps/mobile/components/feed/NewPostsBanner.tsx        ← "N new posts ↑" floating bar

apps/mobile/app/(tabs)/discover/post/[postId].tsx     ← Rednote-style detail screen
apps/mobile/app/(tabs)/discover/video/[postId].tsx    ← TikTok full-screen pager
```

### Modify
```
apps/mobile/types/index.ts                            ← extend Post, Comment
apps/mobile/store/feedStore.ts                        ← full rewrite
apps/mobile/app/(tabs)/discover/index.tsx             ← add feed subtab
apps/mobile/app/(tabs)/discover/community/create-post.tsx  ← type picker
apps/mobile/app/(tabs)/discover/community/post/[postId].tsx ← redirect to new screen
```

---

## Component Designs

### FeedCard.tsx — dispatcher only, no logic

```ts
export function FeedCard({ post, ...handlers }: FeedCardProps) {
  switch (post.post_type) {
    case 'video':      return <VideoPostCard post={post} {...handlers} />;
    case 'roxy_link':  return <RoxyLinkCard  post={post} {...handlers} />;
    default:           return <StaticPostCard post={post} {...handlers} />;
  }
}
```

### StaticPostCard — text / photo / gallery

Photo/gallery: `expo-image` with `blurhash` placeholder, AVIF via `getPostImageUrl`.
Gallery: horizontal `ScrollView pagingEnabled` inside the card's image zone.
Text posts: no image zone, gradient background using community accent or `COLORS.surface`.
Caption truncated at 3 lines with "Show more" toggle.

### VideoPostCard — thumbnail, no autoplay in feed

`expo-image` renders `video_thumbnail_url` at `4:5` (or native ratio).
Play icon (▶) centered overlay. Duration badge bottom-right.
Tapping calls `onPress` → navigates to `video/[postId]`.
Tapping 💬 in `PostActionRow` → navigates to `video/[postId]?openComments=true`.

### VideoPlayerScreen — `video/[postId].tsx`

`FlatList` with `pagingEnabled`, vertical, `windowSize={3}`, `initialNumToRender={1}`.
Uses `expo-av` `Video` component.

```ts
// expo-av guard — native module pattern
let ExpoAV: any = null;
try { ExpoAV = require('expo-av'); } catch {}
export const isVideoAvailable = () => ExpoAV !== null;
```

`onViewableItemsChanged` drives play/pause:
- Snapped item → `video.playAsync()`
- Off-screen → `video.pauseAsync()` + preload next (`video.loadAsync()`)

Back → `router.back()`. Feed scroll position preserved (screen not unmounted).

### RoxyLinkCard — three sub-renders

```ts
type RoxyLinkVariant = 'game' | 'room' | 'event';

// game:  🎮 name · "Live" · 👥 count · [Join Game]
// room:  🎙 name · "Live" · 👥 count · [Join Room]
// event: 📅 name · formatted date · 📍 location · [RSVP / View]
```

CTA tap:
- `link_community_id` null OR user is member → deep-link to entity
- Community is private AND user not member → `<PrivacyGateSheet>`

### PostActionRow

```
♡ {like_count}   ✦ {save_count}   💬 {comment_count}   ↗
```

♡ filled + purple when `isLiked`. ✦ filled when `isSaved`.
Both toggle optimistically via `feedStore.toggleLike` / `toggleSave`.
💬 navigates to detail or opens sheet. ↗ calls `Share.share`.

### CommentThread — shared between PostDetailScreen and CommentSheet

```ts
interface CommentThreadProps {
  postId: string;
  comments: Comment[];       // top-level only, replies in comment.replies
  currentUserId: string;
  likedCommentIds: Set<string>;
  onLikeComment: (commentId: string) => void;
  onReply: (comment: Comment) => void;
}
```

Replies collapsed to first 2 by default. "View N more replies" tap expands inline.
No second-level nesting — replies always attach to the top-level parent.
Deleted comments show "This comment was removed." — content cleared, row preserved.

### PostDetailScreen — `post/[postId].tsx`

```
ScrollView
  Author row: avatar · name · follow button · ···
  Media zone: photo (expo-image) OR gallery (horizontal ScrollView) OR nothing (text)
  Caption: full text, no truncation
  Tags row
  ─────────────
  Comments (N)
  CommentThread (paginated: 20 top-level, replies fetched on expand)
  Load more comments button

StickyActionBar (pinned bottom):
  ♡ like_count   ✦ save_count   [Add a comment...]   ↗
  📷  GIF  😊   ← shown only when input focused
```

Comment input: tap → keyboard up, `replyingTo` state shows "@username" chip.
Submit → `INSERT comments WHERE parent_id = replyingTo?.id OR null`.

### FeedSkeleton — shimmer placeholder

Three skeleton cards rendered during `loading === true`.
Shape approximates a photo card (most common type).
Built with `Animated` — no new packages.

```
┌────────────────────────────────┐
│ ░░░░░  ░░░░░░░░░░░  ← author  │
│ ┌──────────────────────────┐   │
│ │ ░░░░░░░░░░░░░░░░░░░░░░  │   │  shimmer over grey blocks
│ │ ░░░░░░░░░░░░░░░░░░░░░░  │   │
│ └──────────────────────────┘   │
│ ░░░░░░░░░░░░  ← caption        │
│ ░░  ░░  ░░  ░░  ← actions      │
└────────────────────────────────┘
```

### PrivacyGateSheet

```
▬▬▬
🔒  This is inside
    "{communityName}"
    a private community.

Join to access:
[ Request to Join ]   ← primary
[ Cancel ]            ← ghost
```

### Create post — type picker + branching composers

```
STEP 1: Type picker
┌────────────────────────────────────┐
│ ← New Post                         │
│────────────────────────────────────│
│  ┌──────┐  ┌──────┐  ┌──────┐     │
│  │  📝  │  │  📷  │  │  🎬  │     │
│  │ Text │  │Photo/│  │Video │     │
│  │      │  │Gallery│  │      │     │
│  └──────┘  └──────┘  └──────┘     │
│  ┌──────────────────────────────┐  │
│  │ 🔗  Roxy Link                │  │
│  │     Share a game, room,      │  │
│  │     or community event       │  │
│  └──────────────────────────────┘  │
└────────────────────────────────────┘

STEP 2A: Text — existing composer, unchanged
STEP 2B: Photo/Gallery — up to 10 photos, reorder, first = cover
          blurhash computed on device before upload
          images uploaded to post-media/{user_id}/{post_id}/
STEP 2C: Video — pick from library, 3-min max, 720p cap enforced
          compress before upload, thumbnail extracted via expo-video-thumbnails
          direct upload to Cloudflare Stream via get-video-upload-url
STEP 2D: Roxy Link — RoxyLinkPicker sheet → caption
```

### RoxyLinkPicker

Shows only entities user has access to (queried by membership):

```
← Link to...
────────────────
🎮 Games
   Trivia Night     ▸
   Word Scramble    ▸
────────────────
🎙 Rooms
   Chill & Chat     ▸
────────────────
📅 Community Events
   WLW Mixer        ▸
   Book Club        ▸
```

---

## GIF Support — Tenor API

Tenor API (free tier, no key required for development) for GIF search in comment
composer. `GifPickerSheet` component: search input → grid of results.
Selected GIF URL stored in `comments.gif_url`.
Rendered with `expo-image` — `autoplay={false}` by default (first frame only).
Tap to animate. Battery and bandwidth friendly.

---

## Error Handling

| Failure | Behaviour |
|---|---|
| Feed load fails | Full-width retry banner: "Couldn't load feed. Tap to retry." |
| Feed page load fails | Silent retry on next scroll, no banner |
| Video load fails | Thumbnail stays, ⚠️ badge overlay, no crash |
| Video upload fails | Error toast, draft preserved, user can retry |
| Comment submit fails | Optimistic update rolled back, toast error |
| Like/save fails | Optimistic update rolled back silently |
| RoxyLink entity deleted | Card shows "This content is no longer available" |
| GIF picker offline | "GIF search unavailable" inline in picker |

---

## Emotional Wellbeing — Explicit, Not Covert

No covert feed manipulation based on inferred emotional state. The reasons:
- Ethically indefensible without explicit consent (ref: Facebook 2014 emotional contagion incident)
- Legally questionable under EU AI Act mental health AI provisions
- Inference accuracy is too low at small scale — too many false positives
- WLW users have elevated privacy sensitivity

The correct version: **an explicit Roxy Check-In feature** (separate spec).
User-initiated. Named. Transparent. "Roxy, I need some support today" → user
actively requests a curated supportive feed composition. This is a product
strength, not an algorithmic trick.

---

## WLW Interest Ontology — Community-Seeded, Not Hard-Coded

A static `feedOntology.ts` file written by engineers would be biased and brittle.
The right approach:
- Seed initial vocabulary from `profiles.interests[]` (existing field, user-entered)
- Expose ontology management in a future staff/admin tool
- Community members propose categories, moderators approve
- The ontology evolves with the community — Roxy can't define queer identity from the outside

Phase 2: use the emerged vocabulary as the post tagging taxonomy for `post_tags[]`.

---

## Emotional AI Data — What This Feed Generates

Every interaction is a training signal for the Thinqer emotional AI pipeline:

| Signal | What it tells the model |
|---|---|
| Dwell time (consent-gated) | Content resonance — more honest than likes |
| Like vs save distinction | Like = appreciation, Save = desire to return |
| Video watch completion % | Engagement depth and narrative preference |
| Comment sentiment | Emotional state at moment of posting |
| Reply chain formation | Relationship bonding signal |
| Roxy Link share type | Social graph + game/room/event affinity |
| Post type preference | Visual vs text vs video communication style |
| Content vector proximity of liked posts | Latent interest cluster mapping |
| Scroll-past rate by post type | Content format rejection signal |

All logged anonymised (no content, hashed user IDs) via `ObservabilityService`.

---

## Testing Requirements

### Unit tests

```
feedStore.test.ts
  ✓ init() populates likedPostIds and savedPostIds from DB
  ✓ fetchFeed populates posts and videoQueue
  ✓ fetchMoreFeed appends posts, advances cursor, sets hasMore=false at end
  ✓ toggleLike optimistically updates likedPostIds and like_count
  ✓ toggleLike rolls back on DB error
  ✓ toggleSave optimistically updates savedPostIds and save_count
  ✓ toggleSave rolls back on DB error
  ✓ acceptNewPosts inserts new posts at top, resets newPostCount

PostActionRow.test.tsx
  ✓ renders like_count correctly
  ✓ heart is filled when isLiked=true, unfilled when false
  ✓ save icon filled when isSaved=true
  ✓ calls onLike when ♡ pressed
  ✓ calls onSave when ✦ pressed
  ✓ calls onComment when 💬 pressed

StaticPostCard.test.tsx
  ✓ text post renders without image zone
  ✓ photo post renders expo-image with blurhash placeholder
  ✓ gallery renders dot indicators for 2+ images, not for 1
  ✓ caption truncated at 3 lines, Show more expands
  ✓ calls onPress on card tap

VideoPostCard.test.tsx
  ✓ renders thumbnail image
  ✓ renders ▶ play icon overlay
  ✓ renders duration badge
  ✓ calls onPress when card tapped

RoxyLinkCard.test.tsx
  ✓ renders game variant with 🎮 and player count
  ✓ renders room variant with 🎙 and participant count
  ✓ renders event variant with 📅 and formatted date
  ✓ calls onPress when CTA tapped

CommentThread.test.tsx
  ✓ renders top-level comments
  ✓ shows first 2 replies, hides rest with "View N more"
  ✓ expands replies on tap
  ✓ calls onLikeComment when ♡ tapped
  ✓ calls onReply when Reply tapped
  ✓ deleted comment shows "This comment was removed."

media.test.ts
  ✓ getPostImageUrl returns correct transform URL per variant
  ✓ getPostImageUrl uses avif format
```

### Integration checklist (manual)
- [ ] Feed loads on Discover tab Feed subtab, shows mixed card types
- [ ] Skeleton shows during first load, disappears when data arrives
- [ ] Tapping video card opens full-screen player at correct video
- [ ] Swiping up/down in player moves to adjacent video in queue
- [ ] Back from player returns to feed at exact scroll position
- [ ] Tapping static card opens Rednote-style detail screen
- [ ] Comments load inline on detail screen (not upfront with feed)
- [ ] Reply creates comment with correct parent_id in DB
- [ ] "View N more replies" expands inline
- [ ] Like on comment: optimistic update, DB write, filled heart shown
- [ ] Unlike on comment: optimistic, rollback on error
- [ ] Like on post persists after navigate away and back (from likedPostIds Set)
- [ ] Save on post persists after navigate away and back
- [ ] New post arrives via Realtime → "N new posts" banner appears, not auto-injected
- [ ] Tapping banner inserts new posts at top, banner clears
- [ ] RoxyLinkCard CTA → direct navigate if public
- [ ] RoxyLinkCard CTA → PrivacyGateSheet if private community
- [ ] Create post → type picker → photo → upload → appears in feed with thumbnail
- [ ] Create post → video → Cloudflare upload → thumbnail shown in feed card
- [ ] Video plays HLS on tap, pauses when swiped away
- [ ] Dwell time NOT logged when behavioural_consent = false
- [ ] Dwell time IS logged when behavioural_consent = true

---

## Phase Roadmap (in spec, not in implementation plan)

```
PHASE 1 (now):
  ✓ Engagement-weighted recency (feed_score cron)
  ✓ Soft delete, seen_posts, like/save tables
  ✓ AVIF images, blurhash, Cloudflare Stream AV1 video
  ✓ Dwell time logging (consent-gated)
  ✓ vector columns in schema (null)

PHASE 2 (10k users, ~6 months post-launch):
  ○ Choose embedding model
  ○ Vector-tagger n8n job populates content_vector, content_vector_full
  ○ HNSW index enabled
  ○ Two-stage retrieval (64-dim fast → 512-dim rerank)
  ○ interest_vector on profiles
  ○ Per-type decay calibration from 60 days of dwell data

PHASE 3 (100k users):
  ○ Evaluate StreamingDiskANN (pgvectorscale) if HNSW degrades under insert load
  ○ Fan-out-on-write feed table (user_feeds)
  ○ On-device re-ranking (CoreML/TFLite) — requires training data from Phase 2
  ○ Roxy Check-In feature (explicit wellbeing feed modulation)
  ○ Redis Bloom filter for seen_posts at high volume
```

---

## Out of Scope

- Story-style 24h ephemeral posts
- Poll post type (schema exists, UI deferred)
- Post scheduling
- GIF reactions on posts (comments only for now)
- Full-text search across feed
- Covert emotional state feed modulation (replaced by explicit Roxy Check-In, separate spec)
- On-device federated learning (Phase 3, requires Phase 2 training data first)
