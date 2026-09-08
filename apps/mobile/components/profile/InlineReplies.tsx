import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII, inkOn } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { loadPostComments, submitComment, appendComment } from '../../lib/comments';
import { Analytics } from '../../lib/analytics';
import { relativeWhen } from './ThoughtRow';
import type { Comment } from '../../types';

interface Props {
  postId: string;
  currentUserId: string | null;
  /** Told when the count changes, so the row's reply tally stays honest. */
  onCountChange?: (count: number) => void;
  testID?: string;
}

const MAX_REPLY = 2000;

/**
 * Replies, opened in place.
 *
 * Tapping a post used to push a whole new screen. That is the wrong shape for a
 * one-line answer: she loses her scroll position, the thread she was reading,
 * and everything around it — and coming back means finding her place again. X
 * and Threads both expand in place for exactly this reason.
 *
 * The list and the composer are the same pieces the post's own page uses
 * (`lib/comments.ts`), so a reply written here and a reply written there are
 * the same row, written the same way. Nothing about the data model is duplicated
 * for this surface; only the container changed.
 */
export function InlineReplies({ postId, currentUserId, onCountChange, testID = 'inline-replies' }: Props) {
  const colors = useThemeColors();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await loadPostComments(postId, currentUserId);
    if (res.error) setError('Could not load the replies.');
    else {
      setComments(res.comments);
      setError(null);
    }
    setLoading(false);
  }, [postId, currentUserId]);

  useEffect(() => { void load(); }, [load]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending || !currentUserId) return;
    setSending(true);
    const res = await submitComment({ postId, authorId: currentUserId, content: body });
    setSending(false);

    // `submitComment` returns `{comment, error}` and never throws. Clearing the
    // box on anything other than a returned row would eat what she wrote.
    if (res.error || !res.comment) {
      setError(res.error ?? 'That reply did not send.');
      return;
    }
    // After the write, never before: firing first counts replies that never
    // landed, which is the same lie in the metrics as in the UI.
    Analytics.thoughtReplySent('profile');
    const next = appendComment(comments, res.comment);
    setComments(next);
    setDraft('');
    setError(null);
    onCountChange?.(countAll(next));
  };

  const s = StyleSheet.create({
    wrap: {
      marginTop: 4,
      marginLeft: 50,
      paddingLeft: 12,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: colors.line,
      gap: 10,
      paddingBottom: 6,
    },
    row: { gap: 2 },
    head: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
    name: { ...TYPE.micro, fontWeight: '800', color: colors.textPrimary },
    when: { ...TYPE.micro, color: colors.textMuted },
    body: { ...TYPE.caption, color: colors.textSecondary },
    composer: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
    input: {
      flex: 1,
      minHeight: MIN_TOUCH_TARGET,
      maxHeight: 110,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: RADII.md,
      paddingHorizontal: 12,
      paddingVertical: 9,
      ...TYPE.caption,
      color: colors.textPrimary,
    },
    send: {
      minHeight: MIN_TOUCH_TARGET,
      justifyContent: 'center',
      paddingHorizontal: 14,
      borderRadius: RADII.md,
      backgroundColor: colors.primary,
    },
    sendOff: { opacity: 0.45 },
    sendText: { ...TYPE.caption, fontWeight: '700', color: inkOn(colors.primary) },
    note: { ...TYPE.micro, color: colors.textMuted },
    error: { ...TYPE.micro, color: colors.errorInk },
  });

  const canSend = draft.trim().length > 0 && draft.trim().length <= MAX_REPLY
    && !sending && !!currentUserId;

  return (
    <View style={s.wrap} testID={testID}>
      {loading ? (
        <ActivityIndicator color={colors.primary} testID={`${testID}-loading`} />
      ) : null}

      {!loading && comments.length === 0 ? (
        <Text style={s.note} testID={`${testID}-empty`}>No replies yet. Say something.</Text>
      ) : null}

      {comments.map((comment) => (
        <View key={comment.id} style={s.row} testID={`${testID}-${comment.id}`}>
          <View style={s.head}>
            <Text style={s.name} numberOfLines={1}>
              {comment.profiles?.display_name ?? 'Someone who left'}
            </Text>
            <Text style={s.when}>{relativeWhen(comment.created_at)}</Text>
          </View>
          <Text style={s.body}>{comment.content}</Text>
        </View>
      ))}

      {currentUserId ? (
        <View style={s.composer}>
          <TextInput
            style={s.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Write a reply…"
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={MAX_REPLY}
            editable={!sending}
            accessibilityLabel="Write a reply"
            testID={`${testID}-input`}
          />
          <TouchableOpacity
            style={[s.send, !canSend && s.sendOff]}
            onPress={() => { void send(); }}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Send reply"
            accessibilityState={{ disabled: !canSend }}
            testID={`${testID}-send`}
          >
            {sending
              ? <ActivityIndicator color={inkOn(colors.primary)} />
              : <Text style={s.sendText}>Reply</Text>}
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={s.note}>Sign in to reply.</Text>
      )}

      {error ? <Text style={s.error} testID={`${testID}-error`}>{error}</Text> : null}
    </View>
  );
}

/** Top-level replies plus their nested ones — the number the row shows. */
export function countAll(comments: Comment[]): number {
  return comments.reduce((n, c) => n + 1 + (c.replies?.length ?? 0), 0);
}
