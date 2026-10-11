import React, { useState } from 'react';
import { Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { avatarGradient, isPresetAvatar, presetColor, presetEmoji } from '../../lib/avatars';
import { inkOnGradient } from '../../lib/theme';

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
 */
export function Avatar({
  uri, name, seed, size = 40, shape = 'round', style, testID = 'avatar',
}: AvatarProps) {
  const [failed, setFailed] = useState(false);
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

  if (uri && !failed) {
    return (
      <ExpoImage
        source={{ uri }}
        style={[box, style] as never}
        contentFit="cover"
        onError={() => setFailed(true)}
        testID={`${testID}-photo`}
        accessibilityIgnoresInvertColors
      />
    );
  }

  const stops = avatarGradient(seed ?? name);
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
