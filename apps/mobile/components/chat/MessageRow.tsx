import { memo, useCallback, useMemo } from 'react';
import {
  View, Text, Image, Pressable, StyleSheet,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring,
} from 'react-native-reanimated';
import { TouchableOpacity } from '../ui/PressableScale';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { format } from 'date-fns';
import { useThemeColors } from '../../hooks/useThemeColors';
import type { ChatMessage } from '../../hooks/useRealtime';
import type { GroupedMessage } from '../../lib/chatThread';
import { replyQuote } from '../../lib/chatThread';
import { avatarGradient } from '../../lib/avatars';
import { inkOn, type ThemeColors, BRAND_INK, pinkFill } from '../../lib/theme';
import { TYPE } from '../../lib/typography';
import { haptic } from '../../lib/haptics';
import { SPRING } from '../../lib/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { MessageStatus } from './MessageStatus';
import { ReactionChips } from './ReactionBar';
import type { MessageReaction } from '../../types';

const AVA = 30;
const AVA_GAP = 8;
/** How far right she pulls a bubble before letting go means "reply". */
export const SWIPE_REPLY_AT = 56;

/** How far past the threshold the bubble can be pulled, at most (dp). */
const SWIPE_OVERPULL = 24;
/** Rubber-band coefficient past the threshold (iOS-like; spec §3.2 GESTURE.rubberBand). */
const RUBBER_BAND = 0.55;

/** Pure, so the gesture threshold is tested without a gesture. */
export function swipeReplyDecision(dx: number, dy: number): 'reply' | 'none' {
  'worklet';
  return dx >= SWIPE_REPLY_AT && Math.abs(dy) < dx / 2 ? 'reply' : 'none';
}

/**
 * Where the bubble sits for a pull of `dx`: 1:1 up to the threshold, then
 * rubber-banded towards `SWIPE_OVERPULL` (never past it). Under Reduce Motion
 * it does not travel at all; the swipe still works.
 */
export function swipeOffset(dx: number, reduced: boolean): number {
  'worklet';
  if (reduced || dx <= 0) return 0;
  if (dx <= SWIPE_REPLY_AT) return dx;
  const over = dx - SWIPE_REPLY_AT;
  return SWIPE_REPLY_AT + (1 - 1 / ((over * RUBBER_BAND) / SWIPE_OVERPULL + 1)) * SWIPE_OVERPULL;
}

/** The spring home on release, carrying the finger's velocity; none under Reduce Motion. */
export function releaseSpring(velocityX: number, reduced: boolean): (typeof SPRING.spatial & { velocity: number }) | null {
  'worklet';
  return reduced ? null : { ...SPRING.spatial, velocity: velocityX };
}

const isWebImage = (url: string | null | undefined): url is string =>
  !!url && /^https:\/\//.test(url);

interface Props {
  message: GroupedMessage;
  /** The message this one answers, when it is loaded. */
  replyTo?: ChatMessage;
  currentUserId: string;
  isGroup: boolean;
  nameOf: (senderId: string | null) => string;
  reactions: MessageReaction[];
  /** Receipts on for both sides (read receipts are reciprocal). */
  showReadState: boolean;
  highlighted?: boolean;
  onLongPress: (m: ChatMessage) => void;
  onReply: (m: ChatMessage) => void;
  onQuotePress: (messageId: string) => void;
  onToggleReaction: (messageId: string, emoji: string, own: boolean) => void;
  onRetry: (m: ChatMessage) => void;
  onUseSuggestion: (text: string) => void;
}

/**
 * One line of the thread.
 *
 * Swipe right on any bubble to reply (iMessage), long-press for the menu.
 * Both are also accessibility actions, so neither is gesture-only. The swipe
 * is a gesture-handler `Pan` running as worklets (UI thread): it claims only a
 * clearly rightward pull (12 dp right before any 12 dp vertical), so the list
 * still scrolls, and the web build behaves like the app.
 */
function MessageRowImpl({
  message: m, replyTo, currentUserId, isGroup, nameOf, reactions, showReadState, highlighted,
  onLongPress, onReply, onQuotePress, onToggleReaction, onRetry, onUseSuggestion,
}: Props) {
  const colors = useThemeColors();
  const s = useMemo(() => styles(colors), [colors]);
  const isOwn = m.sender_id === currentUserId;
  const senderName = nameOf(m.sender_id);
  // A group names the sender above the first bubble of her run, so three
  // people talking stay tellable apart. A 1:1 never does (there is only her),
  // and her own bubbles never carry "You".
  const showSenderName = isGroup && !isOwn && m.showName;

  const reduced = useReducedMotion();
  const x = useSharedValue(0);
  const armed = useSharedValue(false);
  const settled = (m.deliveryStatus ?? 'sent') === 'sent';
  const canReply = settled && !m.deleted_at && !m.isSystem;

  // JS-side ends of the worklets: the threshold tick (selection, §3.3; it
  // stays under Reduce Motion) and the reply itself.
  const tick = useCallback(() => haptic('select'), []);
  const reply = useCallback(() => onReply(m), [onReply, m]);

  const pan = useMemo(() => Gesture.Pan()
    .enabled(canReply)
    .activeOffsetX(12)
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      x.value = swipeOffset(e.translationX, reduced);
      const nowArmed = swipeReplyDecision(e.translationX, e.translationY) === 'reply';
      if (nowArmed && !armed.value) runOnJS(tick)();
      armed.value = nowArmed;
    })
    .onEnd((e) => {
      if (swipeReplyDecision(e.translationX, e.translationY) === 'reply') runOnJS(reply)();
    })
    .onFinalize((e) => {
      armed.value = false;
      const spring = releaseSpring(e.velocityX ?? 0, reduced);
      x.value = spring ? withSpring(0, spring) : 0;
    })
    .withTestId(`swipe-reply-${m.id}`), [canReply, reduced, tick, reply, x, armed, m.id]);

  const bubbleStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  // Under Reduce Motion nothing travels, so the glyph says "armed" instead.
  const hintStyle = useAnimatedStyle(() => ({
    opacity: reduced
      ? (armed.value ? 1 : 0)
      : interpolate(x.value, [0, SWIPE_REPLY_AT], [0, 1], Extrapolation.CLAMP),
  }));

  const timeSep = m.showTimestamp ? <Text style={s.timeSep}>{formatSep(m.created_at)}</Text> : null;

  if (m.isSystem) {
    return (
      <View>
        {timeSep}
        <Text style={s.system} accessibilityRole="text">{m.content}</Text>
      </View>
    );
  }

  if (m.message_type === 'roxy_suggestion') {
    return (
      <View>
        {timeSep}
        <Pressable onLongPress={() => onLongPress(m)} delayLongPress={350} testID={`message-${m.id}`}>
          <View style={[s.roxy, highlighted && s.highlight]}>
            <LinearGradient colors={pinkFill(colors)} style={s.roxyBar} />
            <Text style={s.roxyLabel}>✨ Roxy suggests</Text>
            <Text style={s.roxyText}>{m.content}</Text>
            <TouchableOpacity
              style={s.roxyUse}
              onPress={() => onUseSuggestion(m.content ?? '')}
              accessibilityRole="button"
              accessibilityLabel="Use Roxy's suggestion"
            >
              <LinearGradient colors={pinkFill(colors)} style={s.roxyUseFill}>
                <Text style={s.roxyUseText}>Use this</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </Pressable>
      </View>
    );
  }

  const quote = m.reply_to_id ? replyQuote(replyTo, nameOf) : null;
  const unsent = !!m.deleted_at;
  const body = unsent ? (
    <Text style={[s.unsent, isOwn && s.unsentOwn]}>Message unsent</Text>
  ) : m.message_type === 'image' ? (
    isWebImage(m.media_url) ? (
      <Image
        source={{ uri: m.media_url }}
        style={s.gif}
        resizeMode="cover"
        accessibilityLabel="GIF"
        testID={`message-gif-${m.id}`}
      />
    ) : (
      <Text style={[s.text, isOwn ? s.textOwn : s.textOther]}>Photo</Text>
    )
  ) : (
    <Text style={[s.text, isOwn ? s.textOwn : s.textOther]} selectable>{m.content}</Text>
  );

  return (
    <View>
      {timeSep}
      {showSenderName ? <Text style={s.name} testID={`message-sender-${m.id}`}>{senderName}</Text> : null}
      <View style={s.swipeWrap}>
        <Animated.View style={[s.replyHint, hintStyle]} pointerEvents="none">
          <Ionicons name="arrow-undo" size={18} color={colors.textSecondary} />
        </Animated.View>
        <GestureDetector gesture={pan}>
        <Animated.View style={bubbleStyle}>
          <Pressable
            // A long-press that opens a menu ticks as a selection (§3.3).
            onLongPress={() => { haptic('select'); onLongPress(m); }}
            delayLongPress={320}
            testID={`message-${m.id}`}
            accessibilityLabel={`${isOwn ? 'You' : senderName}: ${unsent ? 'Message unsent' : m.message_type === 'image' ? 'GIF' : m.content ?? ''}`}
            accessibilityHint="Swipe right to reply. Long-press for more."
            accessibilityActions={[
              ...(canReply ? [{ name: 'reply', label: 'Reply' }] : []),
              { name: 'menu', label: 'More actions' },
            ]}
            onAccessibilityAction={(e) => {
              if (e.nativeEvent.actionName === 'reply') onReply(m);
              else if (e.nativeEvent.actionName === 'menu') onLongPress(m);
            }}
          >
            <View style={[s.row, isOwn ? s.rowOwn : s.rowOther]}>
              {!isOwn ? (
                <View style={s.avaSlot}>
                  {m.isLastInGroup ? (
                    <LinearGradient colors={avatarGradient(senderName)} style={s.ava}>
                      <Text style={s.avaText}>{senderName[0]?.toUpperCase() ?? '?'}</Text>
                    </LinearGradient>
                  ) : null}
                </View>
              ) : null}

              <View style={[s.col, isOwn ? s.colOwn : s.colOther]}>
                {quote ? (
                  <TouchableOpacity
                    style={[s.quote, isOwn ? s.quoteOwn : s.quoteOther]}
                    onPress={() => m.reply_to_id && onQuotePress(m.reply_to_id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Replying to ${quote.name || 'a message'}: ${quote.text}`}
                    testID={`reply-quote-${m.id}`}
                  >
                    {quote.name ? <Text style={s.quoteName} numberOfLines={1}>{quote.name}</Text> : null}
                    <Text style={s.quoteText} numberOfLines={2}>{quote.text}</Text>
                  </TouchableOpacity>
                ) : null}

                <View
                  style={[
                    s.bubble,
                    isOwn ? s.bubbleOwn : s.bubbleOther,
                    isOwn && m.isLastInGroup && s.tailOwn,
                    !isOwn && m.isLastInGroup && s.tailOther,
                    m.message_type === 'image' && !unsent && isWebImage(m.media_url) && s.bubbleMedia,
                    unsent && s.bubbleUnsent,
                    highlighted && s.highlight,
                  ]}
                >
                  {body}
                </View>

                {(m.isLastInGroup || m.edited_at || (isOwn && m.deliveryStatus && m.deliveryStatus !== 'sent')) ? (
                  <View style={[s.meta, isOwn ? s.metaOwn : s.metaOther]}>
                    {m.edited_at && !unsent ? <Text style={s.metaText}>Edited</Text> : null}
                    {m.isLastInGroup ? <Text style={s.metaText}>{format(new Date(m.created_at), 'HH:mm')}</Text> : null}
                    {isOwn ? (
                      <MessageStatus
                        status={m.deliveryStatus ?? 'sent'}
                        isRead={showReadState && m.is_read}
                        onRetry={() => onRetry(m)}
                      />
                    ) : null}
                  </View>
                ) : null}
              </View>
            </View>
          </Pressable>
        </Animated.View>
        </GestureDetector>
      </View>

      {reactions.length > 0 ? (
        <View style={[s.reactions, isOwn ? s.reactionsOwn : { paddingLeft: AVA + AVA_GAP }]}>
          <ReactionChips
            reactions={reactions}
            currentUserId={currentUserId}
            // A committed reaction: the light tap (§3.3).
            onToggle={(emoji, own) => { haptic('tap'); onToggleReaction(m.id, emoji, own); }}
          />
        </View>
      ) : null}
    </View>
  );
}

export const MessageRow = memo(MessageRowImpl);

function formatSep(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return `Today ${format(d, 'HH:mm')}`;
  if (d.toDateString() === y.toDateString()) return `Yesterday ${format(d, 'HH:mm')}`;
  return format(d, 'EEE d MMM · HH:mm');
}

const styles = (colors: ThemeColors) => StyleSheet.create({
  timeSep: { ...TYPE.micro, alignSelf: 'center', color: colors.textMuted, marginTop: 14, marginBottom: 6, fontWeight: '600' },
  system: {
    ...TYPE.caption, alignSelf: 'center', textAlign: 'center', color: colors.textMuted,
    marginVertical: 8, paddingHorizontal: 24,
  },
  name: { ...TYPE.micro, color: colors.textSecondary, fontWeight: '700', marginLeft: AVA + AVA_GAP + 10, marginTop: 8, marginBottom: 2 },
  swipeWrap: { position: 'relative' },
  replyHint: { position: 'absolute', left: 6, top: 0, bottom: 0, justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-end', marginVertical: 1 },
  rowOwn: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  avaSlot: { width: AVA + AVA_GAP },
  ava: { width: AVA, height: AVA, borderRadius: AVA / 2, alignItems: 'center', justifyContent: 'center' },
  avaText: { color: BRAND_INK, fontWeight: '800', fontSize: 12 },
  col: { maxWidth: '78%' },
  colOwn: { alignItems: 'flex-end' },
  colOther: { alignItems: 'flex-start' },
  quote: {
    borderLeftWidth: 3, paddingLeft: 8, paddingRight: 10, paddingVertical: 4,
    marginBottom: 3, borderRadius: 8, maxWidth: '100%',
  },
  quoteOwn: { borderLeftColor: colors.primary, backgroundColor: colors.primary + '14' },
  quoteOther: { borderLeftColor: colors.secondary, backgroundColor: colors.surfaceLight },
  quoteName: { ...TYPE.micro, color: colors.textSecondary, fontWeight: '700' },
  quoteText: { ...TYPE.caption, color: colors.textSecondary },
  bubble: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9 },
  bubbleOwn: { backgroundColor: colors.primary },
  bubbleOther: { backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  tailOwn: { borderBottomRightRadius: 6 },
  tailOther: { borderBottomLeftRadius: 6 },
  bubbleMedia: { padding: 3, backgroundColor: 'transparent', borderWidth: 0 },
  bubbleUnsent: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed' },
  highlight: { borderWidth: 2, borderColor: colors.roxy },
  text: { fontSize: 16, lineHeight: 22 },
  textOwn: { color: inkOn(colors.primary) },
  textOther: { color: colors.textPrimary },
  unsent: { ...TYPE.body, fontStyle: 'italic', color: colors.textMuted },
  unsentOwn: { color: colors.textMuted },
  gif: { width: 220, height: 165, borderRadius: 16 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, paddingHorizontal: 4 },
  metaOwn: { justifyContent: 'flex-end' },
  metaOther: { justifyContent: 'flex-start' },
  metaText: { ...TYPE.micro, color: colors.textMuted },
  reactions: { marginTop: -2, marginBottom: 2 },
  reactionsOwn: { alignItems: 'flex-end' },
  roxy: {
    alignSelf: 'center', width: '90%', marginVertical: 8, padding: 14, paddingTop: 17,
    borderRadius: 20, overflow: 'hidden', backgroundColor: colors.roxy + '14',
  },
  roxyBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  roxyLabel: { ...TYPE.micro, color: colors.roxy, fontWeight: '800', marginBottom: 6 },
  roxyText: { ...TYPE.body, color: colors.textPrimary, fontStyle: 'italic' },
  roxyUse: { alignSelf: 'flex-start', marginTop: 10, borderRadius: 12, overflow: 'hidden' },
  roxyUseFill: { paddingHorizontal: 16, paddingVertical: 8 },
  roxyUseText: { color: colors.onPink, fontWeight: '700', fontSize: 13 },
});
