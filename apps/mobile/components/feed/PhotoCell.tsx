import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { getPostImageUrl } from '../../lib/media';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { FeedCellChrome } from './FeedCellChrome';
import type { FeedBodyCellProps } from './FeedCellChrome';

type SlideStatus = 'loading' | 'ready' | 'error';

/**
 * A still, full-bleed, with the same chrome as everything else in the pager.
 *
 * A multi-image post gets a horizontal pager inside the vertical one. The two
 * do not fight because this one is direction-locked and nested-scroll enabled,
 * so a mostly-vertical drag never gets captured here. `pagingEnabled` is safe on
 * a plain `ScrollView` — the bug that bans it on the feed is specific to
 * flash-list 1.6.4 on Android, where it and `snapToInterval` are both set.
 * src: https://github.com/Shopify/flash-list/issues/1200 · 2026-08-05
 */
export function PhotoCell({
  post, width, height, onOpenPost, ...chrome
}: FeedBodyCellProps): ReactElement {
  const urls = post.media_urls ?? [];
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<Record<number, SlideStatus>>({});

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!(width > 0)) return;
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    setIndex((prev) => (prev === next ? prev : next));
  }, [width]);

  const mark = useCallback((slide: number, next: SlideStatus) => {
    setStatus((prev) => (prev[slide] === next ? prev : { ...prev, [slide]: next }));
  }, []);

  const active = status[index] ?? 'loading';

  return (
    <View testID="photo-cell" style={[s.page, { width, height }]}>
      {urls.length === 0 ? (
        // A post whose media never made it is still a post. Say so, rather than
        // paging the viewer onto a black rectangle she cannot explain.
        <View testID="photo-cell-unavailable" style={s.state}>
          <Ionicons name="image-outline" size={40} color="rgba(255,255,255,0.6)" />
          <Text style={s.stateText}>This photo is unavailable</Text>
        </View>
      ) : (
        <ScrollView
          testID="photo-cell-pager"
          horizontal
          pagingEnabled
          // Without both of these the horizontal pager steals near-vertical
          // drags from the feed and the whole page stops scrolling.
          nestedScrollEnabled
          directionalLockEnabled
          showsHorizontalScrollIndicator={false}
          scrollEnabled={urls.length > 1}
          scrollEventThrottle={16}
          onScroll={handleScroll}
          accessibilityLabel={`Photo ${index + 1} of ${urls.length}`}
          style={{ width, height }}
        >
          {urls.map((path, i) => (
            <Image
              key={`${post.id}:${i}`}
              testID={`photo-cell-image-${i}`}
              source={{ uri: getPostImageUrl(path, 'detail') }}
              placeholder={post.blurhash ?? undefined}
              contentFit="cover"
              // "Changing this prop resets the image view content to blank or a
              // placeholder before loading and rendering the final image. This
              // is especially useful for any kinds of recycling views like
              // FlashList to prevent showing the previous source before the new
              // one fully loads."
              // src: https://github.com/expo/expo/blob/sdk-51/packages/expo-image/src/Image.types.ts · expo-image 1.13.0 · 2026-08-05
              recyclingKey={`${post.id}:${i}`}
              onLoad={() => mark(i, 'ready')}
              onError={() => mark(i, 'error')}
              style={{ width, height }}
            />
          ))}
        </ScrollView>
      )}

      {urls.length > 0 && active === 'loading' ? (
        <View testID="photo-cell-loading" style={s.state} pointerEvents="none">
          <ActivityIndicator color="#fff" />
        </View>
      ) : null}

      {urls.length > 0 && active === 'error' ? (
        <View testID="photo-cell-error" style={s.state}>
          <Ionicons name="cloud-offline-outline" size={36} color="rgba(255,255,255,0.6)" />
          <Text style={s.stateText}>This photo could not be loaded</Text>
          {/* A dead image is not a dead post: the detail screen still has the
              words and the comments. */}
          <TouchableOpacity
            testID="photo-cell-error-open"
            onPress={onOpenPost}
            accessibilityRole="button"
            style={s.stateActionHit}
            accessibilityLabel="Open post"
          >
            <Text style={s.stateAction}>Open post</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {urls.length > 1 ? (
        <View testID="photo-cell-dots" style={s.dots} pointerEvents="none">
          {urls.map((path, i) => (
            <View
              key={`${path}-${i}`}
              testID={`photo-cell-dot-${i}`}
              // The active dot is wider as well as brighter: on a photo whose
              // colours are unknown, opacity alone is not a reliable signal.
              style={{
                height: 5,
                borderRadius: 3,
                width: i === index ? 16 : 5,
                backgroundColor: i === index ? '#fff' : 'rgba(255,255,255,0.5)',
              }}
            />
          ))}
        </View>
      ) : null}

      <FeedCellChrome post={post} {...chrome} />
    </View>
  );
}

const s = StyleSheet.create({
  page: { backgroundColor: '#000' },
  state: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32,
  },
  stateText: { color: 'rgba(255,255,255,0.75)', fontSize: 15, textAlign: 'center' },
  stateActionHit: {
    minHeight: MIN_TOUCH_TARGET, minWidth: MIN_TOUCH_TARGET,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16,
  },
  stateAction: { color: '#fff', fontSize: 15, fontWeight: '700' },
  dots: {
    position: 'absolute', left: 0, right: 0, bottom: 128,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5,
  },
});
