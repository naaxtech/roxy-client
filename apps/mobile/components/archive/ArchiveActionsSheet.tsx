import { useCallback, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Modal, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '../../hooks/useThemeColors';
import { FRAME_MAX_WIDTH } from '../../hooks/useAppWidth';
import { TYPE } from '../../lib/typography';
import { RADII, inkOn } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { deleteMyReview, reportArchiveContent } from '../../lib/archiveSafety';
import type { ArchiveReportReason } from '../../lib/archiveSafety';
import { supabase } from '../../lib/supabase';
import { logError } from '../../lib/errorLogger';
import { useSafetyStore } from '../../store/safetyStore';

export type ArchiveActionTarget =
  | { kind: 'review'; id: string; authorId: string; authorName: string; isMine: boolean }
  | { kind: 'entry'; id: string; reporterId: string }
  | { kind: 'note'; id: string; label: string };

type Step = 'menu' | 'block' | 'delete' | 'done';

interface Props {
  target: ArchiveActionTarget | null;
  onClose: () => void;
  /** Her review was deleted: drop it from the list. */
  onReviewDeleted?: (reviewId: string) => void;
  /** Edit her review (the composer prefills from her row). */
  onEditReview?: () => void;
  /** A note was flagged by her: the screen may hide it for her at once. */
  onNoteFlagged?: (noteId: string) => void;
  /**
   * The entry's more menu offers Suggest an edit (design direction v2 ›
   * Archive: "also in the entry's more menu"). Omit to hide the row.
   */
  onSuggestEdit?: () => void;
}

/**
 * Report, block, flag — the Archive's safety surface, which did not exist
 * (ARC-03): a spoiler or a slur in a review could not be reported, the Studio
 * Archive queue was always empty, and blocking a harasser left her named
 * reviews on every entry. One sheet for a review, the entry itself, and a
 * content note, so the three cannot drift apart in wording or behaviour.
 */
export function ArchiveActionsSheet({
  target, onClose, onReviewDeleted, onEditReview, onNoteFlagged, onSuggestEdit,
}: Props): ReactElement | null {
  const colors = useThemeColors();
  const blockUser = useSafetyStore((s) => s.blockUser);
  const [step, setStep] = useState<Step>('menu');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [outcome, setOutcome] = useState('');

  const key = target ? `${target.kind}:${target.id}` : null;
  const last = useRef<string | null>(key);
  if (last.current !== key) {
    last.current = key;
    setStep('menu'); setBusy(false); setFailed(null); setOutcome('');
  }

  const announce = useCallback((m: string) => {
    setOutcome(m);
    setStep('done');
    AccessibilityInfo.announceForAccessibility(m);
  }, []);

  if (!target) return null;

  const prefix = target.kind === 'review' ? 'archive-review-action'
    : target.kind === 'entry' ? 'archive-entry-action' : 'archive-note-action';

  const run = async (work: () => Promise<void>, failure: string) => {
    if (busy) return;
    setBusy(true);
    setFailed(null);
    try {
      await work();
    } catch (e) {
      logError(e, 'ArchiveActionsSheet');
      setFailed(failure);
    } finally {
      setBusy(false);
    }
  };

  const report = (reason: ArchiveReportReason) => run(async () => {
    if (target.kind === 'note') return;
    await reportArchiveContent({
      contentType: target.kind === 'review' ? 'archive_review' : 'archive_entry',
      contentId: target.id,
      // A wrong entry has no offender; reported_user_id is NOT NULL, so the
      // report names the reporter and the mod queue works from content_id.
      userId: target.kind === 'review' ? target.authorId : target.reporterId,
      reason,
    });
    announce("Report sent. A mod will look at it. Nobody is told who reported it.");
  }, 'That report did not send. Check your connection and try again.');

  const flagNote = (reason: 'spoiler' | 'wrong' | 'abuse') => run(async () => {
    if (target.kind !== 'note') return;
    const { error } = await supabase.from('archive_note_flags').insert({ note_id: target.id, reason });
    if (error && error.code !== '23505') throw error;
    onNoteFlagged?.(target.id);
    announce('Flagged. Three flags take a note down until a mod looks at it.');
  }, 'That flag did not send. Check your connection and try again.');

  const confirmBlock = () => run(async () => {
    if (target.kind !== 'review') return;
    await blockUser(target.authorId);
    announce(`Blocked ${target.authorName || 'her'}. Her reviews are gone from your Archive and you will not see each other here.`);
  }, 'She was not blocked. Check your connection and try again.');

  const confirmDelete = () => run(async () => {
    if (target.kind !== 'review') return;
    await deleteMyReview(target.id);
    onReviewDeleted?.(target.id);
    AccessibilityInfo.announceForAccessibility('Your review was deleted.');
    onClose();
  }, 'Your review was not deleted. Check your connection and try again.');

  const s = StyleSheet.create({
    root: { flex: 1, justifyContent: 'flex-end' },
    scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: RADII.sheet, borderTopRightRadius: RADII.sheet,
      paddingTop: 10, paddingHorizontal: 18, paddingBottom: 30,
      width: '100%', maxWidth: FRAME_MAX_WIDTH, alignSelf: 'center',
    },
    grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', backgroundColor: colors.textMuted, marginBottom: 12 },
    title: { ...TYPE.title, color: colors.textPrimary, marginBottom: 8 },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: MIN_TOUCH_TARGET, paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line,
    },
    rowText: { ...TYPE.bodyLg, color: colors.textPrimary, flex: 1 },
    danger: { color: colors.error },
    body: { ...TYPE.body, color: colors.textSecondary, marginBottom: 12 },
    primary: {
      minHeight: MIN_TOUCH_TARGET, borderRadius: RADII.pill, backgroundColor: colors.primary,
      alignItems: 'center', justifyContent: 'center', marginTop: 8,
    },
    primaryText: { ...TYPE.body, fontWeight: '800', color: inkOn(colors.primary) },
    secondary: { minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
    secondaryText: { ...TYPE.body, color: colors.textSecondary, fontWeight: '700' },
    error: { ...TYPE.caption, color: colors.error, marginBottom: 8 },
  });

  const row = (
    id: string, icon: keyof typeof Ionicons.glyphMap, label: string, onPress: () => void, danger = false,
  ) => (
    <Pressable key={id} onPress={busy ? undefined : onPress} accessible={false}>
      <View style={s.row} testID={id} accessibilityRole="button" accessibilityLabel={label}>
        <Ionicons name={icon} size={20} color={danger ? colors.error : colors.textPrimary} />
        <Text style={[s.rowText, danger && s.danger]}>{label}</Text>
        {busy ? <ActivityIndicator size="small" color={colors.primary} /> : null}
      </View>
    </Pressable>
  );

  const title = step === 'block' && target.kind === 'review' ? `Block ${target.authorName || 'her'}?`
    : step === 'delete' ? 'Delete your review?'
      : step === 'done' ? 'Done'
        : target.kind === 'review' ? (target.isMine ? 'Your review' : 'This review')
          : target.kind === 'entry' ? 'This entry' : `“${target.label}”`;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={s.root}>
        <Pressable style={s.scrim} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={s.sheet} testID={`${prefix}-sheet`}>
          <View style={s.grabber} />
          <Text style={s.title}>{title}</Text>
          {failed ? <Text style={s.error} testID={`${prefix}-error`} accessibilityLiveRegion="assertive">{failed}</Text> : null}

          {step === 'menu' && target.kind === 'review' && target.isMine ? (
            <View>
              {row(`${prefix}-edit`, 'create-outline', 'Edit your review', () => { onClose(); onEditReview?.(); })}
              {row(`${prefix}-delete`, 'trash-outline', 'Delete your review', () => setStep('delete'), true)}
            </View>
          ) : null}

          {step === 'menu' && target.kind === 'review' && !target.isMine ? (
            <View>
              {row(`${prefix}-spoiler`, 'eye-off-outline', 'Report a spoiler', () => { void report('archive_spoiler'); })}
              {row(`${prefix}-abuse`, 'flag-outline', 'Report abuse or harassment', () => { void report('archive_review_abuse'); })}
              {row(`${prefix}-block`, 'ban-outline', `Block ${target.authorName || 'her'}`, () => setStep('block'), true)}
            </View>
          ) : null}

          {step === 'menu' && target.kind === 'entry' ? (
            <View>
              {onSuggestEdit
                ? row('archive-entry-suggest-edit', 'create-outline', 'Suggest an edit', () => { onClose(); onSuggestEdit(); })
                : null}
              {row('archive-entry-report-wrong', 'alert-circle-outline', 'Report wrong details', () => { void report('archive_bad_entry'); })}
              {row('archive-entry-report-spoiler', 'eye-off-outline', 'Report a spoiler in the summary', () => { void report('archive_spoiler'); })}
            </View>
          ) : null}

          {step === 'menu' && target.kind === 'note' ? (
            <View>
              <Text style={s.body}>Notes describe what is in it — never how it ends. Flag one that does not.</Text>
              {row('archive-note-flag-spoiler', 'eye-off-outline', 'It spoils the ending', () => { void flagNote('spoiler'); })}
              {row('archive-note-flag-wrong', 'alert-circle-outline', 'It is not accurate', () => { void flagNote('wrong'); })}
              {row('archive-note-flag-abuse', 'flag-outline', 'It is hateful or abusive', () => { void flagNote('abuse'); })}
            </View>
          ) : null}

          {step === 'block' || step === 'delete' ? (
            <View>
              <Text style={s.body}>
                {step === 'block'
                  ? 'Her reviews disappear from your Archive and neither of you will see the other here. She is not told.'
                  : 'This cannot be undone. Your star rating stays.'}
              </Text>
              <Pressable onPress={busy ? undefined : () => { void (step === 'block' ? confirmBlock() : confirmDelete()); }} accessible={false}>
                <View style={s.primary} testID={`${prefix}-${step}-confirm`} accessibilityRole="button" accessibilityLabel={step === 'block' ? 'Block' : 'Delete'}>
                  {busy ? <ActivityIndicator color={inkOn(colors.primary)} /> : <Text style={s.primaryText}>{step === 'block' ? 'Block' : 'Delete'}</Text>}
                </View>
              </Pressable>
              <Pressable onPress={() => setStep('menu')} accessible={false}>
                <View style={s.secondary} accessibilityRole="button" accessibilityLabel="Cancel"><Text style={s.secondaryText}>Cancel</Text></View>
              </Pressable>
            </View>
          ) : null}

          {step === 'done' ? (
            <View>
              <Text style={s.body} testID={`${prefix}-done`} accessibilityLiveRegion="polite">{outcome}</Text>
              <Pressable onPress={onClose} accessible={false}>
                <View style={s.primary} accessibilityRole="button" accessibilityLabel="Done"><Text style={s.primaryText}>Done</Text></View>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
