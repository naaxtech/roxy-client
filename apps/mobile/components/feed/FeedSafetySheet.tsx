import { useCallback, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Modal, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FRAME_MAX_WIDTH } from '../../hooks/useAppWidth';
import { THEMES } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import type { ReelRow } from '../../lib/reels';
import { REPORT_DETAIL_MAX, REPORT_REASONS } from './feedSafety';
import type { ReportReason } from './feedSafety';

/** The feed's surfaces are the dark ones, whatever the app theme is. */
const DARK = THEMES.dark;

/** Which face of the sheet is showing. */
type Step = 'menu' | 'report' | 'block' | 'done';

export interface FeedSafetySheetProps {
  /** The post the `⋯` was tapped on. `null` closes the sheet. */
  post: ReelRow | null;
  onClose: () => void;
  /** Files the report. Must REJECT when the write did not land. */
  onReport: (reason: ReportReason, detail: string) => Promise<void>;
  /** Blocks the author. Must REJECT when the block did not land. */
  onBlock: () => Promise<void>;
  /** Drops the post from this viewer's feed. Synchronous and local. */
  onHide: () => void;
}

/**
 * Report, block, hide — the three negative actions the feed never had.
 *
 * ## Why these three and why they are separate
 *
 * "Not for me" and "this frightened me" are different sentences and must not
 * share a control. The low-stakes one is `FeedInterestCard`, offered
 * proactively in the feed; this sheet is for the sentence that costs something
 * to say, and it is reached deliberately from the `⋯`. Collapsing them would
 * either make every dismissal look like an accusation or bury the accusation
 * under a dismissal.
 *
 * Hiding is immediate and unconfirmed, because hiding is not an accusation and
 * nothing about it is hard to undo by scrolling. Blocking is confirmed, because
 * it severs a relationship in both directions. Reporting asks what happened,
 * because a report with no reason is a row a moderator cannot act on.
 *
 * ## What it writes
 *
 *  - Report → `reports`, via the `submit-report` edge function.
 *  - Block  → `friendships (status='blocked')`, via the `block_user` RPC that
 *             migration 085 added. Deliberately NOT a second blocks table: 008
 *             recorded friendships as the mechanism and 085 built the entry
 *             point, and a second store of who is blocked is a second store to
 *             get wrong.
 *  - Hide   → `seen_posts`, which both feed queries already exclude.
 *
 * Every outcome is announced, because a woman using a screen reader who has
 * just reported something needs to hear that it went, and a visual tick is not
 * an answer to that.
 */
export function FeedSafetySheet({
  post, onClose, onReport, onBlock, onHide,
}: FeedSafetySheetProps): ReactElement | null {
  const [step, setStep] = useState<Step>('menu');
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [outcome, setOutcome] = useState('');

  // A single sheet serves every cell, so it has to forget the last post the way
  // a freshly mounted one would — otherwise the next `⋯` opens on the previous
  // report's confirmation, or worse, on a half-filled form aimed at someone else.
  const postId = post?.id ?? null;
  const lastPostId = useRef<string | null>(postId);
  if (lastPostId.current !== postId) {
    lastPostId.current = postId;
    setStep('menu');
    setReason(null);
    setDetail('');
    setBusy(false);
    setFailed(null);
    setOutcome('');
  }

  const announce = useCallback((message: string) => {
    setOutcome(message);
    setStep('done');
    AccessibilityInfo.announceForAccessibility(message);
  }, []);

  const authorName = post?.profiles?.display_name ?? '';
  const communityName = post?.communities?.name ?? '';

  const submitReport = useCallback(async () => {
    if (busy || reason === null) return;
    setBusy(true);
    setFailed(null);
    try {
      // Trimmed here as well as in `reportPost`: what the sheet hands its
      // caller should already be what it means, not what the keyboard left.
      await onReport(reason, detail.trim());
      announce(`Report sent. Roxy's team will look at this post.`);
    } catch {
      setFailed('That report did not send. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }, [busy, reason, detail, onReport, announce]);

  const confirmBlock = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setFailed(null);
    try {
      await onBlock();
      announce(`Blocked ${authorName || 'this author'}. You will not see each other here.`);
    } catch {
      setFailed('She was not blocked. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }, [busy, onBlock, announce, authorName]);

  const hide = useCallback(() => {
    onHide();
    onClose();
  }, [onHide, onClose]);

  if (!post) return null;

  return (
    <Modal
      visible
      transparent
      // `none`, like every other sheet in this app: react-native's Modal
      // animation drives an Animated value on a timer, which in a test is an
      // unwrapped state update and in a list is work during a swipe.
      animationType="none"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={s.root}>
        <TouchableOpacity
          testID="safety-scrim"
          style={s.scrim}
          activeOpacity={1}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close safety options"
        />

        <View testID="safety-sheet" style={s.sheet}>
          <View style={s.grabber} />

          <View style={s.header}>
            <Text style={s.title}>
              {step === 'report' ? 'What happened?' : null}
              {step === 'block' ? `Block ${authorName || 'this author'}?` : null}
              {step === 'menu' ? 'This post' : null}
              {step === 'done' ? 'Done' : null}
            </Text>
            <TouchableOpacity
              testID="safety-close"
              style={s.close}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close safety options"
            >
              <Ionicons name="close" size={22} color={DARK.textMuted} />
            </TouchableOpacity>
          </View>

          {failed ? (
            <View testID="safety-error" style={s.error} accessibilityLiveRegion="assertive">
              <Ionicons name="alert-circle-outline" size={16} color="#fff" />
              <Text style={s.errorText}>{failed}</Text>
            </View>
          ) : null}

          {step === 'menu' ? (
            <View>
              <Row
                testID="safety-report"
                icon="flag-outline"
                label="Report post"
                hint="Tell Roxy's team something is wrong with this post"
                accessibilityLabel="Report this post"
                onPress={() => { setFailed(null); setStep('report'); }}
              />
              <Row
                testID="safety-block"
                icon="ban-outline"
                label={authorName ? `Block ${authorName}` : 'Block author'}
                hint="You will not see each other anywhere on Roxy"
                accessibilityLabel={authorName ? `Block ${authorName}` : 'Block this author'}
                onPress={() => { setFailed(null); setStep('block'); }}
              />
              <Row
                testID="safety-hide"
                icon="eye-off-outline"
                label="Hide from this community"
                hint="This post stops appearing in your feed"
                accessibilityLabel={
                  communityName
                    ? `Hide this post from ${communityName}`
                    : 'Hide this post from this community'
                }
                onPress={hide}
              />
            </View>
          ) : null}

          {step === 'report' ? (
            <ScrollView keyboardShouldPersistTaps="handled">
              <View testID="safety-reasons" accessibilityRole="radiogroup">
                {REPORT_REASONS.map((option) => {
                  const chosen = reason === option.key;
                  return (
                    <TouchableOpacity
                      key={option.key}
                      testID={`safety-reason-${option.key}`}
                      style={[s.reason, chosen && s.reasonChosen]}
                      onPress={() => setReason(option.key)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: chosen }}
                      accessibilityLabel={option.label}
                    >
                      <Text style={s.reasonText}>{option.label}</Text>
                      {chosen ? (
                        <Ionicons name="checkmark-circle" size={19} color={DARK.roxy} />
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TextInput
                testID="safety-report-detail"
                style={s.detail}
                value={detail}
                onChangeText={setDetail}
                placeholder="Anything else we should know? (optional)"
                placeholderTextColor={DARK.textMuted}
                multiline
                maxLength={REPORT_DETAIL_MAX}
                accessibilityLabel="More about what happened, optional"
              />

              <TouchableOpacity
                testID="safety-report-submit"
                style={[s.primary, (reason === null || busy) && s.primaryOff]}
                onPress={() => { void submitReport(); }}
                disabled={reason === null || busy}
                accessibilityRole="button"
                accessibilityLabel="Send report"
                accessibilityState={{ disabled: reason === null || busy, busy }}
              >
                {busy
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.primaryText}>Send report</Text>}
              </TouchableOpacity>
            </ScrollView>
          ) : null}

          {step === 'block' ? (
            <View>
              <Text style={s.body}>
                {authorName || 'She'} will not see your posts or reach you in chat, and you will
                not see hers. You can undo this in Settings.
              </Text>
              <TouchableOpacity
                testID="safety-block-confirm"
                style={[s.primary, s.danger, busy && s.primaryOff]}
                onPress={() => { void confirmBlock(); }}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={authorName ? `Block ${authorName}` : 'Block this author'}
                accessibilityState={{ disabled: busy, busy }}
              >
                {busy
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.primaryText}>Block</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                testID="safety-block-cancel"
                style={s.secondary}
                onPress={() => { setFailed(null); setStep('menu'); }}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Do not block"
              >
                <Text style={s.secondaryText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {step === 'done' ? (
            <View>
              <View
                testID="safety-done"
                style={s.done}
                accessibilityLiveRegion="polite"
                accessibilityRole="alert"
              >
                <Ionicons name="checkmark-circle" size={20} color={DARK.roxy} />
                <Text style={s.doneText}>{outcome}</Text>
              </View>
              <TouchableOpacity
                testID="safety-done-close"
                style={s.primary}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Back to the feed"
              >
                <Text style={s.primaryText}>Back to the feed</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

interface RowProps {
  testID: string;
  icon: 'flag-outline' | 'ban-outline' | 'eye-off-outline';
  label: string;
  hint: string;
  accessibilityLabel: string;
  onPress: () => void;
}

function Row({ testID, icon, label, hint, accessibilityLabel, onPress }: RowProps): ReactElement {
  return (
    <TouchableOpacity
      testID={testID}
      style={s.row}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={hint}
    >
      <Ionicons name={icon} size={21} color={DARK.textPrimary} />
      <View style={s.rowText}>
        <Text style={s.rowLabel}>{label}</Text>
        <Text style={s.rowHint}>{hint}</Text>
      </View>
      <Ionicons name="chevron-forward" size={17} color={DARK.textMuted} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: DARK.background,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 10, paddingHorizontal: 18, paddingBottom: 30,
    maxHeight: '82%',
    width: '100%', maxWidth: FRAME_MAX_WIDTH, alignSelf: 'center',
  },
  grabber: {
    width: 40, height: 4, borderRadius: 2, alignSelf: 'center',
    backgroundColor: DARK.textMuted, marginBottom: 12,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10,
  },
  title: { color: DARK.textPrimary, fontSize: 17, fontWeight: '800' },
  // The sheet has the room a feed cell does not, so the box is spent outright:
  // 48dp square around a 22dp glyph, minus the sheet's own right padding so it
  // sits flush with the edge rather than 12dp shy of it.
  close: {
    width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, marginRight: -12,
    alignItems: 'center', justifyContent: 'center',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: DARK.surface,
  },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { color: DARK.textPrimary, fontSize: 15.5, fontWeight: '700' },
  rowHint: { color: DARK.textSecondary, fontSize: 12.5 },
  body: { color: DARK.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 16 },
  reason: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 48, paddingHorizontal: 14, marginBottom: 8,
    borderRadius: 12, borderWidth: 1, borderColor: DARK.surface,
    backgroundColor: DARK.surface,
  },
  reasonChosen: { borderColor: DARK.roxy },
  reasonText: { color: DARK.textPrimary, fontSize: 15, flex: 1 },
  detail: {
    minHeight: 76, borderRadius: 12, padding: 12, marginTop: 4, marginBottom: 14,
    backgroundColor: DARK.surface, color: DARK.textPrimary, fontSize: 14,
    textAlignVertical: 'top',
  },
  primary: {
    minHeight: 50, borderRadius: 14, marginTop: 6,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: DARK.primary,
  },
  primaryOff: { opacity: 0.5 },
  danger: { backgroundColor: '#C62828' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  secondary: {
    minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  secondaryText: { color: DARK.textSecondary, fontSize: 15, fontWeight: '600' },
  error: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(198,40,40,0.92)',
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, marginBottom: 12,
  },
  errorText: { color: '#fff', fontSize: 13, flex: 1 },
  done: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 14,
  },
  doneText: { color: DARK.textPrimary, fontSize: 15, flex: 1, lineHeight: 21 },
});
