import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII, inkOnGradient } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { avatarGradient } from '../../lib/avatars';
import { logError } from '../../lib/errorLogger';
import {
  PROMPTS, PROMPT_LIMIT, PROMPT_MAX, fetchArchiveShelf, fetchProfilePrompts, promptLabel,
  savePromptAnswer, type PromptAnswer, type PromptKey, type ShelfEntry,
} from '../../lib/profileExtras';

/**
 * The profile glow-up (delight): two or three prompt answer cards and her
 * Archive top four. Both are 133 tables (profile_prompts, archive_shelf) whose
 * RLS withholds them across a block and from unapproved viewers, so this
 * renders nothing when there is nothing she may see — never an empty frame.
 */
export function ProfileExtras({
  userId, onOpenEntry, testID = 'profile-extras',
}: {
  userId: string;
  onOpenEntry?: (slug: string) => void;
  testID?: string;
}) {
  const colors = useThemeColors();
  const [prompts, setPrompts] = useState<PromptAnswer[]>([]);
  const [shelf, setShelf] = useState<ShelfEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchProfilePrompts(userId), fetchArchiveShelf(userId)]).then(([p, sh]) => {
      if (cancelled) return;
      setPrompts(p.slice(0, PROMPT_LIMIT));
      setShelf(sh);
    });
    return () => { cancelled = true; };
  }, [userId]);

  if (prompts.length === 0 && shelf.length === 0) return null;

  const s = StyleSheet.create({
    wrap: { paddingHorizontal: 16, gap: 10, marginBottom: 12 },
    card: {
      padding: 14, borderRadius: RADII.md, gap: 4,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    },
    q: { ...TYPE.caption, color: colors.textMuted, fontWeight: '700' },
    a: { ...TYPE.bodyLg, color: colors.textPrimary, fontWeight: '700' },
    shelfTitle: { ...TYPE.caption, color: colors.textMuted, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
    shelfRow: { flexDirection: 'row', gap: 8 },
    poster: { flex: 1, aspectRatio: 2 / 3, borderRadius: RADII.sm, overflow: 'hidden', justifyContent: 'flex-end', padding: 6 },
    posterTitle: { ...TYPE.micro, fontWeight: '800' },
  });

  return (
    <View style={s.wrap} testID={testID}>
      {prompts.map((p) => (
        <View key={p.prompt_key} style={s.card} testID={`${testID}-prompt-${p.prompt_key}`}>
          <Text style={s.q}>{promptLabel(p.prompt_key)}</Text>
          <Text style={s.a}>{p.answer}</Text>
        </View>
      ))}
      {shelf.length > 0 ? (
        <View style={{ gap: 6 }} testID={`${testID}-shelf`}>
          <Text style={s.shelfTitle}>Top four from the Archive</Text>
          <View style={s.shelfRow}>
            {shelf.map((e) => {
              const stops = avatarGradient(e.slug);
              return (
                <Pressable
                  key={e.id}
                  onPress={onOpenEntry ? () => onOpenEntry(e.slug) : undefined}
                  accessibilityRole="link"
                  accessibilityLabel={`${e.title}, open in the Archive`}
                  style={{ flex: 1 }}
                  testID={`${testID}-shelf-${e.slug}`}
                >
                  <LinearGradient colors={stops} style={s.poster}>
                    <Text style={[s.posterTitle, { color: inkOnGradient(stops) }]} numberOfLines={3}>{e.title}</Text>
                  </LinearGradient>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Edit her prompt answers: pick up to three of the six questions, answer each
 * in a line (150 characters, the DB CHECK). Saved per field on blur; an empty
 * answer removes it.
 */
export function ProfilePromptsEditor({ userId }: { userId: string }) {
  const colors = useThemeColors();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchProfilePrompts(userId).then((rows) => {
      if (cancelled) return;
      const map = Object.fromEntries(rows.map((r) => [r.prompt_key, r.answer]));
      setAnswers(map);
      setSaved(map);
    });
    return () => { cancelled = true; };
  }, [userId]);

  const answered = Object.entries(answers).filter(([, v]) => v.trim().length > 0).map(([k]) => k);
  const atLimit = answered.length >= PROMPT_LIMIT;

  const save = async (key: PromptKey) => {
    const value = (answers[key] ?? '').trim();
    if (value === (saved[key] ?? '').trim()) return;
    try {
      await savePromptAnswer(userId, key, value);
      setSaved((cur) => ({ ...cur, [key]: value }));
      setError(null);
    } catch (e) {
      logError(e, 'ProfilePromptsEditor.save');
      setError('That answer did not save. Check your connection and try again.');
    }
  };

  const s = StyleSheet.create({
    section: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, width: '100%', gap: 10 },
    label: { color: colors.textMuted, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
    q: { ...TYPE.caption, color: colors.textSecondary, fontWeight: '700' },
    input: {
      ...TYPE.body, color: colors.textPrimary, minHeight: MIN_TOUCH_TARGET,
      borderRadius: RADII.sm, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 10,
    },
    hint: { ...TYPE.micro, color: colors.textMuted },
    error: { ...TYPE.caption, color: colors.error },
  });

  return (
    <View style={s.section} testID="profile-prompts-editor">
      <Text style={s.label}>Prompts — pick up to {PROMPT_LIMIT}</Text>
      <Text style={s.hint}>An easy way to start a conversation. They show on your profile.</Text>
      {PROMPTS.map((p) => {
        const value = answers[p.key] ?? '';
        const locked = atLimit && !value.trim();
        return (
          <View key={p.key} style={{ gap: 4, opacity: locked ? 0.5 : 1 }}>
            <Text style={s.q}>{p.label}</Text>
            <TextInput
              style={s.input}
              value={value}
              editable={!locked}
              onChangeText={(t) => setAnswers((cur) => ({ ...cur, [p.key]: t }))}
              onBlur={() => { void save(p.key); }}
              maxLength={PROMPT_MAX}
              placeholder={locked ? 'Clear another answer to use this one' : 'Your answer'}
              placeholderTextColor={colors.textMuted}
              testID={`prompt-input-${p.key}`}
              accessibilityLabel={p.label}
            />
          </View>
        );
      })}
      {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  );
}
