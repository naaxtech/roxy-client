import { useState } from 'react';
import { View, Text, Modal, Pressable, TextInput, StyleSheet } from 'react-native';
import { useSafetyStore } from '../../store/safetyStore';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { a11yState } from '../../lib/a11yState';
import { logError } from '../../lib/errorLogger';

type Reason = 'harassment' | 'spam' | 'inappropriate' | 'hate_speech' | 'other';

const REASONS: { key: Reason; label: string }[] = [
  { key: 'harassment', label: 'Harassment or threats' },
  { key: 'hate_speech', label: 'Hate speech' },
  { key: 'inappropriate', label: 'Inappropriate content' },
  { key: 'spam', label: 'Spam or scam' },
  { key: 'other', label: 'Something else' },
];

/**
 * The sheet a Report button opens.
 *
 * It did not exist. `safetyStore.openReportModal` set `isReportModalOpen` and
 * `reportTarget`, and nothing in the app read either — chat carries its own
 * local modal, which is why chat kept working and nobody noticed. So on a live
 * audio room and a five-minute video date with a stranger, Report was inert:
 * no sheet, no report, no error, right after the control announced itself as
 * "Report. Reports are anonymous — she is never told."
 *
 * Mounted once at the app root so every surface that calls `openReportModal`
 * gets it, rather than each screen remembering to render its own. Chat's local
 * modal is left alone: it works, and replacing a working safety path in the
 * same change that builds a missing one is how you end up with neither.
 *
 * It closes ONLY after the write succeeded. `submitReport` reads the
 * `{data, error}` envelope and throws on a refusal; closing regardless would be
 * the "Report submitted 💜 over nothing" bug this app has already shipped.
 */
export function ReportSheet() {
  const colors = useThemeColors();
  const open = useSafetyStore((s) => s.isReportModalOpen);
  const target = useSafetyStore((s) => s.reportTarget);
  const submitReport = useSafetyStore((s) => s.submitReport);
  const closeReportModal = useSafetyStore((s) => s.closeReportModal);

  const [reason, setReason] = useState<Reason | null>(null);
  const [detail, setDetail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => { setReason(null); setDetail(''); setError(null); setBusy(false); };

  const cancel = () => { reset(); closeReportModal(); };

  const send = async () => {
    if (!reason || busy) return;
    setBusy(true);
    setError(null);
    try {
      await submitReport(reason, detail.trim() || undefined);
      reset();
      closeReportModal();
    } catch (e) {
      logError(e, 'ReportSheet.submit');
      setBusy(false);
      setError('We could not file that report. Nothing was sent — please try again.');
    }
  };

  const s = StyleSheet.create({
    scrim: { flex: 1, backgroundColor: 'rgba(8,3,18,0.66)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: RADII.sheet,
      borderTopRightRadius: RADII.sheet,
      padding: 20, gap: 12,
    },
    title: { ...TYPE.title, color: colors.textPrimary },
    body: { ...TYPE.caption, color: colors.textSecondary },
    reason: {
      minHeight: MIN_TOUCH_TARGET, justifyContent: 'center',
      paddingHorizontal: 14, borderRadius: RADII.md,
      borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface,
    },
    reasonOn: { borderColor: colors.primary, backgroundColor: colors.surfaceLight },
    reasonText: { ...TYPE.body, color: colors.textPrimary },
    input: {
      ...TYPE.body, color: colors.textPrimary, backgroundColor: colors.surface,
      borderWidth: 1, borderColor: colors.line, borderRadius: RADII.md,
      padding: 12, minHeight: 80, textAlignVertical: 'top',
    },
    row: { flexDirection: 'row', gap: 10, marginTop: 4 },
    btn: {
      flex: 1, minHeight: MIN_TOUCH_TARGET, alignItems: 'center',
      justifyContent: 'center', borderRadius: RADII.pill,
    },
    cancel: { backgroundColor: colors.surfaceLight },
    submit: { backgroundColor: colors.primary },
    btnText: { ...TYPE.body, fontWeight: '800', color: colors.textPrimary },
    error: { ...TYPE.caption, color: colors.error, fontWeight: '700' },
  });

  if (!open || !target) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={cancel}>
      <View style={s.scrim}>
        <View style={s.sheet} testID="report-sheet">
          <Text style={s.title}>Report</Text>
          {/* The control that opened this already promised anonymity. Saying it
              again here is not repetition — it is the moment she decides. */}
          <Text style={s.body}>
            Reports are anonymous. She is never told who reported her, and a moderator
            sees where it happened.
          </Text>

          {REASONS.map((r) => (
            <Pressable key={r.key} onPress={() => setReason(r.key)} accessible={false}>
              <View
                style={[s.reason, reason === r.key && s.reasonOn]}
                testID={`report-reason-${r.key}`}
                accessibilityRole="radio"
                accessibilityLabel={r.label}
                {...a11yState({ checked: reason === r.key })}
              >
                <Text style={s.reasonText}>{r.label}</Text>
              </View>
            </Pressable>
          ))}

          <TextInput
            style={s.input}
            value={detail}
            onChangeText={setDetail}
            placeholder="Anything that would help a moderator (optional)"
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={1000}
            accessibilityLabel="More detail, optional"
            testID="report-detail"
          />

          {error ? <Text style={s.error} testID="report-error">{error}</Text> : null}

          <View style={s.row}>
            <Pressable onPress={cancel} accessible={false} style={{ flex: 1 }}>
              <View style={[s.btn, s.cancel]} testID="report-cancel" accessibilityRole="button" accessibilityLabel="Cancel">
                <Text style={s.btnText}>Cancel</Text>
              </View>
            </Pressable>
            <Pressable onPress={() => void send()} accessible={false} style={{ flex: 1 }}>
              <View
                style={[s.btn, s.submit]}
                testID="report-submit"
                accessibilityRole="button"
                accessibilityLabel="Send report"
                {...a11yState({ disabled: !reason, busy })}
              >
                <Text style={s.btnText}>{busy ? 'Sending…' : 'Send report'}</Text>
              </View>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
