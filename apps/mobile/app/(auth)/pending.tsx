import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { format } from 'date-fns';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useGateStore } from '../../store/gateStore';
import { useAuth } from '../../hooks/useAuth';
import { showAlert } from '../../lib/confirm';
import { BRAND_GRADIENT } from '../../lib/theme';

const MIN_APPEAL = 10;

/**
 * Where an applicant waits, and where a rejected applicant gets a way back.
 *
 * Always-human review with no appeal route means a wrongly-rejected woman has
 * no recourse at all — so the rejection state carries one, and it goes to Roxy
 * staff rather than back to the community that said no.
 */
export default function PendingScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { signOut } = useAuth();
  const { application, loadingApplication, loadError, loadApplication, requestAppeal } =
    useGateStore();

  const [appealText, setAppealText] = useState('');
  const [sending, setSending] = useState(false);
  const [appealSent, setAppealSent] = useState(false);

  useEffect(() => { void loadApplication(); }, [loadApplication]);

  const handleAppeal = async () => {
    if (appealText.trim().length < MIN_APPEAL) return;
    setSending(true);
    const ok = await requestAppeal(appealText);
    setSending(false);
    if (ok) {
      setAppealSent(true);
    } else {
      // The unique constraint on application_id means a second appeal is
      // refused server-side. Say so plainly rather than showing a raw error.
      showAlert('Already sent', "You've already asked us to take another look. We'll be in touch.");
    }
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
    heroTitle: { color: '#fff', fontSize: 24, fontWeight: '800', textAlign: 'center' },
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
    btnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
    btnDisabled: { opacity: 0.5 },
    link: { color: colors.roxy, fontWeight: '700', textAlign: 'center', paddingVertical: 14, fontSize: 15 },
    muted: { color: colors.textMuted, fontSize: 12, textAlign: 'center', lineHeight: 18 },
    doneRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  });

  if (loadingApplication) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.centred}>
          <ActivityIndicator color={colors.roxy} />
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
    ? format(new Date(application.rejected_until), 'd MMMM yyyy')
    : null;

  return (
    <SafeAreaView style={s.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <LinearGradient
            colors={BRAND_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.hero}
          >
            <View style={s.heroIcon}>
              <Ionicons name={rejected ? 'mail-outline' : 'hourglass-outline'} size={28} color="#fff" />
            </View>
            <Text style={s.heroTitle}>
              {rejected ? 'Not this time' : "You're in the queue"}
            </Text>
            <Text style={s.heroBody}>
              {rejected
                ? 'A reviewer read your application and decided not to approve it. That decision was made by a person, and you can ask us to look again.'
                : 'A member of the community that invited you is reading your application. Most decisions land within a couple of days — we’ll email you either way.'}
            </Text>
          </LinearGradient>

          <View style={s.card}>
            <Text style={s.cardTitle}>Application details</Text>
            <Text style={s.meta}>
              Submitted {format(new Date(application.submitted_at), 'd MMM yyyy, HH:mm')}
            </Text>
            {application.decided_at && (
              <Text style={s.meta}>
                Decided {format(new Date(application.decided_at), 'd MMM yyyy, HH:mm')}
              </Text>
            )}
            {rejected && canReapplyAt && (
              <Text style={s.cardBody}>
                You can apply again with a new code from {canReapplyAt}.
              </Text>
            )}
          </View>

          {rejected && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Ask us to look again</Text>
              {appealSent ? (
                <View style={s.doneRow}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.roxy} />
                  <Text style={s.cardBody}>
                    Sent. Roxy staff will review it — not the community that decided.
                  </Text>
                </View>
              ) : (
                <>
                  <Text style={s.cardBody}>
                    Tell us what you think was missed. This goes to Roxy directly.
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
                    style={[s.btn, appealText.trim().length < MIN_APPEAL && s.btnDisabled]}
                    onPress={() => void handleAppeal()}
                    disabled={sending || appealText.trim().length < MIN_APPEAL}
                    accessibilityLabel="Send appeal"
                  >
                    {sending
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={s.btnText}>Send appeal</Text>}
                  </TouchableOpacity>
                </>
              )}
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
                accessibilityLabel="Open your application"
              >
                <Text style={s.btnText}>Open application</Text>
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity onPress={() => void loadApplication()} accessibilityLabel="Refresh status">
            <Text style={s.link}>Refresh status</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => void signOut()} accessibilityLabel="Sign out">
            <Text style={s.muted}>Sign out</Text>
          </TouchableOpacity>
          <View style={{ height: 28 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
