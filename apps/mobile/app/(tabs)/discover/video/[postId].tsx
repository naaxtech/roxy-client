import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  StatusBar, Share, PanResponder, useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFeedStore } from '../../../../store/feedStore';
import { useAuthStore } from '../../../../store/authStore';
import { useThemeColors } from '../../../../hooks/useThemeColors';
import { CommentSheet } from '../../../../components/feed/CommentSheet';
import { FeedVideoPlayer } from '../../../../components/feed/FeedVideoPlayer';
import type { Comment, Post } from '../../../../types';
import { supabase } from '../../../../lib/supabase';
import { fetchPostById } from '../../../../lib/posts';
import { routeParam } from '../../../../lib/routeParams';
import { COMMENT_WITH_AUTHOR } from '../../../../lib/supabaseQueries';

function VideoItem({
  post, isActive, onComment, isLiked, isSaved, onLike, onSave, onShare, styles, colors,
}: {
  post: Post; isActive: boolean;
  onComment: () => void;
  isLiked: boolean; isSaved: boolean;
  onLike: () => void; onSave: () => void; onShare: () => void;
  styles: ReturnType<typeof buildStyles>;
  colors: ReturnType<typeof useThemeColors>;
}) {
  const [muted, setMuted] = useState(false);

  return (
    <View style={styles.videoItem}>
      <FeedVideoPlayer
        videoUrl={post.video_url}
        isActive={isActive}
        isMuted={muted}
      />
      <TouchableOpacity
        style={styles.muteBtn}
        onPress={() => setMuted(m => !m)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={muted ? 'Unmute video' : 'Mute video'}
      >
        <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={22} color="#fff" />
      </TouchableOpacity>
      <View style={styles.overlay}>
        <Text style={styles.overlayAuthor}>@{post.profiles?.display_name ?? ''}</Text>
        {post.content ? (
          <Text style={styles.overlayCaption} numberOfLines={2}>{post.content}</Text>
        ) : null}
      </View>
      <View style={styles.rightRail}>
        <TouchableOpacity style={styles.railAction} onPress={onLike} accessibilityRole="button" accessibilityLabel={isLiked ? 'Unlike post' : 'Like post'}>
          <Ionicons name={isLiked ? 'heart' : 'heart-outline'} size={28} color={isLiked ? colors.primary : '#fff'} />
          <Text style={styles.railCount}>{post.like_count}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.railAction} onPress={onSave} accessibilityRole="button" accessibilityLabel={isSaved ? 'Remove from saved' : 'Save post'}>
          <Ionicons name={isSaved ? 'bookmark' : 'bookmark-outline'} size={26} color={isSaved ? colors.primary : '#fff'} />
          <Text style={styles.railCount}>{post.save_count}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.railAction} onPress={onComment} accessibilityRole="button" accessibilityLabel="View comments">
          <Ionicons name="chatbubble" size={26} color="#fff" />
          <Text style={styles.railCount}>{post.comment_count}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.railAction} onPress={onShare} accessibilityRole="button" accessibilityLabel="Share video">
          <Ionicons name="arrow-redo" size={26} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function buildStyles(colors: ReturnType<typeof useThemeColors>, screenWidth: number, screenHeight: number) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000' },
    videoItem: { width: screenWidth, height: screenHeight, backgroundColor: '#000' },
    muteBtn: { position: 'absolute', top: 60, right: 16, zIndex: 2 },
    overlay: { position: 'absolute', bottom: 80, left: 16, right: 80, zIndex: 2 },
    overlayAuthor: { color: '#fff', fontWeight: '700', fontSize: 15, marginBottom: 4 },
    overlayCaption: { color: 'rgba(255,255,255,0.9)', fontSize: 13, lineHeight: 18 },
    rightRail: { position: 'absolute', right: 12, bottom: 100, alignItems: 'center', gap: 20, zIndex: 2 },
    railAction: { alignItems: 'center', gap: 2 },
    railCount: { color: '#fff', fontSize: 12 },
    backBtn: { position: 'absolute', top: 48, left: 16, zIndex: 10 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    emptyText: { color: colors.textMuted, fontSize: 16 },
  });
}

export default function VideoPlayerScreen() {
  const colors = useThemeColors();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const styles = buildStyles(colors, screenWidth, screenHeight);
  const params = useLocalSearchParams<{ postId: string | string[] }>();
  const postId = routeParam(params.postId);
  const router = useRouter();
  const { user } = useAuthStore();
  const { posts, videoQueue, likedPostIds, savedPostIds, toggleLike, toggleSave } = useFeedStore();

  const [videoPosts, setVideoPosts] = useState<Post[]>(() =>
    videoQueue.map(id => posts.find(p => p.id === id)).filter(Boolean) as Post[],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);
  const [commentSheetPostId, setCommentSheetPostId] = useState<string | null>(null);
  const [sheetComments, setSheetComments] = useState<Comment[]>([]);
  const [likedCommentIds, setLikedCommentIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fromStore = videoQueue.map(id => posts.find(p => p.id === id)).filter(Boolean) as Post[];
    if (fromStore.length) { setVideoPosts(fromStore); return; }
    if (!postId) return;
    void fetchPostById(postId).then((p) => { if (p?.post_type === 'video') setVideoPosts([p]); });
  }, [postId, posts, videoQueue]);

  const initializedRef = useRef(false);
  const initialIndexRef = useRef(0);

  useEffect(() => {
    if (initializedRef.current || !videoPosts.length) return;
    const idx = Math.max(0, videoPosts.findIndex(p => p.id === postId));
    initialIndexRef.current = idx;
    setActiveIndex(idx);
    activeIndexRef.current = idx;
    initializedRef.current = true;
  // Run once when videoPosts first becomes non-empty; postId is stable for this screen mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoPosts.length]);

  const closePlayer = useCallback(() => router.back(), [router]);

  const videoCountRef = useRef(videoPosts.length);
  useEffect(() => { videoCountRef.current = videoPosts.length; }, [videoPosts.length]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 12 || Math.abs(g.dy) > 12,
      onPanResponderRelease: (_, g) => {
        if (g.dx > 70 && Math.abs(g.dx) > Math.abs(g.dy)) {
          closePlayer();
          return;
        }
        const atLast = activeIndexRef.current >= videoCountRef.current - 1;
        if (atLast && g.dy < -70 && Math.abs(g.dy) > Math.abs(g.dx)) {
          closePlayer();
        }
      },
    })
  ).current;

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { index: number | null }[] }) => {
      if (viewableItems[0]?.index != null) {
        activeIndexRef.current = viewableItems[0].index;
        setActiveIndex(viewableItems[0].index);
      }
    },
    []
  );

  const openComments = async (pid: string) => {
    setCommentSheetPostId(pid);
    const { data } = await supabase
      .from('comments')
      .select(COMMENT_WITH_AUTHOR)
      .eq('post_id', pid)
      .is('parent_id', null)
      .order('created_at', { ascending: true })
      .limit(20);
    setSheetComments((data ?? []) as Comment[]);
  };

  if (!videoPosts.length) {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={closePlayer} style={styles.backBtn}>
          <Ionicons name="close" size={26} color="#fff" />
        </TouchableOpacity>
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No video found</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="video-player-screen" {...panResponder.panHandlers}>
      <StatusBar hidden />
      <FlatList
        key={screenHeight}
        data={videoPosts}
        keyExtractor={item => item.id}
        renderItem={({ item, index }) => (
          <VideoItem
            post={item}
            isActive={index === activeIndex}
            isLiked={likedPostIds.has(item.id)}
            isSaved={savedPostIds.has(item.id)}
            onLike={() => void toggleLike(item.id)}
            onSave={() => void toggleSave(item.id)}
            onComment={() => void openComments(item.id)}
            onShare={() => void Share.share({ message: 'Check this video on Roxy!' })}
            styles={styles}
            colors={colors}
          />
        )}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        initialScrollIndex={activeIndexRef.current > 0 ? activeIndexRef.current : undefined}
        getItemLayout={(_, index) => ({
          length: screenHeight,
          offset: screenHeight * index,
          index,
        })}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 80 }}
        windowSize={3}
        initialNumToRender={1}
        onEndReached={() => {
          if (activeIndexRef.current >= videoPosts.length - 1) {
            // overscroll at end handled by pan; optional hint only
          }
        }}
      />
      <TouchableOpacity testID="video-back-btn" style={styles.backBtn} onPress={closePlayer} hitSlop={8}>
        <Ionicons name="close" size={26} color="#fff" />
      </TouchableOpacity>
      <CommentSheet
        visible={commentSheetPostId !== null}
        postId={commentSheetPostId ?? ''}
        comments={sheetComments}
        likedCommentIds={likedCommentIds}
        currentUserId={user?.id ?? ''}
        onClose={() => setCommentSheetPostId(null)}
        onCommentsChange={setSheetComments}
        onLikeComment={async (commentId) => {
          const wasLiked = likedCommentIds.has(commentId);
          setLikedCommentIds(s => {
            const next = new Set(s);
            if (wasLiked) next.delete(commentId); else next.add(commentId);
            return next;
          });
          if (wasLiked) {
            await supabase.from('comment_likes').delete()
              .eq('comment_id', commentId).eq('user_id', user?.id ?? '');
          } else {
            await supabase.from('comment_likes').insert({ comment_id: commentId });
          }
        }}
        onReply={() => {}}
      />
    </View>
  );
}

