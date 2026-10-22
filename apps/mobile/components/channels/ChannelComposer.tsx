import { useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { PressableScale } from '../ui/PressableScale';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII, inkOn } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { MAX_MESSAGE_LENGTH, writeFailureMessage } from '../../lib/channels';

interface Props {
  /** The design's `{{chanPh}}` — placeholder names the channel she is in. */
  placeholder: string;
  onSend: (body: string) => Promise<void>;
  /**
   * A send failed. The screen says so (snackbar) and offers `retry`, which
   * sends the same words again. Without it the composer shows the reason
   * under the box itself.
   */
  onSendFailed?: (message: string, retry: () => void) => void;
  disabled?: boolean;
  /** Why she cannot post, when she cannot. Silence would read as a bug. */
  disabledReason?: string;
  /** A keystroke (CHAT-17 typing). The hook throttles it. */
  onTyping?: () => void;
  /** She sent, emptied the box or left it: stop showing her as typing. */
  onStopTyping?: () => void;
  testID?: string;
}

/**
 * The channel composer (design markup 689–693).
 *
 * Optimistic (motion spec F10): Send empties the box in the same frame and
 * hands the words to the screen, which draws them in the channel at once.
 * That is also the double-tap guard: a second tap finds an empty box, so a
 * slow network can never post the message twice (there is no unsend). A
 * failed send gives her words back (unless she is already typing the next
 * one) and says why.
 */
export function ChannelComposer({
  placeholder, onSend, onSendFailed, disabled = false, disabledReason, onTyping, onStopTyping, testID = 'channel-composer',
}: Props) {
  const colors = useThemeColors();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  // What is in the box right now, for a failure that lands after she has
  // started typing the next message.
  const valueRef = useRef(value);
  valueRef.current = value;

  const trimmed = value.trim();
  const overLong = trimmed.length > MAX_MESSAGE_LENGTH;
  const canSend = trimmed.length > 0 && !overLong && !disabled;

  const sendBody = (body: string) => {
    setError(null);
    onStopTyping?.();
    // Cleared in the same frame (F10). The words are not lost on a failure:
    // the catch below puts them back.
    if (valueRef.current.trim() === body) {
      valueRef.current = '';
      setValue('');
    }
    onSend(body).catch((e: unknown) => {
      if (!valueRef.current.trim()) setValue(body);
      // NEVER `e.message`. A PostgrestError is an Error subclass, so that branch
      // put policy text — "new row violates row-level security policy for table
      // \"community_channel_messages\"" — under a member's composer, which is a
      // client-visible internal error and a table-name leak both.
      const message = writeFailureMessage(e);
      if (onSendFailed) onSendFailed(message, () => sendBody(body));
      else setError(message);
    });
  };

  const submit = () => {
    if (!canSend) return;
    sendBody(trimmed);
  };

  // Built once per theme, not on every keystroke (jank audit #8).
  const s = useMemo(() => StyleSheet.create({
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
  }), [colors]);

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
          onChangeText={(t) => {
            setValue(t);
            if (t.trim()) onTyping?.(); else onStopTyping?.();
          }}
          onBlur={onStopTyping}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          multiline
          onSubmitEditing={submit}
          blurOnSubmit={false}
          accessibilityLabel={placeholder}
          testID={`${testID}-input`}
        />
        <PressableScale
          onPress={submit}
          disabled={!canSend}
          style={[s.send, !canSend && s.sendOff]}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !canSend }}
          aria-disabled={!canSend}
          testID={`${testID}-send`}
        >
          <Text style={s.sendText}>Send</Text>
        </PressableScale>
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
