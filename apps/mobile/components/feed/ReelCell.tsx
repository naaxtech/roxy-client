import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Share } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';
import { FeedVideoPlayer } from './FeedVideoPlayer';
import type { ReelRow } from '../../lib/reels';

interface ReelCellProps {
  post: ReelRow;
  /**
   * This cell's position in the list. Drives the decoder window ONLY — distance
   * from the active cell is inherently positional. It must never decide
   * playback: see `activeItemId`.
   */
  index: number;
  /** The active cell's position, for the same distance maths. */
  activeIndex: number;
  /**
   * The id of the item the pager is currently on.
   *
   * Playback keys on this rather than on `index === activeIndex`, because a bare
   * index carries no identity and no type. The pager is becoming mixed-media, so
   * an index match would cheerfully tell a photo, a poll or a game cell to start
   * playing; and an index is stale the moment a page is spliced in ahead of this
   * cell, which `ReelsFeed.load` does whenever a viewer arrives on a specific
   * video. An id survives both.
   */
  activeItemId: string | null;
  width: number;
  height: number;
  muted: boolean;
  liked: boolean;
  saved: boolean;
  /** Store-adjusted count, so a tap on the rail moves the number. */
  likeCount: number;
  /** OS "Reduce Motion": suppresses autoplay and the heart burst. */
  reducedMotion: boolean;
  onToggleMute: () => void;
  onLike: () => void;
  onSave: () => void;
  onOpenComments: () => void;
  onOpenAuthor: () => void;
  onOpenCommunity: () => void;
}

export function ReelCell({
  post, index, activeIndex, activeItemId, width, height,
  muted, liked, saved, likeCount, reducedMotion,
  onToggleMute, onLike, onSave, onOpenComments, onOpenAuthor, onOpenCommunity,
}: ReelCellProps) {
  const isActive = post.id === activeItemId;
  const isVideo = post.post_type === 'video';

  // Reduce Motion turns autoplay off: WCAG 2.2 SC 2.2.2 treats a clip running
  // past five seconds as moving content that needs a pause mechanism, and a
  // viewer who asked the OS for less motion has already answered that.
  const autoplay = !reducedMotion;
  // null = follow the mode's default; true/false = the viewer tapped.
  const [playOverride, setPlayOverride] = useState<boolean | null>(null);
  // Two independent conditions, both required: this cell is the one being
  // looked at, AND this cell is something that plays.
  const playing = isActive && isVideo && (playOverride ?? autoplay);

  // A cell scrolled away from is a cell whose pause was about the old clip;
  // recycled or returned to, it should behave like a fresh one.
  useEffect(() => {
    if (!isActive) setPlayOverride(null);
  }, [isActive]);

  const burst = useSharedValue(0);
  const burstStyle = useAnimatedStyle(() => ({
    opacity: burst.value,
    transform: [{ scale: 0.7 + burst.value * 0.45 }],
  }));

  const handleDoubleTap = useCallback(() => {
    // Instagram's contract: a double tap likes, and a second double tap does
    // not take it back. Unliking is the rail button's job.
    if (!liked) onLike();
    if (reducedMotion) return;
    burst.value = withSequence(
      withTiming(1, { duration: 160 }),
      withDelay(340, withTiming(0, { duration: 240 })),
    );
  }, [liked, onLike, reducedMotion, burst]);

  const togglePlay = useCallback(() => {
    setPlayOverride((prev) => !(prev ?? autoplay));
  }, [autoplay]);

  // runOnJS(true) keeps these callbacks off the UI thread so they can touch
  // React state and the Zustand store directly.
  // "when `true`, all the callbacks will be run on the JS thread instead of the
  // UI thread, regardless of whether they are worklets or not." The versioned
  // docs.swmansion.com path for 2.16.2 now 404s, so this cites the tag.
  // src: https://github.com/software-mansion/react-native-gesture-handler/blob/2.16.2/src/handlers/gestures/gesture.ts · react-native-gesture-handler 2.16.2 · 2026-08-05
  const tapGesture = useMemo(() => {
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDelay(260)
      .runOnJS(true)
      .onEnd((_event, success) => { if (success) handleDoubleTap(); });
    const singleTap = Gesture.Tap()
      .numberOfTaps(1)
      .runOnJS(true)
      .onEnd((_event, success) => { if (success) togglePlay(); });
    // Exclusive, not Race: the single tap must wait for the double tap to fail,
    // or every like also pauses the video.
    return Gesture.Exclusive(doubleTap, singleTap);
  }, [handleDoubleTap, togglePlay]);

  const handleShare = useCallback(() => {
    // Every other Share.share in this app sends a bare sentence with nothing to
    // open. createURL resolves to the app's own scheme, so the link actually
    // lands on this video.
    // The versioned docs.expo.dev/versions/v51.0.0/** paths now 404; cite the
    // tagged source instead, which is what actually ships.
    // src: https://github.com/expo/expo/blob/sdk-51/packages/expo-linking/src/createURL.ts · expo-linking 6.3.1 · 2026-08-05
    const url = Linking.createURL(`/community/video/${post.id}`);
    const who = post.profiles?.display_name;
    // Android's share sheet reads `message` only, iOS prefers `url` — so the
    // link goes in both or half the platforms share nothing.
    void Share.share({
      message: who ? `${who} posted this on Roxy — ${url}` : `Check this out on Roxy — ${url}`,
      url,
    }).catch(() => { /* viewer dismissed the sheet */ });
  }, [post.id, post.profiles?.display_name]);

  const authorName = post.profiles?.display_name ?? '';

  return (
    <View style={[s.page, { width, height }]}>
      <FeedVideoPlayer
        videoUrl={post.video_url}
        posterUrl={post.video_thumbnail_url}
        postId={post.id}
        isActive={playing}
        isMuted={muted}
        index={index}
        activeIndex={activeIndex}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Transparent catcher: sits over the video and under every control, so
          the rail buttons keep their own touches. */}
      <GestureDetector gesture={tapGesture}>
        <View style={StyleSheet.absoluteFill} collapsable={false} />
      </GestureDetector>

      {/* Keeps white text legible over a bright frame. */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.65)']}
        start={{ x: 0.5, y: 0.45 }}
        end={{ x: 0.5, y: 1 }}
        style={s.veil}
        pointerEvents="none"
      />

      <Animated.View style={[s.burst, burstStyle]} pointerEvents="none">
        <Ionicons name="heart" size={110} color="rgba(255,255,255,0.92)" />
      </Animated.View>

      {isVideo && isActive && !playing ? (
        <View
          style={s.pausedGlyph}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Ionicons name="play" size={64} color="rgba(255,255,255,0.85)" />
        </View>
      ) : null}

      <TouchableOpacity
        style={s.muteBtn}
        onPress={onToggleMute}
        accessibilityRole="button"
        accessibilityLabel={muted ? 'Unmute video' : 'Mute video'}
        accessibilityState={{ selected: !muted }}
        hitSlop={8}
      >
        <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={18} color="#fff" />
      </TouchableOpacity>

      <View style={s.rail}>
        {/* The pause mechanism WCAG 2.2 SC 2.2.2 requires. Tap-anywhere does the
            same thing but is invisible to a screen reader. It belongs to the
            video subsystem, so it follows `isVideo` — its label says "video",
            and announcing that over a still would be a lie to a screen reader. */}
        {isVideo ? (
          <TouchableOpacity
            style={s.railBtn}
            onPress={togglePlay}
            accessibilityRole="button"
            accessibilityLabel={playing ? 'Pause video' : 'Play video'}
            hitSlop={6}
          >
            <Ionicons name={playing ? 'pause' : 'play'} size={26} color="#fff" />
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={s.railBtn}
          onPress={onLike}
          accessibilityRole="button"
          accessibilityLabel={
            liked ? `Unlike video, ${likeCount} likes` : `Like video, ${likeCount} likes`
          }
          accessibilityState={{ selected: liked }}
          hitSlop={6}
        >
          <Ionicons
            name={liked ? 'heart' : 'heart-outline'}
            size={30}
            color={liked ? '#E81C8E' : '#fff'}
          />
          <Text style={s.railCount}>{likeCount}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={s.railBtn}
          onPress={onOpenComments}
          accessibilityRole="button"
          accessibilityLabel={`View comments, ${post.comment_count} comments`}
          hitSlop={6}
        >
          <Ionicons name="chatbubble-outline" size={27} color="#fff" />
          <Text style={s.railCount}>{post.comment_count}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={s.railBtn}
          onPress={handleShare}
          accessibilityRole="button"
          accessibilityLabel="Share video"
          hitSlop={6}
        >
          <Ionicons name="arrow-redo-outline" size={27} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity
          style={s.railBtn}
          onPress={onSave}
          accessibilityRole="button"
          accessibilityLabel={saved ? 'Remove video from saved' : 'Save video'}
          accessibilityState={{ selected: saved }}
          hitSlop={6}
        >
          <Ionicons
            name={saved ? 'bookmark' : 'bookmark-outline'}
            size={26}
            color={saved ? '#FFB020' : '#fff'}
          />
        </TouchableOpacity>
      </View>

      <View style={s.overlay} pointerEvents="box-none">
        <TouchableOpacity
          onPress={onOpenCommunity}
          accessibilityRole="button"
          accessibilityLabel={`Open ${post.communities?.name ?? 'community'}`}
        >
          <Text style={s.community}>{post.communities?.name ?? 'Roxy'}</Text>
        </TouchableOpacity>
        {authorName ? (
          <TouchableOpacity
            onPress={onOpenAuthor}
            accessibilityRole="button"
            accessibilityLabel={`Open ${authorName}'s profile`}
          >
            <Text style={s.author}>{authorName}</Text>
          </TouchableOpacity>
        ) : null}
        {post.content ? (
          <Text style={s.caption} numberOfLines={3}>{post.content}</Text>
        ) : null}
      </View>
    </View>
  );
}

// Static: the reel surface is white-on-video everywhere, so it never reads the
// theme, and rebuilding this per cell would allocate on every swipe.
const s = StyleSheet.create({
  page: { backgroundColor: '#000' },
  veil: { ...StyleSheet.absoluteFillObject },
  burst: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pausedGlyph: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: 18, paddingBottom: 34, gap: 8,
    paddingRight: 76,
  },
  community: { color: 'rgba(255,255,255,0.9)', fontWeight: '800', fontSize: 13 },
  author: { color: 'rgba(255,255,255,0.75)', fontSize: 12 },
  caption: { color: '#fff', fontSize: 14.5, lineHeight: 20 },
  rail: {
    position: 'absolute', right: 12, bottom: 110, gap: 20, alignItems: 'center',
  },
  railBtn: { alignItems: 'center', gap: 3 },
  railCount: { color: '#fff', fontSize: 11, fontWeight: '700' },
  muteBtn: {
    position: 'absolute', top: 16, right: 14,
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
});
