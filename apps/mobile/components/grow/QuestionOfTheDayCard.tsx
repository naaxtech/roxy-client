import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Animated, Image, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../../lib/supabase';
import { useThemeColors } from '../../hooks/useThemeColors';
import { AnswerSheet } from './AnswerSheet';

interface Question {
  id: string;
  question: string;
  answer_count: number;
}

interface AvatarEntry {
  avatar_url: string | null;
  display_name: string | null;
}

interface Props {
  communityIds: string[];
  userId: string;
}

function LivePulse({ color }: { color: string }) {
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 0.3, duration: 750, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 1, duration: 750, useNativeDriver: true }),
      ])
    ).start();
  }, [anim]);
  return <Animated.View style={[q.pulseDot, { backgroundColor: color, opacity: anim }]} />;
}

export function QuestionOfTheDayCard({ communityIds, userId }: Props) {
  const colors = useThemeColors();
  const router = useRouter();
  const [question, setQuestion] = useState<Question | null>(null);
  const [userAnswer, setUserAnswer] = useState<{ content: string } | null>(null);
  const [avatarStack, setAvatarStack] = useState<AvatarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSheet, setShowSheet] = useState(false);

  const load = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    let found: Question | null = null;

    if (communityIds.length > 0) {
      const { data } = await supabase
        .from('questions_of_the_day')
        .select('id, question, answer_count')
        .in('community_id', communityIds)
        .eq('active_date', today)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      found = data as Question | null;
    }

    if (!found) {
      const { data } = await supabase
        .from('questions_of_the_day')
        .select('id, question, answer_count')
        .eq('source', 'staff')
        .is('community_id', null)
        .eq('active_date', today)
        .limit(1)
        .maybeSingle();
      found = data as Question | null;
    }

    setQuestion(found);
    if (!found) { setLoading(false); return; }

    const { data: answer } = await supabase
      .from('qotd_answers')
      .select('content')
      .eq('question_id', found.id)
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    setUserAnswer(answer as { content: string } | null);

    const { data: answers } = await supabase
      .from('qotd_answers')
      .select('profiles!inner(avatar_url, display_name)')
      .eq('question_id', found.id)
      .order('created_at', { ascending: false })
      .limit(3);
    setAvatarStack(
      (answers ?? []).map((a: any) => ({
        avatar_url: a.profiles?.avatar_url ?? null,
        display_name: a.profiles?.display_name ?? null,
      }))
    );
    setLoading(false);
  }, [communityIds, userId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <View style={[q.skeleton, { backgroundColor: colors.surface }]}>
        <ActivityIndicator color={colors.roxy} />
      </View>
    );
  }
  if (!question) return null;

  const answered = userAnswer !== null;

  return (
    <View style={[q.card, { backgroundColor: colors.surface, borderColor: colors.primary + '30' }]}>
      <View style={q.headerRow}>
        <Text style={[q.label, { color: colors.roxy }]}>● QUESTION OF THE DAY</Text>
        <View style={q.livePill}>
          <LivePulse color={colors.error} />
          <Text style={[q.liveText, { color: colors.error }]}>LIVE</Text>
        </View>
      </View>

      <Text style={[q.questionText, { color: colors.textPrimary }]}>
        {question.question}
      </Text>

      {question.answer_count > 0 && (
        <View style={q.metaRow}>
          {avatarStack.map((a, i) => (
            <View
              key={i}
              style={[
                q.avatar,
                { marginLeft: i > 0 ? -10 : 0, backgroundColor: colors.primary + '30', borderColor: colors.surface },
              ]}
            >
              {a.avatar_url ? (
                <Image source={{ uri: a.avatar_url }} style={q.avatarImg} />
              ) : (
                <Text style={[q.avatarText, { color: colors.primary }]}>
                  {a.display_name?.[0]?.toUpperCase() ?? '?'}
                </Text>
              )}
            </View>
          ))}
          <Text style={[q.countText, { color: colors.textSecondary }]}>
            {' '}{question.answer_count} sapphics answered today
          </Text>
        </View>
      )}

      {answered && (
        <Text style={[q.answerPreview, { color: colors.textMuted }]} numberOfLines={2}>
          You: {userAnswer!.content}
        </Text>
      )}

      <View style={q.btnRow}>
        {/* Peg: filled gradient "Add yours" pill leads; "Read N" is outlined. */}
        <TouchableOpacity
          style={[q.addBtnWrap, answered && { opacity: 0.55 }]}
          onPress={() => !answered && setShowSheet(true)}
          disabled={answered}
          activeOpacity={0.85}
          accessibilityLabel="Add your answer"
        >
          <LinearGradient
            colors={['#FF6A2E', '#FF2F71', '#E81C8E']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={q.addBtn}
          >
            <Text style={q.addBtnText}>
              {answered ? 'You answered \u2713' : '+ Add yours'}
            </Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity
          style={[q.readBtn, { borderColor: colors.roxy }]}
          onPress={() => router.push(`/(tabs)/grow/qotd/${question!.id}` as any)}
          activeOpacity={0.85}
          accessibilityLabel={`Read ${question.answer_count} answers`}
        >
          <Text style={[q.readBtnText, { color: colors.roxy }]}>Read {question.answer_count}</Text>
        </TouchableOpacity>
      </View>

      {showSheet && (
        <AnswerSheet
          questionId={question.id}
          userId={userId}
          onClose={() => setShowSheet(false)}
          onSubmitted={() => {
            setShowSheet(false);
            void load();
          }}
        />
      )}
    </View>
  );
}

const q = StyleSheet.create({
  skeleton: { height: 140, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 16, padding: 14, borderWidth: 1, gap: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pulseDot: { width: 7, height: 7, borderRadius: 4 },
  liveText: { fontSize: 11, fontWeight: '700' },
  questionText: { fontSize: 18, fontWeight: '800', lineHeight: 25 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  avatar: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, overflow: 'hidden',
  },
  avatarImg: { width: 26, height: 26, borderRadius: 13 },
  avatarText: { fontSize: 11, fontWeight: '700' },
  countText: { fontSize: 12, marginLeft: 6 },
  answerPreview: { fontSize: 12, fontStyle: 'italic' },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  addBtnWrap: { flex: 1, borderRadius: 999, overflow: 'hidden' },
  addBtn: { minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { fontSize: 13.5, fontWeight: '800', color: '#fff' },
  readBtn: {
    flex: 1, borderRadius: 999, minHeight: 40, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  readBtnText: { fontSize: 13.5, fontWeight: '800' },
});
