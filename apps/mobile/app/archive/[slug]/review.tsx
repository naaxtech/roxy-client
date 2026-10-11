import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ComposerShell } from '../../../components/archive/ComposerShell';
import {
  ComposerChoice, ComposerField, ComposerCheckbox, ComposerSubmit,
} from '../../../components/archive/ComposerField';
import { submitReview } from '../../../components/archive/composerActions';
import { useComposerEntry } from '../../../components/archive/useComposerEntry';
import { useMembership } from '../../../hooks/useMembership';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { TYPE } from '../../../lib/typography';
import { Analytics } from '../../../lib/analytics';

/**
 * Write a review. Copy is the prototype's `M.review`, verbatim.
 *
 * The no-spoilers box is not decoration and not a formality:
 * `archive_reviews.no_spoilers_ack` carries a CHECK that it is true, so an
 * unchecked submit is refused by Postgres with a 23514 she cannot read. Blocked
 * here instead, with the reason on the box.
 */
export default function WriteReviewScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const colors = useThemeColors();
  const membership = useMembership();
  const { entry, status } = useComposerEntry(slug);

  const [body, setBody] = useState('');
  // No default verdict. A review that says "skip it" must never go out under
  // her name as 👍 because she did not touch the toggle (ARC-04/05).
  const [recommend, setRecommend] = useState<boolean | null>(null);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => router.back();

  const s = StyleSheet.create({
    hint: { ...TYPE.micro, color: colors.textMuted },
    row: { flexDirection: 'row', gap: 8 },
  });

  const send = async () => {
    if (!entry || recommend === null) return;
    setBusy(true);
    setError(null);
    const res = await submitReview(entry.id, body.trim(), recommend, ack);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    Analytics.archiveReviewPublished(entry.slug);
    close();
  };

  const title = entry ? `“${entry.title}” · your review shows next to your score, with your name.`
    : 'Your review shows next to your score, with your name.';

  return (
    <ComposerShell
      title="Write a review"
      intro={title}
      footNote="Reviews are public and editable. Spoiler-free by policy."
      locked={!membership.canReview}
      onClose={close}
      error={error ?? (status === 'missing' ? 'That entry is no longer in the Archive.' : null)}
      testID="archive-write-review"
      footer={
        <ComposerSubmit
          label="Publish review"
          onPress={() => void send()}
          // Both gates, not one: an empty review is nothing to publish, and an
          // unacknowledged one is refused by the database anyway.
          disabled={body.trim().length === 0 || !ack || recommend === null || status !== 'ready'}
          busy={busy}
          testID="archive-review-submit"
        />
      }
    >
      <View style={s.row} accessibilityRole="radiogroup" accessibilityLabel="Would you recommend it?">
        <ComposerChoice
          label="👍 I'd recommend it"
          selected={recommend === true}
          onPress={() => setRecommend(true)}
          testID="archive-review-up"
        />
        <ComposerChoice
          label="👎 I wouldn't"
          selected={recommend === false}
          onPress={() => setRecommend(false)}
          testID="archive-review-down"
        />
      </View>

      <ComposerField
        label="Your review"
        value={body}
        onChangeText={setBody}
        placeholder="No spoilers about the ending — that’s the one Archive rule."
        multiline
        maxLength={4000}
        testID="archive-review-body"
      />

      <ComposerCheckbox
        label="I haven’t spoiled the ending. That’s the one Archive rule."
        checked={ack}
        onToggle={() => setAck((v) => !v)}
        testID="archive-review-ack"
      />
      <Text style={s.hint}>
        Your score stays a number. Your review carries your name.
      </Text>
    </ComposerShell>
  );
}
