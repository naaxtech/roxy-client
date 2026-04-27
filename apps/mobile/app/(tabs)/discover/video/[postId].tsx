import React, { useCallback, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Dimensions, StatusBar, Share,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFeedStore } from '../../../../store/feedStore';
import { useAuthStore } from '../../../../store/authStore';
import { COLORS } from '../../../../lib/constants';
import { CommentSheet } from '../../../../components/feed/CommentSheet';
import type { Comment, Post } from '../../../../types';
import { supabase } from '../../../../lib/supabase';

// expo-av guarded import — crashes if not available
let AVModule: any = null;
try { AVModule = require('expo-av'); } catch {}
const isVideoAvailable = () => AVModule !== null;
const Video = isVideoAvailable() ? AVModule.Video : null;
const ResizeMode = isVideoAvailable() ? AVModule.ResizeMode : {};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

function VideoItem({
  post, isActive, onComment, isLiked, isSaved, onLike, onSave, onShare,
}: {
  post: Post; isActive: boolean;
  onComment: () => void;
  isLiked: boolean; isSaved: boolean;
  onLike: () => void; onSave: () => void; onShare: () => void;
}) {
  const videoRef = React.useRef<any>(null);
  const [muted, setMuted] = useState(false);

  React.useEffect(() => {
    if (!videoRef.current) return;
    if (isActive) {
      void videoRef.current.playAsync?.();
    } else {
      void videoRef.current.pauseAsync?.();
    }
  }, [isActive]);

  return (
    <View style={styles.videoItem}>
      {isVideoAvailable() && post.video_url && Video ? (
        <Video
          ref={videoRef}
          source={{ uri: post.video_url }}
          style={StyleSheet.absoluteFill}
          resizeMode={ResizeMode.CONTAIN ?? 'contain'}
          shouldPlay={isActive}
          isLooping
          isMuted={muted}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.videoUnavailable]}>
          <Text style={styles.videoUnavailableText}>Video unavailable</Text>
        </View>
      )}

      <TouchableOpacity
        style={styles.muteBtn}
        onPress={() => setMuted(m => !m)}
        hitSlop={8}
      >
        <Text style={styles.muteIcon}>{muted ? '🔇' : '🔊'}</Text>
      </TouchableOpacity>

      <View style={styles.overlay}>
        <Text style={styles.overlayAuthor}>@{post.profiles?.display_name ?? ''}</Text>
        {post.content ? (
          <Text style={styles.overlayCaption} numberOfLines={2}>{post.content}</Text>
        ) : null}
      </View>

      <View style={styles.rightRail}>
        <TouchableOpacity style={styles.railAction} onPress={onLike}>
          <Text style={[styles.railIcon, isLiked && styles.railIconActive]}>
            {isLiked ? '♥' : '♡'}
          </Text>
          <Text style={styles.railCount}>{post.like_count}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.railAction} onPress={onSave}>
          <Text style={[styles.railIcon, isSaved && styles.railIconActive]}>
            {isSaved ? '✦' : '✧'}
          </Text>
          <Text style={styles.railCount}>{post.save_count}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.railAction} onPress={onComment}>
          <Text style={styles.railIcon}>💬</Text>
          <Text style={styles.railCount}>{post.comment_count}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.railAction} onPress={onShare}>
          <Text style={styles.railIcon}>↗</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function VideoPlayerScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const { posts, videoQueue, likedPostIds, savedPostIds, toggleLike, toggleSave } = useFeedStore();

  const videoPosts = videoQueue
    .map(id => posts.find(p => p.id === id))
    .filter(Boolean) as Post[];

  const initialIndex = Math.max(0, videoPosts.findIndex(p => p.id === postId));
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [commentSheetPostId, setCommentSheetPostId] = useState<string | null>(null);
  const [sheetComments, setSheetComments] = useState<Comment[]>([]);
  const [likedCommentIds, setLikedCommentIds] = useState<Set<string>>(new Set());

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { index: number | null }[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index !== null) {
        setActiveIndex(viewableItems[0].index);
      }
    },
    []
  );

  const openComments = async (pid: string) => {
    setCommentSheetPostId(pid);
    const { data } = await supabase
      .from('comments')
      .select('*, profiles(display_name, avatar_url)')
      .eq('post_id', pid)
      .is('parent_id', null)
      .order('created_at', { ascending: true })
      .limit(20);
    setSheetComments((data ?? []) as Comment[]);
  };

  if (!videoPosts.length) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>×</Text>
        </TouchableOpacity>
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No video found</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      <FlatList
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
          />
        )}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        initialScrollIndex={initialIndex}
        getItemLayout={(_, index) => ({
          length: SCREEN_HEIGHT,
          offset: SCREEN_HEIGHT * index,
          index,
        })}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 80 }}
        windowSize={3}
        initialNumToRender={1}
      />

      <TouchableOpacity
        style={styles.backBtn}
        onPress={() => router.back()}
        hitSlop={8}
      >
        <Text style={styles.backText}>×</Text>
      </TouchableOpacity>

      <CommentSheet
        visible={commentSheetPostId !== null}
        postId={commentSheetPostId ?? ''}
        comments={sheetComments}
        likedCommentIds={likedCommentIds}
        currentUserId={user?.id ?? ''}
        onClose={() => setCommentSheetPostId(null)}
        onLikeComment={async (commentId) => {
          const wasLiked = likedCommentIds.has(commentId);
          setLikedCommentIds(s => {
            const next = new Set(s);
            if (wasLiked) { next.delete(commentId); } else { next.add(commentId); }
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  videoItem: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    backgroundColor: '#000',
  },
  videoUnavailable: {
    alignItems: 'center', justifyContent: 'center',
  },
  videoUnavailableText: { color: 'rgba(255,255,255,0.6)', fontSize: 16 },
  muteBtn: { position: 'absolute', top: 60, right: 16 },
  muteIcon: { fontSize: 24 },
  overlay: {
    position: 'absolute', bottom: 80, left: 16, right: 80,
  },
  overlayAuthor: { color: '#fff', fontWeight: '700', fontSize: 15, marginBottom: 4 },
  overlayCaption: { color: 'rgba(255,255,255,0.9)', fontSize: 13, lineHeight: 18 },
  rightRail: {
    position: 'absolute', right: 12, bottom: 100,
    alignItems: 'center', gap: 20,
  },
  railAction: { alignItems: 'center', gap: 2 },
  railIcon: { fontSize: 28, color: '#fff' },
  railIconActive: { color: COLORS.primary },
  railCount: { color: '#fff', fontSize: 12 },
  backBtn: { position: 'absolute', top: 48, left: 16, zIndex: 10 },
  backText: { color: '#fff', fontSize: 28, fontWeight: '300' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: COLORS.textMuted, fontSize: 16 },
});
