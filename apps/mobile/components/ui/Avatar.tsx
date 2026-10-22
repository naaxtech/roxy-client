import React, { useState } from 'react';
import { Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { avatarGradient, isPresetAvatar, presetColor, presetEmoji } from '../../lib/avatars';
import { inkOnGradient } from '../../lib/theme';
import { CROSS_DISSOLVE_MS } from '../../lib/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';

/**
 * Photo URLs this session has already painted. A photo seen before comes back
 * with no fade (it is in expo-image's memory cache), so a recycled row never
 * flashes; capped so a long session does not grow it without bound.
 */
const painted = new Set<string>();
const PAINTED_MAX = 600;
function markPainted(uri: string) {
  if (painted.size >= PAINTED_MAX) painted.clear();
  painted.add(uri);
}

/** "Maya Lin" -> "ML", "maya" -> "M", "" -> "?". Letters only, never emoji halves. */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const first = (w: string | undefined) => (w ? Array.from(w)[0] ?? '' : '');
  const letters = words.length >= 2 ? first(words[0]) + first(words[words.length - 1]) : first(words[0]);
  return letters.toUpperCase() || '?';
}

export interface AvatarProps {
  /** `avatar_url`: a photo URL, an `avatar://<emoji>` preset, or nothing. */
  uri?: string | null;
  /** Her display name — the initials, and the gradient's seed. */
  name?: string | null;
  /** A stable seed for the gradient when the name can change (her id). Defaults to the name. */
  seed?: string | null;
  size?: number;
  /** `square` for communities. */
  shape?: 'round' | 'square';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * One avatar for every surface.
 *
 * A photo when she has one; her preset emoji when she picked one; otherwise
 * her initials on a gradient from the theme's tokens (lib/avatars
 * AVATAR_GRADS), with ink chosen by `inkOnGradient` so the letters clear
 * contrast on every stop. 19 of 23 members have no photo: the fallback is
 * what most of the app looks like, so it is worth being warm rather than a
 * grey circle with a letter. A photo that fails to load falls back too.
 *
 * Image defaults (Wave 3, F15; motion spec §3.1 row 16): frame 1 shows her
 * identity colour (the gradient's first stop) under the photo, never a blank
 * circle; a first-time photo cross-dissolves in over `CROSS_DISSOLVE_MS`;
 * one already painted this session, or any under Reduce Motion, has no
 * fade. `recyclingKey` + the memory cache keep recycled rows from showing
 * the previous member's face.
 */
export function Avatar({
  uri, name, seed, size = 40, shape = 'round', style, testID = 'avatar',
}: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const reducedMotion = useReducedMotion();
  const radius = shape === 'round' ? size / 2 : Math.round(size * 0.28);
  const box: ViewStyle = {
    width: size, height: size, borderRadius: radius, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  };

  if (uri && isPresetAvatar(uri)) {
    return (
      <View style={[box, { backgroundColor: presetColor(uri) }, style]} testID={`${testID}-preset`}>
        <Text style={{ fontSize: size * 0.5 }}>{presetEmoji(uri)}</Text>
      </View>
    );
  }

  const stops = avatarGradient(seed ?? name);

  if (uri && !failed) {
    return (
      <ExpoImage
        source={{ uri }}
        style={[box, { backgroundColor: stops[0] }, style] as never}
        contentFit="cover"
        recyclingKey={uri}
        cachePolicy="memory-disk"
        transition={reducedMotion || painted.has(uri) ? 0 : CROSS_DISSOLVE_MS}
        onLoad={() => markPainted(uri)}
        onError={() => setFailed(true)}
        testID={`${testID}-photo`}
        accessibilityIgnoresInvertColors
      />
    );
  }

  return (
    <LinearGradient
      colors={stops}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[box, style]}
      testID={`${testID}-initials`}
    >
      <Text
        style={{ color: inkOnGradient(stops), fontSize: Math.max(10, size * 0.38), fontWeight: '800' }}
        allowFontScaling={false}
      >
        {initialsOf(name)}
      </Text>
    </LinearGradient>
  );
}
