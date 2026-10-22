import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { RADII, identityFor, inkOn } from '../../lib/theme';
import { COVER_ASPECT, COVER_PADDING, COVER_TITLE, coverTitleStep } from './archiveTokens';

interface Props {
  /** Picks the identity field. The id, not the slug or title: a renamed entry keeps its colour. */
  entryId: string;
  title: string;
  /** The uploaded cover (M158 member suggestion, S041 queue, S039 staff edit). */
  coverUrl: string | null | undefined;
  /** Width in dp; the height follows at 2:3. */
  width: number;
  testID?: string;
}

/**
 * An Archive cover (design direction v2 › Screen notes › Archive).
 *
 * Covers are uploaded and shown as they are: 2:3, radius 8, nothing written
 * over them. An entry with no cover gets a DESIGNED type cover rather than a
 * placeholder: one identity field picked from the entry id, the title in
 * Geologica 800 at 18/20 at the bottom start, three lines at most, no icon.
 * That replaces every gradient fallback the Archive had (v0 painted each
 * entry's seeded CSS gradient, or a two-tone ramp); the brand gradient lives
 * on the wordmark only.
 *
 * The cover is decoration for assistive tech: every surface that shows one
 * (the row, the rail card, the entry hero) already announces the title, so a
 * screen reader would otherwise read it twice.
 */
export function ArchiveCover({ entryId, title, coverUrl, width, testID }: Props) {
  // A broken upload must fall back to the type cover, never leave a hole
  // where the poster was.
  const [failed, setFailed] = useState(false);
  const showImage = !!coverUrl && !failed;
  const field = identityFor(entryId);

  const s = StyleSheet.create({
    frame: {
      width,
      height: width * COVER_ASPECT,
      borderRadius: RADII.sm,
      overflow: 'hidden',
    },
    image: { width: '100%', height: '100%' },
    type: {
      flex: 1,
      backgroundColor: field,
      justifyContent: 'flex-end',
      alignItems: 'flex-start',
      padding: COVER_PADDING,
    },
    title: { ...COVER_TITLE, ...coverTitleStep(title, width), color: inkOn(field), textAlign: 'left' },
  });

  return (
    <View
      style={s.frame}
      testID={testID}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {showImage ? (
        <ExpoImage
          source={{ uri: coverUrl as string }}
          style={s.image}
          contentFit="cover"
          testID={testID ? `${testID}-image` : undefined}
          onError={() => setFailed(true)}
        />
      ) : (
        <View style={s.type} testID={testID ? `${testID}-type` : undefined}>
          <Text style={s.title} numberOfLines={3}>{title}</Text>
        </View>
      )}
    </View>
  );
}
