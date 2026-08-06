import type { ReactElement } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CHROME_SHADOW } from './feedChromeTokens';

export interface FeedInterestCardProps {
  /** Hide this post and keep it out of future pages. */
  onNotForMe: () => void;
  /** Keep the post, and stop asking about it. */
  onMoreOfThis: () => void;
  /** She would rather not say. Same as "more of this" minus the claim. */
  onDismiss: () => void;
}

/**
 * "Are you interested in this?" — the low-stakes way out, offered rather than
 * buried.
 *
 * Instagram renders this inline and dismissible instead of hiding the only
 * negative signal in an overflow menu, and plan §11 adopts it. Report and block
 * stay under the `⋯`, because "not for me" and "this frightened me" are
 * different sentences: a woman dismissing a dull post should not be walked
 * through a form that treats her as an accuser, and a woman who was frightened
 * should not have to answer "interested?" first.
 *
 * ## What each answer actually does, and what it does not
 *
 * "Not for me" writes `seen_posts` — the post is dropped from this page and
 * excluded from every future one, by the same filter both feed queries already
 * apply. That is durable and the copy is true.
 *
 * "More of this" keeps the post and stops the card asking again. It does NOT
 * promise a ranking change, and the copy does not claim one: there is no
 * durable per-viewer preference store in this schema. `compute_feed_score`
 * (045) ranks on public like/comment/save counts and recency, and the only
 * personalised input anywhere is `interest_overlap(post_tags, profiles.interests)`
 * in the announcement feed (073) — which reads her PUBLIC stated interests, so
 * quietly appending a post's tags to them on a tap would publish "she is
 * interested in #survivors" on her profile. On this product that is an outing
 * risk, not a ranking tweak. A `post_feedback (user_id, post_id, signal)` table
 * with `TO authenticated` RLS is the honest home for it, and it is a schema
 * slice of its own.
 *
 * It renders inside the scrim's band (see `FeedCellChrome`), so its own backing
 * grows with it and the chrome's contrast guarantee covers it unchanged.
 */
export function FeedInterestCard({
  onNotForMe, onMoreOfThis, onDismiss,
}: FeedInterestCardProps): ReactElement {
  return (
    <View
      testID="interest-card"
      style={s.card}
      accessibilityRole="none"
      accessibilityLabel="Are you interested in this?"
    >
      <View style={s.head}>
        <Text testID="interest-card-question" style={[s.question, CHROME_SHADOW]}>
          Are you interested in this?
        </Text>
        <TouchableOpacity
          testID="interest-close"
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss this question"
          hitSlop={10}
        >
          <Ionicons name="close" size={16} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={s.answers}>
        <TouchableOpacity
          testID="interest-not-for-me"
          style={s.answer}
          onPress={onNotForMe}
          accessibilityRole="button"
          accessibilityLabel="Not for me. Hide this post and show fewer like it"
        >
          <Ionicons name="thumbs-down-outline" size={15} color="#fff" />
          <Text style={s.answerText}>Not for me</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="interest-more-of-this"
          style={s.answer}
          onPress={onMoreOfThis}
          accessibilityRole="button"
          accessibilityLabel="More of this. Keep this post in your feed"
        >
          <Ionicons name="thumbs-up-outline" size={15} color="#fff" />
          <Text style={s.answerText}>More of this</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // Sits on the scrim's band rather than on the media, so it needs separation
  // from the band rather than contrast against an unknown photo.
  card: {
    marginHorizontal: 18, marginBottom: 12,
    padding: 12, gap: 10, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  question: { color: '#fff', fontSize: 13.5, fontWeight: '700', flex: 1 },
  answers: { flexDirection: 'row', gap: 8 },
  answer: {
    flex: 1, minHeight: 38, borderRadius: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  answerText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
