import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList,
  TouchableOpacity, RefreshControl, Image, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { format } from 'date-fns';
import { supabase } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../store/authStore';
import { useThemeColors } from '../../../../hooks/useThemeColors';
import { AnswerSheet } from '../../../../components/grow/AnswerSheet';

interface Answer {
  id: string;
  content: string;
  created_at: string;
  profiles: { avatar_url: string | null; display_name: string | null } | null;
}

interface Question {
  id: string;
  question: string;
  answer_count: number;
}

export default function QotdAnswersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const colors = useThemeColors();
  const [question, setQuestion] = useState<Question | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userAnswered, setUserAnswered] = useState(false);
  const [showSheet, setShowSheet] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    const [qRes, aRes, myRes] = await Promise.all([
      supabase
        .from('questions_of_the_day')
        .select('id, question, answer_count')
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('qotd_answers')
        .select('id, content, created_at, profiles!inner(avatar_url, display_name)')
        .eq('question_id', id)
        .order('created_at', { ascending: false }),
      user?.id ? supabase
        .from('qotd_answers')
        .select('id')
        .eq('question_id', id)
        .eq('user_id', user.id)
        .limit(1) : Promise.resolve({ data: [] }),
    ]);
    setQuestion(qRes.data as Question | null);
    setAnswers((aRes.data ?? []) as unknown as Answer[]);
    setUserAnswered((myRes.data ?? []).length > 0);
    if (isRefresh) setRefreshing(false); else setLoading(false);
  }, [id, user?.id]);

  useEffect(() => { void load(); }, [load]);

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      padding: 16, borderBottomWidth: 1, borderBottomColor: colors.surfaceLight,
    },
    backBtn: { color: colors.roxy, fontSize: 16, fontWeight: '500' },
    headerTitle: { flex: 1, color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
    questionCard: {
      margin: 16, padding: 14, borderRadius: 14,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary + '30',
    },
    questionText: { color: colors.textPrimary, fontSize: 16, fontWeight: '600', fontStyle: 'italic', lineHeight: 22 },
    countHint: { color: colors.textMuted, fontSize: 12, marginTop: 6 },
    answerRow: {
      flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 10,
      borderBottomWidth: 1, borderBottomColor: colors.surfaceLight,
    },
    avatar: {
      width: 34, height: 34, borderRadius: 17,
      backgroundColor: colors.primary + '30',
      alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    },
    avatarImg: { width: 34, height: 34, borderRadius: 17 },
    avatarText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
    answerMeta: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
    answerTime: { color: colors.textMuted, fontSize: 11 },
    answerContent: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 2 },
    emptyText: { color: colors.textMuted, textAlign: 'center', marginTop: 32, fontSize: 14 },
    fab: {
      position: 'absolute', bottom: 24, right: 24,
      backgroundColor: colors.primary, borderRadius: 28,
      paddingHorizontal: 20, paddingVertical: 13,
      elevation: 4, shadowColor: colors.primary, shadowOpacity: 0.4, shadowRadius: 8,
    },
    fabText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  });

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.roxy} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backBtn}>{'← Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Answers</Text>
      </View>

      <FlatList
        data={answers}
        keyExtractor={(a) => a.id}
        ListHeaderComponent={question ? (
          <View style={styles.questionCard}>
            <Text style={styles.questionText}>"{question.question}"</Text>
            <Text style={styles.countHint}>{question.answer_count} answers</Text>
          </View>
        ) : null}
        ListEmptyComponent={<Text style={styles.emptyText}>No answers yet — be the first!</Text>}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
            tintColor={colors.roxy}
          />
        }
        renderItem={({ item }) => (
          <View style={styles.answerRow}>
            <View style={styles.avatar}>
              {item.profiles?.avatar_url ? (
                <Image source={{ uri: item.profiles.avatar_url }} style={styles.avatarImg} />
              ) : (
                <Text style={styles.avatarText}>
                  {item.profiles?.display_name?.[0]?.toUpperCase() ?? '?'}
                </Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={styles.answerMeta}>{item.profiles?.display_name ?? 'Anonymous'}</Text>
                <Text style={styles.answerTime}>{format(new Date(item.created_at), 'h:mm a')}</Text>
              </View>
              <Text style={styles.answerContent}>{item.content}</Text>
            </View>
          </View>
        )}
      />

      {!userAnswered && user && question && (
        <TouchableOpacity style={styles.fab} onPress={() => setShowSheet(true)} activeOpacity={0.85}>
          <Text style={styles.fabText}>+ Add yours</Text>
        </TouchableOpacity>
      )}

      {showSheet && user && question && (
        <AnswerSheet
          questionId={question.id}
          userId={user.id}
          onClose={() => setShowSheet(false)}
          onSubmitted={() => { setShowSheet(false); void load(); }}
        />
      )}
    </SafeAreaView>
  );
}
