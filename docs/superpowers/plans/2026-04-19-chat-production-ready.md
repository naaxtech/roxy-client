# Chat Production-Ready Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make chat fully functional for real-world use — fix message sync, optimistic failure handling, read receipt realtime, input bar redesign (Roxy ✦ brand button + tray), inline emoji keyboard, edge function error handling, and header cleanup.

**Architecture:** All changes are surgical. `useRealtime` gets a dependency fix and two new capabilities (removeMessage, UPDATE subscription). The chat screen input area is restructured: one `✦` Roxy button replaces 4 unlabelled icons, a labelled `ActionTray` slides up, emoji keyboard renders inline (no modal). Edge functions wrap `callClaude` in try/catch and treat `logAiCall` failure as non-fatal.

**Tech Stack:** React Native 0.74, Expo 51, Supabase Realtime (Postgres Changes INSERT+UPDATE + Broadcast), rn-emoji-keyboard (inline), GIPHY API, Deno edge functions.

**Files changed:**
- Modify: `apps/mobile/hooks/useRealtime.ts` — dep fix, removeMessage, UPDATE subscription
- Modify: `apps/mobile/app/(tabs)/connect/chat/[id].tsx` — message lifecycle, input redesign, header cleanup
- Create: `apps/mobile/components/chat/ActionTray.tsx` — labelled action tray component
- Delete: `apps/mobile/components/chat/EmojiPicker.tsx` — replaced by inline keyboard
- Modify: `supabase/functions/roxy-wingwoman/index.ts` — try/catch, non-fatal log
- Modify: `supabase/functions/roxy-nudge/index.ts` — try/catch, DEV_MOCK placement
- Modify: `apps/mobile/__tests__/hooks/useRealtime.test.ts` — cover new behaviour
- Delete: `apps/mobile/__tests__/components/chat/EmojiPicker.test.tsx` — component deleted

---

## TASK 0: Deploy ANTHROPIC_API_KEY to remote Supabase (manual prerequisite)

This is the most likely cause of the non-2xx errors. Edge functions run on Supabase's servers, not locally.

- [ ] **Step 1: Set the secret on the remote project**

```bash
cd D:/Nicole/Dev/roxy/roxy-client
npx supabase secrets set ANTHROPIC_API_KEY=<your_key> --project-ref ptymtdlysqbpxzlgsshp
```

Replace `<your_key>` with the value from `apps/mobile/.env` (the `ANTHROPIC_API_KEY=` line).

- [ ] **Step 2: Verify**

```bash
npx supabase secrets list --project-ref ptymtdlysqbpxzlgsshp
```

Expected: `ANTHROPIC_API_KEY` appears in the list.

---

## TASK 1: Fix useRealtime — dependency, removeMessage, read-receipt UPDATE

**Files:**
- Modify: `apps/mobile/hooks/useRealtime.ts`
- Modify: `apps/mobile/__tests__/hooks/useRealtime.test.ts`

**Root cause of message sync bug:** `useRealtime` initialises `messages` from `useState(initialMessages)` (which is `[]` at mount), then only calls `setMessages(initialMessages)` inside `useEffect([conversationId])`. When `loadMessages` in the parent finishes and sets `initialMessages = [...]`, the hook never sees the update because `conversationId` didn't change.

- [ ] **Step 1: Rewrite `useRealtime.ts`**

Replace the entire file:

```ts
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Message } from '../types';

interface UseRealtimeOptions {
  conversationId: string;
  initialMessages: Message[];
}

interface UseRealtimeReturn {
  messages: Message[];
  isSubscribed: boolean;
  appendMessage: (msg: Message) => void;
  replaceMessageId: (tempId: string, realId: string) => void;
  removeMessage: (id: string) => void;
}

export function useRealtime({
  conversationId,
  initialMessages,
}: UseRealtimeOptions): UseRealtimeReturn {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Sync messages whenever the parent loads/reloads them (dep on reference, not conversationId)
  useEffect(() => {
    setMessages(initialMessages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessages]);

  const appendMessage = (msg: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  };

  const replaceMessageId = (tempId: string, realId: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === tempId ? { ...m, id: realId } : m))
    );
  };

  const removeMessage = (id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  };

  useEffect(() => {
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          appendMessage(payload.new as Message);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          // Flip is_read so ✓ → ✓✓ updates in realtime when partner reads
          const updated = payload.new as Message;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === updated.id ? { ...m, is_read: updated.is_read } : m
            )
          );
        }
      )
      .subscribe((status) => {
        setIsSubscribed(status === 'SUBSCRIBED');
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      setIsSubscribed(false);
    };
  }, [conversationId]);

  return { messages, isSubscribed, appendMessage, replaceMessageId, removeMessage };
}
```

- [ ] **Step 2: Update `useRealtime.test.ts`**

Replace the entire file:

```ts
jest.mock('../../lib/supabase', () => {
  const channel = jest.fn();
  const removeChannel = jest.fn();
  const on = jest.fn();
  const subscribe = jest.fn();

  on.mockReturnValue({ on, subscribe });
  channel.mockReturnValue({ on, subscribe });

  return { supabase: { channel, removeChannel } };
});

import { act, renderHook } from '@testing-library/react-native';
import { useRealtime } from '../../hooks/useRealtime';
import { Message } from '../../types';

const { supabase } = jest.requireMock('../../lib/supabase');

const makeMsg = (id: string): Message => ({
  id,
  conversation_id: 'conv-1',
  sender_id: 'user-1',
  content: 'hello',
  media_url: null,
  message_type: 'text',
  is_read: false,
  created_at: '2026-01-01T00:00:00Z',
});

describe('useRealtime', () => {
  beforeEach(() => jest.clearAllMocks());

  it('starts with empty messages when initialMessages is []', () => {
    const { result } = renderHook(() =>
      useRealtime({ conversationId: 'conv-1', initialMessages: [] })
    );
    expect(result.current.messages).toHaveLength(0);
  });

  it('syncs messages when initialMessages prop changes', () => {
    const initial: Message[] = [];
    const { result, rerender } = renderHook(
      ({ msgs }) => useRealtime({ conversationId: 'conv-1', initialMessages: msgs }),
      { initialProps: { msgs: initial } }
    );
    expect(result.current.messages).toHaveLength(0);

    const loaded = [makeMsg('msg-1'), makeMsg('msg-2')];
    rerender({ msgs: loaded });
    expect(result.current.messages).toHaveLength(2);
  });

  it('creates a supabase channel on mount', () => {
    renderHook(() => useRealtime({ conversationId: 'conv-1', initialMessages: [] }));
    expect(supabase.channel).toHaveBeenCalledWith('messages:conv-1');
  });

  it('removeChannel is called on unmount', () => {
    const { unmount } = renderHook(() =>
      useRealtime({ conversationId: 'conv-1', initialMessages: [] })
    );
    unmount();
    expect(supabase.removeChannel).toHaveBeenCalled();
  });

  it('appendMessage deduplicates by id', () => {
    const { result } = renderHook(() =>
      useRealtime({ conversationId: 'conv-1', initialMessages: [makeMsg('m1')] })
    );
    act(() => result.current.appendMessage(makeMsg('m1'))); // duplicate
    expect(result.current.messages).toHaveLength(1);
  });

  it('appendMessage adds a new message', () => {
    const { result } = renderHook(() =>
      useRealtime({ conversationId: 'conv-1', initialMessages: [] })
    );
    act(() => result.current.appendMessage(makeMsg('m1')));
    expect(result.current.messages).toHaveLength(1);
  });

  it('replaceMessageId swaps temp id with real id', () => {
    const tmpMsg = makeMsg('tmp-123');
    const { result } = renderHook(() =>
      useRealtime({ conversationId: 'conv-1', initialMessages: [tmpMsg] })
    );
    act(() => result.current.replaceMessageId('tmp-123', 'real-uuid'));
    expect(result.current.messages[0].id).toBe('real-uuid');
  });

  it('removeMessage removes a message by id', () => {
    const { result } = renderHook(() =>
      useRealtime({ conversationId: 'conv-1', initialMessages: [makeMsg('m1'), makeMsg('m2')] })
    );
    act(() => result.current.removeMessage('m1'));
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].id).toBe('m2');
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests --testPathPattern="useRealtime" 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/hooks/useRealtime.ts apps/mobile/__tests__/hooks/useRealtime.test.ts
git commit -m "fix(realtime): sync initialMessages on prop change + removeMessage + UPDATE read-receipt subscription"
```

---

## TASK 2: Fix ChatScreen message lifecycle

**Files:**
- Modify: `apps/mobile/app/(tabs)/connect/chat/[id].tsx`

Three changes: (1) reset `initialMessages` when conversation changes so old messages don't flash, (2) remove failed optimistic messages and offer retry, (3) update `conversations.last_message_at` on successful send.

- [ ] **Step 1: Add reset effect and update `sendMessage`**

In `chat/[id].tsx`, find the destructure of `useRealtime`:

```tsx
const { messages, isSubscribed, appendMessage, replaceMessageId } = useRealtime({
```

Replace with:

```tsx
const { messages, isSubscribed, appendMessage, replaceMessageId, removeMessage } = useRealtime({
```

Find the effect `useEffect(() => { setActiveConversation(...) }, [conversationId])` and add a new effect directly after it:

```tsx
// Reset messages when navigating to a different conversation
useEffect(() => {
  setInitialMessages([]);
}, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 2: Replace `sendMessage` function**

Find the existing `sendMessage` async function and replace it entirely:

```tsx
const sendMessage = async (content: string, type: Message['message_type'] = 'text', mediaUrl?: string) => {
  if ((!content.trim() && !mediaUrl) || !user || !conversationId) return;
  setSending(true);
  const optimisticMsg: Message = {
    id: `tmp-${Date.now()}`,
    conversation_id: conversationId,
    sender_id: user.id,
    content: content.trim() || null,
    media_url: mediaUrl ?? null,
    message_type: type,
    is_read: false,
    created_at: new Date().toISOString(),
  };
  appendMessage(optimisticMsg);
  setInputText('');

  const { data: inserted, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: user.id,
      content: content.trim() || null,
      media_url: mediaUrl ?? null,
      message_type: type,
    })
    .select('id')
    .single();

  if (error) {
    removeMessage(optimisticMsg.id);
    Alert.alert(
      'Message not sent',
      'Could not deliver your message.',
      [
        { text: 'Dismiss', style: 'cancel' },
        { text: 'Retry', onPress: () => void sendMessage(content, type, mediaUrl) },
      ]
    );
  } else if (inserted?.id) {
    replaceMessageId(optimisticMsg.id, inserted.id);
    Analytics.messageSent(conversationId);
    // Update conversation list order (fire-and-forget, non-critical)
    supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId)
      .then(null, () => {});
  }
  setSending(false);
};
```

- [ ] **Step 3: Verify**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/\(tabs\)/connect/chat/\[id\].tsx
git commit -m "fix(chat): reset messages on conversation change + optimistic failure retry + last_message_at update"
```

---

## TASK 3: Fix edge function error handling

**Files:**
- Modify: `supabase/functions/roxy-wingwoman/index.ts`
- Modify: `supabase/functions/roxy-nudge/index.ts`

Root cause: `callClaude(...)` throws if Anthropic SDK fails (wrong key, rate limit, network). No try/catch → unhandled rejection → 500. Also `roxy-wingwoman` hard-fails on a non-critical log insert. `roxy-nudge` declares `DEV_MOCK` after DB calls (violates anti-pattern #11).

- [ ] **Step 1: Rewrite `roxy-wingwoman/index.ts`**

```ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT } from '../_shared/auth.ts';
import { callClaude } from '../_shared/claude.ts';
import { checkRateLimit, logAiCall } from '../_shared/rateLimit.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

const MOCK_SUGGESTION = "That sounds really interesting — tell me more!";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const body = await req.json();
  const { conversation_id, message_history, current_message } = body;

  if (!conversation_id) return errorResponse('conversation_id required', 400);
  if (!current_message) return errorResponse('current_message required', 400);

  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

  const { allowed, currentCount } = await checkRateLimit({
    userId: auth.userId,
    fnName: 'roxy-wingwoman',
    maxCount: 5,
    windowType: 'daily',
  });
  if (!allowed) {
    return errorResponse(`Daily wingwoman limit reached (${currentCount}/5)`, 429);
  }

  if (DEV_MOCK) return successResponse({ suggestion: MOCK_SUGGESTION });

  const recentHistory = Array.isArray(message_history)
    ? message_history.slice(-6)
    : [];

  const historyText = recentHistory.length > 0
    ? recentHistory.map((m: { sender: string; content: string }) => `${m.sender}: ${m.content}`).join('\n')
    : 'No prior messages.';

  let suggestion: string;
  try {
    suggestion = await callClaude({
      system: `You are Roxy, WLW AI wingwoman. Suggest ONE short, warm follow-up message (max 15 words) that continues the conversation naturally. Be genuine, not sycophantic. No quotes. Just the suggestion text.`,
      messages: [
        {
          role: 'user',
          content: `Recent conversation:\n${historyText}\n\nThey just typed: "${current_message}"\n\nSuggest a reply.`,
        },
      ],
      maxTokens: 200,
      mockResponse: MOCK_SUGGESTION,
    });
  } catch {
    return errorResponse('AI temporarily unavailable, please try again', 503);
  }

  // Log call — non-critical, do not fail the request if this errors
  await logAiCall({
    userId: auth.userId,
    fnName: 'roxy-wingwoman',
    wasMock: false,
    conversationId: conversation_id,
  }).catch(() => {});

  return successResponse({ suggestion });
});
```

- [ ] **Step 2: Rewrite `roxy-nudge/index.ts`**

```ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { checkRateLimit, logAiCall } from '../_shared/rateLimit.ts';
import { callClaude } from '../_shared/claude.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

const MOCK_NUDGE = "She might love hearing from you — even a small 'hey' can spark something special 💜";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const body = await req.json();
  const { conversation_id } = body;
  if (!conversation_id) return errorResponse('conversation_id required', 400);

  // DEV_MOCK must be declared before any DB calls (anti-pattern #11)
  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

  const { allowed } = await checkRateLimit({
    userId: auth.userId,
    fnName: 'roxy-nudge',
    maxCount: 3,
    windowType: 'conversation',
    conversationId: conversation_id,
  });
  if (!allowed) return errorResponse('Nudge limit reached — 3 nudges per conversation', 429);

  if (DEV_MOCK) return successResponse({ nudge: MOCK_NUDGE });

  const supabase = getSupabaseClient();

  const { data: conv } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversation_id)
    .contains('participant_ids', [auth.userId])
    .maybeSingle();
  if (!conv) return errorResponse('Forbidden', 403);

  const { data: recentMessages } = await supabase
    .from('messages')
    .select('sender_id, content')
    .eq('conversation_id', conversation_id)
    .order('created_at', { ascending: false })
    .limit(3);

  const context = (recentMessages ?? [])
    .reverse()
    .map((m: { sender_id: string; content: string }) =>
      `${m.sender_id === auth.userId ? 'You' : 'Her'}: ${m.content ?? '[media]'}`
    )
    .join('\n');

  let nudge: string;
  try {
    nudge = await callClaude({
      system: `You are Roxy, a warm and encouraging WLW wingwoman. The user wants a gentle nudge to re-engage with someone they've been chatting with. Write one encouraging sentence (max 18 words) that feels personal and warm, ending with a 💜 emoji. Never be pushy.`,
      messages: [{ role: 'user', content: context ? `Recent messages:\n${context}\n\nGenerate nudge.` : 'Generate nudge.' }],
      maxTokens: 120,
      mockResponse: MOCK_NUDGE,
    });
  } catch {
    return errorResponse('AI temporarily unavailable, please try again', 503);
  }

  await logAiCall({
    userId: auth.userId,
    fnName: 'roxy-nudge',
    wasMock: false,
    conversationId: conversation_id,
  }).catch(() => {});

  return successResponse({ nudge });
});
```

- [ ] **Step 3: Verify TypeScript (Deno)**

```bash
cd D:/Nicole/Dev/roxy/roxy-client && npx supabase functions serve --no-verify-jwt 2>&1 | head -5
```

Expected: starts without import errors (Ctrl+C to stop).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/roxy-wingwoman/index.ts supabase/functions/roxy-nudge/index.ts
git commit -m "fix(edge): wrap callClaude in try/catch, non-fatal logAiCall, fix DEV_MOCK placement in nudge"
```

---

## TASK 4: Create ActionTray component

**Files:**
- Create: `apps/mobile/components/chat/ActionTray.tsx`

The tray slides in above the input bar when the ✦ Roxy button is tapped. Four labelled chips: Emoji, GIF, Wingwoman, Nudge.

- [ ] **Step 1: Create the file**

```tsx
// apps/mobile/components/chat/ActionTray.tsx
import React from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native';
import { COLORS } from '../../lib/constants';

interface ActionTrayProps {
  onEmojiPress: () => void;
  onGifPress: () => void;
  onWingwomanPress: () => void;
  onNudgePress: () => void;
  wingwomanLoading: boolean;
  nudgeLoading: boolean;
}

export function ActionTray({
  onEmojiPress,
  onGifPress,
  onWingwomanPress,
  onNudgePress,
  wingwomanLoading,
  nudgeLoading,
}: ActionTrayProps) {
  return (
    <View style={styles.tray}>
      <TouchableOpacity style={styles.chip} onPress={onEmojiPress} hitSlop={4}>
        <Text style={styles.chipIcon}>😊</Text>
        <Text style={styles.chipLabel}>Emoji</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.chip} onPress={onGifPress} hitSlop={4}>
        <Text style={styles.chipLabel}>GIF</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.chip, styles.chipRoxy]}
        onPress={onWingwomanPress}
        disabled={wingwomanLoading}
        hitSlop={4}
      >
        {wingwomanLoading ? (
          <ActivityIndicator size="small" color={COLORS.roxy} />
        ) : (
          <>
            <Text style={styles.chipIcon}>✨</Text>
            <Text style={[styles.chipLabel, styles.chipLabelRoxy]}>Wingwoman</Text>
          </>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.chip, styles.chipRoxy]}
        onPress={onNudgePress}
        disabled={nudgeLoading}
        hitSlop={4}
      >
        {nudgeLoading ? (
          <ActivityIndicator size="small" color={COLORS.roxy} />
        ) : (
          <>
            <Text style={styles.chipIcon}>💜</Text>
            <Text style={[styles.chipLabel, styles.chipLabelRoxy]}>Nudge</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  tray: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.surface,
    backgroundColor: COLORS.background,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipRoxy: {
    borderWidth: 1,
    borderColor: COLORS.roxy + '40',
  },
  chipIcon: { fontSize: 14 },
  chipLabel: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '500' },
  chipLabelRoxy: { color: COLORS.roxy },
});
```

- [ ] **Step 2: Verify**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -10
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/components/chat/ActionTray.tsx
git commit -m "feat(chat): add ActionTray component — labelled chips for emoji/GIF/wingwoman/nudge"
```

---

## TASK 5: Redesign chat input area — ✦ button, tray, inline emoji

**Files:**
- Modify: `apps/mobile/app/(tabs)/connect/chat/[id].tsx`
- Delete: `apps/mobile/components/chat/EmojiPicker.tsx`

Replace the crowded 4-icon input bar with a clean 3-element bar: `[✦]` `[input]` `[→]`. The ✦ Roxy button opens the ActionTray. Emoji from the tray opens `rn-emoji-keyboard` inline (no modal, no keyboard dismiss confusion).

- [ ] **Step 1: Delete EmojiPicker.tsx**

Delete the file `apps/mobile/components/chat/EmojiPicker.tsx` — it's replaced by the inline keyboard.

- [ ] **Step 2: Update imports in `chat/[id].tsx`**

Find the current imports block. Make these changes:

Remove:
```tsx
import { EmojiPicker } from '../../../../components/chat/EmojiPicker';
```

Add (at the end of the imports block):
```tsx
import EmojiKeyboard from 'rn-emoji-keyboard';
import { ActionTray } from '../../../../components/chat/ActionTray';
```

Also add `Keyboard` and `TextInput` (as a type for the ref) to the react-native import if not already present:
```tsx
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
  Modal, FlatList, Image, Pressable, Keyboard,
} from 'react-native';
```

- [ ] **Step 3: Replace state declarations for pickers**

Find:
```tsx
const [showEmojiPicker, setShowEmojiPicker] = useState(false);
const [showGifPicker, setShowGifPicker] = useState(false);
```

Replace with:
```tsx
const [showTray, setShowTray] = useState(false);
const [showEmojiKeyboard, setShowEmojiKeyboard] = useState(false);
const [showGifPicker, setShowGifPicker] = useState(false);
const inputRef = useRef<TextInput>(null);
```

- [ ] **Step 4: Replace the input bar JSX**

Find the entire `<View style={styles.inputBar}>` block (from `<View style={styles.inputBar}>` to its closing `</View>`, which is just before `</KeyboardAvoidingView>`). Replace it with:

```tsx
        <View>
          {showTray && (
            <ActionTray
              onEmojiPress={() => {
                Keyboard.dismiss();
                setShowEmojiKeyboard((v) => !v);
              }}
              onGifPress={() => {
                setShowTray(false);
                setShowEmojiKeyboard(false);
                setShowGifPicker(true);
              }}
              onWingwomanPress={() => {
                setShowTray(false);
                void handleWingwoman();
              }}
              onNudgePress={() => {
                setShowTray(false);
                void handleNudge();
              }}
              wingwomanLoading={wingwomanLoading}
              nudgeLoading={nudgeLoading}
            />
          )}

          {showEmojiKeyboard && (
            <View style={styles.inlineEmojiContainer}>
              <EmojiKeyboard
                onEmojiSelected={({ emoji }: { emoji: string }) => {
                  setInputText((prev) => prev + emoji);
                }}
                expandable={false}
                styles={{ container: { height: 300 } }}
              />
            </View>
          )}

          <View style={styles.inputBar}>
            <TouchableOpacity
              style={[styles.roxyBtn, showTray && styles.roxyBtnActive]}
              onPress={() => {
                setShowTray((v) => !v);
                setShowEmojiKeyboard(false);
              }}
              hitSlop={8}
            >
              <Text style={styles.roxyBtnText}>✦</Text>
            </TouchableOpacity>

            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder="Say something..."
              placeholderTextColor={COLORS.textMuted}
              value={inputText}
              onChangeText={(t) => { setInputText(t); sendTyping(); }}
              onFocus={() => setShowEmojiKeyboard(false)}
              multiline
              maxLength={2000}
            />

            <TouchableOpacity
              style={[styles.sendBtn, (!inputText.trim() || sending) && styles.sendBtnDisabled]}
              onPress={() => void sendMessage(inputText)}
              disabled={!inputText.trim() || sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.sendBtnText}>›</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
```

- [ ] **Step 5: Remove EmojiPicker from JSX**

Find and delete this block entirely:
```tsx
      <EmojiPicker
        visible={showEmojiPicker}
        onEmojiSelected={(emoji) => setInputText((prev) => prev + emoji)}
        onClose={() => setShowEmojiPicker(false)}
      />
```

- [ ] **Step 6: Update styles**

In the `StyleSheet.create({...})`, find the old icon button styles and replace/add:

Remove these old styles (no longer used):
```ts
  iconBtn: { ... },
  iconBtnText: { ... },
  wingwomanBtn: { ... },
  wingwomanIcon: { ... },
  nudgeBtn: { ... },
  nudgeBtnDisabled: { ... },
  nudgeBtnText: { ... },
```

Replace `inputBar` style with:
```ts
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.surface,
    backgroundColor: COLORS.background,
  },
```

Add these new styles (before `sendBtn`):
```ts
  roxyBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.roxy + '50',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  roxyBtnActive: {
    backgroundColor: COLORS.roxy + '18',
    borderColor: COLORS.roxy,
  },
  roxyBtnText: {
    color: COLORS.roxy,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
  inlineEmojiContainer: {
    borderTopWidth: 1,
    borderTopColor: COLORS.surface,
  },
```

- [ ] **Step 7: Verify**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors. Fix any import or type errors before continuing.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/app/\(tabs\)/connect/chat/\[id\].tsx apps/mobile/components/chat/ActionTray.tsx
git rm apps/mobile/components/chat/EmojiPicker.tsx
git commit -m "feat(chat): redesign input bar — Roxy ✦ button, ActionTray, inline emoji keyboard"
```

---

## TASK 6: Header cleanup — remove misleading dot, move search to menu

**Files:**
- Modify: `apps/mobile/app/(tabs)/connect/chat/[id].tsx`

The green/grey dot shows `isSubscribed` (your realtime connection) next to the partner's name — users read it as "she's online." It's not. Remove it. Move search into the ••• menu.

- [ ] **Step 1: Replace headerRight JSX**

Find:
```tsx
            <View style={styles.headerRight}>
              <View style={[styles.dot, isSubscribed ? styles.dotConnected : styles.dotDisconnected]} />
              <TouchableOpacity onPress={() => setSearchActive(true)} hitSlop={12}>
                <Text style={styles.searchIcon}>🔍</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.menuBtn}
                onPress={() => setMenuVisible(true)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.menuBtnText}>•••</Text>
              </TouchableOpacity>
            </View>
```

Replace with:
```tsx
            <TouchableOpacity
              style={styles.menuBtn}
              onPress={() => setMenuVisible(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.menuBtnText}>•••</Text>
            </TouchableOpacity>
```

- [ ] **Step 2: Add Search to ••• modal**

Find the ••• modal's `actionSheet` view. It currently starts with the Block row. Add a Search row as the first option:

```tsx
          <View style={styles.actionSheet}>
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => { setMenuVisible(false); setSearchActive(true); }}
            >
              <Text style={styles.actionRowIcon}>⌕</Text>
              <Text style={styles.actionRowText}>Search messages</Text>
            </TouchableOpacity>
            <View style={styles.actionSeparator} />
            {/* existing Block row follows */}
```

- [ ] **Step 3: Clean up unused styles**

Remove these styles that are no longer referenced:
```ts
  headerRight: { ... },
  dot: { ... },
  dotConnected: { ... },
  dotDisconnected: { ... },
  searchIcon: { ... },
```

- [ ] **Step 4: Verify**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -10
cd apps/mobile && npx eslint app/\(tabs\)/connect/chat/\[id\].tsx --ext .tsx --max-warnings 0 2>&1 | tail -10
```

Expected: zero errors and zero warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/\(tabs\)/connect/chat/\[id\].tsx
git commit -m "fix(chat): remove misleading connection dot, move search to ••• menu"
```

---

## TASK 7: Remove EmojiPicker test, update ActionTray test

**Files:**
- Delete: `apps/mobile/__tests__/components/chat/EmojiPicker.test.tsx`
- Create: `apps/mobile/__tests__/components/chat/ActionTray.test.tsx`

- [ ] **Step 1: Delete EmojiPicker test**

Delete the file `apps/mobile/__tests__/components/chat/EmojiPicker.test.tsx`.

- [ ] **Step 2: Create ActionTray test**

```tsx
// apps/mobile/__tests__/components/chat/ActionTray.test.tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ActionTray } from '../../../components/chat/ActionTray';

const defaultProps = {
  onEmojiPress: jest.fn(),
  onGifPress: jest.fn(),
  onWingwomanPress: jest.fn(),
  onNudgePress: jest.fn(),
  wingwomanLoading: false,
  nudgeLoading: false,
};

describe('ActionTray', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders Emoji, GIF, Wingwoman, and Nudge chips', () => {
    const { getByText } = render(<ActionTray {...defaultProps} />);
    expect(getByText('Emoji')).toBeTruthy();
    expect(getByText('GIF')).toBeTruthy();
    expect(getByText('Wingwoman')).toBeTruthy();
    expect(getByText('Nudge')).toBeTruthy();
  });

  it('calls onEmojiPress when Emoji chip tapped', () => {
    const onEmojiPress = jest.fn();
    const { getByText } = render(<ActionTray {...defaultProps} onEmojiPress={onEmojiPress} />);
    fireEvent.press(getByText('Emoji'));
    expect(onEmojiPress).toHaveBeenCalled();
  });

  it('calls onGifPress when GIF chip tapped', () => {
    const onGifPress = jest.fn();
    const { getByText } = render(<ActionTray {...defaultProps} onGifPress={onGifPress} />);
    fireEvent.press(getByText('GIF'));
    expect(onGifPress).toHaveBeenCalled();
  });

  it('calls onWingwomanPress when Wingwoman chip tapped', () => {
    const onWingwomanPress = jest.fn();
    const { getByText } = render(<ActionTray {...defaultProps} onWingwomanPress={onWingwomanPress} />);
    fireEvent.press(getByText('Wingwoman'));
    expect(onWingwomanPress).toHaveBeenCalled();
  });

  it('calls onNudgePress when Nudge chip tapped', () => {
    const onNudgePress = jest.fn();
    const { getByText } = render(<ActionTray {...defaultProps} onNudgePress={onNudgePress} />);
    fireEvent.press(getByText('Nudge'));
    expect(onNudgePress).toHaveBeenCalled();
  });

  it('shows spinner and disables Wingwoman chip when loading', () => {
    const onWingwomanPress = jest.fn();
    const { queryByText } = render(
      <ActionTray {...defaultProps} wingwomanLoading={true} onWingwomanPress={onWingwomanPress} />
    );
    expect(queryByText('Wingwoman')).toBeNull(); // replaced by spinner
  });

  it('shows spinner and disables Nudge chip when loading', () => {
    const { queryByText } = render(
      <ActionTray {...defaultProps} nudgeLoading={true} />
    );
    expect(queryByText('Nudge')).toBeNull(); // replaced by spinner
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests --testPathPattern="ActionTray|useRealtime" 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git rm apps/mobile/__tests__/components/chat/EmojiPicker.test.tsx
git add apps/mobile/__tests__/components/chat/ActionTray.test.tsx
git commit -m "test(chat): remove EmojiPicker test (component deleted), add ActionTray tests"
```

---

## TASK 8: QA loop

- [ ] **Step 1: Lint**

```bash
cd apps/mobile && npx eslint . --ext .ts,.tsx --max-warnings 0 2>&1 | tail -20
```

Fix any errors. Re-run until clean.

- [ ] **Step 2: TypeScript**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -40
cd apps/studio && npx tsc --noEmit 2>&1 | head -20
```

Fix all errors. Re-run until zero.

- [ ] **Step 3: Tests**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -10
```

Expected: all suites pass, zero failures. Test count will be slightly lower (EmojiPicker test removed, ActionTray + useRealtime tests added).

- [ ] **Step 4: Update log**

Append to `.claude/log.md`:

```
[2026-04-19] [CLIENT] [FEATURE] Session 16 complete — chat production-ready. Fixes: useRealtime sync (initialMessages dep), removeMessage + retry alert, UPDATE subscription for read receipts, last_message_at on send, input bar redesign (Roxy ✦ button + ActionTray), inline EmojiKeyboard, edge function try/catch + non-fatal logAiCall, DEV_MOCK fix in nudge, removed misleading connection dot, search moved to ••• menu. QA: lint ✓ tsc ✓ jest ✓. [FILES: useRealtime.ts, chat/[id].tsx, ActionTray.tsx, roxy-wingwoman/index.ts, roxy-nudge/index.ts, EmojiPicker.tsx deleted]
```

- [ ] **Step 5: Commit and push**

```bash
git add .claude/log.md
git commit -m "chore: QA pass — lint ✓ tsc ✓ jest ✓ — session 16 chat production-ready"
git push
```

- [ ] **Step 6: Create PR**

```bash
gh pr create --base main --title "feat(session-16): chat production-ready — sync fix, input redesign, edge function fixes" --body "..."
```

---

## SELF-REVIEW

**Spec coverage:**
- ✅ useRealtime initialMessages sync (Task 1)
- ✅ removeMessage + optimistic failure retry (Task 2)
- ✅ UPDATE subscription for read receipts (Task 1)
- ✅ last_message_at update on send (Task 2)
- ✅ Edge function try/catch (Task 3)
- ✅ logAiCall non-fatal (Task 3)
- ✅ DEV_MOCK placement fix in nudge (Task 3)
- ✅ ANTHROPIC_API_KEY deployment reminder (Task 0)
- ✅ ActionTray component (Task 4)
- ✅ Input bar redesign — ✦ Roxy button (Task 5)
- ✅ Inline emoji keyboard — no modal (Task 5)
- ✅ Remove misleading connection dot (Task 6)
- ✅ Search moved to ••• menu (Task 6)
- ✅ EmojiPicker.tsx deleted (Task 5 + 7)
- ✅ Tests updated (Tasks 1 + 7)

**Not in scope (deferred):**
- Message pagination (100 message cap stays; future plan)
