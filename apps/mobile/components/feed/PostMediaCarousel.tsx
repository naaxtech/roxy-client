import React, { useRef, useState } from 'react';
import {
  View, ScrollView, TouchableOpacity, StyleSheet, Platform, useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { getPostImageUrl } from '../../lib/media';
import { COLORS } from '../../lib/constants';

const FEED_HEIGHT = 300;
const DETAIL_HEIGHT = 400;

interface Props {
  urls: string[];
  blurhash?: string | null;
  variant: 'feed' | 'detail';
  onOpen?: () => void;
}

export function PostMediaCarousel({ urls, blurhash, variant, onOpen }: Props) {
  const { width: SLIDE_WIDTH } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const height = variant === 'detail' ? DETAIL_HEIGHT : FEED_HEIGHT;
  const multi = urls.length > 1;

  const go = (dir: -1 | 1) => {
    const next = Math.max(0, Math.min(urls.length - 1, index + dir));
    if (next === index) return;
    setIndex(next);
    scrollRef.current?.scrollTo({ x: next * SLIDE_WIDTH, animated: true });
  };

  return (
    <View style={[styles.wrap, { height }]}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        nestedScrollEnabled
        directionalLockEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.x / SLIDE_WIDTH);
          if (i !== index) setIndex(i);
        }}
      >
        {urls.map((path, i) => (
          <TouchableOpacity
            key={`${path}-${i}`}
            activeOpacity={onOpen ? 0.95 : 1}
            onPress={onOpen}
            style={{ width: SLIDE_WIDTH, height }}
          >
            <Image
              testID={i === 0 ? 'post-image' : undefined}
              source={{ uri: getPostImageUrl(path, variant === 'detail' ? 'detail' : 'feed') }}
              placeholder={blurhash ?? undefined}
              contentFit="cover"
              style={{ width: SLIDE_WIDTH, height }}
            />
          </TouchableOpacity>
        ))}
      </ScrollView>

      {multi && (
        <>
          {index > 0 && (
            <TouchableOpacity style={[styles.arrow, styles.arrowLeft]} onPress={() => go(-1)} hitSlop={12}>
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </TouchableOpacity>
          )}
          {index < urls.length - 1 && (
            <TouchableOpacity style={[styles.arrow, styles.arrowRight]} onPress={() => go(1)} hitSlop={12}>
              <Ionicons name="chevron-forward" size={22} color="#fff" />
            </TouchableOpacity>
          )}
          <View testID="gallery-dots" style={styles.dots}>
            {urls.map((_, i) => (
              <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', backgroundColor: COLORS.surface, overflow: 'hidden' },
  dots: {
    position: 'absolute', bottom: 10, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', gap: 4,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.45)' },
  dotActive: { backgroundColor: '#fff' },
  arrow: {
    position: 'absolute', top: '50%', marginTop: -20,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' as const } : {}),
  },
  arrowLeft: { left: 8 },
  arrowRight: { right: 8 },
});
