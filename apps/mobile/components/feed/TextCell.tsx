import type { ReactElement } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { TEXT_CARD_READ_MORE } from '../../lib/textCard';
import { FeedCellChrome } from './FeedCellChrome';
import type { FeedBodyCellProps } from './FeedCellChrome';
import { TextCardFace } from './TextCardFace';

/** A text post: Claude Design's p3 card, full-bleed on the plum ramp. */
export function TextCell({
  post, width, height, onOpenPost, ...chrome
}: FeedBodyCellProps): ReactElement {
  const body = post.content.trim();
  const overflow = body.length > TEXT_CARD_READ_MORE;

  return (
    <View testID="text-cell" style={[s.page, { width, height }]}>
      {body ? (
        <View style={[s.face, { paddingBottom: Math.round(height * 0.26) }]}>
          <TextCardFace
            content={body}
            size="page"
            testIDPrefix="text-cell"
            maxWidth={width - 60}
          />
        </View>
      ) : (
        <View testID="text-cell-empty-wrap" style={s.emptyWrap}>
          <Text testID="text-cell-empty" style={s.empty}>
            This post has no words yet
          </Text>
        </View>
      )}

      {overflow ? (
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
  page: { backgroundColor: '#0D0520' },
  face: { flex: 1 },
  emptyWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  empty: { color: 'rgba(255,249,251,0.7)', fontSize: 20, textAlign: 'left' },
  more: {
    position: 'absolute',
    left: 30,
    bottom: Math.round(MIN_TOUCH_TARGET * 3.2),
    minHeight: MIN_TOUCH_TARGET, minWidth: MIN_TOUCH_TARGET,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 18, borderRadius: MIN_TOUCH_TARGET / 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
    zIndex: 4,
  },
  moreText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
