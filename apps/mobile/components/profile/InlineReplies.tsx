import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, Image,
} from 'react-native';
import { TouchableOpacity } from '../ui/PressableScale';
import { Snackbar } from '../ui/Snackbar';
import { useProfileStore } from '../../store/profileStore';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII, inkOn } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { loadPostComments, submitComment, appendComment } from '../../lib/comments';
import { GifPicker } from '../chat/GifPicker';
import { Analytics } from '../../lib/analytics';
import { relativeWhen } from './ThoughtRow';
import type { Comment } from '../../types';
import { Skeleton, SkeletonGroup } from '../feedback';

interface Props {
  postId: string;
  currentUserId: string | null;
  /** Told when the count changes, so the row's reply tally stays honest. */
  onCountChange?: (count: number) => void;
  testID?: string;
}

const MAX_REPLY = 2000;

/** Id prefix of a reply drawn before the server has it (F10). */
const PENDING = 'pending:';
let pendingSeq = 0;

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
  const [showGif, setShowGif] = useState(false);
  // F10: a reply that the server refused. It has already left the thread;
  // this says why and offers Retry.
  const [failure, setFailure] = useState<{ message: string; retry: () => void } | null>(null);
  const selfName = useProfileStore((st) => st.profile?.display_name ?? null);
  const selfAvatar = useProfileStore((st) => st.profile?.avatar_url ?? null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const commentsRef = useRef(comments);
  commentsRef.current = comments;

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

  /**
   * Optimistic (motion spec F10): the reply is in the thread in the same
   * frame as the tap, as a provisional row, and the box empties. The
   * returned row replaces it. `submitComment` never throws; a refusal takes
   * the reply back out, puts her words back in the box (unless she is
   * already typing the next one) and offers Retry.
   */
  const post = (content: string, gifUrl?: string) => {
    if (!currentUserId) return;
    pendingSeq += 1;
    const provisional: Comment = {
      id: `${PENDING}${Date.now()}-${pendingSeq}`,
      post_id: postId,
      author_id: currentUserId,
      parent_id: null,
      content: content || null,
      media_url: null,
      gif_url: gifUrl ?? null,
      like_count: 0,
      deleted_at: null,
      created_at: new Date().toISOString(),
      profiles: { display_name: selfName ?? 'You', avatar_url: selfAvatar },
    };
    setFailure(null);
    setError(null);
    setComments((prev) => appendComment(prev, provisional));
    if (!gifUrl && draftRef.current.trim() === content) {
      draftRef.current = '';
      setDraft('');
    }
    const request = gifUrl
      ? submitComment({ postId, authorId: currentUserId, content: '', gifUrl })
      : submitComment({ postId, authorId: currentUserId, content });
    void request.then((res) => {
      if (res.error || !res.comment) {
        setComments((prev) => prev.filter((c) => c.id !== provisional.id));
        if (!gifUrl && !draftRef.current.trim()) setDraft(content);
        setFailure({
          message: res.error ?? (gifUrl ? 'That GIF did not send.' : 'That reply did not send.'),
          retry: () => post(content, gifUrl),
        });
        return;
      }
      // After the write, never before: firing first counts replies that never
      // landed, which is the same lie in the metrics as in the UI.
      Analytics.thoughtReplySent('profile');
      const savedRow: Comment = { ...res.comment, replies: [] };
      // Idempotent: applying it to a list that already holds the saved row
      // only drops the provisional one, so the tally below can never count
      // the reply twice, however React batched the update.
      const settle = (prev: Comment[]) => {
        if (prev.some((c) => c.id === savedRow.id)) return prev.filter((c) => c.id !== provisional.id);
        return prev.some((c) => c.id === provisional.id)
          ? prev.map((c) => (c.id === provisional.id ? savedRow : c))
          : appendComment(prev, savedRow);
      };
      setComments(settle);
      onCountChange?.(countAll(settle(commentsRef.current).filter((c) => !c.id.startsWith(PENDING))));
    });
  };

  const send = () => {
    const body = draft.trim();
    if (!body || !currentUserId) return;
    post(body);
  };

  const sendGif = (url: string) => post('', url);

  // Built once per theme, not on every keystroke (jank audit #8).
  const s = useMemo(() => StyleSheet.create({
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
    gif: { width: 160, height: 120, borderRadius: RADII.md, marginTop: 4 },
    gifBtn: {
      minHeight: MIN_TOUCH_TARGET, minWidth: MIN_TOUCH_TARGET,
      alignItems: 'center', justifyContent: 'center',
    },
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
    snackAnchor: { height: 0, zIndex: 1 },
  }), [colors]);

  const canSend = draft.trim().length > 0 && draft.trim().length <= MAX_REPLY && !!currentUserId;

  return (
    <View style={s.wrap} testID={testID}>
      {loading ? (
        // F8: two reply lines at their final size; F11: no spinner.
        <SkeletonGroup testID={`${testID}-loading`} accessibilityLabel="Loading replies" style={s.row}>
          <Skeleton width="30%" height={12} />
          <Skeleton width="80%" height={14} />
        </SkeletonGroup>
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
          {comment.gif_url || comment.media_url ? (
            <Image
              source={{ uri: (comment.gif_url ?? comment.media_url)! }}
              style={s.gif}
              resizeMode="cover"
            />
          ) : (
            <Text style={s.body}>{comment.content}</Text>
          )}
        </View>
      ))}

      <View style={s.snackAnchor} pointerEvents="box-none">
        <Snackbar
          visible={failure !== null}
          message={failure?.message ?? ''}
          actionLabel="Retry"
          onAction={() => failure?.retry()}
          onDismiss={() => setFailure(null)}
          testID={`${testID}-snackbar`}
        />
      </View>

      {currentUserId ? (
        <View style={s.composer}>
          <TouchableOpacity
            style={s.gifBtn}
            onPress={() => setShowGif(true)}
            accessibilityRole="button"
            accessibilityLabel="Reply with a GIF"
            testID={`${testID}-gif`}
          >
            <Ionicons name="image-outline" size={20} color={colors.textMuted} />
          </TouchableOpacity>
          <TextInput
            style={s.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Write a reply…"
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={MAX_REPLY}
            accessibilityLabel="Write a reply"
            testID={`${testID}-input`}
          />
          <TouchableOpacity
            style={[s.send, !canSend && s.sendOff]}
            onPress={send}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Send reply"
            accessibilityState={{ disabled: !canSend }}
            testID={`${testID}-send`}
          >
            <Text style={s.sendText}>Reply</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={s.note}>Sign in to reply.</Text>
      )}

      <GifPicker
        visible={showGif}
        onGifSelected={sendGif}
        onClose={() => setShowGif(false)}
      />

      {error ? <Text style={s.error} testID={`${testID}-error`}>{error}</Text> : null}
    </View>
  );
}

/** Top-level replies plus their nested ones — the number the row shows. */
export function countAll(comments: Comment[]): number {
  return comments.reduce((n, c) => n + 1 + (c.replies?.length ?? 0), 0);
}
