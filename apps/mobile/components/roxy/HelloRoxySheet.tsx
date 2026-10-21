import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, I18nManager, Modal, PanResponder, Platform, Pressable, StyleSheet, Text, TextInput,
  View, useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { MARGIN, RADII, SPACE, popElevation, scrim } from '../../lib/theme';
import { SPRING, runSpring } from '../../lib/motion';
import { TYPE, emphasized } from '../../lib/typography';
import { MIN_TOUCH_TARGET } from '../../lib/touchTargets';
import { a11yState } from '../../lib/a11yState';
import { TouchableOpacity } from '../ui/PressableScale';
import { RoxyO } from './RoxyO';
import { RoxyChip } from './RoxyChip';
import { HELLO_SUGGESTIONS, greetingFor, sendToRoxy } from './roxyConversation';

/** The avatar on the sheet's top edge (the FAB's 56 dp O grows into it). */
export const HELLO_AVATAR = 80;

/** How far (dp) she drags the sheet up before it becomes the full chat. */
const EXPAND_DRAG = 48;
/** How far (dp) she drags it down before it closes. */
const CLOSE_DRAG = 96;
/** The scrim over the screen behind (the screen stays legible but quiet). */
const SCRIM_ALPHA = 0.32;
/** Lines of the greeting arrive one after another (ms). */
const LINE_STEP_MS = 160;

export type HelloRoxyOrigin = { x: number; y: number; size: number };

export type HelloRoxySheetProps = {
  visible: boolean;
  userId: string | null;
  firstName: string | null;
  /** The FAB's centre and size in window coordinates: where the O grows from. */
  origin?: HelloRoxyOrigin | null;
  onClose: () => void;
  /** Open `/roxy-chat` (drag up, the handle, or after a first message). */
  onOpenChat: () => void;
  /** Injectable clock for the greeting. */
  now?: Date;
};

/**
 * "Hello, Roxy" — signature moment 1 (design direction v2, board v2-01).
 *
 * The O she tapped grows into this sheet's 80 dp avatar while the sheet rises
 * (`SPRING.spatial`, a container transform: one progress value drives the
 * sheet's travel, the scrim and the avatar's flight from the FAB to the
 * sheet's top edge). Her face goes from `open` to `happy` as it lands; the
 * greeting arrives line by line. Three suggestions; the pressed one morphs to
 * a rounded square in `pinkContainer` (PressableScale's pill morph). Composer
 * "Message Roxy AI"; "Only you see this chat."; "Roxy AI is an AI and can get
 * things wrong." Drag up (or the handle) for the full chat; drag down, the
 * scrim or close to leave. Reduce Motion: everything lands at once.
 *
 * A first message from here goes through the shared conversation engine and
 * opens the full chat, where her words and Roxy's writing indicator already
 * are.
 */
export function HelloRoxySheet({
  visible, userId, firstName, origin, onClose, onOpenChat, now,
}: HelloRoxySheetProps) {
  const colors = useThemeColors();
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();

  const progress = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const lines = useRef([new Animated.Value(0), new Animated.Value(0)]).current;
  const [sheetH, setSheetH] = useState<number | null>(null);
  const [landed, setLanded] = useState(false);
  const [draft, setDraft] = useState('');

  const greeting = useMemo(() => greetingFor(now ?? new Date(), firstName), [now, firstName, visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset for every opening.
  useEffect(() => {
    if (!visible) {
      progress.setValue(0);
      drag.setValue(0);
      lines.forEach((l) => l.setValue(0));
      setSheetH(null);
      setLanded(false);
      setDraft('');
      return;
    }
    if (reducedMotion) {
      progress.setValue(1);
      lines.forEach((l) => l.setValue(1));
      setLanded(true);
    }
  }, [visible, reducedMotion, progress, drag, lines]);

  // Rise once the sheet knows its height (it hugs its content).
  useEffect(() => {
    if (!visible || reducedMotion || sheetH == null) return undefined;
    const anim = Animated.spring(progress, { toValue: 1, ...SPRING.spatial, useNativeDriver: true });
    anim.start(({ finished }) => {
      if (!finished) return;
      setLanded(true);
      lines.forEach((l, i) => {
        Animated.sequence([
          Animated.delay(LINE_STEP_MS * (i + 1)),
          Animated.spring(l, { toValue: 1, ...SPRING.calm, useNativeDriver: true }),
        ]).start();
      });
    });
    return () => anim.stop();
  }, [visible, reducedMotion, sheetH, progress, lines]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6,
        onPanResponderMove: (_e, g) => drag.setValue(Math.max(g.dy, -EXPAND_DRAG * 2)),
        onPanResponderRelease: (_e, g) => {
          if (g.dy < -EXPAND_DRAG) {
            onOpenChat();
          } else if (g.dy > CLOSE_DRAG) {
            onClose();
          } else {
            runSpring(drag, 0, 'spatial', reducedMotion);
          }
        },
      }),
    [drag, onOpenChat, onClose, reducedMotion],
  );

  if (!visible) return null;

  const travel = sheetH ?? winH;
  const translateY = Animated.add(
    progress.interpolate({ inputRange: [0, 1], outputRange: [travel, 0] }),
    drag,
  );

  // The avatar's flight: from the FAB's centre to its seat on the sheet edge.
  const seatX = I18nManager.isRTL ? winW - (MARGIN + HELLO_AVATAR / 2) : MARGIN + HELLO_AVATAR / 2;
  const fromX = origin ? origin.x - seatX : 0;
  const fromY = origin ? origin.y - winH : 0;
  const fromScale = origin ? origin.size / HELLO_AVATAR : 1;
  const avatarFlight = {
    transform: [
      { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [fromX, 0] }) },
      { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [fromY, 0] }) },
      { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [fromScale, 1] }) },
    ],
  };

  const canSend = draft.trim().length > 0;
  const send = async (text: string) => {
    if (!text.trim()) return;
    setDraft('');
    onOpenChat();
    await sendToRoxy(userId, text);
  };

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: scrim(SCRIM_ALPHA), opacity: progress }]}
      />
      <Pressable
        testID="hello-roxy-scrim"
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close Roxy AI"
      />

      <Animated.View
        testID="hello-roxy-sheet"
        accessibilityViewIsModal
        onLayout={(e) => setSheetH(e.nativeEvent.layout.height)}
        style={[
          s.sheet,
          popElevation(colors),
          {
            backgroundColor: colors.surface,
            paddingBottom: Math.max(insets.bottom, SPACE[2]),
            transform: [{ translateY }],
          },
        ]}
      >
        <View {...pan.panHandlers}>
          <Pressable
            testID="hello-roxy-expand"
            onPress={onOpenChat}
            accessibilityRole="button"
            accessibilityLabel="Open the full chat"
            accessibilityHint="Or drag the sheet up"
            style={s.handleTarget}
          >
            <View style={[s.handle, { backgroundColor: colors.control }]} />
          </Pressable>
          <View style={s.headerRow}>
            <View style={s.avatarRoom} />
            <View style={s.headerText}>
              <Text style={[s.name, { color: colors.ink }]}>Roxy AI</Text>
              <Text style={[s.meta, { color: colors.ink2 }]}>Only you see this chat.</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={s.close}
            >
              <Ionicons name="close" size={24} color={colors.ink} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.body} accessibilityLiveRegion="polite">
          <Text style={[s.greeting, { color: colors.ink }]} accessibilityRole="header">{greeting.line1}</Text>
          <Animated.Text style={[s.greeting, { color: colors.ink, opacity: lines[0] }]}>{greeting.line2}</Animated.Text>
          <Animated.Text style={[s.intro, { color: colors.ink, opacity: lines[1] }]}>
            I&apos;m here for the big stuff and the small stuff. Pick one or just start typing.
          </Animated.Text>

          <View style={s.chips}>
            {HELLO_SUGGESTIONS.map((text) => (
              <RoxyChip key={text} testID={`hello-roxy-chip-${text}`} label={text} onPress={() => void send(text)} />
            ))}
          </View>

          <View style={[s.composer, { backgroundColor: colors.raised }]}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Message Roxy AI"
              placeholderTextColor={colors.ink3}
              style={[s.input, { color: colors.ink }]}
              accessibilityLabel="Message Roxy AI"
              returnKeyType="send"
              blurOnSubmit
              onSubmitEditing={() => void send(draft)}
              onKeyPress={(e) => {
                const ne = e.nativeEvent as { key?: string; shiftKey?: boolean };
                if (Platform.OS === 'web' && ne.key === 'Enter' && !ne.shiftKey) {
                  (e as unknown as { preventDefault?: () => void }).preventDefault?.();
                  void send(draft);
                }
              }}
            />
            <TouchableOpacity
              testID="hello-roxy-send"
              onPress={() => void send(draft)}
              disabled={!canSend}
              accessibilityRole="button"
              accessibilityLabel="Send"
              {...a11yState({ disabled: !canSend })}
              style={[s.send, { backgroundColor: canSend ? colors.pink : 'transparent' }]}
            >
              <Ionicons name="paper-plane-outline" size={22} color={canSend ? colors.onPink : colors.ink2} />
            </TouchableOpacity>
          </View>

          <Text style={[s.footer, { color: colors.ink2 }]}>Roxy AI is an AI and can get things wrong.</Text>
        </View>

        <Animated.View pointerEvents="none" style={[s.avatar, avatarFlight]}>
          <RoxyO size={HELLO_AVATAR} mood={landed ? 'happy' : 'open'} testID="hello-roxy-avatar" />
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  sheet: {
    position: 'absolute',
    start: 0,
    end: 0,
    bottom: 0,
    borderTopLeftRadius: RADII.sheet,
    borderTopRightRadius: RADII.sheet,
  },
  handleTarget: {
    alignSelf: 'center',
    minHeight: SPACE[5],
    minWidth: MIN_TOUCH_TARGET + SPACE[5],
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: { width: SPACE[6], height: SPACE[0], borderRadius: RADII.pill },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: MARGIN,
    gap: SPACE[2],
  },
  avatarRoom: { width: HELLO_AVATAR },
  headerText: { flex: 1, minWidth: 0 },
  name: { ...emphasized('title') },
  meta: { ...TYPE.meta },
  close: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { paddingHorizontal: MARGIN, paddingTop: SPACE[5], gap: SPACE[1] },
  greeting: { ...TYPE.headline },
  intro: { ...TYPE.body, marginTop: SPACE[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACE[1], marginTop: SPACE[4] },
  composer: {
    marginTop: SPACE[6],
    minHeight: MIN_TOUCH_TARGET + SPACE[1],
    borderRadius: RADII.pill,
    flexDirection: 'row',
    alignItems: 'center',
    paddingStart: SPACE[4],
    paddingEnd: SPACE[0],
  },
  input: { ...TYPE.body, flex: 1, paddingVertical: SPACE[2] },
  send: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { ...TYPE.meta, textAlign: 'center', marginTop: SPACE[2] },
  avatar: {
    position: 'absolute',
    top: -HELLO_AVATAR / 2,
    start: MARGIN,
  },
});
