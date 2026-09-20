import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput,
  ScrollView, StyleSheet, ActivityIndicator, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, usePathname } from 'expo-router';
import { useAuthStore } from '../../../store/authStore';
import { useFeedbackStore } from '../../../store/feedbackStore';
import { showAlert } from '../../../lib/confirm';
import { useThemeColors } from '../../../hooks/useThemeColors';
import { AppFeedback, FeatureRequest } from '../../../types';

type Tab = 'report' | 'ideas';
type Category = AppFeedback['category'];

const CATEGORY_LABELS: Record<Category, string> = {
  bug: 'Something crashed',
  broken: "Something's broken",
  other: 'Other',
};

const STATUS_LABELS: Record<AppFeedback['status'], string> = {
  open: 'Received',
  in_review: 'In review',
  resolved: 'Resolved',
  wontfix: "Won't fix",
};

const FEATURE_STATUS_LABELS: Record<FeatureRequest['status'], string> = {
  open: 'Open',
  in_progress: 'In progress',
  done: 'Done',
  rejected: 'Rejected',
};

export default function FeedbackScreen() {
  const params = useLocalSearchParams<{ category?: string; prefillMessage?: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const colors = useThemeColors();
  const { user } = useAuthStore();
  const {
    myFeedback, loadingMyFeedback, submitting,
    featureRequests, loadingFeatures, myVotedFeatureIds,
    submitFeedback, loadMyFeedback,
    loadFeatureRequests, loadMyVotes, pitchFeature, toggleVote,
  } = useFeedbackStore();

  const [tab, setTab] = useState<Tab>(
    params.category === 'bug' || params.category === 'broken' ? 'report' : 'report',
  );
  const [category, setCategory] = useState<Category>(
    (params.category as Category) ?? 'bug',
  );
  const [message, setMessage] = useState(params.prefillMessage ?? '');
  const [rating, setRating] = useState<number | null>(null);

  const [pitchTitle, setPitchTitle] = useState('');
  const [pitchDescription, setPitchDescription] = useState('');
  const [showPitchForm, setShowPitchForm] = useState(false);

  const load = useCallback(() => {
    if (!user) return;
    void loadMyFeedback(user.id);
    void loadFeatureRequests();
    void loadMyVotes(user.id);
  }, [user, loadMyFeedback, loadFeatureRequests, loadMyVotes]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async () => {
    if (!user || !message.trim()) return;
    const { error } = await submitFeedback({
      userId: user.id,
      category,
      message,
      rating,
      screenContext: pathname,
    });
    if (error) {
      showAlert('Could not send feedback', error);
      return;
    }
    setMessage('');
    setRating(null);
    showAlert('Thanks', "We read every report — you'll see it move to In review once we look at it.");
  };

  const handlePitch = async () => {
    if (!user || !pitchTitle.trim()) return;
    const { error } = await pitchFeature({ userId: user.id, title: pitchTitle, description: pitchDescription });
    if (error) {
      showAlert('Could not submit idea', error);
      return;
    }
    setPitchTitle('');
    setPitchDescription('');
    setShowPitchForm(false);
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center',
      justifyContent: 'space-between', padding: 16, paddingBottom: 4,
    },
    backButton: { padding: 4 },
    backText: { color: colors.roxy, fontSize: 16, fontWeight: '500' },
    headerTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '700' },
    headerSpacer: { width: 56 },
    segmentedControl: {
      flexDirection: 'row', marginHorizontal: 16, borderRadius: 10,
      backgroundColor: colors.surfaceLight, padding: 3,
    },
    segment: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
    segmentActive: { backgroundColor: colors.primary },
    segmentText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
    segmentTextActive: { color: '#FFFFFF' },
    scroll: { padding: 16, gap: 16 },
    section: {
      backgroundColor: colors.surface, borderRadius: 16,
      padding: 16, gap: 12, width: '100%',
    },
    sectionHeader: {
      color: colors.textMuted, fontSize: 11, fontWeight: '600',
      textTransform: 'uppercase', letterSpacing: 0.8,
    },
    categoryRow: { flexDirection: 'row', gap: 8 },
    categoryChip: {
      paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
      backgroundColor: colors.surfaceLight,
    },
    categoryChipActive: { backgroundColor: colors.roxy },
    categoryChipText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
    categoryChipTextActive: { color: '#FFFFFF' },
    input: {
      backgroundColor: colors.surfaceLight, borderRadius: 12, padding: 12,
      color: colors.textPrimary, fontSize: 14, minHeight: 100, textAlignVertical: 'top',
    },
    ratingRow: { flexDirection: 'row', gap: 8 },
    star: { fontSize: 28 },
    submitButton: {
      backgroundColor: colors.roxy, borderRadius: 14,
      paddingVertical: 14, alignItems: 'center',
    },
    submitButtonDisabled: { opacity: 0.5 },
    submitButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
    historyRow: {
      paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.textMuted + '20',
    },
    historyMessage: { color: colors.textPrimary, fontSize: 13 },
    historyMeta: { color: colors.textMuted, fontSize: 11, marginTop: 4 },
    emptyText: { color: colors.textMuted, fontSize: 13, textAlign: 'center', padding: 12 },
    featureRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.textMuted + '20',
    },
    voteButton: {
      alignItems: 'center', justifyContent: 'center',
      width: 44, height: 44, borderRadius: 10, backgroundColor: colors.surfaceLight,
    },
    voteButtonActive: { backgroundColor: colors.roxy },
    voteCount: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
    featureTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
    featureDescription: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    featureBadge: { color: colors.roxy, fontSize: 11, fontWeight: '700', marginTop: 2 },
    pitchButton: { alignSelf: 'flex-start' },
    pitchButtonText: { color: colors.roxy, fontSize: 14, fontWeight: '600' },
  });

  if (!user) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.roxy} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>{'← Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Feedback & Ideas</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.segmentedControl}>
        <TouchableOpacity
          style={[styles.segment, tab === 'report' && styles.segmentActive]}
          onPress={() => setTab('report')}
        >
          <Text style={[styles.segmentText, tab === 'report' && styles.segmentTextActive]}>
            Report a problem
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segment, tab === 'ideas' && styles.segmentActive]}
          onPress={() => setTab('ideas')}
        >
          <Text style={[styles.segmentText, tab === 'ideas' && styles.segmentTextActive]}>
            Ideas & Roadmap
          </Text>
        </TouchableOpacity>
      </View>

      {tab === 'report' ? (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>What's going on?</Text>
            <View style={styles.categoryRow}>
              {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.categoryChip, category === c && styles.categoryChipActive]}
                  onPress={() => setCategory(c)}
                >
                  <Text style={[styles.categoryChipText, category === c && styles.categoryChipTextActive]}>
                    {CATEGORY_LABELS[c]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={styles.input}
              placeholder="Tell us what happened — the more detail, the faster we can fix it."
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={1000}
              value={message}
              onChangeText={setMessage}
              accessibilityLabel="Feedback message"
            />

            <View style={styles.ratingRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <TouchableOpacity
                  key={n}
                  onPress={() => setRating(rating === n ? null : n)}
                  accessibilityLabel={`Rate ${n} of 5 stars`}
                >
                  <Text style={styles.star}>{rating && n <= rating ? '⭐' : '☆'}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.submitButton, (!message.trim() || submitting) && styles.submitButtonDisabled]}
              onPress={handleSubmit}
              disabled={!message.trim() || submitting}
            >
              {submitting
                ? <ActivityIndicator color="#FFFFFF" />
                : <Text style={styles.submitButtonText}>Send</Text>}
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionHeader}>Your reports</Text>
            {loadingMyFeedback ? (
              <ActivityIndicator color={colors.roxy} />
            ) : myFeedback.length === 0 ? (
              <Text style={styles.emptyText}>Nothing sent yet — your reports will show up here.</Text>
            ) : (
              myFeedback.map((f) => (
                <View key={f.id} style={styles.historyRow}>
                  <Text style={styles.historyMessage} numberOfLines={2}>{f.message}</Text>
                  <Text style={styles.historyMeta}>
                    {CATEGORY_LABELS[f.category]} · {STATUS_LABELS[f.status]}
                  </Text>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      ) : (
        <FlatList
          contentContainerStyle={styles.scroll}
          data={featureRequests}
          keyExtractor={(f) => f.id}
          ListHeaderComponent={
            <View style={styles.section}>
              <Text style={styles.sectionHeader}>Roxy roadmap</Text>
              {!showPitchForm ? (
                <TouchableOpacity style={styles.pitchButton} onPress={() => setShowPitchForm(true)}>
                  <Text style={styles.pitchButtonText}>+ Pitch an idea</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TextInput
                    style={styles.input}
                    placeholder="What should we build?"
                    placeholderTextColor={colors.textMuted}
                    value={pitchTitle}
                    onChangeText={setPitchTitle}
                    maxLength={200}
                    accessibilityLabel="Idea title"
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Say a bit more (optional)"
                    placeholderTextColor={colors.textMuted}
                    value={pitchDescription}
                    onChangeText={setPitchDescription}
                    multiline
                    maxLength={1000}
                    accessibilityLabel="Idea description"
                  />
                  <TouchableOpacity
                    style={[styles.submitButton, !pitchTitle.trim() && styles.submitButtonDisabled]}
                    onPress={handlePitch}
                    disabled={!pitchTitle.trim()}
                  >
                    <Text style={styles.submitButtonText}>Pitch it</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          }
          renderItem={({ item }: { item: FeatureRequest }) => {
            const voted = myVotedFeatureIds.has(item.id);
            return (
              <View style={styles.featureRow}>
                <TouchableOpacity
                  style={[styles.voteButton, voted && styles.voteButtonActive]}
                  onPress={() => toggleVote(item.id, user.id)}
                  accessibilityLabel={voted ? 'Remove vote' : 'Vote for this idea'}
                >
                  <Text style={[styles.voteCount, voted && { color: '#FFFFFF' }]}>{item.vote_count}</Text>
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                  <Text style={styles.featureTitle}>{item.title}</Text>
                  {item.description && (
                    <Text style={styles.featureDescription} numberOfLines={2}>{item.description}</Text>
                  )}
                  {item.type === 'planned' && <Text style={styles.featureBadge}>Roxy Pick · {FEATURE_STATUS_LABELS[item.status]}</Text>}
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            loadingFeatures
              ? <ActivityIndicator color={colors.roxy} />
              : <Text style={styles.emptyText}>No ideas yet — be the first to pitch one.</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}
