import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { ReactElement, ReactNode } from 'react';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { avatarGradient } from '../../lib/avatars';
import { CHROME_SHADOW } from './feedChromeTokens';

/** Already past `MIN_TOUCH_TARGET`, which is why the crest needed no hit box. */
const SIZE = 50;
const ROTATION_MS = 9000;

interface CommunityCrestProps {
  /** The community this post is standing in. */
  name: string;
  /**
   * The community's own artwork when the caller has it. `communities` carries a
   * `cover_image_url`, but the feed's select fragment only embeds `name`, so
   * today this is null and the monogram below stands in — the same name-hashed
   * gradient the app already uses for identity everywhere else.
   */
  imageUrl?: string | null;
  /** Recycling identity for the artwork; normally the post id. */
  recyclingKey: string;
  /**
   * Whether this crest's cell is the one being looked at.
   *
   * Only the active cell's crest turns. Up to five cells are mounted either
   * side of the viewer at any moment, and five off-screen discs rotating
   * forever is five animations' worth of work nobody can see — on a list whose
   * whole job is to stay at 60fps through a swipe.
   */
  active: boolean;
  reducedMotion: boolean;
  onPress: () => void;
}

/**
 * Roxy's one deliberate divergence from TikTok, in TikTok's own slot.
 *
 * TikTok's bottom-right disc is the SOUND: how a video belongs to something
 * larger than its author. Roxy has no sounds, it has rooms — so the community
 * crest takes the disc's exact position and its slow rotation, and opens the
 * community instead of a sound page. Same place, same gesture, same muscle
 * memory; the one element that carries meaning is the one that is swapped.
 *
 * The rotation uses React Native's own `Animated` rather than Reanimated. Both
 * would work, but a looping transform is the textbook `useNativeDriver` case and
 * this keeps the crest renderable in any test that has not stood a Reanimated
 * mock up — which is most of them, since the burst animation is the only other
 * motion in a cell.
 */
export function CommunityCrest({
  name, imageUrl, recyclingKey, active, reducedMotion, onPress,
}: CommunityCrestProps): ReactElement {
  const spin = useRef(new Animated.Value(0)).current;
  const spinning = active && !reducedMotion;

  useEffect(() => {
    if (!spinning) return;
    spin.setValue(0);
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: ROTATION_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => { loop.stop(); };
  }, [spinning, spin]);

  const grad = avatarGradient(name);
  const initial = (name.trim()[0] ?? '?').toUpperCase();

  const face: ReactNode = (
    <LinearGradient colors={grad} style={s.face}>
      {imageUrl ? (
        <Image
          testID="community-crest-image"
          source={{ uri: imageUrl }}
          contentFit="cover"
          // A recycled cell would otherwise show the previous community's crest
          // until this one decodes.
          recyclingKey={recyclingKey}
          style={s.image}
        />
      ) : (
        <Text testID="community-crest-monogram" style={s.monogram}>{initial}</Text>
      )}
    </LinearGradient>
  );

  return (
    <TouchableOpacity
      testID="community-crest"
      style={s.hit}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${name}`}
      activeOpacity={0.8}
    >
      {/*
        Reduce Motion gets a crest that does not move at all, rather than a
        slower one. A disc that turns forever is precisely the "moving content
        that starts automatically and lasts more than five seconds" WCAG 2.2 SC
        2.2.2 asks for a mechanism to stop, and the OS setting IS the viewer
        already asking.
        src: https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html · WCAG 2.2 · 2026-08-06
      */}
      {!spinning ? (
        <View testID="community-crest-static" style={s.disc}>{face}</View>
      ) : (
        <Animated.View
          testID="community-crest-spinning"
          style={[s.disc, {
            transform: [{
              rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }),
            }],
          }]}
        >
          {face}
        </Animated.View>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  hit: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  disc: {
    width: SIZE, height: SIZE, borderRadius: SIZE / 2,
    // The ring is what separates the crest from an arbitrarily bright frame; it
    // does the same job for a graphic that CHROME_SHADOW does for a glyph.
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.55)',
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  face: {
    width: '100%', height: '100%',
    alignItems: 'center', justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  monogram: { color: '#fff', fontWeight: '800', fontSize: 20, ...CHROME_SHADOW },
});
