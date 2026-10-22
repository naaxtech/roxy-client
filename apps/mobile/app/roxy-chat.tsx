import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, Platform, Modal, Pressable, type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  runOnJS, scrollTo, useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle,
  useDerivedValue, useSharedValue,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../store/authStore';
import { useProfileStore } from '../store/profileStore';
import { useRoxyChatStore } from '../store/roxyChatStore';
import { Analytics } from '../lib/analytics';
import { useThemeColors } from '../hooks/useThemeColors';
import { confirmAction } from '../lib/confirm';
import { MARGIN, RADII, SPACE, floatElevation, scrim } from '../lib/theme';
import { TYPE, emphasized } from '../lib/typography';
import { MIN_TOUCH_TARGET } from '../lib/touchTargets';
import { a11yState } from '../lib/a11yState';
import { useRoxyFab, ROXY_OFF_COPY } from '../lib/roxyFab';
import { TouchableOpacity } from '../components/ui/PressableScale';
import { Snackbar } from '../components/ui/Snackbar';
import { RoxyO } from '../components/roxy/RoxyO';
import { RoxyWriting } from '../components/roxy/RoxyWriting';
import { RoxyBubble, BUBBLE_O } from '../components/roxy/RoxyBubble';
import { RoxyChip } from '../components/roxy/RoxyChip';
import { useComposerKeyboard } from '../components/roxy/useComposerKeyboard';
import {
  sendToRoxy, retryRoxy, clearRoxyChat, useRoxyFailure, greetingFor, firstNameOf,
  HELLO_SUGGESTIONS, FOLLOW_UPS,
} from '../components/roxy/roxyConversation';

/** The O in her header, dp. */
const HEADER_O = 40;
/** Her O on an empty chat (the same 80 dp as the Hello sheet). */
const HELLO_O = 80;
/** The composer's outline (design direction v2 › Roxy AI chat: "a 1.5 dp outline"). */
const COMPOSER_OUTLINE = 1.5;
/** The composer grows to this height, then scrolls. */
const COMPOSER_MAX = 120;
/** The list's top and bottom padding. */
const LIST_PAD = SPACE[3];
/** Within this of the end, the list counts as "at the end" (pinned to the keyboard). */
const END_SLOP = 24;
const IS_WEB = Platform.OS === 'web';

/*
 * RETIRED (v2, 2026-10-21): v0's Roxy chat chrome — the gradient sparkle
 * mark, the "WINGWOMAN" tag, "● always on — replies instantly", the emoji
 * gradient suggestion chips (Dating Advice · Her Texts · Confidence Tips ·
 * Queer Events), "Ask Roxy anything…" and the gradient Send. Origin: the Roxy
 * 3.0 chat (`git log -S "WINGWOMAN" -- apps/mobile/app/roxy-chat.tsx`). Why:
 * Roxy AI is the emotional companion and says she is an AI; "always on",
 * "ask me anything" and the sparkle are banned (direction v2 › Bans), and the
 * gradient is the wordmark's alone. The old suggestions' prompts are not
 * lost: she can type any of them, and the new three cover the same ground.
 */

/**
 * Roxy AI's own chat (design direction v2 › "Roxy AI chat + FAB", board
 * v2-05). Her chat, not a DM.
 *
 * Header: back, her O at 40 dp, "Roxy AI", "Only you see this chat", more
 * (Clear chat, Report a reply, Turn off Roxy AI). Her bubbles on `surface`
 * with her 32 dp O; the member's in `pinkContainer`. Two follow-ups after her
 * latest reply. While she writes: her O in `think` mood squashing beside
 * "Roxy AI is writing" — never a spinner; replies arrive by sentence. The
 * composer sits on `surface` with a 1.5 dp outline and a `pink` send.
 * Footer: "Roxy AI can be wrong. Keep passwords and addresses to yourself."
 *
 * The keyboard (motion spec §3.1 row 15, F14): the composer rides it frame by
 * frame. Its height is a UI-thread shared value (`useComposerKeyboard`:
 * reanimated's `useAnimatedKeyboard` on native, mounted only here; the visual
 * viewport on web); a spacer under the composer takes `keyboard − bottom
 * inset` each frame, and when the list was at its end as the keyboard started
 * moving, it scrolls to the new end in the same frame, so her last message
 * stays in view. Reading older messages, she stays where she was.
 *
 * The conversation is shared with the "Hello, Roxy" sheet
 * (`components/roxy/roxyConversation.ts`). A failed send keeps her message
 * and says so in one sentence with Retry. If she brings up harming herself,
 * Roxy AI's answer comes from the `roxy-chat` edge function; the Sister
 * support card for that moment must be designed with care professionals
 * before launch (direction), so it is not improvised here.
 */
export default function RoxyChatScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const profile = useProfileStore((s) => s.profile);
  const messages = useRoxyChatStore((s) => s.messages);
  const isTyping = useRoxyChatStore((s) => s.isTyping);
  const failureRaw = useRoxyFailure((s) => s.failure);
  const failure = failureRaw && user?.id && failureRaw.userId === user.id ? failureRaw : null;
  const roxyEnabled = useRoxyFab((s) => s.enabled);

  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [snack, setSnack] = useState(false);
  const listRef = useAnimatedRef<Animated.ScrollView>();
  const keyboard = useComposerKeyboard();
  const bottomInset = insets.bottom;
  /** The list's height with the keyboard down, and its messages' height. */
  const listAtRest = useSharedValue(0);
  const contentH = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const pinned = useSharedValue(true);
  const lastLift = useSharedValue(0);
  // The safe-area inset sits under the keyboard: only the rest needs room.
  const lift = useDerivedValue(() => Math.max(0, keyboard.value - bottomInset), [bottomInset]);
  const spacerStyle = useAnimatedStyle(() => ({ height: lift.value }));
  const onListScroll = useAnimatedScrollHandler({
    onScroll: (e) => { scrollY.value = e.contentOffset.y; },
  });
  const scrollOnJs = (y: number) => { listRef.current?.scrollTo({ y, animated: false }); };
  useAnimatedReaction(
    () => lift.value,
    (now) => {
      const before = lastLift.value;
      if (now === before) return;
      lastLift.value = now;
      const content = contentH.value + 2 * LIST_PAD;
      // Decide once, as the keyboard starts to move: was she at the end?
      if (before === 0) pinned.value = scrollY.value >= content - listAtRest.value - END_SLOP;
      if (!pinned.value) return;
      const end = Math.max(0, content - (listAtRest.value - now));
      if (IS_WEB) runOnJS(scrollOnJs)(end);
      else scrollTo(listRef, 0, end, false);
    },
    [bottomInset],
  );
  const onListLayout = (e: LayoutChangeEvent) => {
    if (lift.value === 0) listAtRest.value = e.nativeEvent.layout.height;
  };
  const onMessagesLayout = (e: LayoutChangeEvent) => {
    contentH.value = e.nativeEvent.layout.height;
  };
  // Replies that arrive while she is here reveal by sentence; older ones show whole.
  const seenAtOpen = useRef(messages.length);

  useEffect(() => {
    Analytics.roxyChatOpened();
  }, []);

  useEffect(() => {
    if (messages.length > 0 || isTyping) listRef.current?.scrollToEnd({ animated: true });
  }, [messages.length, isTyping, failure, listRef]);

  const userId = user?.id ?? null;
  const canSend = draft.trim().length > 0 && !isTyping;
  const last = messages[messages.length - 1];
  const showFollowUps = !isTyping && !failure && last?.role === 'roxy';

  const send = async (text: string) => {
    if (!text.trim() || isTyping) return;
    setDraft('');
    await sendToRoxy(userId, text);
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/feed' as never);
  };

  const clearChat = async () => {
    setMenuOpen(false);
    const ok = await confirmAction(
      'Clear this chat?',
      'Your messages with Roxy AI leave this phone. This cannot be undone.',
      'Clear chat',
    );
    if (ok) clearRoxyChat();
  };

  const reportReply = () => {
    setMenuOpen(false);
    // No report type exists for an AI reply (reports.content_type); the team
    // reads Feedback. She chooses what to quote — nothing is copied for her.
    router.push({
      pathname: '/(tabs)/you/feedback',
      params: { category: 'other', prefillMessage: 'About a Roxy AI reply: ' },
    } as never);
  };

  const toggleRoxy = async () => {
    setMenuOpen(false);
    if (roxyEnabled) {
      await useRoxyFab.getState().setEnabled(userId, false);
      setSnack(true);
    } else {
      await useRoxyFab.getState().setEnabled(userId, true);
    }
  };

  const greeting = greetingFor(new Date(), firstNameOf(profile?.display_name));
  const firstTime = messages[0]
    ? new Date(messages[0].timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.ground }]} edges={['top', 'bottom']}>
      <View style={s.fill}>
        <View style={s.header}>
          <TouchableOpacity
            onPress={goBack}
            style={s.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={24} color={colors.ink} />
          </TouchableOpacity>
          <RoxyO size={HEADER_O} mood={isTyping ? 'think' : 'open'} testID="roxy-chat-header-o" />
          <View style={s.headerText}>
            <Text style={[s.name, { color: colors.ink }]} accessibilityRole="header">Roxy AI</Text>
            <Text style={[s.meta, { color: colors.ink2 }]}>Only you see this chat</Text>
          </View>
          <TouchableOpacity
            onPress={() => setMenuOpen(true)}
            style={s.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="More"
            testID="roxy-chat-more"
          >
            <Ionicons name="ellipsis-horizontal" size={24} color={colors.ink} />
          </TouchableOpacity>
        </View>

        <Animated.ScrollView
          ref={listRef}
          style={s.fill}
          contentContainerStyle={s.list}
          keyboardShouldPersistTaps="handled"
          onScroll={onListScroll}
          scrollEventThrottle={16}
          onLayout={onListLayout}
          testID="roxy-chat-list"
        >
          <View style={s.messages} onLayout={onMessagesLayout} testID="roxy-chat-messages">
          {messages.length === 0 ? (
            <View style={s.hello} testID="roxy-chat-hello">
              <RoxyO size={HELLO_O} mood="happy" />
              <Text style={[s.greeting, { color: colors.ink }]}>{greeting.line1}</Text>
              <Text style={[s.greeting, { color: colors.ink }]}>{greeting.line2}</Text>
              <Text style={[s.intro, { color: colors.ink }]}>
                I&apos;m here for the big stuff and the small stuff. Pick one or just start typing.
              </Text>
              <View style={s.chips}>
                {HELLO_SUGGESTIONS.map((text) => (
                  <RoxyChip key={text} label={text} onPress={() => void send(text)} disabled={isTyping} />
                ))}
              </View>
            </View>
          ) : (
            <Text style={[s.meta, s.when, { color: colors.ink2 }]}>{`Today ${firstTime}`}</Text>
          )}

          {messages.map((m, i) => (
            <RoxyBubble
              key={`${m.id}-${i}`}
              role={m.role}
              content={m.content}
              index={i}
              fresh={m.role === 'roxy' && i >= seenAtOpen.current}
            />
          ))}

          {failure ? (
            <View style={s.failure} accessibilityLiveRegion="polite">
              <Text style={[s.meta, s.failureText, { color: colors.dangerInk }]}>{failure.message}</Text>
              <TouchableOpacity
                onPress={() => void retryRoxy(userId)}
                accessibilityRole="button"
                accessibilityLabel="Retry"
                style={s.retry}
              >
                <Text style={[s.retryLabel, { color: colors.pinkInk }]}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {showFollowUps ? (
            <View style={[s.chips, s.followUps]}>
              {FOLLOW_UPS.map((text) => (
                <RoxyChip key={text} label={text} onPress={() => void send(text)} />
              ))}
            </View>
          ) : null}

          {isTyping ? (
            <View style={s.writing}>
              <RoxyWriting testID="roxy-chat-writing" />
            </View>
          ) : null}
          </View>
        </Animated.ScrollView>

        <View style={s.composerWrap}>
          <View
            testID="roxy-chat-composer"
            style={[s.composer, { backgroundColor: colors.surface, borderColor: colors.control }]}
          >
            <TextInput
              style={[s.input, { color: colors.ink }]}
              value={draft}
              onChangeText={setDraft}
              placeholder="Message Roxy AI"
              placeholderTextColor={colors.ink3}
              multiline
              accessibilityLabel="Message Roxy AI"
              // Web: Enter sends, Shift+Enter inserts a newline (chat convention).
              onKeyPress={(e) => {
                const ne = e.nativeEvent as { key?: string; shiftKey?: boolean };
                if (Platform.OS === 'web' && ne.key === 'Enter' && !ne.shiftKey) {
                  (e as unknown as { preventDefault?: () => void }).preventDefault?.();
                  void send(draft);
                }
              }}
            />
            <TouchableOpacity
              testID="roxy-chat-send"
              onPress={() => void send(draft)}
              disabled={!canSend}
              accessibilityRole="button"
              accessibilityLabel="Send"
              {...a11yState({ disabled: !canSend })}
              style={[s.send, { backgroundColor: canSend ? colors.pink : colors.raised }]}
            >
              <Ionicons name="paper-plane-outline" size={22} color={canSend ? colors.onPink : colors.ink3} />
            </TouchableOpacity>
          </View>
          <Text style={[s.meta, s.footer, { color: colors.ink2 }]}>
            Roxy AI can be wrong. Keep passwords and addresses to yourself.
          </Text>
        </View>
        <Animated.View testID="roxy-chat-keyboard-spacer" style={spacerStyle} />
      </View>

      <Snackbar
        visible={snack}
        message={ROXY_OFF_COPY}
        actionLabel="Undo"
        onAction={() => void useRoxyFab.getState().setEnabled(userId, true)}
        onDismiss={() => setSnack(false)}
        bottom={insets.bottom + MIN_TOUCH_TARGET + SPACE[6]}
        testID="roxy-chat-snackbar"
      />

      <Modal visible={menuOpen} transparent animationType="none" onRequestClose={() => setMenuOpen(false)}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: scrim(0.16) }]}
          onPress={() => setMenuOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Close menu"
        />
        <View
          style={[s.menu, floatElevation(colors), { backgroundColor: colors.surface, top: insets.top + MIN_TOUCH_TARGET + SPACE[2] }]}
          accessibilityViewIsModal
        >
          <MenuRow icon="trash-outline" label="Clear chat" onPress={() => void clearChat()} />
          <MenuRow icon="flag-outline" label="Report a reply" onPress={reportReply} />
          <MenuRow
            icon="power-outline"
            label={roxyEnabled ? 'Turn off Roxy AI' : 'Turn on Roxy AI'}
            onPress={() => void toggleRoxy()}
          />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function MenuRow({
  icon, label, onPress,
}: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <TouchableOpacity onPress={onPress} accessibilityRole="menuitem" accessibilityLabel={label} style={s.menuRow}>
      <Ionicons name={icon} size={24} color={colors.ink2} />
      <Text style={[s.menuLabel, { color: colors.ink }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE[2],
    paddingStart: SPACE[0],
    paddingEnd: SPACE[0],
    paddingVertical: SPACE[1],
  },
  iconBtn: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, minWidth: 0 },
  name: { ...emphasized('title') },
  meta: { ...TYPE.meta },
  list: { paddingHorizontal: MARGIN, paddingVertical: LIST_PAD, flexGrow: 1 },
  messages: { gap: SPACE[2] },
  when: { textAlign: 'center' },
  hello: { gap: SPACE[1], paddingTop: SPACE[4] },
  greeting: { ...TYPE.headline },
  intro: { ...TYPE.body, marginTop: SPACE[1] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE[1], marginTop: SPACE[3] },
  followUps: { marginTop: 0, paddingStart: BUBBLE_O + SPACE[1] },
  failure: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: SPACE[1] },
  failureText: { flexShrink: 1, textAlign: 'right' },
  retry: { minHeight: MIN_TOUCH_TARGET, paddingHorizontal: SPACE[2], justifyContent: 'center', borderRadius: RADII.pill },
  retryLabel: { ...emphasized('label') },
  writing: { paddingStart: SPACE[0] },
  composerWrap: { paddingHorizontal: MARGIN, paddingTop: SPACE[1], paddingBottom: SPACE[1], gap: SPACE[1] },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: RADII.sheet,
    borderWidth: COMPOSER_OUTLINE,
    paddingStart: MARGIN,
    paddingEnd: SPACE[0],
    paddingVertical: SPACE[0],
    minHeight: MIN_TOUCH_TARGET + SPACE[1],
  },
  input: { ...TYPE.body, flex: 1, maxHeight: COMPOSER_MAX, paddingVertical: SPACE[2] },
  send: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { textAlign: 'center' },
  menu: {
    position: 'absolute',
    end: MARGIN,
    borderRadius: RADII.md,
    paddingVertical: SPACE[1],
  },
  menuRow: {
    minHeight: MIN_TOUCH_TARGET + SPACE[1],
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE[2],
    paddingHorizontal: MARGIN,
  },
  menuLabel: { ...TYPE.label },
});
