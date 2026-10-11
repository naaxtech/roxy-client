import { useCallback, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Modal, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../hooks/useThemeColors';
import { FRAME_MAX_WIDTH } from '../../hooks/useAppWidth';
import { RADII, inkOn } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { a11yState } from '../../lib/a11yState';
import { deleteMyComment, reportComment } from '../../lib/comments';
import type { CommentRemoval } from '../../lib/comments';
import { useSafetyStore } from '../../store/safetyStore';
import { REPORT_DETAIL_MAX, REPORT_REASONS } from './feedSafety';
import type { ReportReason } from './feedSafety';
import type { Comment } from '../../types';

type Step = 'menu' | 'report' | 'block' | 'delete' | 'done';

export interface CommentActionsSheetProps {
  /** The comment that was long-pressed (or whose ⋯ was tapped). `null` closes. */
  comment: Comment | null;
  currentUserId: string;
  /** The host can drop a deleted comment from its list. Default true. */
  canDelete?: boolean;
  onClose: () => void;
  /** Her own comment went: drop it, or blank it in place when it has replies. */
  onRemoved: (commentId: string, outcome: CommentRemoval) => void;
}

/**
 * Report, mute, block — or delete, when it is hers — for one comment.
 *
 * Comments are where harassment lands, and until this a comment offered only
 * Like and Reply: nothing could be reported (prod reports = 0), and a woman
 * could not take back her own words. Same shape as the post sheet
 * (`FeedSafetySheet`): reporting asks what happened, blocking is confirmed,
 * muting is quiet and undone in Settings → Blocked & muted, deleting is
 * confirmed. Every outcome is announced for screen readers.
 *
 * Block and mute go through `safetyStore`, so every thread hides that author
 * at once (`CommentThread` filters on the store) — no host has to remember.
 */
export function CommentActionsSheet({
  comment, currentUserId, canDelete = true, onClose, onRemoved,
}: CommentActionsSheetProps): ReactElement | null {
  const colors = useThemeColors();
  const blockUser = useSafetyStore((s) => s.blockUser);
  const muteUser = useSafetyStore((s) => s.muteUser);
  const [step, setStep] = useState<Step>('menu');
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [outcome, setOutcome] = useState('');

  // One sheet serves every row; forget the last comment like a fresh mount.
  const commentId = comment?.id ?? null;
  const last = useRef<string | null>(commentId);
  if (last.current !== commentId) {
    last.current = commentId;
    setStep('menu'); setReason(null); setDetail('');
    setBusy(false); setFailed(null); setOutcome('');
  }

  const announce = useCallback((message: string) => {
    setOutcome(message);
    setStep('done');
    AccessibilityInfo.announceForAccessibility(message);
  }, []);

  const name = comment?.profiles?.display_name ?? '';
  const isMine = !!comment && !!currentUserId && comment.author_id === currentUserId;

  const run = useCallback(async (work: () => Promise<void>, failure: string) => {
    if (busy) return;
    setBusy(true);
    setFailed(null);
    try {
      await work();
    } catch {
      setFailed(failure);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  if (!comment) return null;

  const sendReport = () => run(async () => {
    if (!reason) return;
    await reportComment({ commentId: comment.id, authorId: comment.author_id, reason, detail });
    announce("Report sent. Roxy's team will look at this comment. She is not told who reported it.");
  }, 'That report did not send. Check your connection and try again.');

  const confirmBlock = () => run(async () => {
    await blockUser(comment.author_id);
    announce(`Blocked ${name || 'her'}. You will not see each other here.`);
  }, 'She was not blocked. Check your connection and try again.');

  const mute = () => run(async () => {
    await muteUser(comment.author_id);
    announce(`Muted ${name || 'her'}. You won't see her posts or comments. She is not told. Undo any time in Settings → Blocked & muted.`);
  }, 'She was not muted. Check your connection and try again.');

  const confirmDelete = () => run(async () => {
    const result = await deleteMyComment(comment.id);
    onRemoved(comment.id, result);
    AccessibilityInfo.announceForAccessibility('Your comment was deleted.');
    onClose();
  }, 'Your comment was not deleted. Check your connection and try again.');

  const s = StyleSheet.create({
    root: { flex: 1, justifyContent: 'flex-end' },
    scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: RADII.sheet, borderTopRightRadius: RADII.sheet,
      paddingTop: 10, paddingHorizontal: 18, paddingBottom: 30, maxHeight: '82%',
      width: '100%', maxWidth: FRAME_MAX_WIDTH, alignSelf: 'center',
    },
    grabber: {
      width: 40, height: 4, borderRadius: 2, alignSelf: 'center',
      backgroundColor: colors.textMuted, marginBottom: 12,
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
    title: { color: colors.textPrimary, fontSize: 17, fontWeight: '800' },
    close: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, marginRight: -12, alignItems: 'center', justifyContent: 'center' },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, minHeight: MIN_TOUCH_TARGET,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.surface,
    },
    rowLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
    rowHint: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
    danger: { color: colors.error },
    reason: {
      flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, minHeight: MIN_TOUCH_TARGET,
    },
    reasonText: { color: colors.textPrimary, fontSize: 15 },
    input: {
      backgroundColor: colors.surface, borderRadius: RADII.sm, color: colors.textPrimary,
      padding: 12, minHeight: 72, textAlignVertical: 'top', marginTop: 8,
    },
    body: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 14 },
    primary: {
      backgroundColor: colors.primary, borderRadius: RADII.pill, minHeight: MIN_TOUCH_TARGET,
      alignItems: 'center', justifyContent: 'center', marginTop: 14,
    },
    primaryText: { color: inkOn(colors.primary), fontWeight: '800', fontSize: 15 },
    primaryOff: { opacity: 0.5 },
    secondary: { minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
    secondaryText: { color: colors.textSecondary, fontWeight: '700' },
    error: { color: colors.error, fontSize: 13, marginBottom: 8 },
    done: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
    doneText: { color: colors.textPrimary, fontSize: 14, lineHeight: 20, flex: 1 },
  });

  const title = step === 'report' ? 'What happened?'
    : step === 'block' ? `Block ${name || 'her'}?`
      : step === 'delete' ? 'Delete your comment?'
        : step === 'done' ? 'Done'
          : isMine ? 'Your comment' : 'This comment';

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} accessibilityViewIsModal>
      <View style={s.root}>
        <TouchableOpacity
          testID="comment-actions-scrim"
          style={s.scrim}
          activeOpacity={1}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close comment options"
        />
        <View testID="comment-actions-sheet" style={s.sheet}>
          <View style={s.grabber} />
          <View style={s.header}>
            <Text style={s.title}>{title}</Text>
            <TouchableOpacity
              testID="comment-actions-close"
              style={s.close}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close comment options"
            >
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {failed ? (
            <Text testID="comment-actions-error" style={s.error} accessibilityLiveRegion="assertive">{failed}</Text>
          ) : null}

          {step === 'menu' && isMine && !canDelete ? (
            <Text style={s.body}>This is your comment. Open the post to delete it.</Text>
          ) : null}

          {step === 'menu' && isMine && canDelete ? (
            <TouchableOpacity
              testID="comment-action-delete"
              style={s.row}
              onPress={() => { setFailed(null); setStep('delete'); }}
              accessibilityRole="button"
              accessibilityLabel="Delete your comment"
            >
              <Ionicons name="trash-outline" size={21} color={colors.error} />
              <View style={{ flex: 1 }}>
                <Text style={[s.rowLabel, s.danger]}>Delete</Text>
                <Text style={s.rowHint}>Replies from others stay; your words go.</Text>
              </View>
            </TouchableOpacity>
          ) : null}

          {step === 'menu' && !isMine ? (
            <View>
              <MenuRow
                testID="comment-action-report" icon="flag-outline" label="Report"
                hint="Roxy's team reviews it. She is not told who reported."
                a11y="Report this comment" colors={colors} s={s}
                onPress={() => { setFailed(null); setStep('report'); }}
              />
              <MenuRow
                testID="comment-action-mute" icon="volume-mute-outline" label={name ? `Mute ${name}` : 'Mute'}
                hint="Quietly stop seeing her posts and comments."
                a11y={name ? `Mute ${name}` : 'Mute this author'} colors={colors} s={s}
                onPress={() => { void mute(); }}
              />
              <MenuRow
                testID="comment-action-block" icon="ban-outline" label={name ? `Block ${name}` : 'Block'}
                hint="Neither of you will see the other here."
                a11y={name ? `Block ${name}` : 'Block this author'} colors={colors} s={s}
                onPress={() => { setFailed(null); setStep('block'); }}
              />
            </View>
          ) : null}

          {step === 'report' ? (
            <ScrollView keyboardShouldPersistTaps="handled">
              <View accessibilityRole="radiogroup">
                {REPORT_REASONS.map((o) => (
                  <TouchableOpacity
                    key={o.key}
                    testID={`comment-reason-${o.key}`}
                    style={s.reason}
                    onPress={() => setReason(o.key)}
                    accessibilityRole="radio"
                    accessibilityLabel={o.label}
                    {...a11yState({ checked: reason === o.key })}
                  >
                    <Ionicons
                      name={reason === o.key ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={reason === o.key ? colors.primary : colors.textMuted}
                    />
                    <Text style={s.reasonText}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                testID="comment-report-detail"
                style={s.input}
                value={detail}
                onChangeText={setDetail}
                maxLength={REPORT_DETAIL_MAX}
                multiline
                placeholder="Anything else we should know? (optional)"
                placeholderTextColor={colors.textMuted}
                accessibilityLabel="More about what happened, optional"
              />
              <TouchableOpacity
                testID="comment-report-submit"
                style={[s.primary, (!reason || busy) && s.primaryOff]}
                disabled={!reason || busy}
                onPress={() => { void sendReport(); }}
                accessibilityRole="button"
                accessibilityLabel="Send report"
                {...a11yState({ disabled: !reason || busy, busy })}
              >
                {busy ? <ActivityIndicator color={inkOn(colors.primary)} /> : <Text style={s.primaryText}>Send report</Text>}
              </TouchableOpacity>
            </ScrollView>
          ) : null}

          {step === 'block' || step === 'delete' ? (
            <View>
              <Text style={s.body}>
                {step === 'block'
                  ? 'You will not see each other’s posts, comments or profiles. She is not told.'
                  : 'This cannot be undone. If others replied, their replies stay under “This comment was removed.”'}
              </Text>
              <TouchableOpacity
                testID={step === 'block' ? 'comment-block-confirm' : 'comment-delete-confirm'}
                style={[s.primary, busy && s.primaryOff]}
                disabled={busy}
                onPress={() => { void (step === 'block' ? confirmBlock() : confirmDelete()); }}
                accessibilityRole="button"
                accessibilityLabel={step === 'block' ? `Block ${name || 'her'}` : 'Delete comment'}
                {...a11yState({ busy })}
              >
                {busy
                  ? <ActivityIndicator color={inkOn(colors.primary)} />
                  : <Text style={s.primaryText}>{step === 'block' ? 'Block' : 'Delete'}</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                testID="comment-actions-cancel"
                style={s.secondary}
                onPress={() => { setFailed(null); setStep('menu'); }}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={s.secondaryText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {step === 'done' ? (
            <View>
              <View testID="comment-actions-done" style={s.done} accessibilityLiveRegion="polite">
                <Ionicons name="checkmark-circle" size={20} color={colors.roxy} />
                <Text style={s.doneText}>{outcome}</Text>
              </View>
              <TouchableOpacity
                testID="comment-actions-done-close"
                style={s.primary}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Back to the comments"
              >
                <Text style={s.primaryText}>Back to the comments</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

type IconName = 'flag-outline' | 'ban-outline' | 'volume-mute-outline';

function MenuRow({
  testID, icon, label, hint, a11y, onPress, colors, s,
}: {
  testID: string; icon: IconName; label: string; hint: string; a11y: string;
  onPress: () => void;
  colors: ReturnType<typeof useThemeColors>;
  s: { row: object; rowLabel: object; rowHint: object };
}): ReactElement {
  return (
    <TouchableOpacity
      testID={testID}
      style={s.row}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint={hint}
    >
      <Ionicons name={icon} size={21} color={colors.textPrimary} />
      <View style={{ flex: 1 }}>
        <Text style={s.rowLabel}>{label}</Text>
        <Text style={s.rowHint}>{hint}</Text>
      </View>
      <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
    </TouchableOpacity>
  );
}
