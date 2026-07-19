import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useThemeColors } from '../../hooks/useThemeColors';
import { contentDetailPath } from '../../lib/contentNavigation';
import { getPostImageUrl } from '../../lib/media';

interface Props {
  userId: string;
}

type SavedRow = {
  post_id: string;
  posts: {
    id: string;
    content: string | null;
    post_type: string;
    media_urls: string[] | null;
    profiles: { display_name: string | null } | null;
  } | null;
};

/** Bookmarks home: the posts a user saved, surfaced on their own profile. */
export function SavedPosts({ userId }: Props) {
  const colors = useThemeColors();
  const router = useRouter();
  const [rows, setRows] = useState<SavedRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('post_saves')
      .select('post_id, posts(id, content, post_type, media_urls, profiles!posts_author_id_fkey(display_name))')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(12);
    setRows(((data ?? []) as unknown as SavedRow[]).filter((r) => r.posts));
    setLoading(false);
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const styles = StyleSheet.create({
    wrap: { marginTop: 16, paddingHorizontal: 16 },
    label: { color: colors.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8 },
    row: { gap: 10, paddingBottom: 4 },
    card: {
      width: 150, borderRadius: 14, overflow: 'hidden',
      backgroundColor: colors.surface,
    },
    thumb: { width: 150, height: 90, backgroundColor: colors.surfaceLight },
    thumbFallback: {
      width: 150, height: 90, backgroundColor: colors.roxy + '12',
      alignItems: 'center', justifyContent: 'center',
    },
    cardBody: { padding: 10, gap: 2 },
    cardText: { color: colors.textPrimary, fontSize: 12, fontWeight: '600', lineHeight: 16 },
    cardAuthor: { color: colors.textMuted, fontSize: 11 },
    hint: { color: colors.textMuted, fontSize: 13 },
  });

  if (loading || rows.length === 0) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.label}>SAVED</Text>
        <Text style={styles.hint}>
          {loading ? ' ' : 'Bookmark posts across Roxy and they land here.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>SAVED</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {rows.map((r) => {
          const post = r.posts!;
          const mediaUrl = post.media_urls?.length ? getPostImageUrl(post.media_urls[0], 'thumb') : null;
          return (
            <TouchableOpacity
              key={r.post_id}
              style={styles.card}
              onPress={() => router.push(contentDetailPath(post.id, post.post_type as Parameters<typeof contentDetailPath>[1]) as any)}
              activeOpacity={0.85}
              accessibilityLabel={`Open saved post by ${post.profiles?.display_name ?? 'someone'}`}
            >
              {mediaUrl ? (
                <ExpoImage source={{ uri: mediaUrl }} style={styles.thumb} contentFit="cover" />
              ) : (
                <View style={styles.thumbFallback}>
                  <Ionicons
                    name={post.post_type === 'video' ? 'play-circle' : 'bookmark'}
                    size={26}
                    color={colors.roxy}
                  />
                </View>
              )}
              <View style={styles.cardBody}>
                <Text style={styles.cardText} numberOfLines={2}>
                  {post.content?.trim() || (post.post_type === 'video' ? 'Video' : 'Post')}
                </Text>
                <Text style={styles.cardAuthor} numberOfLines={1}>
                  {post.profiles?.display_name ?? ''}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}
