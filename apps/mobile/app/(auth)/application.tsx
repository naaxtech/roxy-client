import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  ScrollView, KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useThemeColors } from '../../hooks/useThemeColors';
import {
  useGateStore,
  JOIN_REASON_MIN,
  type Criterion,
  type SubmitFailure,
} from '../../store/gateStore';
import { showAlert } from '../../lib/confirm';
import { BRAND_GRADIENT, inkOn, inkOnGradient } from '../../lib/theme';
import { a11yState } from '../../lib/a11yState';

/** Both are awarded together by the KYC webhook, so they share one row in the UI. */
const KYC_KEYS = ['gov_id', 'kyc_liveness'];

/** What she reads once the server has her application (G-14). */
const SENT_COPY = "Usually within 48 hours. We'll email you and send a push.";

/**
 * Why "Send for review" was refused, in words she can act on. A dropped
 * connection is never blamed on her answers.
 */
function submitFailureCopy(
  reason: SubmitFailure,
  missing: string[] | undefined,
  criteria: Criterion[],
): string {
  switch (reason) {
    case 'join_reason_too_short':
      return `Your answer to "Why Roxy?" needs at least ${JOIN_REASON_MIN} characters, so your reviewer has something to go on.`;
    case 'missing_required': {
      const labels = (missing ?? [])
        .map((key) => criteria.find((c) => c.key === key)?.label ?? key);
      return labels.length > 0
        ? `Still needed before you can send it: ${labels.join(', ')}.`
        : 'A required answer is still missing.';
    }
    case 'already_decided':
      return 'A reviewer has already decided on your application. Check your status.';
    case 'no_application':
      return "We couldn't find your application. Try again in a moment.";
    default:
      return "We couldn't reach Roxy just now. Your answers are saved — try again in a moment.";
  }
}

export default function ApplicationScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const {
    application, criteria, metCriterionIds,
    loadingApplication, loadError, submitting,
    loadApplication, saveAnswer, saveLegalName, startVerification,
    grantVerificationConsent, submitForReview,
  } = useGateStore();
  const [consentTicked, setConsentTicked] = useState(false);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [startingKyc, setStartingKyc] = useState(false);
  // A saved answer shows "Added"; Change reopens it. The legal name is
  // correctable too now (130: save_applicant_legal_name replaces it while she
  // is pending), so the old session-only "being added to your score" state —
  // a workaround for a name that could be given exactly once — is gone.
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  // The store records ready_at too; this makes the sent state independent of
  // whether the application row was in memory when she pressed the button.
  const [justSent, setJustSent] = useState(false);

  useEffect(() => { void loadApplication(); }, [loadApplication]);

  // Both KYC criteria are satisfied by one vendor session, so the row is done
  // when every one of them is met — not when the first arrives.
  const kycCriteria = criteria.filter((c) => KYC_KEYS.includes(c.key));
  const kycDone = kycCriteria.length > 0 && kycCriteria.every((c) => metCriterionIds.has(c.id));
  const listed = criteria.filter((c) => !KYC_KEYS.includes(c.key));

  const missingRequired = criteria.filter((c) => c.is_required && !metCriterionIds.has(c.id));
  const sent = justSent || !!application?.ready_at;

  const handleSave = useCallback(async (criterion: Criterion) => {
    const value = (drafts[criterion.id] ?? '').trim();
    if (!value) return;
    setSavingKey(criterion.id);

    if (criterion.key === 'legal_name') {
      const outcome = await saveLegalName(value);
      setSavingKey(null);

      if (outcome === 'failed') {
        showAlert('Could not save', 'Please try again in a moment.');
        return;
      }
      setDrafts((d) => ({ ...d, [criterion.id]: '' }));
      setEditing((e) => ({ ...e, [criterion.id]: false }));

      // Only the pre-130 fallback (a database without the RPC, during a
      // rollout window) can still answer these two. Say what happened.
      if (outcome === 'saved_unscored') {
        showAlert('Name saved', 'Your reviewer can see it. There is nothing more for you to do here.');
      } else if (outcome === 'already_saved') {
        showAlert('Already on file', 'You gave us your name earlier, so there is nothing more to do here.');
      }
      return;
    }

    const ok = await saveAnswer(criterion.id, value);
    setSavingKey(null);
    if (!ok) {
      showAlert('Could not save', 'Please try again in a moment.');
      return;
    }
    setEditing((e) => ({ ...e, [criterion.id]: false }));
  }, [drafts, saveAnswer, saveLegalName]);

  const handleSubmit = useCallback(async () => {
    setSubmitError(null);
    const outcome = await submitForReview();
    if (outcome.ok) {
      setJustSent(true);
      return;
    }
    setSubmitError(submitFailureCopy(outcome.reason, outcome.missing, criteria));
  }, [submitForReview, criteria]);

  const handleVerify = useCallback(async () => {
    setStartingKyc(true);

    // Recorded before the vendor is contacted. Consent obtained after the
    // document has already been sent is not consent to send it.
    const consented = await grantVerificationConsent();
    if (!consented) {
      setStartingKyc(false);
      showAlert('Could not continue', 'We could not record your agreement. Please try again.');
      return;
    }

    const url = await startVerification();
    setStartingKyc(false);
    if (!url) {
      showAlert(
        'Not available yet',
        'Identity checks are paused while we finish a data-protection agreement with our verification partner. Everything else in your application still counts.',
      );
      return;
    }
    // Opened outside the app on purpose: the document and face scan are handled
    // entirely by our verification partner, and Roxy never sees either.
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      showAlert('Could not open', 'We could not open the verification page on this device.');
      return;
    }
    await Linking.openURL(url);
  }, [startVerification, grantVerificationConsent]);

  const roxyInk = inkOn(colors.roxy);
  const gradientInk = inkOnGradient(BRAND_GRADIENT);

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14, gap: 6 },
    title: { fontSize: 26, fontWeight: '800', color: colors.textPrimary },
    sub: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },

    card: {
      marginHorizontal: 20, marginTop: 12, borderRadius: 16,
      backgroundColor: colors.surface, padding: 14, gap: 8,
    },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    cardTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 15, flex: 1 },
    cardBody: { color: colors.textMuted, fontSize: 12.5, lineHeight: 18 },
    required: { color: colors.primaryInk, fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
    counter: { color: colors.textMuted, fontSize: 12 },

    input: {
      backgroundColor: colors.background, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 12,
      color: colors.textPrimary, fontSize: 15,
      borderWidth: 1, borderColor: colors.line,
    },
    textarea: { minHeight: 104, textAlignVertical: 'top' },
    saveBtn: {
      alignSelf: 'flex-start', minHeight: 44, borderRadius: 12,
      paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.roxy,
    },
    saveText: { color: roxyInk, fontWeight: '800', fontSize: 13 },
    doneRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    changeBtn: { marginLeft: 'auto', minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
    changeText: { color: colors.primaryInk, fontWeight: '700', fontSize: 13 },
    consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingVertical: 2 },
    consentText: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, flex: 1 },
    doneText: { color: colors.roxy, fontWeight: '700', fontSize: 13 },

    footer: { padding: 20, gap: 10 },
    cta: {
      minHeight: 52, borderRadius: 16,
      alignItems: 'center', justifyContent: 'center',
    },
    ctaText: { color: gradientInk, fontWeight: '800', fontSize: 16 },
    footnote: { color: colors.textMuted, fontSize: 12, textAlign: 'center', lineHeight: 18 },
    submitError: { color: colors.errorInk, fontSize: 13, textAlign: 'center', lineHeight: 19 },
    sentCard: {
      borderRadius: 18, padding: 18, gap: 8, alignItems: 'center',
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    },
    sentTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '800', textAlign: 'center' },
    sentBody: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
    secondaryBtn: {
      minHeight: 48, borderRadius: 14, alignSelf: 'stretch',
      alignItems: 'center', justifyContent: 'center', backgroundColor: colors.roxy,
    },
    centred: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
    errorText: { color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  });

  if (loadingApplication) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.centred}>
          <ActivityIndicator color={colors.roxy} />
          <Text style={s.errorText}>Loading your application…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadError || !application) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.centred}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
          <Text style={s.errorText}>
            {loadError ?? "We couldn't find an application for this account."}
          </Text>
          <TouchableOpacity
            onPress={() => void loadApplication()}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={[s.doneText, { fontSize: 15 }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const renderInput = (c: Criterion) => {
    const done = metCriterionIds.has(c.id);
    if (done && !editing[c.id]) {
      return (
        <View style={s.doneRow}>
          <Ionicons name="checkmark-circle" size={16} color={colors.roxy} />
          <Text style={s.doneText}>Added</Text>
          {application.status === 'pending' && (
            <TouchableOpacity
              style={s.changeBtn}
              onPress={() => setEditing((e) => ({ ...e, [c.id]: true }))}
              accessibilityRole="button"
              accessibilityLabel={`Change ${c.label}`}
            >
              <Text style={s.changeText}>Change</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }
    const isLong = c.kind === 'question';
    const draft = drafts[c.id] ?? '';
    const shortBy = c.key === 'join_reason' ? JOIN_REASON_MIN - draft.trim().length : 0;
    const disabled = savingKey === c.id || !draft.trim();
    return (
      <>
        <TextInput
          style={[s.input, isLong && s.textarea]}
          value={draft}
          onChangeText={(t) => setDrafts((d) => ({ ...d, [c.id]: t }))}
          placeholder={c.kind === 'question' ? 'Take your time…' : c.label}
          placeholderTextColor={colors.textMuted}
          multiline={isLong}
          maxLength={isLong ? 4000 : 200}
          accessibilityLabel={c.label}
          autoCapitalize={c.key === 'legal_name' ? 'words' : 'none'}
        />
        {c.key === 'join_reason' && draft.trim().length > 0 && shortBy > 0 && (
          <Text style={s.counter} accessibilityLiveRegion="polite">
            {shortBy} more characters to go
          </Text>
        )}
        <TouchableOpacity
          style={[s.saveBtn, disabled && { opacity: 0.5 }]}
          onPress={() => void handleSave(c)}
          disabled={disabled}
          accessibilityRole="button"
          {...a11yState({ disabled, busy: savingKey === c.id })}
          accessibilityLabel={`Save ${c.label}`}
        >
          {savingKey === c.id
            ? <ActivityIndicator color={roxyInk} size="small" />
            : <Text style={s.saveText}>Save</Text>}
        </TouchableOpacity>
      </>
    );
  };

  const submitDisabled = submitting || missingRequired.length > 0;

  return (
    <SafeAreaView style={s.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={s.header}>
            <Text style={s.title}>Your application</Text>
            <Text style={s.sub}>
              A real person from the community that invited you reads every one. The
              required answer takes about three minutes; anything else you add helps her
              say yes.
            </Text>
          </View>

          {kycCriteria.length > 0 && (
            <View style={s.card}>
              <View style={s.cardTop}>
                <Ionicons
                  name={kycDone ? 'shield-checkmark' : 'shield-outline'}
                  size={18}
                  color={kycDone ? colors.roxy : colors.textMuted}
                />
                <Text style={s.cardTitle}>Verify your identity</Text>
              </View>
              <Text style={s.cardBody}>
                Our verification partner checks your ID and a live selfie. Roxy never
                receives the photo or the scan — only whether it passed.
              </Text>
              {kycDone ? (
                <View style={s.doneRow}>
                  <Ionicons name="checkmark-circle" size={16} color={colors.roxy} />
                  <Text style={s.doneText}>Verified</Text>
                </View>
              ) : (
                <>
                  {/* Art. 9(2)(a): explicit, specific and recorded. A pre-ticked
                      box or a link buried in the terms is none of those. */}
                  <TouchableOpacity
                    style={s.consentRow}
                    onPress={() => setConsentTicked((v) => !v)}
                    accessibilityRole="checkbox"
                    {...a11yState({ checked: consentTicked })}
                    accessibilityLabel="I agree to the identity check"
                  >
                    <Ionicons
                      name={consentTicked ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={consentTicked ? colors.roxy : colors.textMuted}
                    />
                    <Text style={s.consentText}>
                      I agree to our verification partner checking my government ID and a live
                      selfie to confirm I am who I say I am. They keep the images; Roxy receives
                      only whether it passed. I can withdraw this at any time in Settings.
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.saveBtn, !consentTicked && { opacity: 0.5 }]}
                    onPress={() => void handleVerify()}
                    disabled={startingKyc || !consentTicked}
                    accessibilityRole="button"
                    {...a11yState({ disabled: startingKyc || !consentTicked, busy: startingKyc })}
                    accessibilityLabel="Start identity verification"
                  >
                    {startingKyc
                      ? <ActivityIndicator color={roxyInk} size="small" />
                      : <Text style={s.saveText}>Start verification</Text>}
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          {listed.map((c) => (
            <View key={c.id} style={s.card}>
              <View style={s.cardTop}>
                <Ionicons
                  name={metCriterionIds.has(c.id) ? 'checkmark-circle' : 'ellipse-outline'}
                  size={18}
                  color={metCriterionIds.has(c.id) ? colors.roxy : colors.textMuted}
                />
                <Text style={s.cardTitle}>{c.label}</Text>
                {c.is_required && <Text style={s.required}>REQUIRED</Text>}
              </View>
              {(c.prompt ?? c.description) && (
                <Text style={s.cardBody}>{c.prompt ?? c.description}</Text>
              )}
              {renderInput(c)}
            </View>
          ))}

          <View style={s.footer}>
            {sent ? (
              <View style={s.sentCard} testID="application-sent" accessibilityLiveRegion="polite">
                <Ionicons name="paper-plane" size={28} color={colors.roxy} />
                <Text style={s.sentTitle}>Sent for review</Text>
                <Text style={s.sentBody}>{SENT_COPY}</Text>
                <Text style={s.footnote}>
                  You can still add to it — your reviewer sees changes straight away.
                </Text>
                <TouchableOpacity
                  style={s.secondaryBtn}
                  onPress={() => router.replace('/(tabs)/feed')}
                  accessibilityRole="button"
                  accessibilityLabel="Back to Roxy"
                >
                  <Text style={[s.saveText, { fontSize: 15 }]}>Back to Roxy</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <TouchableOpacity
                  onPress={() => void handleSubmit()}
                  disabled={submitDisabled}
                  accessibilityRole="button"
                  {...a11yState({ disabled: submitDisabled, busy: submitting })}
                  accessibilityLabel="Send application for review"
                  testID="send-for-review"
                >
                  <LinearGradient
                    colors={BRAND_GRADIENT}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[s.cta, submitDisabled && { opacity: 0.5 }]}
                  >
                    {submitting
                      ? <ActivityIndicator color={gradientInk} />
                      : <Text style={s.ctaText}>Send for review</Text>}
                  </LinearGradient>
                </TouchableOpacity>
                {submitError && (
                  <Text style={s.submitError} testID="submit-error" accessibilityLiveRegion="polite">
                    {submitError}
                  </Text>
                )}
                <Text style={s.footnote}>
                  {missingRequired.length > 0
                    ? `Still needed: ${missingRequired.map((c) => c.label).join(', ')}`
                    : 'Nobody sees your application until you send it.'}
                </Text>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
