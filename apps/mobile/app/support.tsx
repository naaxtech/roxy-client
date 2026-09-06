import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, StyleSheet, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase, callEdgeFunction } from '../lib/supabase';
import { logError } from '../lib/errorLogger';
import { useAuthStore } from '../store/authStore';
import { useBuildStore } from '../store/buildStore';
import { useThemeColors } from '../hooks/useThemeColors';
import { TYPE } from '../lib/typography';
import { RADII, inkOn, type ThemeColors } from '../lib/theme';
import { MIN_TOUCH_TARGET } from '../lib/touchTargets';
import { FeatureVoteCard, type FeatureRequest } from '../components/build/FeatureVoteCard';
import { DonateModal } from '../components/donations/DonateModal';
import type { ImpactProject } from '../types';
import { a11yState } from '../lib/a11yState';

type Tab = 'planned' | 'pitched' | 'impact';

const TABS: { key: Tab; label: string }[] = [
  { key: 'planned', label: '💜 Roxy Picks' },
  { key: 'pitched', label: '💡 Community' },
  { key: 'impact', label: '✊ Impact' },
];

/**
 * Support — donations, feature voting, and impact projects.
 *
 * This screen exists because a parity audit of the redesign found that three
 * write paths had quietly lost every entry point when the Build tab dissolved:
 * the "Keep Roxy alive" donation banner (whose only two callers were both being
 * deleted), voting and pitching on `feature_requests`, and supporting an
 * `impact_projects` row. Discover renders those rows in its WLW-economy rail,
 * but a rail is a shelf — it shows you the thing, it does not let you act on it.
 *
 * So the rail cards point here, and this is where the actions live. It is a root
 * route rather than a tab because it is a destination you arrive at from a card,
 * not one of the four places you live.
 */
export default function SupportScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const s = styles(colors);

  const user = useAuthStore((st) => st.user);
  const impactProjects = useBuildStore((st) => st.impactProjects);
  const setImpactProjects = useBuildStore((st) => st.setImpactProjects);
  const supportedProjectIds = useBuildStore((st) => st.supportedProjectIds);
  const loadSupports = useBuildStore((st) => st.loadSupports);
  const supportProject = useBuildStore((st) => st.supportProject);

  const [tab, setTab] = useState<Tab>('planned');
  const [features, setFeatures] = useState<FeatureRequest[]>([]);
  const [votedIds, setVotedIds] = useState<string[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [donateOpen, setDonateOpen] = useState(false);
  const [pitchOpen, setPitchOpen] = useState(false);
  const [pitchTitle, setPitchTitle] = useState('');
  const [pitchBody, setPitchBody] = useState('');
  const [pitching, setPitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);

    const [featureRes, projectRes] = await Promise.all([
      callEdgeFunction<{ features: FeatureRequest[]; voted_ids: string[] }>(
        'feature-vote', { action: 'list' },
      ),
      supabase.from('impact_projects').select('*')
        .order('status').order('created_at', { ascending: false }).limit(30),
    ]);

    // State before logging — a throwing logger must never leave this spinning.
    if (featureRes.error && projectRes.error) {
      setStatus('error');
      logError(new Error(featureRes.error), 'support.load');
      return;
    }

    setFeatures(featureRes.data?.features ?? []);
    setVotedIds(featureRes.data?.voted_ids ?? []);
    setImpactProjects((projectRes.data as ImpactProject[]) ?? []);
    setStatus('ready');

    if (featureRes.error) logError(new Error(featureRes.error), 'support.features');
    if (projectRes.error) logError(projectRes.error, 'support.impact');
  }, [setImpactProjects]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (user?.id) void loadSupports(user.id); }, [user?.id, loadSupports]);

  const vote = useCallback(async (featureId: string) => {
    const { data, error: err } = await callEdgeFunction<{ voted: boolean; vote_count: number }>(
      'feature-vote', { action: 'vote', feature_id: featureId },
    );
    // callEdgeFunction never throws, so the envelope is the only signal. Throw so
    // FeatureVoteCard's own optimistic update rolls back rather than sitting on
    // a vote the server refused.
    if (err || !data) throw new Error(err ?? 'vote failed');
    setVotedIds((prev) => (data.voted ? [...prev, featureId] : prev.filter((id) => id !== featureId)));
    setFeatures((prev) => prev.map((f) => (f.id === featureId ? { ...f, vote_count: data.vote_count } : f)));
  }, []);

  const pitch = useCallback(async () => {
    const title = pitchTitle.trim();
    if (title.length < 3) return;
    setPitching(true);
    setError(null);
    const { error: err } = await callEdgeFunction<{ id: string }>(
      'feature-vote', { action: 'pitch', title, description: pitchBody.trim() },
    );
    setPitching(false);
    if (err) { setError('That did not send. Try again.'); logError(new Error(err), 'support.pitch'); return; }
    setPitchOpen(false);
    setPitchTitle('');
    setPitchBody('');
    setTab('pitched');
    void load();
  }, [pitchTitle, pitchBody, load]);

  const support = useCallback(async (projectId: string) => {
    if (!user?.id) return;
    try {
      await supportProject(projectId, user.id);
    } catch (e) {
      setError('Could not add your support just now.');
      logError(e, 'support.project');
    }
  }, [user?.id, supportProject]);

  const shown = tab === 'impact' ? [] : features.filter((f) => f.type === tab);

  return (
    <SafeAreaView edges={['top']} style={s.screen}>
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.push('/(tabs)/discover'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={s.iconBtn}
        >
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={s.title} accessibilityRole="header">Support</Text>
        <View style={s.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <TouchableOpacity
          style={s.donate}
          onPress={() => setDonateOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Keep Roxy alive. Make a donation."
          activeOpacity={0.9}
          testID="support-donate"
        >
          <Ionicons name="heart" size={20} color={inkOn(colors.primary)} />
          <View style={s.donateText}>
            <Text style={s.donateTitle}>Keep Roxy alive</Text>
            <Text style={s.donateSub}>No ads, no data sales. Members keep this running.</Text>
          </View>
        </TouchableOpacity>

        <View style={s.tabs} accessibilityRole="radiogroup" accessibilityLabel="Support sections">
          {TABS.map((t) => {
            const on = t.key === tab;
            return (
              <TouchableOpacity
                key={t.key}
                onPress={() => setTab(t.key)}
                accessibilityRole="radio"
                {...a11yState({ selected: on, checked: on })}
                accessibilityLabel={t.label}
                activeOpacity={0.85}
                style={[s.tab, on ? { backgroundColor: colors.primary, borderColor: colors.primary } : null]}
                testID={`support-tab-${t.key}`}
              >
                <Text style={[s.tabText, on ? { color: inkOn(colors.primary) } : null]}>{t.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}

        {status === 'loading' ? (
          <View style={s.state}><ActivityIndicator color={colors.roxy} /></View>
        ) : status === 'error' ? (
          <View style={s.state}>
            <Text style={s.stateText}>We could not load this right now.</Text>
            <TouchableOpacity onPress={() => void load()} accessibilityRole="button"
              accessibilityLabel="Try again" style={s.retry}>
              <Text style={s.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : tab === 'impact' ? (
          impactProjects.length === 0 ? (
            <View style={s.state}><Text style={s.stateText}>No impact projects yet.</Text></View>
          ) : (
            impactProjects.map((p) => {
              const already = supportedProjectIds.has(p.id);
              return (
                <View key={p.id} style={s.card} testID={`impact-card-${p.id}`}>
                  <Text style={s.cardTitle}>{p.title}</Text>
                  <Text style={s.cardMeta}>{p.supporter_count} supporters</Text>
                  <TouchableOpacity
                    onPress={() => void support(p.id)}
                    disabled={already || p.status !== 'active'}
                    accessibilityRole="button"
                    {...a11yState({ disabled: already })}
                    accessibilityLabel={already ? `Already supporting ${p.title}` : `Support ${p.title}`}
                    style={[s.support, already && s.supportDone]}
                    testID={`impact-support-${p.id}`}
                  >
                    <Text style={[s.supportText, already && s.supportTextDone]}>
                      {already ? '✓ Supported' : 'Support'}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })
          )
        ) : shown.length === 0 ? (
          <View style={s.state}>
            <Text style={s.stateText}>
              {tab === 'pitched' ? 'No ideas pitched yet — yours could be first.' : 'Nothing on the roadmap yet.'}
            </Text>
          </View>
        ) : (
          shown.map((f) => (
            <FeatureVoteCard
              key={f.id}
              feature={f}
              voted={votedIds.includes(f.id)}
              onVote={vote}
            />
          ))
        )}

        {tab === 'pitched' ? (
          <TouchableOpacity
            style={s.pitchCta}
            onPress={() => setPitchOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Pitch an idea"
            activeOpacity={0.85}
            testID="support-pitch-open"
          >
            <Ionicons name="add" size={18} color={colors.roxy} />
            <Text style={s.pitchCtaText}>Pitch an idea</Text>
          </TouchableOpacity>
        ) : null}

        <View style={s.tail} />
      </ScrollView>

      <Modal visible={pitchOpen} transparent animationType="slide" onRequestClose={() => setPitchOpen(false)}>
        <View style={s.scrim}>
          <View style={s.sheet} testID="support-pitch-sheet">
            <Text style={s.sheetTitle}>Pitch an idea</Text>
            <TextInput
              style={s.input}
              value={pitchTitle}
              onChangeText={setPitchTitle}
              placeholder="What should Roxy build?"
              placeholderTextColor={colors.textMuted}
              maxLength={200}
              accessibilityLabel="Idea title"
            />
            <TextInput
              style={[s.input, s.inputMulti]}
              value={pitchBody}
              onChangeText={setPitchBody}
              placeholder="Why does it matter? (optional)"
              placeholderTextColor={colors.textMuted}
              maxLength={1000}
              multiline
              accessibilityLabel="Idea description"
            />
            <View style={s.sheetRow}>
              <TouchableOpacity onPress={() => setPitchOpen(false)} accessibilityRole="button"
                accessibilityLabel="Cancel" style={s.cancel}>
                <Text style={s.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => void pitch()}
                disabled={pitchTitle.trim().length < 3 || pitching}
                accessibilityRole="button"
                {...a11yState({ disabled: pitchTitle.trim().length < 3 || pitching })}
                accessibilityLabel="Send pitch"
                style={[s.send, (pitchTitle.trim().length < 3 || pitching) && s.sendOff]}
                testID="support-pitch-send"
              >
                {pitching
                  ? <ActivityIndicator color={inkOn(colors.primary)} />
                  : <Text style={s.sendText}>Pitch it</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <DonateModal visible={donateOpen} onClose={() => setDonateOpen(false)} />
    </SafeAreaView>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', ...TYPE.title, color: colors.textPrimary },
  body: { paddingHorizontal: 16, gap: 10, paddingTop: 4 },
  donate: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: RADII.lg, backgroundColor: colors.primary,
  },
  donateText: { flex: 1, gap: 2 },
  donateTitle: { ...TYPE.title, color: inkOn(colors.primary) },
  donateSub: { ...TYPE.caption, color: inkOn(colors.primary) },
  tabs: { flexDirection: 'row', gap: 6, marginTop: 4 },
  tab: {
    flex: 1, minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center',
    borderRadius: RADII.pill, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.surface, paddingHorizontal: 6,
  },
  tabText: { ...TYPE.caption, color: colors.textSecondary, fontWeight: '700' },
  state: { paddingVertical: 26, gap: 12, alignItems: 'center' },
  stateText: { ...TYPE.bodyLg, color: colors.textSecondary, textAlign: 'center' },
  retry: {
    minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: 20,
    borderRadius: RADII.pill, borderWidth: 1.5, borderColor: colors.roxy,
  },
  retryText: { ...TYPE.caption, color: colors.roxy, fontWeight: '800' },
  error: { ...TYPE.caption, color: colors.errorInk },
  card: {
    padding: 14, borderRadius: RADII.lg, gap: 6,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
  },
  cardTitle: { ...TYPE.bodyLg, color: colors.textPrimary, fontWeight: '700' },
  cardMeta: { ...TYPE.caption, color: colors.textSecondary },
  support: {
    minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center',
    borderRadius: RADII.pill, backgroundColor: colors.primary, marginTop: 4,
  },
  supportDone: { backgroundColor: colors.surfaceLight },
  supportText: { ...TYPE.caption, color: inkOn(colors.primary), fontWeight: '800' },
  supportTextDone: { color: colors.successInk },
  pitchCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    minHeight: MIN_TOUCH_TARGET, borderRadius: RADII.pill,
    borderWidth: 1.5, borderColor: colors.roxy, marginTop: 4,
  },
  pitchCtaText: { ...TYPE.bodyLg, color: colors.roxy, fontWeight: '800' },
  tail: { height: 40 },
  scrim: { flex: 1, backgroundColor: 'rgba(8,3,18,0.66)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface, padding: 18, gap: 10,
    borderTopLeftRadius: RADII.sheet, borderTopRightRadius: RADII.sheet,
  },
  sheetTitle: { ...TYPE.headline, color: colors.textPrimary },
  input: {
    minHeight: MIN_TOUCH_TARGET, borderRadius: RADII.md, paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: colors.surfaceLight, color: colors.textPrimary, ...TYPE.bodyLg,
  },
  inputMulti: { minHeight: 90, textAlignVertical: 'top' },
  sheetRow: { flexDirection: 'row', gap: 10, marginTop: 2 },
  cancel: {
    flex: 1, minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center',
    borderRadius: RADII.pill, borderWidth: 1, borderColor: colors.line,
  },
  cancelText: { ...TYPE.bodyLg, color: colors.textSecondary, fontWeight: '700' },
  send: {
    flex: 1.4, minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center',
    borderRadius: RADII.pill, backgroundColor: colors.primary,
  },
  sendOff: { opacity: 0.5 },
  sendText: { ...TYPE.bodyLg, color: inkOn(colors.primary), fontWeight: '800' },
});
