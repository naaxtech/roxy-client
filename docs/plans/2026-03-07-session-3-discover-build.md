# Session 3 — Discover Tab + Build Tab Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Build Discover (community feed + events with RSVP) and Build (business directory + impact projects) tabs from their current stubs, and wire Grow tab zones 2–4 to real DB data.

**Architecture:** Two new migrations create `posts`, `events`, `event_attendees`, `businesses`, `impact_projects`. Two new Zustand stores (`feedStore`, `buildStore`) own list state and optimistic updates. Three screen files are replaced wholesale — stubs become full implementations.

**Tech Stack:** Supabase (Postgres + RLS), `@shopify/flash-list`, Zustand, `date-fns`, existing `supabase` client, `COLORS` from `lib/constants.ts`, `types/index.ts` (Post, Event, Business, ImpactProject already defined).

---

## Pre-flight Checks

```bash
# Confirm clean branch and 34 tests passing
cd /c/Thinqer/roxy-client
git branch --show-current        # expect: session-3-discover-build
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -3
# expect: Tests: 34 passed
```

---

## Task 1: Migration 005 — posts, events, event_attendees

**Files:**
- Create: `supabase/migrations/005_content_feed.sql`

**Step 1: Write the migration**

```sql
-- supabase/migrations/005_content_feed.sql

-- POSTS
CREATE TABLE public.posts (
  id             uuid       PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id      uuid       NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  community_id   uuid       REFERENCES public.communities(id) ON DELETE CASCADE,
  content        text       NOT NULL,
  media_urls     text[]     NOT NULL DEFAULT '{}',
  post_type      text       NOT NULL DEFAULT 'standard'
                            CHECK (post_type IN ('standard','event','poll','resource')),
  is_pinned      boolean    NOT NULL DEFAULT false,
  is_flagged     boolean    NOT NULL DEFAULT false,
  reaction_counts jsonb     NOT NULL DEFAULT '{}',
  comment_count  integer    NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- EVENTS
CREATE TABLE public.events (
  id             uuid       PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id   uuid       REFERENCES public.communities(id) ON DELETE SET NULL,
  host_id        uuid       NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title          text       NOT NULL,
  description    text,
  event_type     text       NOT NULL DEFAULT 'online'
                            CHECK (event_type IN ('online','in_person','hybrid')),
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz,
  location_text  text,
  location_url   text,
  max_attendees  integer,
  attendee_count integer    NOT NULL DEFAULT 0,
  cover_image_url text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- EVENT ATTENDEES
CREATE TABLE public.event_attendees (
  event_id  uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rsvp_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

-- RLS
ALTER TABLE public.posts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_attendees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "posts_select"   ON public.posts FOR SELECT TO authenticated USING (true);
CREATE POLICY "posts_insert"   ON public.posts FOR INSERT TO authenticated WITH CHECK (author_id = auth.uid());
CREATE POLICY "posts_update"   ON public.posts FOR UPDATE TO authenticated USING (author_id = auth.uid());
CREATE POLICY "posts_delete"   ON public.posts FOR DELETE TO authenticated USING (author_id = auth.uid());

CREATE POLICY "events_select"  ON public.events FOR SELECT TO authenticated USING (true);
CREATE POLICY "events_insert"  ON public.events FOR INSERT TO authenticated WITH CHECK (host_id = auth.uid());
CREATE POLICY "events_update"  ON public.events FOR UPDATE TO authenticated USING (host_id = auth.uid());

CREATE POLICY "ea_select" ON public.event_attendees FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "ea_insert" ON public.event_attendees FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "ea_delete" ON public.event_attendees FOR DELETE TO authenticated USING (user_id = auth.uid());

-- TRIGGER: sync attendee_count on event_attendees INSERT/DELETE
CREATE OR REPLACE FUNCTION public.update_attendee_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.events SET attendee_count = attendee_count + 1 WHERE id = NEW.event_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.events SET attendee_count = GREATEST(0, attendee_count - 1) WHERE id = OLD.event_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_attendee_count
  AFTER INSERT OR DELETE ON public.event_attendees
  FOR EACH ROW EXECUTE FUNCTION public.update_attendee_count();

-- INDEXES
CREATE INDEX idx_posts_community  ON public.posts(community_id);
CREATE INDEX idx_posts_author     ON public.posts(author_id);
CREATE INDEX idx_posts_created    ON public.posts(created_at DESC);
CREATE INDEX idx_events_starts_at ON public.events(starts_at);
CREATE INDEX idx_events_community ON public.events(community_id);

-- SEED (uses first profile; harmless if no profiles exist)
DO $$
DECLARE v_host uuid;
BEGIN
  SELECT id INTO v_host FROM public.profiles LIMIT 1;
  IF v_host IS NOT NULL THEN
    INSERT INTO public.events (host_id, title, description, event_type, starts_at)
    VALUES
      (v_host, 'Queer Book Club', 'Monthly book club for queer women and allies',
       'online', now() + interval '3 days'),
      (v_host, 'WLW Social Mixer', 'Casual meetup for women who love women',
       'in_person', now() + interval '7 days');
  END IF;
END $$;
```

**Step 2: Commit**

```bash
git add supabase/migrations/005_content_feed.sql
git commit -m "feat: migration 005 — posts, events, event_attendees + RLS + seed"
```

---

## Task 2: Migration 006 — businesses, impact_projects

**Files:**
- Create: `supabase/migrations/006_build_tab.sql`

**Step 1: Write the migration**

```sql
-- supabase/migrations/006_build_tab.sql

CREATE TABLE public.businesses (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name             text    NOT NULL,
  description      text,
  category         text,
  location_city    text,
  website_url      text,
  instagram_handle text,
  logo_url         text,
  is_verified      boolean NOT NULL DEFAULT false,
  is_wlw_owned     boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.impact_projects (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id      uuid    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title           text    NOT NULL,
  description     text,
  category        text    NOT NULL DEFAULT 'mutual_aid'
                          CHECK (category IN ('mutual_aid','visibility','education','safety')),
  goal_amount     numeric,
  raised_amount   numeric NOT NULL DEFAULT 0,
  supporter_count integer NOT NULL DEFAULT 0,
  status          text    NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','completed','paused')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.businesses      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.impact_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "biz_select"    ON public.businesses      FOR SELECT TO authenticated USING (true);
CREATE POLICY "biz_insert"    ON public.businesses      FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "biz_update"    ON public.businesses      FOR UPDATE TO authenticated USING (owner_id = auth.uid());

CREATE POLICY "impact_select" ON public.impact_projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "impact_insert" ON public.impact_projects FOR INSERT TO authenticated WITH CHECK (creator_id = auth.uid());
CREATE POLICY "impact_update" ON public.impact_projects FOR UPDATE TO authenticated USING (creator_id = auth.uid());

CREATE INDEX idx_biz_wlw      ON public.businesses(is_wlw_owned);
CREATE INDEX idx_biz_category ON public.businesses(category);
CREATE INDEX idx_impact_status ON public.impact_projects(status);

DO $$
DECLARE v_owner uuid;
BEGIN
  SELECT id INTO v_owner FROM public.profiles LIMIT 1;
  IF v_owner IS NOT NULL THEN
    INSERT INTO public.businesses (owner_id, name, description, category, location_city, is_wlw_owned, is_verified)
    VALUES
      (v_owner, 'Lavender Books', 'Queer bookshop and community space', 'retail', 'London', true, true),
      (v_owner, 'Wildflower Studio', 'Photography for the queer community', 'creative', 'Manchester', true, false),
      (v_owner, 'Queerly Coaching', 'Life coaching for LGBTQ+ professionals', 'services', 'Remote', true, false);

    INSERT INTO public.impact_projects (creator_id, title, description, category, goal_amount, raised_amount, supporter_count, status)
    VALUES
      (v_owner, 'Safety Fund for Trans Women', 'Emergency housing and legal support fund', 'safety', 5000, 1250, 23, 'active'),
      (v_owner, 'Queer Visibility Zine', 'Community-made zine distributed at Pride events', 'visibility', 800, 800, 47, 'completed');
  END IF;
END $$;
```

**Step 2: Commit**

```bash
git add supabase/migrations/006_build_tab.sql
git commit -m "feat: migration 006 — businesses, impact_projects + RLS + seed"
```

---

## Task 3: feedStore + tests (TDD)

**Files:**
- Create: `apps/mobile/__tests__/store/feedStore.test.ts`
- Create: `apps/mobile/store/feedStore.ts`

**Step 1: Write the failing tests**

```ts
// apps/mobile/__tests__/store/feedStore.test.ts
import { act, renderHook } from '@testing-library/react-native';
import { useFeedStore } from '../../store/feedStore';
import { Post, Event } from '../../types';

const makePost = (id: string, overrides: Partial<Post> = {}): Post => ({
  id,
  author_id: 'user-1',
  community_id: 'comm-1',
  content: 'Hello world',
  media_urls: [],
  post_type: 'standard',
  is_pinned: false,
  is_flagged: false,
  reaction_counts: {},
  comment_count: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const makeEvent = (id: string): Event => ({
  id,
  community_id: null,
  host_id: 'user-1',
  title: 'Test Event',
  description: null,
  event_type: 'online',
  starts_at: '2026-04-01T18:00:00Z',
  ends_at: null,
  location_text: null,
  location_url: null,
  max_attendees: null,
  attendee_count: 0,
  cover_image_url: null,
  created_at: '2026-01-01T00:00:00Z',
});

beforeEach(() => {
  useFeedStore.setState({
    posts: [], events: [], loading: false,
    rsvpdEventIds: new Set(),
  });
});

describe('feedStore', () => {
  it('has correct initial state', () => {
    const { result } = renderHook(() => useFeedStore());
    expect(result.current.posts).toEqual([]);
    expect(result.current.events).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.rsvpdEventIds).toBeInstanceOf(Set);
  });

  it('setPosts replaces array', () => {
    const { result } = renderHook(() => useFeedStore());
    act(() => result.current.setPosts([makePost('p1'), makePost('p2')]));
    expect(result.current.posts).toHaveLength(2);
    expect(result.current.posts[0].id).toBe('p1');
  });

  it('setEvents replaces array', () => {
    const { result } = renderHook(() => useFeedStore());
    act(() => result.current.setEvents([makeEvent('e1')]));
    expect(result.current.events[0].id).toBe('e1');
  });

  it('upsertPost prepends new post', () => {
    const { result } = renderHook(() => useFeedStore());
    act(() => result.current.setPosts([makePost('p1')]));
    act(() => result.current.upsertPost(makePost('p2')));
    expect(result.current.posts[0].id).toBe('p2');
    expect(result.current.posts).toHaveLength(2);
  });

  it('upsertPost updates existing post in place', () => {
    const { result } = renderHook(() => useFeedStore());
    act(() => result.current.setPosts([makePost('p1', { content: 'old' })]));
    act(() => result.current.upsertPost(makePost('p1', { content: 'updated' })));
    expect(result.current.posts).toHaveLength(1);
    expect(result.current.posts[0].content).toBe('updated');
  });

  it('incrementReaction creates new emoji key', () => {
    const { result } = renderHook(() => useFeedStore());
    act(() => result.current.setPosts([makePost('p1')]));
    act(() => result.current.incrementReaction('p1', '🌸'));
    expect(result.current.posts[0].reaction_counts['🌸']).toBe(1);
  });

  it('incrementReaction increments existing emoji', () => {
    const { result } = renderHook(() => useFeedStore());
    act(() => result.current.setPosts([makePost('p1', { reaction_counts: { '💜': 3 } })]));
    act(() => result.current.incrementReaction('p1', '💜'));
    expect(result.current.posts[0].reaction_counts['💜']).toBe(4);
  });

  it('markRsvpd adds event id to set', () => {
    const { result } = renderHook(() => useFeedStore());
    act(() => result.current.markRsvpd('e1'));
    expect(result.current.rsvpdEventIds.has('e1')).toBe(true);
  });
});
```

**Step 2: Run test — expect FAIL**

```bash
cd apps/mobile && npx jest --ci --testPathPattern="feedStore" 2>&1 | tail -8
# expect: Cannot find module '../../store/feedStore'
```

**Step 3: Write minimal implementation**

```ts
// apps/mobile/store/feedStore.ts
import { create } from 'zustand';
import { Post, Event } from '../types';

interface FeedState {
  posts: Post[];
  events: Event[];
  loading: boolean;
  rsvpdEventIds: Set<string>;
  setPosts: (posts: Post[]) => void;
  setEvents: (events: Event[]) => void;
  setLoading: (loading: boolean) => void;
  upsertPost: (post: Post) => void;
  incrementReaction: (postId: string, emoji: string) => void;
  markRsvpd: (eventId: string) => void;
}

export const useFeedStore = create<FeedState>((set) => ({
  posts: [],
  events: [],
  loading: false,
  rsvpdEventIds: new Set(),

  setPosts: (posts) => set({ posts }),
  setEvents: (events) => set({ events }),
  setLoading: (loading) => set({ loading }),

  upsertPost: (post) =>
    set((s) => {
      const idx = s.posts.findIndex((p) => p.id === post.id);
      if (idx === -1) return { posts: [post, ...s.posts] };
      const updated = [...s.posts];
      updated[idx] = post;
      return { posts: updated };
    }),

  incrementReaction: (postId, emoji) =>
    set((s) => ({
      posts: s.posts.map((p) =>
        p.id !== postId ? p : {
          ...p,
          reaction_counts: {
            ...p.reaction_counts,
            [emoji]: (p.reaction_counts[emoji] ?? 0) + 1,
          },
        }
      ),
    })),

  markRsvpd: (eventId) =>
    set((s) => ({ rsvpdEventIds: new Set([...s.rsvpdEventIds, eventId]) })),
}));
```

**Step 4: Run test — expect PASS**

```bash
cd apps/mobile && npx jest --ci --testPathPattern="feedStore" 2>&1 | tail -5
# expect: Tests: 8 passed
```

**Step 5: Commit**

```bash
git add apps/mobile/store/feedStore.ts apps/mobile/__tests__/store/feedStore.test.ts
git commit -m "feat: feedStore — posts, events, reactions, RSVP tracking (TDD)"
```

---

## Task 4: buildStore + tests (TDD)

**Files:**
- Create: `apps/mobile/__tests__/store/buildStore.test.ts`
- Create: `apps/mobile/store/buildStore.ts`

**Step 1: Write the failing tests**

```ts
// apps/mobile/__tests__/store/buildStore.test.ts
import { act, renderHook } from '@testing-library/react-native';
import { useBuildStore } from '../../store/buildStore';
import { Business, ImpactProject } from '../../types';

const makeBiz = (id: string): Business => ({
  id, owner_id: 'user-1', name: 'Test Biz', description: null,
  category: 'retail', location_city: 'London', website_url: null,
  instagram_handle: null, logo_url: null, is_verified: false,
  is_wlw_owned: true, created_at: '2026-01-01T00:00:00Z',
});

const makeProject = (id: string): ImpactProject => ({
  id, creator_id: 'user-1', title: 'Test Project', description: null,
  category: 'mutual_aid', goal_amount: 1000, raised_amount: 250,
  supporter_count: 10, status: 'active', created_at: '2026-01-01T00:00:00Z',
});

beforeEach(() => {
  useBuildStore.setState({ businesses: [], impactProjects: [], loading: false });
});

describe('buildStore', () => {
  it('has correct initial state', () => {
    const { result } = renderHook(() => useBuildStore());
    expect(result.current.businesses).toEqual([]);
    expect(result.current.impactProjects).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('setBusinesses replaces array', () => {
    const { result } = renderHook(() => useBuildStore());
    act(() => result.current.setBusinesses([makeBiz('b1'), makeBiz('b2')]));
    expect(result.current.businesses).toHaveLength(2);
    expect(result.current.businesses[0].id).toBe('b1');
  });

  it('setImpactProjects replaces array', () => {
    const { result } = renderHook(() => useBuildStore());
    act(() => result.current.setImpactProjects([makeProject('ip1')]));
    expect(result.current.impactProjects[0].id).toBe('ip1');
  });

  it('incrementSupporter updates supporter_count', () => {
    const { result } = renderHook(() => useBuildStore());
    act(() => result.current.setImpactProjects([makeProject('ip1')]));
    act(() => result.current.incrementSupporter('ip1'));
    expect(result.current.impactProjects[0].supporter_count).toBe(11);
  });
});
```

**Step 2: Run test — expect FAIL**

```bash
cd apps/mobile && npx jest --ci --testPathPattern="buildStore" 2>&1 | tail -5
```

**Step 3: Write implementation**

```ts
// apps/mobile/store/buildStore.ts
import { create } from 'zustand';
import { Business, ImpactProject } from '../types';

interface BuildState {
  businesses: Business[];
  impactProjects: ImpactProject[];
  loading: boolean;
  setBusinesses: (businesses: Business[]) => void;
  setImpactProjects: (projects: ImpactProject[]) => void;
  setLoading: (loading: boolean) => void;
  incrementSupporter: (projectId: string) => void;
}

export const useBuildStore = create<BuildState>((set) => ({
  businesses: [],
  impactProjects: [],
  loading: false,

  setBusinesses: (businesses) => set({ businesses }),
  setImpactProjects: (impactProjects) => set({ impactProjects }),
  setLoading: (loading) => set({ loading }),

  incrementSupporter: (projectId) =>
    set((s) => ({
      impactProjects: s.impactProjects.map((p) =>
        p.id !== projectId ? p : { ...p, supporter_count: p.supporter_count + 1 }
      ),
    })),
}));
```

**Step 4: Run all tests — expect PASS (42 total)**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -4
# expect: Tests: 42 passed
```

**Step 5: Commit**

```bash
git add apps/mobile/store/buildStore.ts apps/mobile/__tests__/store/buildStore.test.ts
git commit -m "feat: buildStore — businesses, impact projects, supporter count (TDD)"
```

---

## Task 5: Discover Tab — Feed + Events

**Files:**
- Modify: `apps/mobile/app/(tabs)/discover/index.tsx` (replace stub)

**Design:**
- Segment control: `Feed` | `Events` (simple TouchableOpacity tabs, same pattern as connect screen header)
- **Feed segment:** FlashList of posts from `posts` table, pull-to-refresh, reaction bar (🌸 💜 🔥 ✊), dating teaser card injected every 8 real posts
- **Events segment:** FlatList of upcoming events sorted by `starts_at ASC`, date-grouped header, RSVP toggle button

```tsx
// apps/mobile/app/(tabs)/discover/index.tsx
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  RefreshControl, Alert,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { format, isToday, isTomorrow, isThisWeek } from 'date-fns';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { useProfileStore } from '../../../store/profileStore';
import { useFeedStore } from '../../../store/feedStore';
import { COLORS } from '../../../lib/constants';
import { Post, Event } from '../../../types';

const REACTIONS = ['🌸', '💜', '🔥', '✊'] as const;

// Inject a dating-teaser card every 8 posts
function buildFeedItems(posts: Post[], isDating: boolean): (Post | { id: string; _type: 'teaser' })[] {
  const items: (Post | { id: string; _type: 'teaser' })[] = [];
  posts.forEach((p, i) => {
    items.push(p);
    if (isDating && (i + 1) % 8 === 0) {
      items.push({ id: `teaser-${i}`, _type: 'teaser' });
    }
  });
  return items;
}

function eventDateLabel(startsAt: string): string {
  const d = new Date(startsAt);
  if (isToday(d)) return 'Today';
  if (isTomorrow(d)) return 'Tomorrow';
  if (isThisWeek(d)) return format(d, 'EEEE');
  return format(d, 'EEE, MMM d');
}

function PostCard({ post, onReact }: { post: Post; onReact: (emoji: string) => void }) {
  return (
    <View style={styles.postCard}>
      <View style={styles.postHeader}>
        <View style={styles.postAvatar} />
        <View style={styles.postMeta}>
          <Text style={styles.postAuthor}>Community Member</Text>
          <Text style={styles.postTime}>{format(new Date(post.created_at), 'MMM d')}</Text>
        </View>
      </View>
      <Text style={styles.postContent}>{post.content}</Text>
      <View style={styles.reactionBar}>
        {REACTIONS.map((emoji) => (
          <TouchableOpacity key={emoji} style={styles.reactionBtn} onPress={() => onReact(emoji)}>
            <Text style={styles.reactionEmoji}>{emoji}</Text>
            <Text style={styles.reactionCount}>{post.reaction_counts[emoji] ?? 0}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function DatingTeaserCard({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.teaserCard} onPress={onPress} activeOpacity={0.8}>
      <Text style={styles.teaserEmoji}>⚡</Text>
      <Text style={styles.teaserTitle}>Speed Dating is open</Text>
      <Text style={styles.teaserSub}>5-minute connections. Meet someone new today.</Text>
    </TouchableOpacity>
  );
}

function EventCard({
  event, isRsvpd, onRsvp,
}: { event: Event; isRsvpd: boolean; onRsvp: () => void }) {
  return (
    <View style={styles.eventCard}>
      <View style={styles.eventLeft}>
        <Text style={styles.eventDateLabel}>{eventDateLabel(event.starts_at)}</Text>
        <Text style={styles.eventTime}>{format(new Date(event.starts_at), 'HH:mm')}</Text>
      </View>
      <View style={styles.eventBody}>
        <Text style={styles.eventTitle} numberOfLines={2}>{event.title}</Text>
        {event.description ? (
          <Text style={styles.eventDesc} numberOfLines={1}>{event.description}</Text>
        ) : null}
        <Text style={styles.eventMeta}>
          {event.event_type === 'online' ? '🌐 Online' : '📍 ' + (event.location_text ?? 'In person')}
          {' · '}{event.attendee_count} going
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.rsvpBtn, isRsvpd && styles.rsvpBtnActive]}
        onPress={onRsvp}
      >
        <Text style={[styles.rsvpBtnText, isRsvpd && styles.rsvpBtnTextActive]}>
          {isRsvpd ? '✓ Going' : 'RSVP'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export default function DiscoverScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { profile } = useProfileStore();
  const { posts, events, loading, setPosts, setEvents, setLoading, incrementReaction, markRsvpd, rsvpdEventIds } = useFeedStore();

  const [segment, setSegment] = useState<'feed' | 'events'>('feed');
  const [refreshing, setRefreshing] = useState(false);

  const loadFeed = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('posts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(40);
    setPosts((data as Post[]) ?? []);
  }, [user, setPosts]);

  const loadEvents = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('events')
      .select('*')
      .gte('starts_at', new Date().toISOString())
      .order('starts_at', { ascending: true })
      .limit(20);
    setEvents((data as Event[]) ?? []);
  }, [user, setEvents]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadFeed(), loadEvents()]).finally(() => setLoading(false));
  }, [loadFeed, loadEvents, setLoading]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadFeed(), loadEvents()]);
    setRefreshing(false);
  };

  const handleReact = async (postId: string, emoji: string) => {
    // Optimistic update
    incrementReaction(postId, emoji);
    // Persist via RPC (increment in DB; best-effort)
    await supabase.rpc('increment_reaction', { p_post_id: postId, p_emoji: emoji }).catch(() => {});
  };

  const handleRsvp = async (event: Event) => {
    if (!user) return;
    const isRsvpd = rsvpdEventIds.has(event.id);
    if (isRsvpd) return; // No un-RSVP in MVP
    markRsvpd(event.id);
    const { error } = await supabase
      .from('event_attendees')
      .insert({ event_id: event.id, user_id: user.id });
    if (error) Alert.alert('Could not RSVP', error.message);
  };

  const feedItems = buildFeedItems(posts, profile?.is_dating_mode ?? false);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Segment control */}
      <View style={styles.segmentRow}>
        {(['feed', 'events'] as const).map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.segmentBtn, segment === s && styles.segmentBtnActive]}
            onPress={() => setSegment(s)}
          >
            <Text style={[styles.segmentText, segment === s && styles.segmentTextActive]}>
              {s === 'feed' ? 'Feed' : 'Events'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {segment === 'feed' ? (
        <FlashList
          data={feedItems}
          keyExtractor={(item) => item.id}
          estimatedItemSize={160}
          renderItem={({ item }) => {
            if ('_type' in item && item._type === 'teaser') {
              return <DatingTeaserCard onPress={() => router.push('/(tabs)/connect/speed-dating')} />;
            }
            const post = item as Post;
            return <PostCard post={post} onReact={(emoji) => handleReact(post.id, emoji)} />;
          }}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.roxy} />}
          ListEmptyComponent={
            loading ? null : (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No posts yet</Text>
                <Text style={styles.emptySub}>Join communities to see their posts here.</Text>
              </View>
            )
          }
        />
      ) : (
        <FlashList
          data={events}
          keyExtractor={(item) => item.id}
          estimatedItemSize={100}
          renderItem={({ item }) => (
            <EventCard
              event={item}
              isRsvpd={rsvpdEventIds.has(item.id)}
              onRsvp={() => handleRsvp(item)}
            />
          )}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.roxy} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No upcoming events</Text>
              <Text style={styles.emptySub}>Events from your communities will appear here.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  segmentRow: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.surface,
    paddingHorizontal: 16, gap: 4,
  },
  segmentBtn: { paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  segmentBtnActive: { borderBottomColor: COLORS.primary },
  segmentText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 15 },
  segmentTextActive: { color: COLORS.textPrimary },
  listContent: { padding: 16 },
  // Post card
  postCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, marginBottom: 12 },
  postHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 10 },
  postAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.primary + '40' },
  postMeta: { flex: 1 },
  postAuthor: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 14 },
  postTime: { color: COLORS.textMuted, fontSize: 12 },
  postContent: { color: COLORS.textSecondary, fontSize: 15, lineHeight: 22 },
  reactionBar: { flexDirection: 'row', marginTop: 12, gap: 8 },
  reactionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.surfaceLight, borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  reactionEmoji: { fontSize: 16 },
  reactionCount: { color: COLORS.textMuted, fontSize: 12, fontWeight: '600' },
  // Dating teaser
  teaserCard: {
    backgroundColor: COLORS.primary + '20', borderRadius: 16, padding: 16,
    marginBottom: 12, alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: COLORS.primary + '50',
  },
  teaserEmoji: { fontSize: 28 },
  teaserTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 16 },
  teaserSub: { color: COLORS.textSecondary, fontSize: 13, textAlign: 'center' },
  // Event card
  eventCard: {
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 14,
    marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  eventLeft: { alignItems: 'center', minWidth: 52 },
  eventDateLabel: { color: COLORS.primary, fontWeight: '700', fontSize: 12 },
  eventTime: { color: COLORS.textMuted, fontSize: 12 },
  eventBody: { flex: 1, gap: 2 },
  eventTitle: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 14 },
  eventDesc: { color: COLORS.textMuted, fontSize: 12 },
  eventMeta: { color: COLORS.textMuted, fontSize: 11 },
  rsvpBtn: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.primary,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7,
  },
  rsvpBtnActive: { backgroundColor: COLORS.primary },
  rsvpBtnText: { color: COLORS.primary, fontWeight: '700', fontSize: 13 },
  rsvpBtnTextActive: { color: '#fff' },
  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '700' },
  emptySub: { color: COLORS.textMuted, fontSize: 14, textAlign: 'center' },
});
```

**Step 2: Run all tests (screens have no unit tests — stores cover logic)**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -4
# expect: Tests: 42 passed
```

**Step 3: Commit**

```bash
git add "apps/mobile/app/(tabs)/discover/index.tsx"
git commit -m "feat: Discover tab — feed with reactions, events with RSVP, dating teaser"
```

---

## Task 6: Build Tab — Businesses + Impact Projects

**Files:**
- Modify: `apps/mobile/app/(tabs)/build/index.tsx` (replace stub)

```tsx
// apps/mobile/app/(tabs)/build/index.tsx
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  TextInput, RefreshControl, Linking, Alert,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { useBuildStore } from '../../../store/buildStore';
import { COLORS } from '../../../lib/constants';
import { Business, ImpactProject } from '../../../types';

function BusinessCard({ biz }: { biz: Business }) {
  const handleVisit = () => {
    if (biz.website_url) Linking.openURL(biz.website_url).catch(() => {});
  };
  return (
    <View style={styles.bizCard}>
      <View style={styles.bizLogo}>
        <Text style={styles.bizLogoText}>{biz.name[0]}</Text>
      </View>
      <Text style={styles.bizName} numberOfLines={1}>{biz.name}</Text>
      {biz.is_wlw_owned && <Text style={styles.wlwBadge}>💜 WLW</Text>}
      {biz.location_city && <Text style={styles.bizCity}>{biz.location_city}</Text>}
      {biz.description && <Text style={styles.bizDesc} numberOfLines={2}>{biz.description}</Text>}
      {biz.website_url && (
        <TouchableOpacity style={styles.visitBtn} onPress={handleVisit}>
          <Text style={styles.visitBtnText}>Visit →</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function ImpactCard({ project, onSupport }: { project: ImpactProject; onSupport: () => void }) {
  const progress = project.goal_amount
    ? Math.min(project.raised_amount / project.goal_amount, 1)
    : null;

  const categoryEmoji: Record<string, string> = {
    mutual_aid: '🤝', visibility: '🏳️‍🌈', education: '📚', safety: '🛡️',
  };

  return (
    <View style={styles.impactCard}>
      <View style={styles.impactHeader}>
        <Text style={styles.impactEmoji}>{categoryEmoji[project.category] ?? '✨'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.impactTitle} numberOfLines={2}>{project.title}</Text>
          <Text style={styles.impactMeta}>{project.supporter_count} supporters</Text>
        </View>
        {project.status === 'active' && (
          <TouchableOpacity style={styles.supportBtn} onPress={onSupport}>
            <Text style={styles.supportBtnText}>Support</Text>
          </TouchableOpacity>
        )}
        {project.status === 'completed' && (
          <View style={styles.completedBadge}>
            <Text style={styles.completedText}>✓ Done</Text>
          </View>
        )}
      </View>
      {project.description && (
        <Text style={styles.impactDesc} numberOfLines={2}>{project.description}</Text>
      )}
      {progress !== null && (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` as any }]} />
        </View>
      )}
      {project.goal_amount && (
        <Text style={styles.progressLabel}>
          £{project.raised_amount.toLocaleString()} of £{project.goal_amount.toLocaleString()} raised
        </Text>
      )}
    </View>
  );
}

export default function BuildScreen() {
  const { user } = useAuthStore();
  const { businesses, impactProjects, loading, setBusinesses, setImpactProjects, setLoading, incrementSupporter } = useBuildStore();

  const [segment, setSegment] = useState<'businesses' | 'impact'>('businesses');
  const [search, setSearch] = useState('');
  const [wlwOnly, setWlwOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadBusinesses = useCallback(async () => {
    const { data } = await supabase
      .from('businesses')
      .select('*')
      .order('is_verified', { ascending: false })
      .order('name')
      .limit(50);
    setBusinesses((data as Business[]) ?? []);
  }, [setBusinesses]);

  const loadProjects = useCallback(async () => {
    const { data } = await supabase
      .from('impact_projects')
      .select('*')
      .order('status')
      .order('created_at', { ascending: false })
      .limit(30);
    setImpactProjects((data as ImpactProject[]) ?? []);
  }, [setImpactProjects]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadBusinesses(), loadProjects()]).finally(() => setLoading(false));
  }, [loadBusinesses, loadProjects, setLoading]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadBusinesses(), loadProjects()]);
    setRefreshing(false);
  };

  const handleSupport = async (project: ImpactProject) => {
    if (!user) return;
    incrementSupporter(project.id);
    await supabase
      .from('impact_projects')
      .update({ supporter_count: project.supporter_count + 1 })
      .eq('id', project.id)
      .catch(() => {});
  };

  const filteredBiz = businesses.filter((b) => {
    if (wlwOnly && !b.is_wlw_owned) return false;
    if (search && !b.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.segmentRow}>
        {(['businesses', 'impact'] as const).map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.segmentBtn, segment === s && styles.segmentBtnActive]}
            onPress={() => setSegment(s)}
          >
            <Text style={[styles.segmentText, segment === s && styles.segmentTextActive]}>
              {s === 'businesses' ? 'Businesses' : 'Impact'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {segment === 'businesses' && (
        <>
          <View style={styles.filterRow}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search businesses…"
              placeholderTextColor={COLORS.textMuted}
              value={search}
              onChangeText={setSearch}
            />
            <TouchableOpacity
              style={[styles.wlwToggle, wlwOnly && styles.wlwToggleActive]}
              onPress={() => setWlwOnly((v) => !v)}
            >
              <Text style={styles.wlwToggleText}>💜 WLW only</Text>
            </TouchableOpacity>
          </View>
          <FlashList
            data={filteredBiz}
            keyExtractor={(item) => item.id}
            numColumns={2}
            estimatedItemSize={180}
            renderItem={({ item }) => <BusinessCard biz={item} />}
            contentContainerStyle={styles.gridContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.roxy} />}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No businesses yet</Text>
                <Text style={styles.emptySub}>Be the first to list your business.</Text>
              </View>
            }
          />
        </>
      )}

      {segment === 'impact' && (
        <FlashList
          data={impactProjects}
          keyExtractor={(item) => item.id}
          estimatedItemSize={130}
          renderItem={({ item }) => (
            <ImpactCard project={item} onSupport={() => handleSupport(item)} />
          )}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.roxy} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No projects yet</Text>
              <Text style={styles.emptySub}>Start an impact project for the community.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  segmentRow: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.surface,
    paddingHorizontal: 16, gap: 4,
  },
  segmentBtn: { paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  segmentBtnActive: { borderBottomColor: COLORS.primary },
  segmentText: { color: COLORS.textMuted, fontWeight: '600', fontSize: 15 },
  segmentTextActive: { color: COLORS.textPrimary },
  filterRow: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 },
  searchInput: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    color: COLORS.textPrimary, fontSize: 14,
  },
  wlwToggle: {
    backgroundColor: COLORS.surface, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: 'transparent',
  },
  wlwToggleActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '20' },
  wlwToggleText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
  gridContent: { padding: 8 },
  listContent: { padding: 16 },
  // Business card (grid item)
  bizCard: {
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 14,
    margin: 6, flex: 1, gap: 4,
  },
  bizLogo: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: COLORS.primary + '30', alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  bizLogoText: { color: COLORS.primary, fontWeight: '800', fontSize: 18 },
  bizName: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 14 },
  wlwBadge: { color: COLORS.secondary, fontSize: 11, fontWeight: '600' },
  bizCity: { color: COLORS.textMuted, fontSize: 12 },
  bizDesc: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 17 },
  visitBtn: { marginTop: 6, alignSelf: 'flex-start' },
  visitBtnText: { color: COLORS.primary, fontWeight: '700', fontSize: 13 },
  // Impact card
  impactCard: { backgroundColor: COLORS.surface, borderRadius: 14, padding: 16, marginBottom: 10, gap: 8 },
  impactHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  impactEmoji: { fontSize: 24, marginTop: 2 },
  impactTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 15 },
  impactMeta: { color: COLORS.textMuted, fontSize: 12 },
  impactDesc: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 18 },
  supportBtn: { backgroundColor: COLORS.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  supportBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  completedBadge: { backgroundColor: COLORS.success + '20', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  completedText: { color: COLORS.success, fontWeight: '700', fontSize: 12 },
  progressTrack: { height: 6, backgroundColor: COLORS.surfaceLight, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: COLORS.primary, borderRadius: 3 },
  progressLabel: { color: COLORS.textMuted, fontSize: 12 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '700' },
  emptySub: { color: COLORS.textMuted, fontSize: 14, textAlign: 'center' },
});
```

**Step 2: Run all tests**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -4
# expect: Tests: 42 passed
```

**Step 3: Commit**

```bash
git add "apps/mobile/app/(tabs)/build/index.tsx"
git commit -m "feat: Build tab — business directory (2-col grid, search, WLW filter) + impact projects"
```

---

## Task 7: Grow Tab — Wire Zones 2, 3, 4 to Real Data

**Files:**
- Modify: `apps/mobile/app/(tabs)/grow/index.tsx` (replace zones 2–4 placeholders)

Replace zones 2, 3, 4 with live Supabase queries. Zone 1 (Roxy greeting card) stays unchanged.

```tsx
// apps/mobile/app/(tabs)/grow/index.tsx
// FULL REPLACEMENT — all 4 zones
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { callEdgeFunction, supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { useProfile } from '../../../hooks/useProfile';
import { COLORS } from '../../../lib/constants';
import { Community, Profile } from '../../../types';

interface FriendRow { addressee_id: string; requester_id: string; }

export default function GrowScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { profile } = useProfile();

  const [greeting, setGreeting] = useState<string | null>(null);
  const [greetingLoading, setGreetingLoading] = useState(true);

  const [communities, setCommunities] = useState<Community[]>([]);
  const [friendIds, setFriendIds] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Zone 1: Roxy greeting
  useEffect(() => {
    if (!profile) return;
    setGreetingLoading(true);
    callEdgeFunction<{ greeting: string }>('roxy-greeting', {})
      .then(({ data }) => setGreeting(data?.greeting ?? null))
      .finally(() => setGreetingLoading(false));
  }, [profile]);

  const loadZones = useCallback(async () => {
    if (!user) return;

    // Zone 2: communities user belongs to
    const { data: memberships } = await supabase
      .from('community_members')
      .select('community_id')
      .eq('user_id', user.id)
      .limit(6);

    if (memberships && memberships.length > 0) {
      const ids = memberships.map((m: { community_id: string }) => m.community_id);
      const { data: comms } = await supabase
        .from('communities')
        .select('*')
        .in('id', ids);
      setCommunities((comms as Community[]) ?? []);
    }

    // Zone 3: accepted friendships
    const { data: friends } = await supabase
      .from('friendships')
      .select('requester_id, addressee_id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
      .limit(20);

    if (friends) {
      const ids = (friends as FriendRow[]).map((f) =>
        f.requester_id === user.id ? f.addressee_id : f.requester_id
      );
      setFriendIds(ids);
    }
  }, [user]);

  useEffect(() => { loadZones(); }, [loadZones]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadZones();
    setRefreshing(false);
  };

  const points = profile?.gamification_points ?? 0;
  const level = points < 100 ? 'Seedling 🌱' : points < 500 ? 'Bloom 🌸' : 'Radiant 💜';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.roxy} />}
      >
        {/* Zone 1 — Roxy Greeting */}
        <View style={styles.greetingCard}>
          <View style={styles.roxyDot} />
          {greetingLoading ? (
            <ActivityIndicator color={COLORS.roxy} style={{ marginTop: 24 }} />
          ) : (
            <Text style={styles.greetingText}>{greeting ?? 'Hey — Roxy here. 👋'}</Text>
          )}
          <Text style={styles.greetingLabel}>✨ Your daily message from Roxy</Text>
        </View>

        {/* Zone 2 — Communities */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Your Communities</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/discover')}>
              <Text style={styles.sectionAction}>Explore →</Text>
            </TouchableOpacity>
          </View>
          {communities.length === 0 ? (
            <Text style={styles.emptyState}>Join a community to see it here.</Text>
          ) : (
            <View style={styles.chipRow}>
              {communities.map((c) => (
                <View key={c.id} style={styles.communityChip}>
                  <Text style={styles.communityChipText} numberOfLines={1}>{c.name}</Text>
                  <Text style={styles.communityChipCount}>{c.member_count}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Zone 3 — People */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your People</Text>
          {friendIds.length === 0 ? (
            <Text style={styles.emptyState}>Connect with someone in Discover →</Text>
          ) : (
            <View style={styles.avatarRow}>
              {friendIds.slice(0, 8).map((id) => (
                <View key={id} style={styles.friendAvatar}>
                  <Text style={styles.friendAvatarText}>{id.slice(0, 1).toUpperCase()}</Text>
                </View>
              ))}
              {friendIds.length > 8 && (
                <View style={[styles.friendAvatar, styles.friendAvatarMore]}>
                  <Text style={styles.friendAvatarText}>+{friendIds.length - 8}</Text>
                </View>
              )}
              <Text style={styles.friendCount}>{friendIds.length} connection{friendIds.length !== 1 ? 's' : ''}</Text>
            </View>
          )}
        </View>

        {/* Zone 4 — Journey / Points */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Journey</Text>
          <View style={styles.journeyRow}>
            <View style={styles.journeyStat}>
              <Text style={styles.journeyStatValue}>{points}</Text>
              <Text style={styles.journeyStatLabel}>points</Text>
            </View>
            <View style={styles.journeyStat}>
              <Text style={styles.journeyStatValue}>{level}</Text>
              <Text style={styles.journeyStatLabel}>level</Text>
            </View>
          </View>
          <Text style={styles.journeyHint}>
            Earn points by posting, connecting, and speed dating. Badges coming soon!
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: 16, gap: 16 },
  greetingCard: {
    backgroundColor: COLORS.surface, borderRadius: 24, padding: 24,
    minHeight: 180, justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.primary + '40',
  },
  roxyDot: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.roxy, marginBottom: 12 },
  greetingText: { fontSize: 18, color: COLORS.textPrimary, lineHeight: 28, fontWeight: '500' },
  greetingLabel: { color: COLORS.textMuted, fontSize: 12, marginTop: 12 },
  section: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, gap: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary },
  sectionAction: { color: COLORS.primary, fontSize: 13, fontWeight: '600' },
  emptyState: { color: COLORS.textMuted, fontSize: 14 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  communityChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primary + '20', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  communityChipText: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 13 },
  communityChipCount: { color: COLORS.textMuted, fontSize: 12 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  friendAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.primary + '30', alignItems: 'center', justifyContent: 'center',
  },
  friendAvatarMore: { backgroundColor: COLORS.surfaceLight },
  friendAvatarText: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 15 },
  friendCount: { color: COLORS.textSecondary, fontSize: 13, marginLeft: 4 },
  journeyRow: { flexDirection: 'row', gap: 16 },
  journeyStat: { alignItems: 'center', gap: 2 },
  journeyStatValue: { color: COLORS.textPrimary, fontSize: 22, fontWeight: '800' },
  journeyStatLabel: { color: COLORS.textMuted, fontSize: 12 },
  journeyHint: { color: COLORS.textMuted, fontSize: 13, lineHeight: 18 },
});
```

**Step 2: Run all tests**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -4
# expect: Tests: 42 passed
```

**Step 3: Commit**

```bash
git add "apps/mobile/app/(tabs)/grow/index.tsx"
git commit -m "feat: Grow tab zones 2-4 — communities, connections, journey points"
```

---

## Task 8: Final Verification + PR

**Step 1: Run full test suite**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | grep -E "Tests:|Test Suites:|FAIL"
# expect: Tests: 42 passed, Test Suites: 9 passed
```

**Step 2: Start web preview and verify screens render**

```
preview_start "Expo Web"
# Navigate to /(tabs)/discover — expect segment control visible
# Navigate to /(tabs)/build — expect segment control visible
# Navigate to /(tabs)/grow — expect zones with data or empty states
```

**Step 3: Push and create PR**

```bash
git push -u origin session-3-discover-build

gh pr create \
  --base main \
  --title "feat: Session 3 — Discover tab + Build tab + Grow zones 2-4" \
  --body "$(cat <<'EOF'
## Summary

- **Migration 005**: \`posts\`, \`events\`, \`event_attendees\` — RLS, attendee_count trigger, 2 seed events
- **Migration 006**: \`businesses\`, \`impact_projects\` — RLS, WLW flag, 3 seed businesses, 2 seed projects
- **feedStore**: posts, events, optimistic reactions (🌸💜🔥✊), RSVP tracking — 8 tests
- **buildStore**: businesses, impact projects, supporter count — 4 tests
- **Discover tab**: Feed (FlashList + reactions + dating teaser every 8 posts) and Events (RSVP, date labels) segments
- **Build tab**: Business directory (2-col grid, search, WLW filter) and Impact projects (progress bars, support button) segments
- **Grow tab zones 2–4**: communities from \`community_members\`, connections from \`friendships\`, points/level from \`profiles.gamification_points\`

## Test Plan

- [ ] 42 unit tests pass
- [ ] Discover feed loads posts, reactions update optimistically
- [ ] RSVP button toggles to "✓ Going", attendee_count increments
- [ ] Build businesses search filters by name
- [ ] WLW-only toggle filters correctly
- [ ] Impact project support button increments count
- [ ] Grow zones show community chips / friend avatars / points when data exists
- [ ] All screens show graceful empty states when no data

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Reused From Previous Sessions

| Utility | Path |
|---|---|
| `supabase` client + `callEdgeFunction` | `apps/mobile/lib/supabase.ts` |
| `COLORS` | `apps/mobile/lib/constants.ts` |
| `Post`, `Event`, `Business`, `ImpactProject` types | `apps/mobile/types/index.ts` |
| `useAuthStore` | `apps/mobile/store/authStore.ts` |
| `useProfile` hook | `apps/mobile/hooks/useProfile.ts` |
| FlashList pattern | `apps/mobile/app/(tabs)/connect/index.tsx` |
| Store pattern | `apps/mobile/store/connectStore.ts` |
| Segment control pattern | same file as each screen (inline) |

---

## ⚠️ Known Limitations (Out of Scope)

- `increment_reaction` Postgres RPC function is called but not defined in migrations — reactions persist optimistically in-session but don't survive reload. Add the RPC in Session 4 when gamification migration is written.
- No post creation UI — posts can be seeded via DevPanel or Supabase Studio.
- No community joining UI — wire up in a future session when Community detail screen is built.
