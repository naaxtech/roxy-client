import { useEffect, useMemo, useState } from 'react';
import {
  I18nManager, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import Reanimated, {
  interpolate, runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withDelay, withSpring,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { MARGIN, RADII, SPACE, popElevation, scrim } from '../../lib/theme';
import { projectRelease, springTo } from '../../lib/motion';
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
/** The rise counts as landed here (0 → 1 progress): it looks home, the face turns happy. */
const LANDED_AT = 0.98;
// Suites that mock RNGH partially get the sheet without the drag.
const canPan = typeof Gesture?.Pan === 'function' && typeof GestureDetector === 'function';
// The Modal is its own native root: RNGH needs a root view inside it.
const GestureRoot = (typeof GestureHandlerRootView === 'function' || typeof GestureHandlerRootView === 'object'
  ? GestureHandlerRootView
  : View) as typeof View;

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
 * Wave 3 (lane C): the rise, scrim, flight and lines are reanimated shared
 * values and the drag is an RNGH Pan, so all of it runs on the UI thread;
 * the release is judged by its projected position; the face turns happy and
 * the lines start when the sheet looks landed, not on the spring's callback.
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

  /** 0 → 1: the rise, the scrim and the O's flight (one container transform). */
  const progress = useSharedValue(0);
  /** The handle drag (dp; negative = up). */
  const drag = useSharedValue(0);
  /** The greeting's second and third lines (opacity). */
  const line2 = useSharedValue(0);
  const line3 = useSharedValue(0);
  /** 1 once the sheet looks landed: her face is happy and the lines have started. */
  const landedSV = useSharedValue(0);
  /** How far below its seat the sheet starts: its height once known. */
  const travel = useSharedValue(winH);
  const [sheetH, setSheetH] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  const greeting = useMemo(() => greetingFor(now ?? new Date(), firstName), [now, firstName, visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset for every opening.
  useEffect(() => {
    if (!visible) {
      landedSV.value = 0;
      progress.value = 0;
      drag.value = 0;
      line2.value = 0;
      line3.value = 0;
      setSheetH(null);
      setDraft('');
      return;
    }
    if (reducedMotion) {
      landedSV.value = 1;
      line2.value = 1;
      line3.value = 1;
      progress.value = 1;
    }
  }, [visible, reducedMotion, progress, drag, line2, line3, landedSV]);

  // Rise once the sheet knows its height (it hugs its content).
  useEffect(() => {
    if (!visible || reducedMotion || sheetH == null) return;
    travel.value = sheetH;
    progress.value = withSpring(1, springTo('spatial'));
  }, [visible, reducedMotion, sheetH, progress, travel]);

  // Her face turns happy and the lines start when the sheet LOOKS landed, on
  // the UI thread — never on the spring's "finished" callback, which fires
  // long after it looks done (motion spec §3.2). No React state: the two
  // faces are both mounted and swap by opacity, so nothing commits mid-rise.
  useAnimatedReaction(
    () => progress.value >= LANDED_AT && landedSV.value === 0,
    (arrived) => {
      if (!arrived) return;
      landedSV.value = 1;
      line2.value = withDelay(LINE_STEP_MS, withSpring(1, springTo('calm')));
      line3.value = withDelay(LINE_STEP_MS * 2, withSpring(1, springTo('calm')));
    },
  );

  const pan = useMemo(
    () =>
      canPan
        ? Gesture.Pan()
            .withTestId('hello-roxy-pan')
            .activeOffsetY([-6, 6])
            .onUpdate((e) => {
              drag.value = Math.max(e.translationY, -EXPAND_DRAG * 2);
            })
            .onEnd((e) => {
              // Choose the end from where the release is heading (WWDC18).
              const projected = projectRelease(drag.value, e.velocityY);
              if (projected < -EXPAND_DRAG) {
                runOnJS(onOpenChat)();
              } else if (projected > CLOSE_DRAG) {
                runOnJS(onClose)();
              } else {
                drag.value = reducedMotion
                  ? 0
                  : withSpring(0, springTo('spatial', { px: true, velocity: e.velocityY }));
              }
            })
        : null,
    [drag, onOpenChat, onClose, reducedMotion],
  );

  // The avatar's flight: from the FAB's centre to its seat on the sheet edge.
  const seatX = I18nManager.isRTL ? winW - (MARGIN + HELLO_AVATAR / 2) : MARGIN + HELLO_AVATAR / 2;
  const fromX = origin ? origin.x - seatX : 0;
  const fromY = origin ? origin.y - winH : 0;
  const fromScale = origin ? origin.size / HELLO_AVATAR : 1;

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(progress.value, [0, 1], [travel.value, 0]) + drag.value }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: Math.min(Math.max(progress.value, 0), 1) }));
  const avatarFlight = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [fromX, 0]) },
      { translateY: interpolate(progress.value, [0, 1], [fromY, 0]) },
      { scale: interpolate(progress.value, [0, 1], [fromScale, 1]) },
    ],
  }), [fromX, fromY, fromScale]);
  const openFace = useAnimatedStyle(() => ({ opacity: 1 - landedSV.value }));
  const happyFace = useAnimatedStyle(() => ({ opacity: landedSV.value }));
  const line2Style = useAnimatedStyle(() => ({ opacity: line2.value }));
  const line3Style = useAnimatedStyle(() => ({ opacity: line3.value }));

  if (!visible) return null;

  const canSend = draft.trim().length > 0;
  const send = async (text: string) => {
    if (!text.trim()) return;
    setDraft('');
    onOpenChat();
    await sendToRoxy(userId, text);
  };

  const header = (
    <View>
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
  );

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <GestureRoot style={StyleSheet.absoluteFill}>
        <Reanimated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: scrim(SCRIM_ALPHA) }, scrimStyle]}
        />
        <Pressable
          testID="hello-roxy-scrim"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close Roxy AI"
        />

        <Reanimated.View
          testID="hello-roxy-sheet"
          accessibilityViewIsModal
          onLayout={(e) => setSheetH(e.nativeEvent.layout.height)}
          style={[
            s.sheet,
            popElevation(colors),
            {
              backgroundColor: colors.surface,
              paddingBottom: Math.max(insets.bottom, SPACE[2]),
            },
            sheetStyle,
          ]}
        >
          {pan ? <GestureDetector gesture={pan}>{header}</GestureDetector> : header}

          <View style={s.body} accessibilityLiveRegion="polite">
            <Text style={[s.greeting, { color: colors.ink }]} accessibilityRole="header">{greeting.line1}</Text>
            <Reanimated.Text testID="hello-roxy-line-2" style={[s.greeting, { color: colors.ink }, line2Style]}>
              {greeting.line2}
            </Reanimated.Text>
            <Reanimated.Text testID="hello-roxy-line-3" style={[s.intro, { color: colors.ink }, line3Style]}>
              I&apos;m here for the big stuff and the small stuff. Pick one or just start typing.
            </Reanimated.Text>

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

          <Reanimated.View pointerEvents="none" style={[s.avatar, avatarFlight]}>
            <Reanimated.View testID="hello-roxy-face-open" style={[StyleSheet.absoluteFill, openFace]}>
              <RoxyO size={HELLO_AVATAR} mood="open" testID="hello-roxy-avatar-arriving" />
            </Reanimated.View>
            <Reanimated.View testID="hello-roxy-face-happy" style={happyFace}>
              <RoxyO size={HELLO_AVATAR} mood="happy" testID="hello-roxy-avatar" />
            </Reanimated.View>
          </Reanimated.View>
        </Reanimated.View>
      </GestureRoot>
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
