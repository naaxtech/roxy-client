import { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, StyleSheet, ActivityIndicator,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { useThemeColors } from '../../hooks/useThemeColors';

const MAX_LEN = 500;

interface Props {
  questionId: string;
  userId: string;
  onClose: () => void;
  onSubmitted: () => void;
}

export function AnswerSheet({ questionId, userId, onClose, onSubmitted }: Props) {
  const colors = useThemeColors();
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!content.trim()) return;
    setLoading(true);
    setError(null);
    const { error: err } = await supabase
      .from('qotd_answers')
      .insert({ question_id: questionId, user_id: userId, content: content.trim() });
    setLoading(false);
    if (err) {
      setError('Could not save your answer. Please try again.');
      return;
    }
    onSubmitted();
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={a.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableOpacity style={a.backdrop} onPress={onClose} activeOpacity={1} />
        <View style={[a.sheet, { backgroundColor: colors.surface }]}>
          <View style={[a.handle, { backgroundColor: colors.textMuted + '40' }]} />
          <Text style={[a.sheetTitle, { color: colors.textPrimary }]}>Your answer</Text>
          <TextInput
            style={[a.input, { color: colors.textPrimary, borderColor: colors.surfaceLight, backgroundColor: colors.background }]}
            placeholder="Share your thoughts..."
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={MAX_LEN}
            value={content}
            onChangeText={setContent}
            autoFocus
          />
          <Text style={[a.charCount, { color: colors.textMuted }]}>
            {content.length}/{MAX_LEN}
          </Text>
          {error && (
            <Text style={[a.errorText, { color: colors.error }]}>{error}</Text>
          )}
          <TouchableOpacity
            style={[
              a.submitBtn,
              { backgroundColor: colors.primary },
              (!content.trim() || loading) && { opacity: 0.5 },
            ]}
            onPress={handleSubmit}
            disabled={!content.trim() || loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={a.submitBtnText}>Submit</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const a = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 36, gap: 12,
  },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 4 },
  sheetTitle: { fontSize: 17, fontWeight: '700' },
  input: {
    borderWidth: 1, borderRadius: 12,
    padding: 12, fontSize: 15, minHeight: 100,
    textAlignVertical: 'top',
  },
  charCount: { fontSize: 12, textAlign: 'right', marginTop: -4 },
  errorText: { fontSize: 13 },
  submitBtn: {
    borderRadius: 20, paddingVertical: 13, alignItems: 'center',
  },
  submitBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
