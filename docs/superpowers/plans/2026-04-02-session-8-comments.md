# Session 8 — Flat Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add flat (Threads-style) comments to community posts — migration, post detail screen, comment composer, comment count on post cards.

**Architecture:** A `comments` table stores flat comments with a DB trigger that keeps `posts.comment_count` in sync. A new post detail screen (`post/[postId].tsx`) shows the original post + comment list + sticky composer. Tapping any post card in `community/[id].tsx` navigates to this screen. No new Zustand store — Supabase calls live in the screen.

**Tech Stack:** Expo Router, React Native, Supabase (Postgres RLS + trigger), TypeScript strict, `@shopify/flash-list`, `date-fns`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `supabase/migrations/013_comments.sql` | `comments` table, RLS, trigger on `posts.comment_count` |
| Create | `apps/mobile/app/(tabs)/discover/community/post/[postId].tsx` | Post detail + flat comment list + composer |
| Modify | `apps/mobile/app/(tabs)/discover/community/[id].tsx` | Post cards tappable + comment count badge |
| Modify | `apps/mobile/types/index.ts` | Add `Comment` interface |
| Create | `apps/mobile/__tests__/screens/PostDetail.test.tsx` | Smoke: renders post + comment list + composer |

---

## Task 1: DB Migration — comments table

**Files:**
- Create: `supabase/migrations/013_comments.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/013_comments.sql

-- COMMENTS (flat — no parent_id)
CREATE TABLE public.comments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     uuid        NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  author_id   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content     text        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1000),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comments_select" ON public.comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "comments_insert" ON public.comments FOR INSERT TO authenticated WITH CHECK (author_id = auth.uid());
CREATE POLICY "comments_delete" ON public.comments FOR DELETE TO authenticated USING (author_id = auth.uid());

-- Trigger: keep posts.comment_count in sync
CREATE OR REPLACE FUNCTION public.update_comment_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.posts SET comment_count = GREATEST(0, comment_count - 1) WHERE id = OLD.post_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_comment_count
  AFTER INSERT OR DELETE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.update_comment_count();

-- Indexes
CREATE INDEX idx_comments_post    ON public.comments(post_id, created_at);
CREATE INDEX idx_comments_author  ON public.comments(author_id);
```

- [ ] **Step 2: Push the migration**

```bash
npx supabase db push
```

Expected output: `Applying migration 013_comments.sql...` with no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/013_comments.sql
git commit -m "feat: migration 013 — comments table with trigger on posts.comment_count"
```

---

## Task 2: Add Comment type

**Files:**
- Modify: `apps/mobile/types/index.ts` (after the `Post` interface, ~line 120)

- [ ] **Step 1: Add the interface**

Insert after the closing `}` of the `Post` interface:

```ts
export interface Comment {
  id: string;
  post_id: string;
  author_id: string;
  content: string;
  created_at: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/types/index.ts
git commit -m "feat: add Comment type"
```

---

## Task 3: Post Detail screen (post + flat comments + composer)

**Files:**
- Create: `apps/mobile/app/(tabs)/discover/community/post/[postId].tsx`

- [ ] **Step 1: Write the failing test** (see Task 4 — write test first, then implement)

Skip ahead to Task 4 Step 1, then come back here.

- [ ] **Step 2: Create the screen**

```tsx
// apps/mobile/app/(tabs)/discover/community/post/[postId].tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, KeyboardAvoidingView,
  Platform, FlatList, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { format } from 'date-fns';
import { supabase } from '../../../../../lib/supabase';
import { useAuthStore } from '../../../../../store/authStore';
import { COLORS } from '../../../../../lib/constants';
import type { Comment } from '../../../../../types';

const MAX_CHARS = 500;

type PostRow = {
  id: string;
  content: string;
  created_at: string;
  comment_count: number;
  profiles: { display_name: string; avatar_url: string | null } | null;
};

type CommentRow = Comment & {
  profiles: { display_name: string; avatar_url: string | null } | null;
};

export default function PostDetailScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const listRef = useRef<FlatList>(null);

  const [post, setPost] = useState<PostRow | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadPost = useCallback(async () => {
    if (!postId) return;
    const { data } = await supabase
      .from('posts')
      .select('id, content, created_at, comment_count, profiles(display_name, avatar_url)')
      .eq('id', postId)
      .single();
    if (data) setPost(data as PostRow);
  }, [postId]);

  const loadComments = useCallback(async () => {
    if (!postId) return;
    const { data } = await supabase
      .from('comments')
      .select('*, profiles(display_name, avatar_url)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
      .limit(100);
    if (data) setComments(data as CommentRow[]);
  }, [postId]);

  useEffect(() => {
    (async () => {
      await Promise.all([loadPost(), loadComments()]);
      setLoading(false);
    })();
  }, [loadPost, loadComments]);

  const handleSubmit = async () => {
    if (!draft.trim() || !user || !postId) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from('comments')
        .insert({ post_id: postId, author_id: user.id, content: draft.trim() })
        .select('*, profiles(display_name, avatar_url)')
        .single();
      if (error) {
        Alert.alert('Error', error.message);
      } else {
        setComments((prev) => [...prev, data as CommentRow]);
        setPost((prev) => prev ? { ...prev, comment_count: prev.comment_count + 1 } : prev);
        setDraft('');
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={COLORS.roxy} style={{ marginTop: 48 }} />
      </SafeAreaView>
    );
  }

  if (!post) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity style={styles.backRow} onPress={() => router.back()}>
          <Ionicons name="arrow-back-outline" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.errorText}>Post not found</Text>
      </SafeAreaView>
    );
  }

  const remaining = MAX_CHARS - draft.length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back-outline" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Post</Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={comments}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <View>
              {/* Original post */}
              <View style={styles.postCard}>
                <View style={styles.authorRow}>
                  <View style={styles.avatar}>
                    <Text style={{ fontSize: 14 }}>👤</Text>
                  </View>
                  <View>
                    <Text style={styles.authorName}>{post.profiles?.display_name ?? 'Anonymous'}</Text>
                    <Text style={styles.postTime}>{format(new Date(post.created_at), 'dd MMM · HH:mm')}</Text>
                  </View>
                </View>
                <Text style={styles.postContent}>{post.content}</Text>
                <Text style={styles.commentCountLabel}>
                  {post.comment_count} {post.comment_count === 1 ? 'comment' : 'comments'}
                </Text>
              </View>

              {/* Divider */}
              <View style={styles.divider} />

              {comments.length === 0 && (
                <View style={styles.emptyComments}>
                  <Text style={styles.emptyIcon}>💬</Text>
                  <Text style={styles.emptyText}>No comments yet. Be the first!</Text>
                </View>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.commentRow} key={item.id}>
              <View style={styles.commentAvatar}>
                <Text style={{ fontSize: 12 }}>👤</Text>
              </View>
              <View style={styles.commentBubble}>
                <View style={styles.commentMeta}>
                  <Text style={styles.commentAuthor}>{item.profiles?.display_name ?? 'Anonymous'}</Text>
                  <Text style={styles.commentTime}>{format(new Date(item.created_at), 'dd MMM · HH:mm')}</Text>
                </View>
                <Text style={styles.commentContent}>{item.content}</Text>
              </View>
            </View>
          )}
          contentContainerStyle={{ paddingBottom: 16 }}
        />

        {/* Composer */}
        <View style={styles.composer}>
          <TextInput
            style={styles.composerInput}
            placeholder="Add a comment…"
            placeholderTextColor={COLORS.textMuted}
            value={draft}
            onChangeText={(t) => setDraft(t.slice(0, MAX_CHARS))}
            multiline
            maxLength={MAX_CHARS}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!draft.trim() || submitting) && styles.sendBtnDisabled]}
            onPress={handleSubmit}
            disabled={!draft.trim() || submitting}
          >
            {submitting
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="send" size={18} color="#fff" />
            }
          </TouchableOpacity>
        </View>
        {draft.length > MAX_CHARS - 80 && (
          <Text style={styles.charWarn}>{remaining} left</Text>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, gap: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  backBtn: { padding: 4 },
  backRow: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 8 },
  headerTitle: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '700' },

  // Post
  postCard: { backgroundColor: COLORS.surface, padding: 16, marginBottom: 0 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.surfaceLight, alignItems: 'center', justifyContent: 'center',
  },
  authorName: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 14 },
  postTime: { color: COLORS.textMuted, fontSize: 12 },
  postContent: { color: COLORS.textPrimary, fontSize: 16, lineHeight: 24, marginBottom: 12 },
  commentCountLabel: { color: COLORS.textMuted, fontSize: 13 },

  divider: { height: 1, backgroundColor: COLORS.surface, marginVertical: 8 },

  // Empty
  emptyComments: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyIcon: { fontSize: 36 },
  emptyText: { color: COLORS.textMuted, fontSize: 14 },

  // Comments
  commentRow: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 16, paddingVertical: 8,
  },
  commentAvatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: COLORS.surfaceLight, alignItems: 'center', justifyContent: 'center',
    marginTop: 2,
  },
  commentBubble: {
    flex: 1, backgroundColor: COLORS.surface,
    borderRadius: 14, padding: 10,
  },
  commentMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  commentAuthor: { color: COLORS.roxy, fontWeight: '700', fontSize: 13 },
  commentTime: { color: COLORS.textMuted, fontSize: 11 },
  commentContent: { color: COLORS.textPrimary, fontSize: 14, lineHeight: 20 },

  // Composer
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 16, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: COLORS.surface,
    backgroundColor: COLORS.background,
  },
  composerInput: {
    flex: 1, color: COLORS.textPrimary, fontSize: 15, lineHeight: 22,
    backgroundColor: COLORS.surface, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10,
    maxHeight: 100,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  charWarn: {
    color: COLORS.primary, fontSize: 11,
    paddingHorizontal: 20, paddingBottom: 4, textAlign: 'right',
  },

  errorText: { color: COLORS.textMuted, textAlign: 'center', marginTop: 48, fontSize: 16 },
});
```

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/\(tabs\)/discover/community/post/[postId].tsx
git commit -m "feat: post detail screen with flat comments + composer"
```

---

## Task 4: Tests for PostDetail screen

**Files:**
- Create: `apps/mobile/__tests__/screens/PostDetail.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/mobile/__tests__/screens/PostDetail.test.tsx
import React from 'react';
import { render, act, waitFor, fireEvent } from '@testing-library/react-native';

// Mock expo-router
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ postId: 'post-123' }),
  useRouter: () => ({ back: jest.fn() }),
}));

// Mock supabase with chained builder
jest.mock('../../lib/supabase', () => {
  const mockPost = {
    id: 'post-123',
    content: 'Hello community!',
    created_at: '2026-04-02T10:00:00Z',
    comment_count: 2,
    profiles: { display_name: 'Alice', avatar_url: null },
  };
  const mockComments = [
    {
      id: 'c-1', post_id: 'post-123', author_id: 'u-1',
      content: 'Great post!', created_at: '2026-04-02T10:05:00Z',
      profiles: { display_name: 'Bob', avatar_url: null },
    },
    {
      id: 'c-2', post_id: 'post-123', author_id: 'u-2',
      content: 'Totally agree 💜', created_at: '2026-04-02T10:10:00Z',
      profiles: { display_name: 'Carol', avatar_url: null },
    },
  ];

  const makeChain = (resolveValue: unknown) => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: resolveValue, error: null }),
    insert: jest.fn().mockReturnThis(),
    then: jest.fn(),
  });

  return {
    supabase: {
      from: jest.fn((table: string) => {
        if (table === 'posts') return makeChain(mockPost);
        if (table === 'comments') {
          const chain = makeChain(null);
          // limit() is the terminal call for the list query
          chain.limit = jest.fn().mockResolvedValue({ data: mockComments, error: null });
          return chain;
        }
        return makeChain(null);
      }),
    },
  };
});

// Mock authStore
jest.mock('../../store/authStore', () => ({
  useAuthStore: () => ({ user: { id: 'u-self', display_name: 'Me' } }),
}));

// Mock react-native-safe-area-context
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, ...props }: any) => <View {...props}>{children}</View>,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

// Mock @expo/vector-icons
jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

// Mock @shopify/flash-list (not used in this screen but just in case)
jest.mock('@shopify/flash-list', () => ({ FlashList: 'FlashList' }));

import PostDetailScreen from '../../app/(tabs)/discover/community/post/[postId]';

describe('PostDetailScreen', () => {
  it('renders post content after loading', async () => {
    const { getByText } = render(<PostDetailScreen />);
    await waitFor(() => {
      expect(getByText('Hello community!')).toBeTruthy();
    });
  });

  it('renders existing comments', async () => {
    const { getByText } = render(<PostDetailScreen />);
    await waitFor(() => {
      expect(getByText('Great post!')).toBeTruthy();
      expect(getByText('Totally agree 💜')).toBeTruthy();
    });
  });

  it('renders comment count label', async () => {
    const { getByText } = render(<PostDetailScreen />);
    await waitFor(() => {
      expect(getByText('2 comments')).toBeTruthy();
    });
  });

  it('renders composer input', async () => {
    const { getByPlaceholderText } = render(<PostDetailScreen />);
    await waitFor(() => {
      expect(getByPlaceholderText('Add a comment…')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run and verify tests fail**

```bash
cd apps/mobile && npx jest --ci --testPathPattern="PostDetail" --passWithNoTests 2>&1 | tail -20
```

Expected: `FAIL` — module not found or import errors (screen doesn't exist yet). If you already created the screen in Task 3, expect failures due to unresolved mocks.

- [ ] **Step 3: Run tests after screen is created**

```bash
cd apps/mobile && npx jest --ci --testPathPattern="PostDetail" 2>&1 | tail -30
```

Expected: `PASS` — all 4 tests green.

- [ ] **Step 4: Run full suite to check for regressions**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -20
```

Expected: all existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/__tests__/screens/PostDetail.test.tsx
git commit -m "test: PostDetail — renders post, comments, count label, composer (4 tests)"
```

---

## Task 5: Wire up post cards in community [id].tsx

Update post cards to be tappable (navigate to post detail) and show comment count.

**Files:**
- Modify: `apps/mobile/app/(tabs)/discover/community/[id].tsx`

- [ ] **Step 1: Wrap post card in TouchableOpacity and add comment count row**

In `[id].tsx`, find the posts map block (around line 261). Replace the static `<View key={post.id} style={styles.postCard}>` with a tappable version that also shows the comment count:

```tsx
posts.map((post) => (
  <TouchableOpacity
    key={post.id}
    style={styles.postCard}
    activeOpacity={0.85}
    onPress={() => router.push({
      pathname: '/(tabs)/discover/community/post/[postId]',
      params: { postId: post.id },
    } as any)}
  >
    <View style={styles.postAuthorRow}>
      <View style={styles.postAvatar}>
        <Text style={{ fontSize: 14 }}>👤</Text>
      </View>
      <View>
        <Text style={styles.postAuthorName}>{post.profiles?.display_name ?? 'Anonymous'}</Text>
        <Text style={styles.postTime}>{format(new Date(post.created_at), 'dd MMM · HH:mm')}</Text>
      </View>
    </View>
    <Text style={styles.postContent}>{post.content}</Text>
    <View style={styles.postFooter}>
      <Ionicons name="chatbubble-outline" size={13} color={COLORS.textMuted} />
      <Text style={styles.commentCount}>{post.comment_count ?? 0}</Text>
    </View>
  </TouchableOpacity>
))
```

- [ ] **Step 2: Update PostRow type to include comment_count**

At the top of `[id].tsx`, update the `PostRow` type definition (around line 18):

```ts
type PostRow = {
  id: string; content: string; created_at: string; author_id: string;
  comment_count: number;
  profiles: { display_name: string; avatar_url: string | null } | null;
};
```

- [ ] **Step 3: Update the Supabase query to include comment_count**

In `loadPosts` (around line 72), update the select:

```ts
const { data } = await supabase
  .from('posts')
  .select('id, content, created_at, author_id, comment_count, profiles(display_name, avatar_url)')
  .eq('community_id', id)
  .order('created_at', { ascending: false })
  .limit(30);
```

- [ ] **Step 4: Add the postFooter styles**

In the `StyleSheet.create` at the bottom of `[id].tsx`, add after `postContent`:

```ts
postFooter: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
commentCount: { color: COLORS.textMuted, fontSize: 12 },
```

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/\(tabs\)/discover/community/[id].tsx
git commit -m "feat: post cards tappable — navigate to post detail + show comment count"
```

---

## Task 6: Full test run + type check

- [ ] **Step 1: Run full Jest suite**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -30
```

Expected: all tests pass. If any fail, fix before proceeding.

- [ ] **Step 2: TypeScript check**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors. Fix any type errors before proceeding.

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -p
git commit -m "fix: type errors from comments feature"
```

---

## Self-Review Checklist

- [x] Migration creates `comments` table, RLS (select/insert/delete), trigger on `posts.comment_count`
- [x] `Comment` type added to `types/index.ts`
- [x] Post detail screen: loads post, loads comments, renders flat list, submits new comment, optimistic update of local count + list
- [x] Post cards in `[id].tsx`: tappable, navigate to `post/[postId]`, show `comment_count`
- [x] `PostRow` type updated to include `comment_count`, Supabase select updated to match
- [x] Tests: 4 smoke tests covering render, comments list, count label, composer input
- [x] No `comment_count` sync issues — DB trigger handles it, client does optimistic +1 on successful insert
- [x] Keyboard handling: `KeyboardAvoidingView` with platform-appropriate behavior
- [x] No placeholder steps — all code is complete
