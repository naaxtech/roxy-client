import { useCallback, useEffect, useState } from 'react';
import { Animated, Modal, Text, StyleSheet, Pressable } from 'react-native';
import { TouchableOpacity } from '../ui/PressableScale';
import { usePopIn } from '../ui/popIn';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useAccess } from '../../hooks/useAccess';
import { useVettingStatusSync } from '../../hooks/useVettingStatusSync';
import { useAuthStore } from '../../store/authStore';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TYPE } from '../../lib/typography';
import { RADII, inkOn, type ThemeColors } from '../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { logError } from '../../lib/errorLogger';

const storageKey = (userId: string) => `roxy_pending_status_seen:${userId}`;

/**
 * One-time sheet for a pending applicant. The persistent chip lives in each
 * screen header (`AccountStatusTag`); this is only the first-run explanation.
 */
export function PendingStatusHost() {
  const colors = useThemeColors();
  const router = useRouter();
  const { kind, loading, isPreviewing } = useAccess();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [open, setOpen] = useState(false);
  const pop = usePopIn(open);
  const s = styles(colors);

  // G-11: most applicants wait here, inside the tabs, not on /pending. Listen
  // for the decision while she is actually pending (never for a core preview).
  // Approval needs no routing: the sync puts the approved profile in the
  // store, the gates open, and the welcome takes over. A rejection does: the
  // reason and the appeal live on the pending screen.
  const onDecision = useCallback((_prev: string | null, next: string) => {
    if (next === 'rejected') router.replace('/(auth)/pending');
  }, [router]);
  useVettingStatusSync(onDecision, { enabled: !loading && kind === 'pending' && !isPreviewing });

  useEffect(() => {
    if (loading || kind !== 'pending' || !userId) {
      setOpen(false);
      return;
    }
    let cancelled = false;
    void AsyncStorage.getItem(storageKey(userId))
      .then((seen) => {
        if (!cancelled && !seen) setOpen(true);
      })
      .catch((e: unknown) => logError(e, 'PendingStatusHost.load'));
    return () => { cancelled = true; };
  }, [kind, loading, userId]);

  const dismiss = () => {
    setOpen(false);
    if (userId) {
      void AsyncStorage.setItem(storageKey(userId), '1').catch((e: unknown) =>
        logError(e, 'PendingStatusHost.save'),
      );
    }
  };

  if (loading || kind !== 'pending' || !open) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={dismiss}
    >
      <Pressable style={s.backdrop} onPress={dismiss} accessibilityLabel="Dismiss account status">
        <Animated.View style={pop}>
        <Pressable style={s.card} onPress={() => undefined} testID="pending-status-sheet">
          <Text style={s.eyebrow}>Account status</Text>
          <Text style={s.title}>You’re pending</Text>
          <Text style={s.body}>
            A reviewer is reading your application. You can browse the Archive
            now. Official chat and the rest of Roxy unlock when you’re approved.
          </Text>
          <TouchableOpacity
            style={s.primary}
            onPress={dismiss}
            accessibilityRole="button"
            accessibilityLabel="Got it"
            testID="pending-status-done"
          >
            <Text style={s.primaryText}>Got it</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              dismiss();
              router.push('/(auth)/application');
            }}
            accessibilityRole="button"
            accessibilityLabel="Add to your application"
            testID="pending-status-application"
          >
            <Text style={s.link}>Add to your application</Text>
          </TouchableOpacity>
        </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20, 8, 16, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: RADII.lg,
    backgroundColor: colors.surface,
    padding: 22,
    gap: 10,
  },
  eyebrow: {
    ...TYPE.micro,
    color: colors.primaryInk,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    ...TYPE.headline,
    color: colors.textPrimary,
  },
  body: {
    ...TYPE.body,
    color: colors.textSecondary,
    lineHeight: 21,
  },
  primary: {
    marginTop: 8,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: RADII.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    ...TYPE.bodyLg,
    color: inkOn(colors.primary),
    fontWeight: '700',
  },
  link: {
    ...TYPE.body,
    color: colors.primaryInk,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 8,
  },
});
