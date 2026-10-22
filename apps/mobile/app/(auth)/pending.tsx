import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { TouchableOpacity } from '../../components/ui/PressableScale';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { format } from 'date-fns';
import { enGB } from 'date-fns/locale';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useGateStore, DECISION_REASON_COPY, APPEAL_MIN } from '../../store/gateStore';
import { useAuth } from '../../hooks/useAuth';
import { useAccess } from '../../hooks/useAccess';
import { useVettingStatusSync } from '../../hooks/useVettingStatusSync';
import { useViewAsStore } from '../../store/viewAsStore';
import { showAlert } from '../../lib/confirm';
import { inkOn, pinkFill } from '../../lib/theme';
import { a11yState } from '../../lib/a11yState';
import { BusySwap } from '../../components/messages/LoadingShapes';
import { RoxyLoading } from '../../components/feedback';

const MIN_APPEAL = APPEAL_MIN;

/**
 * Where an applicant waits, and where a rejected applicant gets a way back.
 *
 * Always-human review with no appeal route means a wrongly-rejected woman has
 * no recourse at all — so the rejection state carries one, and it goes to Roxy
 * staff rather than back to the community that said no.
 */
export default function PendingScreen() {
  const colors = useThemeColors();
  // v2: the hero sits on the flat pink fill, so its ink is onPink.
  const heroInk = colors.onPink;
  const router = useRouter();
  const { signOut } = useAuth();
  const { isPreviewing, kind } = useAccess();
  const setPreview = useViewAsStore((s) => s.setPreview);
  const {
    application, appeal, loadingApplication, loadError,
    loadApplication, loadAppeal, requestAppeal,
  } = useGateStore();
  const previewingPending = isPreviewing && kind === 'pending';

  const [appealText, setAppealText] = useState('');
  const [sending, setSending] = useState(false);
  // Shown at once on success; the store's `appeal` (read back via aa_own)
  // carries it across relaunches.
  const [appealJustSent, setAppealJustSent] = useState(false);

  useEffect(() => {
    if (previewingPending) return;
    void loadApplication();
  }, [loadApplication, previewingPending]);

  // aa_own lets her read her own appeal back, so a sent appeal (and its
  // outcome from resolve_appeal) survives a relaunch instead of re-offering
  // a form the UNIQUE constraint will refuse.
  const isRejected = application?.status === 'rejected';
  useEffect(() => {
    if (isRejected) void loadAppeal?.();
  }, [isRejected, loadAppeal]);

  // G-11: the decision reaches her while this screen is open — realtime on
  // her application row, plus a re-read whenever the app is foregrounded.
  const onDecision = useCallback((_prev: string | null, next: string) => {
    if (next === 'approved') {
      router.replace('/(tabs)/feed');
      return;
    }
    // Rejected (or anything else): the application row carries the reason
    // category and cooldown, so read it again.
    void loadApplication();
  }, [router, loadApplication]);
  const { refresh: refreshProfile } = useVettingStatusSync(onDecision, {
    enabled: !previewingPending,
  });

  const refreshStatus = useCallback(() => {
    void refreshProfile();
    void loadApplication();
  }, [refreshProfile, loadApplication]);

  const handleAppeal = async () => {
    if (appealText.trim().length < MIN_APPEAL) return;
    setSending(true);
    const outcome = await requestAppeal(appealText);
    setSending(false);
    if (outcome === 'sent') {
      setAppealJustSent(true);
      return;
    }
    if (outcome === 'already_sent') {
      showAlert('Already sent', "You've already asked us to take another look. We'll be in touch.");
      void loadAppeal?.();
      return;
    }
    showAlert('Could not send', "Your appeal didn't reach us. Check your connection and try again.");
  };

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centred: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
    hero: {
      margin: 20, borderRadius: 24, padding: 24, alignItems: 'center', gap: 10,
    },
    heroIcon: {
      width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.22)', marginBottom: 4,
    },
    heroTitle: { fontSize: 24, fontWeight: '800', textAlign: 'center' },
    heroBody: {
      color: 'rgba(255,255,255,0.92)', fontSize: 14.5,
      lineHeight: 21, textAlign: 'center',
    },
    card: {
      marginHorizontal: 20, marginBottom: 12, borderRadius: 16,
      backgroundColor: colors.surface, padding: 16, gap: 8,
    },
    cardTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 15 },
    cardBody: { color: colors.textSecondary, fontSize: 13.5, lineHeight: 20 },
    meta: { color: colors.textMuted, fontSize: 12 },
    input: {
      backgroundColor: colors.background, borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 12, minHeight: 110,
      color: colors.textPrimary, fontSize: 15, textAlignVertical: 'top',
      borderWidth: 1, borderColor: colors.textMuted + '30',
    },
    btn: {
      minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.roxy,
    },
    btnText: { fontWeight: '800', fontSize: 15 },
    btnDisabled: { opacity: 0.5 },
    link: { color: colors.roxy, fontWeight: '700', textAlign: 'center', paddingVertical: 14, fontSize: 15 },
    muted: { color: colors.textMuted, fontSize: 12, textAlign: 'center', lineHeight: 18 },
    doneRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  });

  const leavePreview = () => {
    setPreview(null);
    router.replace('/(tabs)/feed' as never);
  };

  if (previewingPending) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.centred}>
          <Ionicons name="hourglass-outline" size={40} color={colors.roxy} />
          <Text style={s.cardTitle}>Viewing the pending wait screen</Text>
          <Text style={s.cardBody}>
            This is what an applicant sees while Roxy reads her application.
            Your core account is unchanged.
          </Text>
          <TouchableOpacity
            onPress={leavePreview}
            accessibilityRole="button"
            accessibilityLabel="Leave preview and return to Roxy core"
            testID="exit-pending-preview"
          >
            <Text style={s.link}>Leave preview</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (loadingApplication) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.centred}>
          <RoxyLoading />
        </View>
      </SafeAreaView>
    );
  }

  if (loadError || !application) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.centred}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.textMuted} />
          <Text style={s.cardBody}>
            {loadError ?? "We couldn't find an application for this account."}
          </Text>
          <TouchableOpacity onPress={() => void loadApplication()} accessibilityLabel="Try again">
            <Text style={s.link}>Try again</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => void signOut()} accessibilityLabel="Sign out">
            <Text style={s.muted}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const rejected = application.status === 'rejected';
  const canReapplyAt = application.rejected_until
    ? format(new Date(application.rejected_until), 'd MMMM yyyy', { locale: enGB })
    : null;
  // The cooldown is over (or none was set): she may use a new code now.
  // redeem_invite_code (130) reuses her application row and enforces the
  // same date server-side, so this is a convenience, not the gate.
  const canReapplyNow = rejected
    && (!application.rejected_until || Date.parse(application.rejected_until) <= Date.now());
  const reasonCopy = application.decision_reason
    ? DECISION_REASON_COPY[application.decision_reason] ?? null
    : null;
  const appealDisabled = sending || appealText.trim().length < MIN_APPEAL;
  const btnInk = inkOn(colors.roxy);

  const renderAppeal = () => {
    if (appeal?.outcome === 'upheld') {
      return (
        <View style={s.doneRow} testID="appeal-upheld">
          <Ionicons name="information-circle-outline" size={18} color={colors.textMuted} />
          <Text style={[s.cardBody, { flex: 1 }]}>
            Roxy staff looked again and the decision stands.
            {canReapplyAt && !canReapplyNow ? ` You can apply with a new code from ${canReapplyAt}.` : ''}
          </Text>
        </View>
      );
    }
    if (appeal || appealJustSent) {
      return (
        <View style={s.doneRow} testID="appeal-sent" accessibilityLiveRegion="polite">
          <Ionicons name="checkmark-circle" size={18} color={colors.roxy} />
          <Text style={[s.cardBody, { flex: 1 }]}>
            Sent. Roxy staff will review it — not the community that decided. We'll email you
            either way.
          </Text>
        </View>
      );
    }
    return (
      <>
        <Text style={s.cardBody}>
          Tell us what you think was missed. This goes to Roxy staff directly, and you can send
          one appeal.
        </Text>
        <TextInput
          style={s.input}
          value={appealText}
          onChangeText={setAppealText}
          placeholder="What would you like us to know?"
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={2000}
          accessibilityLabel="Your appeal"
        />
        <TouchableOpacity
          style={[s.btn, appealDisabled && s.btnDisabled]}
          onPress={() => void handleAppeal()}
          disabled={appealDisabled}
          accessibilityRole="button"
          {...a11yState({ disabled: appealDisabled, busy: sending })}
          accessibilityLabel="Send appeal"
        >
          <BusySwap busy={sending} onFill>
            <Text style={[s.btnText, { color: btnInk }]}>Send appeal</Text>
          </BusySwap>
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
          <LinearGradient
            colors={pinkFill(colors)}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.hero}
          >
            <View style={s.heroIcon}>
              <Ionicons name={rejected ? 'mail-outline' : 'hourglass-outline'} size={28} color={heroInk} />
            </View>
            <Text style={[s.heroTitle, { color: heroInk }]}>
              {rejected ? 'Not this time' : "You're in the queue"}
            </Text>
            <Text style={[s.heroBody, { color: heroInk }]}>
              {rejected
                ? 'A reviewer read your application and decided not to approve it. That decision was made by a person, and you can ask us to look again.'
                : "A member of the community that invited you is reading your application. Usually within 48 hours. We'll email you and send a push."}
            </Text>
          </LinearGradient>

          <View style={s.card}>
            <Text style={s.cardTitle}>Application details</Text>
            <Text style={s.meta}>
              Submitted {format(new Date(application.submitted_at), 'd MMM yyyy, HH:mm', { locale: enGB })}
            </Text>
            {application.decided_at && (
              <Text style={s.meta}>
                Decided {format(new Date(application.decided_at), 'd MMM yyyy, HH:mm', { locale: enGB })}
              </Text>
            )}
            {rejected && reasonCopy && (
              <>
                <Text style={[s.cardTitle, { fontSize: 13, marginTop: 4 }]}>Why</Text>
                <Text style={s.cardBody} testID="rejection-reason">{reasonCopy}</Text>
              </>
            )}
            {rejected && canReapplyAt && !canReapplyNow && (
              <Text style={s.cardBody} testID="reapply-date">
                You can apply again with a new code from {canReapplyAt}.
              </Text>
            )}
            {canReapplyNow && (
              <>
                <Text style={s.cardBody}>
                  Your waiting period is over. If someone has given you a new code, you can apply
                  again — your account stays as it is.
                </Text>
                <TouchableOpacity
                  style={s.btn}
                  onPress={() => router.push('/(auth)/code')}
                  accessibilityRole="button"
                  accessibilityLabel="Enter a new code"
                  testID="reapply-with-code"
                >
                  <Text style={[s.btnText, { color: btnInk }]}>Enter a new code</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {rejected && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Ask us to look again</Text>
              {renderAppeal()}
            </View>
          )}

          {!rejected && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Add to your application</Text>
              <Text style={s.cardBody}>
                Anything you add while you wait is visible to your reviewer straight away.
              </Text>
              <TouchableOpacity
                style={s.btn}
                onPress={() => router.push('/(auth)/application')}
                accessibilityRole="button"
                accessibilityLabel="Open your application"
              >
                <Text style={[s.btnText, { color: btnInk }]}>Open application</Text>
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity
            onPress={refreshStatus}
            accessibilityRole="button"
            accessibilityLabel="Refresh status"
          >
            <Text style={s.link}>Refresh status</Text>
          </TouchableOpacity>
          <Text style={s.muted}>Questions? support@roxyhq.com</Text>
          <TouchableOpacity onPress={() => void signOut()} accessibilityRole="button" accessibilityLabel="Sign out">
            <Text style={s.muted}>Sign out</Text>
          </TouchableOpacity>
          <View style={{ height: 28 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
