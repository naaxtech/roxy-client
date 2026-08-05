import type { ReactElement } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { TextStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { FeedCellChrome } from './FeedCellChrome';
import type { FeedBodyCellProps } from './FeedCellChrome';
import { BRAND_GRADIENT, BRAND_VEIL, CHROME_SHADOW } from './feedChromeTokens';

/**
 * The type IS the design, so the scale is set deliberately rather than inherited
 * from a caption.
 *
 * A text post arrives with no artwork and no motion — everything a viewer will
 * feel about it comes from how the words are set. So the size steps with the
 * length: a five-word post gets display scale and fills the page the way a
 * photo would, and an essay steps down until it fits without scrolling. Fixing
 * one size instead would make every short post look like a caption that lost
 * its video and every long one overflow.
 *
 * Tracking tightens as the size grows, which is the standard optical
 * correction — letter-spacing that reads as normal at 18px reads as loose at
 * 40px. Leading loosens as the size drops, for the same reason in reverse: a
 * display line wants 1.15, a paragraph wants 1.45.
 */
const SCALE: { max: number; style: TextStyle }[] = [
  { max: 40, style: { fontSize: 40, lineHeight: 46, fontWeight: '800', letterSpacing: -1 } },
  { max: 120, style: { fontSize: 31, lineHeight: 38, fontWeight: '800', letterSpacing: -0.6 } },
  { max: 280, style: { fontSize: 25, lineHeight: 33, fontWeight: '700', letterSpacing: -0.3 } },
  { max: Infinity, style: { fontSize: 18, lineHeight: 26, fontWeight: '600', letterSpacing: -0.1 } },
];

/** Past this, the page cannot hold the post and the detail screen takes over. */
const READ_MORE_CAP = 420;

/** Fourteen lines at the smallest step is the most a page can carry. */
const MAX_LINES = 14;

/**
 * Long enough for 40-odd characters a line at the middle steps, which is the
 * comfortable measure for display type — the 65-75 guidance is for body copy at
 * body size, and applying it here would produce lines nobody wants to read.
 */
const MAX_MEASURE = 460;

/** The brand gradient, held down to a legal contrast. See `feedChromeTokens`. */
const VEIL_STYLE = { ...StyleSheet.absoluteFillObject, backgroundColor: BRAND_VEIL } as const;

function scaleFor(length: number): TextStyle {
  return (SCALE.find((step) => length <= step.max) ?? SCALE[SCALE.length - 1]).style;
}

/** A text post: the "Notes" treatment, full-bleed on the brand gradient. */
export function TextCell({
  post, width, height, onOpenPost, ...chrome
}: FeedBodyCellProps): ReactElement {
  const body = post.content.trim();
  const step = scaleFor(body.length);

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
        {/* A written post announces itself with a mark rather than an emoji: one
            short rule, the same weight as the type it sits over. */}
        <View style={s.rule} />

        {body ? (
          <Text
            testID="text-cell-body"
            style={[s.body, step, { maxWidth: Math.min(width - 56, MAX_MEASURE) }]}
            numberOfLines={MAX_LINES}
          >
            {body}
          </Text>
        ) : (
          <Text testID="text-cell-empty" style={s.empty}>
            This post has no words yet
          </Text>
        )}

        {body.length > READ_MORE_CAP ? (
          <TouchableOpacity
            testID="text-cell-more"
            style={s.more}
            onPress={onOpenPost}
            accessibilityRole="button"
            accessibilityLabel="Read the full post"
            hitSlop={8}
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
      <FeedCellChrome post={post} showCaption={false} {...chrome} />
    </View>
  );
}

const s = StyleSheet.create({
  page: { backgroundColor: '#1a0a2e' },
  composition: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 28, paddingTop: 56, gap: 22,
  },
  rule: { width: 34, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.75)' },
  body: { color: '#fff', textAlign: 'center', ...CHROME_SHADOW },
  empty: { color: 'rgba(255,255,255,0.7)', fontSize: 20, textAlign: 'center' },
  more: {
    paddingVertical: 9, paddingHorizontal: 18, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
  },
  moreText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
