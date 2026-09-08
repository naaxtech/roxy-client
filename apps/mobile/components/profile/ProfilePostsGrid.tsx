import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useThemeColors } from '../../hooks/useThemeColors';
import { type ThemeColors } from '../../lib/theme';
import { TextCardFace } from '../feed/TextCardFace';
import { parseTextCard } from '../../lib/textCard';
import { contentDetailPath } from '../../lib/contentNavigation';
import { logError } from '../../lib/errorLogger';
import { isMediaPost } from '../../lib/postKind';
import type { PostType } from '../../types';

type GridPost = {
  id: string;
  content: string;
  post_type: PostType;
  media_urls: string[] | null;
  video_thumbnail_url: string | null;
};

interface Props {
  userId: string;
}

/**
 * The Posts tab. ProfilePhotoGrid is the edit-screen gallery of `profile_photos`.
 * This is the wall — text cards, photos and videos she actually published.
 */
export function ProfilePostsGrid({ userId }: Props) {
  const colors = useThemeColors();
  const router = useRouter();
  const [posts, setPosts] = useState<GridPost[]>([]);
  const [loading, setLoading] = useState(true);
  const s = styles(colors);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('posts')
      .select('id, content, post_type, media_urls, video_thumbnail_url')
      .eq('author_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(60);
    if (error) logError(error, 'ProfilePostsGrid.load');
    // Text posts live in the Thoughts tab now. A square is the wrong container
    // for a sentence — it crops the one thing the post is made of — and a wall
    // of cropped paragraphs read as broken image tiles.
    setPosts(((data ?? []) as GridPost[]).filter((post) => isMediaPost(post.post_type)));
    setLoading(false);
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />;
  }

  if (posts.length === 0) {
    return (
      <View style={s.empty} testID="profile-posts-grid">
        <Text style={s.emptyTitle}>No photos or videos yet</Text>
        <Text style={s.emptyBody}>Anything you post with a picture lands here. Words go in Thoughts.</Text>
      </View>
    );
  }

  return (
    <View style={s.wrap} testID="profile-posts-grid">
      <View style={s.grid}>
        {posts.map((post) => {
          const photo = post.media_urls?.[0];
          const thumb = post.video_thumbnail_url;
          const isText = post.post_type === 'standard' || post.post_type === 'roxy_link';
          return (
            <TouchableOpacity
              key={post.id}
              style={s.tile}
              testID={`profile-post-${post.id}`}
              onPress={() => router.push(contentDetailPath(post.id, post.post_type) as never)}
              accessibilityRole="button"
              accessibilityLabel={isText ? parseTextCard(post.content).prompt.slice(0, 80) || 'Text post' : 'Open post'}
            >
              {photo || thumb ? (
                <Image
                  source={{ uri: photo ?? thumb ?? '' }}
                  style={s.media}
                  contentFit="cover"
                />
              ) : (
                <TextCardFace content={post.content} size="tile" testIDPrefix={`profile-post-card-${post.id}`} />
              )}
              {post.post_type === 'video' ? (
                <View style={s.play}>
                  <Ionicons name="play" size={14} color="#fff" />
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  wrap: { marginTop: 12, paddingHorizontal: 12, width: '100%' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tile: {
    width: '31.5%',
    aspectRatio: 9 / 16,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  media: { width: '100%', height: '100%', justifyContent: 'center', padding: 8 },
  play: {
    position: 'absolute', right: 6, bottom: 6,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(13,5,32,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  empty: { paddingHorizontal: 24, paddingVertical: 36, alignItems: 'center', gap: 8 },
  emptyTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
  emptyBody: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
});
