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
import { useGateStore, type Criterion } from '../../store/gateStore';
import { showAlert } from '../../lib/confirm';
import { BRAND_GRADIENT } from '../../lib/theme';
import { a11yState } from '../../lib/a11yState';

/** Both are awarded together by the KYC webhook, so they share one row in the UI. */
const KYC_KEYS = ['gov_id', 'kyc_liveness'];

export default function ApplicationScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const {
    application, criteria, metCriterionIds, score,
    loadingApplication, loadError,
    loadApplication, saveAnswer, saveLegalName, startVerification,
    grantVerificationConsent,
  } = useGateStore();
  const [consentTicked, setConsentTicked] = useState(false);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [startingKyc, setStartingKyc] = useState(false);
  // applicant_identity has no SELECT policy by design (migration 070: reads go
  // through a logging RPC), so nothing can ask the server whether her name is
  // already stored. Until mark_criterion_met ships and the tick arrives through
  // metCriterionIds instead, this is the only record we have that she supplied
  // it — deliberately session-scoped rather than guessed from anything.
  const [nameSubmitted, setNameSubmitted] = useState(false);

  useEffect(() => { void loadApplication(); }, [loadApplication]);

  // Both KYC criteria are satisfied by one vendor session, so the row is done
  // when every one of them is met — not when the first arrives.
  const kycCriteria = criteria.filter((c) => KYC_KEYS.includes(c.key));
  const kycDone = kycCriteria.length > 0 && kycCriteria.every((c) => metCriterionIds.has(c.id));
  const listed = criteria.filter((c) => !KYC_KEYS.includes(c.key));

  const missingRequired = criteria.filter((c) => c.is_required && !metCriterionIds.has(c.id));
  const maxScore = criteria.reduce((sum, c) => sum + c.points, 0);

  /**
   * The legal name has four outcomes rather than two (gateStore.LegalNameOutcome).
   * It goes into a table the applicant may insert into exactly once and can
   * never read back or correct, and the criterion that scores it needs a
   * privileged write the client cannot make. Collapsing that into "saved" or
   * "could not save" is what used to tell her the name had failed when it was
   * already stored — and then send her to retry into a primary key conflict.
   */
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

      // Every remaining outcome means her name is on file. Clear the box so it
      // cannot be submitted a second time into a conflict.
      setNameSubmitted(true);
      setDrafts((d) => ({ ...d, [criterion.id]: '' }));

      if (outcome === 'saved_unscored') {
        showAlert(
          'Name saved',
          "Your reviewer can see it. It hasn't been added to your score yet — that happens on our side, and there's nothing for you to do.",
        );
      } else if (outcome === 'already_saved') {
        showAlert(
          'Already on file',
          'You gave us your name earlier. It can only be entered once, so there is nothing more to do here.',
        );
      }
      return;
    }

    const ok = await saveAnswer(criterion.id, value);
    setSavingKey(null);
    if (!ok) showAlert('Could not save', 'Please try again in a moment.');
  }, [drafts, saveAnswer, saveLegalName]);

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
  }, [startVerification]);

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14, gap: 6 },
    title: { fontSize: 26, fontWeight: '800', color: colors.textPrimary },
    sub: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
    scoreCard: {
      marginHorizontal: 20, borderRadius: 18, padding: 16,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    },
    scoreLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '700', letterSpacing: 0.6 },
    scoreValue: { color: '#fff', fontSize: 28, fontWeight: '800' },
    scoreHint: { color: 'rgba(255,255,255,0.85)', fontSize: 12, maxWidth: 190, lineHeight: 17 },

    card: {
      marginHorizontal: 20, marginTop: 12, borderRadius: 16,
      backgroundColor: colors.surface, padding: 14, gap: 8,
    },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    cardTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 15, flex: 1 },
    points: { color: colors.roxy, fontWeight: '800', fontSize: 13 },
    cardBody: { color: colors.textMuted, fontSize: 12.5, lineHeight: 18 },
    required: { color: '#E5484D', fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },

    input: {
      backgroundColor: colors.background, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 12,
      color: colors.textPrimary, fontSize: 15,
      borderWidth: 1, borderColor: colors.textMuted + '30',
    },
    textarea: { minHeight: 104, textAlignVertical: 'top' },
    saveBtn: {
      alignSelf: 'flex-start', minHeight: 40, borderRadius: 12,
      paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.roxy,
    },
    saveText: { color: '#fff', fontWeight: '800', fontSize: 13 },
    doneRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingVertical: 2 },
    consentText: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, flex: 1 },
    doneText: { color: colors.roxy, fontWeight: '700', fontSize: 13 },
    pendingText: { color: colors.textMuted, fontWeight: '700', fontSize: 13, flex: 1 },

    footer: { padding: 20, gap: 10 },
    cta: {
      minHeight: 52, borderRadius: 16,
      alignItems: 'center', justifyContent: 'center',
    },
    ctaText: { color: '#fff', fontWeight: '800', fontSize: 16 },
    footnote: { color: colors.textMuted, fontSize: 12, textAlign: 'center', lineHeight: 18 },
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
          <TouchableOpacity onPress={() => void loadApplication()} accessibilityLabel="Try again">
            <Text style={[s.doneText, { fontSize: 15 }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const renderInput = (c: Criterion) => {
    const done = metCriterionIds.has(c.id);
    if (done) {
      return (
        <View style={s.doneRow}>
          <Ionicons name="checkmark-circle" size={16} color={colors.roxy} />
          <Text style={s.doneText}>Added</Text>
        </View>
      );
    }
    // Stored, but the criterion is not marked yet — see gateStore.saveLegalName.
    // An empty box here would invite her to retype a name that can be accepted
    // only once, and be refused for it.
    if (c.key === 'legal_name' && nameSubmitted) {
      return (
        <View style={s.doneRow}>
          <Ionicons name="time-outline" size={16} color={colors.textMuted} />
          <Text style={s.pendingText}>Saved — being added to your score</Text>
        </View>
      );
    }
    const isLong = c.kind === 'question';
    return (
      <>
        <TextInput
          style={[s.input, isLong && s.textarea]}
          value={drafts[c.id] ?? ''}
          onChangeText={(t) => setDrafts((d) => ({ ...d, [c.id]: t }))}
          placeholder={c.kind === 'question' ? 'Take your time…' : c.label}
          placeholderTextColor={colors.textMuted}
          multiline={isLong}
          maxLength={isLong ? 4000 : 200}
          accessibilityLabel={c.label}
          autoCapitalize={c.key === 'legal_name' ? 'words' : 'none'}
        />
        <TouchableOpacity
          style={s.saveBtn}
          onPress={() => void handleSave(c)}
          disabled={savingKey === c.id || !(drafts[c.id] ?? '').trim()}
          accessibilityLabel={`Save ${c.label}`}
        >
          {savingKey === c.id
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={s.saveText}>Save</Text>}
        </TouchableOpacity>
      </>
    );
  };

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
              None of this is required — but the more a reviewer can see, the easier it is
              for her to say yes.
            </Text>
          </View>

          <LinearGradient
            colors={BRAND_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.scoreCard}
          >
            <View>
              <Text style={s.scoreLabel}>YOUR SCORE</Text>
              <Text style={s.scoreValue} accessibilityLabel={`Score ${score} of ${maxScore}`}>
                {score}/{maxScore}
              </Text>
            </View>
            <Text style={s.scoreHint}>
              A person reads every application. The score only decides what she sees first.
            </Text>
          </LinearGradient>

          {kycCriteria.length > 0 && (
            <View style={s.card}>
              <View style={s.cardTop}>
                <Ionicons
                  name={kycDone ? 'shield-checkmark' : 'shield-outline'}
                  size={18}
                  color={kycDone ? colors.roxy : colors.textMuted}
                />
                <Text style={s.cardTitle}>Verify your identity</Text>
                <Text style={s.points}>
                  +{kycCriteria.reduce((sum, c) => sum + c.points, 0)}
                </Text>
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
                    accessibilityLabel="Start identity verification"
                  >
                    {startingKyc
                      ? <ActivityIndicator color="#fff" size="small" />
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
                <Text style={s.points}>+{c.points}</Text>
              </View>
              {(c.prompt ?? c.description) && (
                <Text style={s.cardBody}>{c.prompt ?? c.description}</Text>
              )}
              {renderInput(c)}
            </View>
          ))}

          <View style={s.footer}>
            <TouchableOpacity
              onPress={() => router.replace('/(tabs)/feed')}
              disabled={missingRequired.length > 0}
              accessibilityLabel="Send application for review"
            >
              <LinearGradient
                colors={BRAND_GRADIENT}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[s.cta, missingRequired.length > 0 && { opacity: 0.5 }]}
              >
                <Text style={s.ctaText}>Send for review</Text>
              </LinearGradient>
            </TouchableOpacity>
            <Text style={s.footnote}>
              {missingRequired.length > 0
                ? `Still needed: ${missingRequired.map((c) => c.label).join(', ')}`
                : 'You can close the app — we’ll email you when a reviewer has decided.'}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
