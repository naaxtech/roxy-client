import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { a11yState } from '../../lib/a11yState';
import type { DeliveryStatus } from '../../hooks/useRealtime';

interface Props {
  status: DeliveryStatus;
  isRead: boolean;
  onRetry: () => void;
}

/**
 * Where her message actually is.
 *
 * Three states, and the distinction between them is the point. A message that
 * failed used to be indistinguishable from one that arrived — the send path
 * guarded its success on `if (inserted?.id)` and did nothing otherwise, so a
 * PostgREST 200 that inserted zero rows left the message on screen wearing a
 * tick. She believed she had said something she had not said.
 *
 * So: a tick is only ever drawn over a row id the server handed back. `sending`
 * shows no tick at all and announces itself as busy; `failed` says **Not sent**
 * in words and carries a retry. Never a tick over a write that did not land.
 *
 * The retry is a real 44pt target, measured rather than hit-slopped — it is the
 * control someone reaches for when the network is already fighting her.
 */
export function MessageStatus({ status, isRead, onRetry }: Props) {
  const colors = useThemeColors();

  const s = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    tick: { ...TYPE.micro, color: isRead ? colors.roxy : colors.textMuted },
    sending: { ...TYPE.micro, color: colors.textMuted },
    failed: { ...TYPE.micro, color: colors.error, fontWeight: '700' },
    retry: {
      minWidth: MIN_TOUCH_TARGET,
      minHeight: MIN_TOUCH_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
    },
    retryText: { ...TYPE.micro, color: colors.roxy, fontWeight: '700' },
  });

  if (status === 'sending') {
    return (
      <View
        style={s.row}
        accessibilityLabel="Sending"
        // `busy` via a11yState, not accessibilityState alone: on
        // react-native-web 0.19 the state object renders no attribute at all,
        // so a screen reader on the web build would hear nothing.
        {...a11yState({ busy: true })}
      >
        <Text style={s.sending}>· · ·</Text>
      </View>
    );
  }

  if (status === 'failed') {
    return (
      <View style={s.row}>
        <Text style={s.failed}>Not sent</Text>
        <TouchableOpacity
          style={s.retry}
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry sending message"
          testID="message-retry"
        >
          <Text style={s.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={s.row} accessibilityLabel={isRead ? 'Read' : 'Sent'}>
      <Text style={s.tick}>{isRead ? '✓✓' : '✓'}</Text>
    </View>
  );
}
