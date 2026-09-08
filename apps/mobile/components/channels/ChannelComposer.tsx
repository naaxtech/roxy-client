import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII, inkOn } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { MAX_MESSAGE_LENGTH, writeFailureMessage } from '../../lib/channels';

interface Props {
  /** The design's `{{chanPh}}` — placeholder names the channel she is in. */
  placeholder: string;
  onSend: (body: string) => Promise<void>;
  disabled?: boolean;
  /** Why she cannot post, when she cannot. Silence would read as a bug. */
  disabledReason?: string;
  testID?: string;
}

/**
 * The channel composer (design markup 689–693).
 *
 * Send is disabled on empty and while a send is in flight. The in-flight guard
 * is the one that matters: a double tap on a slow network posts the message
 * twice, and there is no unsend.
 */
export function ChannelComposer({
  placeholder, onSend, disabled = false, disabledReason, testID = 'channel-composer',
}: Props) {
  const colors = useThemeColors();
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = value.trim();
  const overLong = trimmed.length > MAX_MESSAGE_LENGTH;
  const canSend = trimmed.length > 0 && !overLong && !sending && !disabled;

  const submit = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await onSend(trimmed);
      // Cleared only after the write settles. Clearing first loses her text
      // when the send fails.
      setValue('');
    } catch (e) {
      // NEVER `e.message`. A PostgrestError is an Error subclass, so that branch
      // put policy text — "new row violates row-level security policy for table
      // \"community_channel_messages\"" — under a member's composer, which is a
      // client-visible internal error and a table-name leak both.
      setError(writeFailureMessage(e));
    } finally {
      setSending(false);
    }
  };

  const s = StyleSheet.create({
    wrap: {
      borderTopWidth: 1,
      borderTopColor: colors.line,
      backgroundColor: colors.backgroundAlt,
      paddingHorizontal: 12,
      paddingTop: 10,
      paddingBottom: 12,
      gap: 6,
    },
    row: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
    input: {
      flex: 1,
      minHeight: MIN_TOUCH_TARGET,
      maxHeight: 120,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: RADII.md,
      paddingHorizontal: 13,
      paddingVertical: 10,
      ...TYPE.caption,
      color: colors.textPrimary,
    },
    send: {
      minHeight: MIN_TOUCH_TARGET,
      justifyContent: 'center',
      paddingHorizontal: 16,
      borderRadius: RADII.md,
      backgroundColor: colors.primary,
    },
    sendOff: { opacity: 0.45 },
    sendText: { ...TYPE.caption, fontWeight: '700', color: inkOn(colors.primary) },
    note: { ...TYPE.micro, color: colors.textMuted },
    error: { ...TYPE.micro, color: colors.errorInk },
    counter: { ...TYPE.micro, color: colors.errorInk, textAlign: 'right' },
  });

  if (disabled) {
    return (
      <View style={s.wrap} testID={`${testID}-locked`}>
        <Text style={s.note}>{disabledReason ?? 'You cannot post here.'}</Text>
      </View>
    );
  }

  return (
    <View style={s.wrap} testID={testID}>
      <View style={s.row}>
        <TextInput
          style={s.input}
          value={value}
          onChangeText={setValue}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          multiline
          editable={!sending}
          onSubmitEditing={submit}
          blurOnSubmit={false}
          accessibilityLabel={placeholder}
          testID={`${testID}-input`}
        />
        <Pressable
          onPress={submit}
          disabled={!canSend}
          style={[s.send, !canSend && s.sendOff]}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !canSend }}
          aria-disabled={!canSend}
          testID={`${testID}-send`}
        >
          {sending
            ? <ActivityIndicator color={inkOn(colors.primary)} testID={`${testID}-sending`} />
            : <Text style={s.sendText}>Send</Text>}
        </Pressable>
      </View>

      {overLong ? (
        <Text style={s.counter} testID={`${testID}-over`}>
          {trimmed.length - MAX_MESSAGE_LENGTH} characters over
        </Text>
      ) : null}
      {error ? <Text style={s.error} testID={`${testID}-error`}>{error}</Text> : null}
    </View>
  );
}
