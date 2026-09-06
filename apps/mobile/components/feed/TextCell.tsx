import type { ReactElement } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import {
  TEXT_CARD_MAX_LINES,
  TEXT_CARD_MAX_MEASURE,
  TEXT_CARD_READ_MORE,
  textCardScale,
} from '../../lib/textCard';
import { FeedCellChrome } from './FeedCellChrome';
import type { FeedBodyCellProps } from './FeedCellChrome';
import { BRAND_GRADIENT, BRAND_VEIL, CHROME_SHADOW } from './feedChromeTokens';

/** The brand gradient, held down to a legal contrast. See `feedChromeTokens`. */
const VEIL_STYLE = { ...StyleSheet.absoluteFillObject, backgroundColor: BRAND_VEIL } as const;

/** A text post: the "Notes" treatment, full-bleed on the brand gradient. */
export function TextCell({
  post, width, height, onOpenPost, ...chrome
}: FeedBodyCellProps): ReactElement {
  const body = post.content.trim();
  const step = textCardScale(body.length);

  return (
    <View testID="text-cell" style={[s.page, { width, height }]}>
      <LinearGradient
        testID="text-cell-gradient"
        colors={BRAND_GRADIENT}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View testID="text-cell-veil" style={VEIL_STYLE} pointerEvents="none" />

      <View
        style={[s.composition, { paddingBottom: Math.round(height * 0.26) }]}
        pointerEvents="box-none"
      >
        {body ? (
          <Text
            testID="text-cell-body"
            style={[s.body, step, { maxWidth: Math.min(width - 60, TEXT_CARD_MAX_MEASURE) }]}
            numberOfLines={TEXT_CARD_MAX_LINES}
          >
            {body}
          </Text>
        ) : (
          <Text testID="text-cell-empty" style={s.empty}>
            This post has no words yet
          </Text>
        )}

        <Text testID="text-cell-flower" style={s.flower} importantForAccessibility="no">
          ✿
        </Text>

        {body.length > TEXT_CARD_READ_MORE ? (
          <TouchableOpacity
            testID="text-cell-more"
            style={s.more}
            onPress={onOpenPost}
            accessibilityRole="button"
            accessibilityLabel="Read the full post"
          >
            <Text style={s.moreText}>Read more</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/*
        The caption is suppressed: the body already IS the words, and repeating
        them two lines further down in caption grey is what makes a text post
        look like a video that forgot its video. The identity block keeps the
        handle and the community line, so the cell still reads as one of the
        family.
      */}
      <FeedCellChrome post={post} showCaption={false} onOpenPost={onOpenPost} {...chrome} />
    </View>
  );
}

const s = StyleSheet.create({
  page: { backgroundColor: '#1a0a2e' },
  composition: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    paddingHorizontal: 30, paddingTop: 56, gap: 18,
  },
  body: { color: '#FFF8FB', textAlign: 'left', ...CHROME_SHADOW },
  empty: { color: 'rgba(255,249,251,0.7)', fontSize: 20, textAlign: 'left' },
  flower: { fontSize: 52, lineHeight: 52, color: 'rgba(255,249,251,0.16)' },
  more: {
    minHeight: MIN_TOUCH_TARGET, minWidth: MIN_TOUCH_TARGET,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 18, borderRadius: MIN_TOUCH_TARGET / 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
  },
  moreText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
