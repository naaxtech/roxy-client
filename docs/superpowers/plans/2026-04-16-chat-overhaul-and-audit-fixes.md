# Chat Overhaul + Audit Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all chat bugs, add standard chat features (emoji, GIFs, reactions, search, typing, read receipts), fix all 25 audit issues across mobile + studio.

**Architecture:** Chat features are added to the existing `chat/[id].tsx` screen via new component files in `apps/mobile/components/chat/`. Each feature is isolated — emoji picker, GIF picker, and reactions each have their own component and hook. Studio fixes are targeted edits to existing pages. Mobile audit fixes are surgical changes to individual screens.

**Tech Stack:** React Native 0.74, Expo 51, Supabase Realtime (Broadcast + Postgres Changes), `rn-emoji-keyboard`, Tenor REST API (free), Zustand, shadcn/ui (studio), Next.js 16 App Router.

**Prerequisites before Task 1:**
- Get a free Tenor API key: https://developers.google.com/tenor/guides/quickstart
- Add `EXPO_PUBLIC_TENOR_API_KEY=your_key` to `apps/mobile/.env`

---

## TASK 1: DB Migration — message_reactions

**Files:**
- Create: `supabase/migrations/035_message_reactions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/035_message_reactions.sql
CREATE TABLE public.message_reactions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id    uuid        NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji         text        NOT NULL CHECK (char_length(emoji) <= 8),
  created_at    timestamptz DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

-- Anyone in the conversation can read reactions (join via messages table)
CREATE POLICY "reactions_select" ON public.message_reactions
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.messages m
      JOIN public.conversations c ON c.id = m.conversation_id
      WHERE m.id = message_reactions.message_id
        AND auth.uid() = ANY(c.participant_ids)
    )
  );

-- Users can only insert their own reactions
CREATE POLICY "reactions_insert" ON public.message_reactions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- Users can only delete their own reactions
CREATE POLICY "reactions_delete" ON public.message_reactions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE INDEX idx_reactions_message ON public.message_reactions (message_id);
CREATE INDEX idx_reactions_user    ON public.message_reactions (user_id);
```

- [ ] **Step 2: Apply migration**

```bash
cd D:/Nicole/Dev/roxy/roxy-client
npx supabase db push
```

Expected: migration 035 applied with no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/035_message_reactions.sql
git commit -m "feat(db): add message_reactions table with RLS"
```

---

## TASK 2: Install emoji keyboard library

**Files:**
- Modify: `apps/mobile/package.json`

- [ ] **Step 1: Install**

```bash
cd apps/mobile
npm install rn-emoji-keyboard --legacy-peer-deps
```

Expected: package installs, no peer dep errors.

- [ ] **Step 2: Verify import works**

```bash
cd apps/mobile
npx tsc --noEmit 2>&1 | head -20
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/package.json apps/mobile/package-lock.json
git commit -m "chore(mobile): install rn-emoji-keyboard"
```

---

## TASK 3: Add MessageReaction type + extend Message type

**Files:**
- Modify: `apps/mobile/types/index.ts`

- [ ] **Step 1: Read current types**

Read `apps/mobile/types/index.ts` and locate the `Message` interface.

- [ ] **Step 2: Add MessageReaction type and reactions field to Message**

Find the `Message` interface and add `reactions?` field. Also add `MessageReaction` type:

```ts
export interface MessageReaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

// Add to existing Message interface:
export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  content: string | null;
  media_url: string | null;
  message_type: 'text' | 'image' | 'voice' | 'roxy_suggestion';
  is_read: boolean;
  created_at: string;
  reactions?: MessageReaction[]; // NEW
}
```

- [ ] **Step 3: Verify**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/types/index.ts
git commit -m "feat(types): add MessageReaction type + reactions field on Message"
```

---

## TASK 4: Create useReactions hook

**Files:**
- Create: `apps/mobile/hooks/useReactions.ts`

- [ ] **Step 1: Write the hook**

```ts
// apps/mobile/hooks/useReactions.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { MessageReaction } from '../types';

type ReactionsMap = Record<string, MessageReaction[]>; // message_id → reactions

interface UseReactionsOptions {
  conversationId: string;
  messageIds: string[];
}

interface UseReactionsReturn {
  reactionsMap: ReactionsMap;
  addReaction: (messageId: string, emoji: string, userId: string) => Promise<void>;
  removeReaction: (messageId: string, emoji: string, userId: string) => Promise<void>;
}

export function useReactions({ conversationId, messageIds }: UseReactionsOptions): UseReactionsReturn {
  const [reactionsMap, setReactionsMap] = useState<ReactionsMap>({});
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Initial load — fetch all reactions for these messages
  useEffect(() => {
    if (messageIds.length === 0) return;
    void (async () => {
      const { data } = await supabase
        .from('message_reactions')
        .select('*')
        .in('message_id', messageIds);
      if (!data) return;
      const map: ReactionsMap = {};
      for (const r of data as MessageReaction[]) {
        if (!map[r.message_id]) map[r.message_id] = [];
        map[r.message_id].push(r);
      }
      setReactionsMap(map);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]); // re-fetch when conversation changes

  // Realtime via Broadcast on reactions:${conversationId}
  useEffect(() => {
    const channel = supabase
      .channel(`reactions:${conversationId}`)
      .on('broadcast', { event: 'reaction_added' }, ({ payload }: { payload: MessageReaction }) => {
        setReactionsMap((prev) => {
          const existing = prev[payload.message_id] ?? [];
          const alreadyHas = existing.some(
            (r) => r.user_id === payload.user_id && r.emoji === payload.emoji
          );
          if (alreadyHas) return prev;
          return { ...prev, [payload.message_id]: [...existing, payload] };
        });
      })
      .on('broadcast', { event: 'reaction_removed' }, ({ payload }: { payload: { message_id: string; user_id: string; emoji: string } }) => {
        setReactionsMap((prev) => {
          const existing = prev[payload.message_id] ?? [];
          return {
            ...prev,
            [payload.message_id]: existing.filter(
              (r) => !(r.user_id === payload.user_id && r.emoji === payload.emoji)
            ),
          };
        });
      })
      .subscribe();

    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [conversationId]);

  const addReaction = useCallback(async (messageId: string, emoji: string, userId: string) => {
    const reaction: Omit<MessageReaction, 'id' | 'created_at'> = {
      message_id: messageId,
      user_id: userId,
      emoji,
    };
    // Optimistic update
    const optimistic: MessageReaction = {
      ...reaction,
      id: `tmp-${Date.now()}`,
      created_at: new Date().toISOString(),
    };
    setReactionsMap((prev) => {
      const existing = prev[messageId] ?? [];
      if (existing.some((r) => r.user_id === userId && r.emoji === emoji)) return prev;
      return { ...prev, [messageId]: [...existing, optimistic] };
    });
    // DB insert
    const { data: inserted } = await supabase
      .from('message_reactions')
      .insert(reaction)
      .select()
      .single();
    // Broadcast to other participants
    if (inserted) {
      await supabase.channel(`reactions:${conversationId}`).send({
        type: 'broadcast',
        event: 'reaction_added',
        payload: inserted,
      });
    }
  }, [conversationId]);

  const removeReaction = useCallback(async (messageId: string, emoji: string, userId: string) => {
    // Optimistic update
    setReactionsMap((prev) => ({
      ...prev,
      [messageId]: (prev[messageId] ?? []).filter(
        (r) => !(r.user_id === userId && r.emoji === emoji)
      ),
    }));
    // DB delete
    await supabase
      .from('message_reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .eq('emoji', emoji);
    // Broadcast to other participants
    await supabase.channel(`reactions:${conversationId}`).send({
      type: 'broadcast',
      event: 'reaction_removed',
      payload: { message_id: messageId, user_id: userId, emoji },
    });
  }, [conversationId]);

  return { reactionsMap, addReaction, removeReaction };
}
```

- [ ] **Step 2: Verify**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/hooks/useReactions.ts
git commit -m "feat(chat): add useReactions hook — reactions via Broadcast + DB"
```

---

## TASK 5: Create EmojiPicker component

**Files:**
- Create: `apps/mobile/components/chat/EmojiPicker.tsx`

- [ ] **Step 1: Create directory and component**

```tsx
// apps/mobile/components/chat/EmojiPicker.tsx
import React from 'react';
import { Modal, View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import EmojiKeyboard from 'rn-emoji-keyboard';
import { COLORS } from '../../lib/constants';

interface EmojiPickerProps {
  visible: boolean;
  onEmojiSelected: (emoji: string) => void;
  onClose: () => void;
}

export function EmojiPicker({ visible, onEmojiSelected, onClose }: EmojiPickerProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.container}>
        <EmojiKeyboard
          onEmojiSelected={(emoji) => {
            onEmojiSelected(emoji.emoji);
            onClose();
          }}
          theme={{
            backdrop: 'transparent',
            knob: COLORS.primary,
            container: COLORS.surface,
            header: COLORS.textPrimary,
            skinTonesContainer: COLORS.surfaceLight,
            category: {
              icon: COLORS.textMuted,
              iconActive: COLORS.primary,
              container: COLORS.surface,
              containerActive: COLORS.primary + '20',
            },
          }}
          styles={{
            container: { height: 320 },
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  container: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
});
```

- [ ] **Step 2: Verify**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/components/chat/EmojiPicker.tsx
git commit -m "feat(chat): add EmojiPicker component using rn-emoji-keyboard"
```

---

## TASK 6: Create GifPicker component

**Files:**
- Create: `apps/mobile/components/chat/GifPicker.tsx`

- [ ] **Step 1: Write the component**

```tsx
// apps/mobile/components/chat/GifPicker.tsx
import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  FlatList, Image, ActivityIndicator, StyleSheet, Dimensions,
} from 'react-native';
import { COLORS } from '../../lib/constants';

const TENOR_KEY = process.env.EXPO_PUBLIC_TENOR_API_KEY ?? '';
const TENOR_BASE = 'https://tenor.googleapis.com/v2';
const COL_WIDTH = (Dimensions.get('window').width - 48) / 2;

interface TenorResult {
  id: string;
  title: string;
  media_formats: { gif: { url: string; dims: [number, number] } };
}

interface GifPickerProps {
  visible: boolean;
  onGifSelected: (url: string) => void;
  onClose: () => void;
}

export function GifPicker({ visible, onGifSelected, onClose }: GifPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TenorResult[]>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const endpoint = q.trim()
        ? `${TENOR_BASE}/search?q=${encodeURIComponent(q)}&key=${TENOR_KEY}&limit=20&media_filter=gif`
        : `${TENOR_BASE}/featured?key=${TENOR_KEY}&limit=20&media_filter=gif`;
      const res = await fetch(endpoint);
      const json = await res.json() as { results: TenorResult[] };
      setResults(json.results ?? []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load featured GIFs when picker opens
  useEffect(() => {
    if (visible) void search('');
  }, [visible, search]);

  // Debounce search on query change
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => void search(query), 400);
    return () => clearTimeout(t);
  }, [query, visible, search]);

  const handleSelect = (url: string) => {
    onGifSelected(url);
    onClose();
    setQuery('');
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>GIFs</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Text style={styles.closeBtn}>✕</Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={styles.searchInput}
          placeholder="Search GIFs..."
          placeholderTextColor={COLORS.textMuted}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
        />

        {loading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 32 }} />
        ) : (
          <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            numColumns={2}
            columnWrapperStyle={styles.row}
            contentContainerStyle={styles.grid}
            renderItem={({ item }) => {
              const [w, h] = item.media_formats.gif.dims;
              const displayH = (COL_WIDTH / w) * h;
              return (
                <TouchableOpacity onPress={() => handleSelect(item.media_formats.gif.url)}>
                  <Image
                    source={{ uri: item.media_formats.gif.url }}
                    style={[styles.gif, { width: COL_WIDTH, height: Math.min(displayH, 200) }]}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <Text style={styles.empty}>No GIFs found</Text>
            }
          />
        )}
        <Text style={styles.poweredBy}>Powered by Tenor</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  container: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surface,
  },
  headerTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 17 },
  closeBtn: { color: COLORS.textMuted, fontSize: 18, fontWeight: '700' },
  searchInput: {
    margin: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: COLORS.textPrimary,
    fontSize: 14,
  },
  grid: { paddingHorizontal: 12, paddingBottom: 12 },
  row: { gap: 8, marginBottom: 8 },
  gif: { borderRadius: 8 },
  empty: { color: COLORS.textMuted, textAlign: 'center', marginTop: 32 },
  poweredBy: {
    color: COLORS.textMuted,
    fontSize: 10,
    textAlign: 'center',
    paddingBottom: 8,
  },
});
```

- [ ] **Step 2: Verify**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/components/chat/GifPicker.tsx
git commit -m "feat(chat): add GifPicker component using Tenor API"
```

---

## TASK 7: Create ReactionBar component

**Files:**
- Create: `apps/mobile/components/chat/ReactionBar.tsx`

- [ ] **Step 1: Write the component**

```tsx
// apps/mobile/components/chat/ReactionBar.tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MessageReaction } from '../../types';
import { COLORS } from '../../lib/constants';

const QUICK_EMOJIS = ['❤️', '😂', '😮', '😢', '😡', '💜'];

interface ReactionBarProps {
  /** Quick-react picker: shown as floating bar on long-press */
  onReact: (emoji: string) => void;
}

export function QuickReactBar({ onReact }: ReactionBarProps) {
  return (
    <View style={styles.quickBar}>
      {QUICK_EMOJIS.map((emoji) => (
        <TouchableOpacity
          key={emoji}
          onPress={() => onReact(emoji)}
          hitSlop={8}
          style={styles.quickEmoji}
        >
          <Text style={styles.quickEmojiText}>{emoji}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

interface ReactionChipsProps {
  reactions: MessageReaction[];
  currentUserId: string;
  onToggle: (emoji: string, isOwn: boolean) => void;
}

export function ReactionChips({ reactions, currentUserId, onToggle }: ReactionChipsProps) {
  if (!reactions || reactions.length === 0) return null;

  // Group by emoji
  const grouped: Record<string, { count: number; isOwn: boolean }> = {};
  for (const r of reactions) {
    if (!grouped[r.emoji]) grouped[r.emoji] = { count: 0, isOwn: false };
    grouped[r.emoji].count += 1;
    if (r.user_id === currentUserId) grouped[r.emoji].isOwn = true;
  }

  return (
    <View style={styles.chipsRow}>
      {Object.entries(grouped).map(([emoji, { count, isOwn }]) => (
        <TouchableOpacity
          key={emoji}
          style={[styles.chip, isOwn && styles.chipOwn]}
          onPress={() => onToggle(emoji, isOwn)}
          hitSlop={4}
        >
          <Text style={styles.chipEmoji}>{emoji}</Text>
          {count > 1 && <Text style={[styles.chipCount, isOwn && styles.chipCountOwn]}>{count}</Text>}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  quickBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  quickEmoji: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  quickEmojiText: { fontSize: 22 },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
    marginHorizontal: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: COLORS.surfaceLight,
  },
  chipOwn: {
    backgroundColor: COLORS.primary + '20',
    borderColor: COLORS.primary + '60',
  },
  chipEmoji: { fontSize: 14 },
  chipCount: { color: COLORS.textMuted, fontSize: 12, fontWeight: '600' },
  chipCountOwn: { color: COLORS.primary },
});
```

- [ ] **Step 2: Verify**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/components/chat/ReactionBar.tsx
git commit -m "feat(chat): add QuickReactBar + ReactionChips components"
```

---

## TASK 8: Create TypingIndicator component + useTyping hook

**Files:**
- Create: `apps/mobile/components/chat/TypingIndicator.tsx`
- Create: `apps/mobile/hooks/useTyping.ts`

- [ ] **Step 1: Write TypingIndicator component**

```tsx
// apps/mobile/components/chat/TypingIndicator.tsx
import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { COLORS } from '../../lib/constants';

interface TypingIndicatorProps {
  partnerName: string;
  visible: boolean;
}

export function TypingIndicator({ partnerName, visible }: TypingIndicatorProps) {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    const anim = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.delay(600 - delay),
        ])
      );
    const a1 = anim(dot1, 0);
    const a2 = anim(dot2, 150);
    const a3 = anim(dot3, 300);
    a1.start(); a2.start(); a3.start();
    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, [visible, dot1, dot2, dot3]);

  if (!visible) return null;

  const dotStyle = (anim: Animated.Value) => ({
    opacity: anim,
    transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
  });

  return (
    <View style={styles.container}>
      <Text style={styles.name}>{partnerName}</Text>
      <Text style={styles.isTyping}> is typing</Text>
      <Animated.Text style={[styles.dot, dotStyle(dot1)]}>.</Animated.Text>
      <Animated.Text style={[styles.dot, dotStyle(dot2)]}>.</Animated.Text>
      <Animated.Text style={[styles.dot, dotStyle(dot3)]}>.</Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 4,
    height: 24,
  },
  name: { color: COLORS.primary, fontSize: 12, fontWeight: '600' },
  isTyping: { color: COLORS.textMuted, fontSize: 12 },
  dot: { color: COLORS.textMuted, fontSize: 16, lineHeight: 18 },
});
```

- [ ] **Step 2: Write useTyping hook**

```ts
// apps/mobile/hooks/useTyping.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

interface UseTypingOptions {
  conversationId: string;
  currentUserId: string;
  partnerName: string;
}

interface UseTypingReturn {
  partnerIsTyping: boolean;
  sendTyping: () => void;
}

export function useTyping({ conversationId, currentUserId, partnerName }: UseTypingOptions): UseTypingReturn {
  const [partnerIsTyping, setPartnerIsTyping] = useState(false);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    const channel = supabase
      .channel(`typing:${conversationId}`)
      .on('broadcast', { event: 'typing' }, ({ payload }: { payload: { user_id: string } }) => {
        if (payload.user_id === currentUserId) return;
        setPartnerIsTyping(true);
        if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
        clearTimerRef.current = setTimeout(() => setPartnerIsTyping(false), 2500);
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      if (throttleRef.current) clearTimeout(throttleRef.current);
    };
  }, [conversationId, currentUserId]);

  // Throttled broadcast — fires at most once per 1.5s
  const sendTyping = useCallback(() => {
    if (throttleRef.current) return;
    void supabase.channel(`typing:${conversationId}`).send({
      type: 'broadcast',
      event: 'typing',
      payload: { user_id: currentUserId },
    });
    throttleRef.current = setTimeout(() => { throttleRef.current = null; }, 1500);
  }, [conversationId, currentUserId]);

  return { partnerIsTyping, sendTyping };
}
```

- [ ] **Step 3: Verify**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/components/chat/TypingIndicator.tsx apps/mobile/hooks/useTyping.ts
git commit -m "feat(chat): add TypingIndicator component + useTyping hook"
```

---

## TASK 9: Overhaul chat/[id].tsx — wire all features + fix all bugs

This task rewrites the chat screen to incorporate all new features and fix the audit bugs.

**Files:**
- Modify: `apps/mobile/app/(tabs)/connect/chat/[id].tsx`

**Bugs being fixed in this task:**
- Report modal: `openReportModal` was called inside `handleReportSubmit` (wrong). Fix: call it in `handleReportPress`.
- Initial load error: add `loadError` state + retry button.
- No emoji/GIF buttons, no reactions, no typing, no read receipts, no search.

- [ ] **Step 1: Replace chat/[id].tsx**

Replace the full file with:

```tsx
// apps/mobile/app/(tabs)/connect/chat/[id].tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
  Modal, FlatList, Image, Pressable,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { format } from 'date-fns';
import { supabase, callEdgeFunction } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../store/authStore';
import { useConnectStore } from '../../../../store/connectStore';
import { useRealtime } from '../../../../hooks/useRealtime';
import { useReactions } from '../../../../hooks/useReactions';
import { useTyping } from '../../../../hooks/useTyping';
import { useSafetyStore } from '../../../../store/safetyStore';
import { COLORS } from '../../../../lib/constants';
import { Analytics } from '../../../../lib/analytics';
import { Message, MessageReaction } from '../../../../types';
import { EmojiPicker } from '../../../../components/chat/EmojiPicker';
import { GifPicker } from '../../../../components/chat/GifPicker';
import { QuickReactBar, ReactionChips } from '../../../../components/chat/ReactionBar';
import { TypingIndicator } from '../../../../components/chat/TypingIndicator';

const REPORT_REASONS: {
  key: 'harassment' | 'spam' | 'inappropriate' | 'hate_speech' | 'other';
  label: string;
}[] = [
  { key: 'harassment', label: 'Harassment' },
  { key: 'spam', label: 'Spam' },
  { key: 'inappropriate', label: 'Inappropriate content' },
  { key: 'hate_speech', label: 'Hate speech' },
  { key: 'other', label: 'Other' },
];

export default function ChatScreen() {
  const { id: conversationId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const { clearUnread, conversations, setActiveConversation } = useConnectStore();
  const { blockUser, openReportModal, submitReport } = useSafetyStore();

  const [initialMessages, setInitialMessages] = useState<Message[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [wingwomanLoading, setWingwomanLoading] = useState(false);
  const [nudgeLoading, setNudgeLoading] = useState(false);
  const [icebreaker, setIcebreaker] = useState<string | null>(null);
  const flashListRef = useRef<FlashList<Message>>(null);

  // Partner info
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [partnerName, setPartnerName] = useState<string>('Chat');

  // Feature toggles
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Reaction long-press state
  const [reactingToMessage, setReactingToMessage] = useState<string | null>(null);
  const [reactAnchor, setReactAnchor] = useState({ x: 0, y: 0 });

  // Menu / report modal state
  const [menuVisible, setMenuVisible] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);
  const [reportReason, setReportReason] = useState<
    'harassment' | 'spam' | 'inappropriate' | 'hate_speech' | 'other' | null
  >(null);
  const [reportDetail, setReportDetail] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);

  const { messages, isSubscribed, appendMessage, replaceMessageId } = useRealtime({
    conversationId: conversationId ?? '',
    initialMessages,
  });

  const messageIds = messages.map((m) => m.id);
  const { reactionsMap, addReaction, removeReaction } = useReactions({
    conversationId: conversationId ?? '',
    messageIds,
  });

  const { partnerIsTyping, sendTyping } = useTyping({
    conversationId: conversationId ?? '',
    currentUserId: user?.id ?? '',
    partnerName,
  });

  useEffect(() => {
    setActiveConversation(conversationId ?? null);
    return () => setActiveConversation(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Resolve partner name
  useEffect(() => {
    if (!conversationId || !user) return;
    const resolvePartner = async (participantIds: string[]) => {
      const pid = participantIds.find((id) => id !== user.id) ?? null;
      setPartnerId(pid);
      if (!pid) return;
      const { data } = await supabase
        .from('profiles')
        .select('display_name, username')
        .eq('id', pid)
        .single();
      if (data) setPartnerName(data.display_name || data.username || 'Chat');
    };
    const conv = conversations.find((c) => c.id === conversationId);
    if (conv) {
      void resolvePartner(conv.participant_ids);
    } else {
      void (async () => {
        try {
          const { data } = await supabase
            .from('conversations')
            .select('participant_ids')
            .eq('id', conversationId)
            .single();
          if (data) void resolvePartner(data.participant_ids);
        } catch {}
      })();
    }
  }, [conversationId, user, conversations]);

  // Load initial messages
  const loadMessages = useCallback(async () => {
    if (!conversationId) return;
    setLoadingInitial(true);
    setLoadError(false);
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(100);
      if (error) throw error;
      if (data) {
        setInitialMessages(data as Message[]);
        const icebreakerMsg = data.find((m) => m.message_type === 'roxy_suggestion');
        if (icebreakerMsg) setIcebreaker(icebreakerMsg.content);
      }
      if (user && data) {
        await supabase
          .from('messages')
          .update({ is_read: true })
          .eq('conversation_id', conversationId)
          .neq('sender_id', user.id)
          .eq('is_read', false);
        clearUnread(conversationId);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoadingInitial(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, user]);

  useEffect(() => { void loadMessages(); }, [loadMessages]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flashListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  // Filtered messages for search
  const displayedMessages = searchActive && searchQuery.trim()
    ? messages.filter((m) =>
        m.content?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : messages;

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
      Alert.alert('Error', 'Failed to send message. Please try again.');
    } else if (inserted?.id) {
      replaceMessageId(optimisticMsg.id, inserted.id);
      Analytics.messageSent(conversationId);
    }
    setSending(false);
  };

  const handleGifSelected = async (url: string) => {
    await sendMessage('', 'image', url);
  };

  const handleWingwoman = async () => {
    if (!conversationId) return;
    setWingwomanLoading(true);
    try {
      const history = messages
        .filter((m) => m.message_type === 'text' && m.content)
        .slice(-6)
        .map((m) => ({
          sender: m.sender_id === user?.id ? 'Me' : 'Them',
          content: m.content ?? '',
        }));
      const { data, error } = await callEdgeFunction<{ suggestion: string }>('roxy-wingwoman', {
        conversation_id: conversationId,
        message_history: history,
        current_message: inputText || 'I want to keep the conversation going',
      });
      if (error) { Alert.alert('Wingwoman unavailable', error); return; }
      if (data?.suggestion) {
        const suggestionMsg: Message = {
          id: `roxy-${Date.now()}`,
          conversation_id: conversationId,
          sender_id: null,
          content: data.suggestion,
          media_url: null,
          message_type: 'roxy_suggestion',
          is_read: true,
          created_at: new Date().toISOString(),
        };
        appendMessage(suggestionMsg);
      }
    } catch {
      Alert.alert('Error', 'Failed to get suggestion. Please try again.');
    } finally {
      setWingwomanLoading(false);
    }
  };

  const handleNudge = async () => {
    if (!conversationId) return;
    setNudgeLoading(true);
    try {
      const { data, error } = await callEdgeFunction<{ nudge: string }>('roxy-nudge', {
        conversation_id: conversationId,
      });
      if (error) {
        Alert.alert('Roxy Nudge', "Nudge limit reached for this conversation, but you've got this! 💜");
        return;
      }
      if (data?.nudge) setInputText(data.nudge);
    } catch {
      Alert.alert('Error', 'Failed to get nudge. Please try again.');
    } finally {
      setNudgeLoading(false);
    }
  };

  // Safety handlers
  const handleBlockPress = () => {
    setMenuVisible(false);
    Alert.alert(
      `Block ${partnerName}?`,
      "They won't be able to message you and you won't see their profile.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block', style: 'destructive',
          onPress: async () => {
            if (!partnerId) return;
            try {
              await blockUser(partnerId);
              router.back();
            } catch {
              Alert.alert('Error', 'Could not block user. Please try again.');
            }
          },
        },
      ]
    );
  };

  const handleReportPress = () => {
    setMenuVisible(false);
    setReportReason(null);
    setReportDetail('');
    // Set safety store context BEFORE opening modal
    if (partnerId) openReportModal({ userId: partnerId, contentType: 'message' });
    setReportVisible(true);
  };

  const handleReportSubmit = async () => {
    if (!reportReason || !partnerId) return;
    setReportSubmitting(true);
    try {
      await submitReport(reportReason, reportDetail.trim() || undefined);
      setReportVisible(false);
      Alert.alert('Report submitted', 'Thank you for keeping our community safe 💜');
    } catch {
      Alert.alert('Error', 'Could not submit report. Please try again.');
    } finally {
      setReportSubmitting(false);
    }
  };

  // Reactions
  const handleLongPress = (messageId: string) => {
    setReactingToMessage(messageId);
  };

  const handleReact = async (emoji: string) => {
    if (!reactingToMessage || !user) return;
    const existing = (reactionsMap[reactingToMessage] ?? []).find(
      (r) => r.user_id === user.id && r.emoji === emoji
    );
    if (existing) {
      await removeReaction(reactingToMessage, emoji, user.id);
    } else {
      await addReaction(reactingToMessage, emoji, user.id);
    }
    setReactingToMessage(null);
  };

  const handleReactionToggle = async (messageId: string, emoji: string, isOwn: boolean) => {
    if (!user) return;
    if (isOwn) {
      await removeReaction(messageId, emoji, user.id);
    } else {
      await addReaction(messageId, emoji, user.id);
    }
  };

  const renderItem = ({ item }: { item: Message }) => {
    const isOwn = item.sender_id === user?.id;
    const isRoxy = item.message_type === 'roxy_suggestion';
    const isImage = item.message_type === 'image';
    const reactions = reactionsMap[item.id] ?? [];
    const isHighlighted = searchActive && searchQuery.trim() &&
      item.content?.toLowerCase().includes(searchQuery.toLowerCase());

    return (
      <Pressable
        onLongPress={() => !isRoxy && handleLongPress(item.id)}
        delayLongPress={400}
      >
        <View style={[
          styles.bubble,
          isOwn && !isRoxy ? styles.bubbleOwn : styles.bubbleOther,
          isRoxy && styles.bubbleRoxy,
          isHighlighted && styles.bubbleHighlighted,
        ]}>
          {isRoxy && <Text style={styles.roxyLabel}>✨ Roxy suggests</Text>}

          {isImage && item.media_url ? (
            <Image
              source={{ uri: item.media_url }}
              style={styles.gifImage}
              resizeMode="cover"
            />
          ) : (
            <Text style={[styles.bubbleText, isOwn && !isRoxy ? styles.bubbleTextOwn : styles.bubbleTextOther]}>
              {item.content}
            </Text>
          )}

          {isRoxy && (
            <View style={styles.roxyActions}>
              <TouchableOpacity style={styles.roxyUseBtn} onPress={() => setInputText(item.content ?? '')}>
                <Text style={styles.roxyUseBtnText}>Use this</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.bubbleMeta}>
            <Text style={styles.bubbleTime}>{format(new Date(item.created_at), 'HH:mm')}</Text>
            {isOwn && !isRoxy && (
              <Text style={[styles.readTick, item.is_read && styles.readTickRead]}>
                {item.is_read ? '✓✓' : '✓'}
              </Text>
            )}
          </View>
        </View>

        {reactions.length > 0 && (
          <ReactionChips
            reactions={reactions}
            currentUserId={user?.id ?? ''}
            onToggle={(emoji, isOwn) => void handleReactionToggle(item.id, emoji, isOwn)}
          />
        )}
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        {searchActive ? (
          <>
            <TextInput
              style={styles.searchInput}
              placeholder="Search messages..."
              placeholderTextColor={COLORS.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
            />
            <TouchableOpacity onPress={() => { setSearchActive(false); setSearchQuery(''); }}>
              <Text style={styles.searchCancelText}>Cancel</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Text style={styles.backText}>‹</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => partnerId && router.push(`/user/${partnerId}` as any)}
              disabled={!partnerId}
              style={{ flex: 1 }}
            >
              <Text style={styles.headerTitle} numberOfLines={1}>{partnerName}</Text>
            </TouchableOpacity>
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
          </>
        )}
      </View>

      {/* Icebreaker */}
      {icebreaker && !searchActive && (
        <View style={styles.icebreakerBanner}>
          <Text style={styles.icebreakerLabel}>✨ Roxy's icebreaker</Text>
          <Text style={styles.icebreakerText}>{icebreaker}</Text>
        </View>
      )}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {loadingInitial ? (
          <ActivityIndicator color={COLORS.roxy} style={{ flex: 1 }} />
        ) : loadError ? (
          <View style={styles.errorState}>
            <Text style={styles.errorText}>Could not load messages</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => void loadMessages()}>
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlashList
            ref={flashListRef}
            data={displayedMessages}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            estimatedItemSize={60}
            contentContainerStyle={styles.messageList}
            style={{ flex: 1 }}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {searchActive ? 'No messages match your search.' : 'Send your first message!'}
              </Text>
            }
          />
        )}

        <TypingIndicator partnerName={partnerName} visible={partnerIsTyping} />

        {/* Input bar */}
        <View style={styles.inputBar}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => { setShowGifPicker(false); setShowEmojiPicker(true); }}
          >
            <Text style={styles.iconBtnText}>😊</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => { setShowEmojiPicker(false); setShowGifPicker(true); }}
          >
            <Text style={styles.iconBtnText}>GIF</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.wingwomanBtn}
            onPress={handleWingwoman}
            disabled={wingwomanLoading}
          >
            {wingwomanLoading ? (
              <ActivityIndicator size="small" color={COLORS.roxy} />
            ) : (
              <Text style={styles.wingwomanIcon}>✨</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.nudgeBtn, nudgeLoading && styles.nudgeBtnDisabled]}
            onPress={handleNudge}
            disabled={nudgeLoading}
          >
            {nudgeLoading ? (
              <ActivityIndicator size="small" color={COLORS.roxy} />
            ) : (
              <Text style={styles.nudgeBtnText}>💜</Text>
            )}
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder="Say something..."
            placeholderTextColor={COLORS.textMuted}
            value={inputText}
            onChangeText={(t) => { setInputText(t); sendTyping(); }}
            multiline
            maxLength={2000}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!inputText.trim() || sending) && styles.sendBtnDisabled]}
            onPress={() => void sendMessage(inputText)}
            disabled={!inputText.trim() || sending}
          >
            <Text style={styles.sendBtnText}>›</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Quick react overlay */}
      {reactingToMessage && (
        <Modal transparent animationType="fade" onRequestClose={() => setReactingToMessage(null)}>
          <TouchableOpacity
            style={styles.reactOverlay}
            activeOpacity={1}
            onPress={() => setReactingToMessage(null)}
          >
            <View style={styles.reactBarContainer}>
              <QuickReactBar onReact={(emoji) => void handleReact(emoji)} />
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {/* Emoji picker */}
      <EmojiPicker
        visible={showEmojiPicker}
        onEmojiSelected={(emoji) => setInputText((prev) => prev + emoji)}
        onClose={() => setShowEmojiPicker(false)}
      />

      {/* GIF picker */}
      <GifPicker
        visible={showGifPicker}
        onGifSelected={(url) => void handleGifSelected(url)}
        onClose={() => setShowGifPicker(false)}
      />

      {/* Three-dot menu */}
      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setMenuVisible(false)}>
          <View style={styles.actionSheet}>
            <TouchableOpacity style={styles.actionRow} onPress={handleBlockPress}>
              <Text style={styles.actionRowIconDanger}>⛔</Text>
              <Text style={styles.actionRowTextDanger}>Block {partnerName}</Text>
            </TouchableOpacity>
            <View style={styles.actionSeparator} />
            <TouchableOpacity style={styles.actionRow} onPress={handleReportPress}>
              <Text style={styles.actionRowIcon}>🚩</Text>
              <Text style={styles.actionRowText}>Report conversation</Text>
            </TouchableOpacity>
            <View style={styles.actionSeparator} />
            <TouchableOpacity style={styles.actionRow} onPress={() => setMenuVisible(false)}>
              <Text style={[styles.actionRowText, { textAlign: 'center', flex: 1, color: COLORS.textMuted }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Report modal */}
      <Modal visible={reportVisible} transparent animationType="slide" onRequestClose={() => setReportVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.reportCard}>
            <Text style={styles.reportTitle}>Report</Text>
            <Text style={styles.reportSubtitle}>What's the issue?</Text>
            <FlatList
              data={REPORT_REASONS}
              keyExtractor={(item) => item.key}
              scrollEnabled={false}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.reasonRow, reportReason === item.key && styles.reasonRowSelected]}
                  onPress={() => setReportReason(item.key)}
                >
                  <View style={[styles.reasonRadio, reportReason === item.key && styles.reasonRadioSelected]} />
                  <Text style={styles.reasonLabel}>{item.label}</Text>
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.reasonSeparator} />}
            />
            <TextInput
              style={styles.reportDetailInput}
              placeholder="Add details (optional)"
              placeholderTextColor={COLORS.textMuted}
              value={reportDetail}
              onChangeText={setReportDetail}
              multiline
              maxLength={500}
            />
            <View style={styles.reportActions}>
              <TouchableOpacity style={styles.reportCancelBtn} onPress={() => setReportVisible(false)}>
                <Text style={styles.reportCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.reportSubmitBtn, (!reportReason || !partnerId || reportSubmitting) && styles.reportSubmitBtnDisabled]}
                onPress={() => void handleReportSubmit()}
                disabled={!reportReason || !partnerId || reportSubmitting}
              >
                {reportSubmitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.reportSubmitText}>Submit</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  backBtn: { width: 40 },
  backText: { color: COLORS.textPrimary, fontSize: 28, lineHeight: 30 },
  headerTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 17, textAlign: 'center' },
  headerRight: { width: 80, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotConnected: { backgroundColor: COLORS.success },
  dotDisconnected: { backgroundColor: COLORS.textMuted },
  searchIcon: { fontSize: 16 },
  menuBtn: { padding: 4 },
  menuBtnText: { color: COLORS.textPrimary, fontSize: 16, letterSpacing: 1 },
  searchInput: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8, color: COLORS.textPrimary, fontSize: 14,
  },
  searchCancelText: { color: COLORS.primary, fontWeight: '600', marginLeft: 10 },
  icebreakerBanner: {
    backgroundColor: COLORS.roxy + '20', borderBottomWidth: 1, borderBottomColor: COLORS.roxy + '40',
    padding: 12,
  },
  icebreakerLabel: { color: COLORS.roxy, fontSize: 11, fontWeight: '700', marginBottom: 2 },
  icebreakerText: { color: COLORS.textPrimary, fontSize: 14, fontStyle: 'italic' },
  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText: { color: COLORS.textMuted, fontSize: 15 },
  retryBtn: {
    backgroundColor: COLORS.primary, borderRadius: 12,
    paddingHorizontal: 24, paddingVertical: 10,
  },
  retryBtnText: { color: '#fff', fontWeight: '700' },
  messageList: { padding: 16, gap: 8 },
  bubble: { maxWidth: '80%', borderRadius: 16, padding: 12, marginVertical: 2 },
  bubbleOwn: { alignSelf: 'flex-end', backgroundColor: COLORS.primary, borderBottomRightRadius: 4 },
  bubbleOther: { alignSelf: 'flex-start', backgroundColor: COLORS.surface, borderBottomLeftRadius: 4 },
  bubbleRoxy: { alignSelf: 'center', backgroundColor: COLORS.roxy + '20', borderRadius: 12, borderWidth: 1, borderColor: COLORS.roxy + '60', width: '90%' },
  bubbleHighlighted: { borderWidth: 2, borderColor: COLORS.primary + '80' },
  roxyLabel: { color: COLORS.roxy, fontSize: 11, fontWeight: '700', marginBottom: 4 },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTextOwn: { color: '#fff' },
  bubbleTextOther: { color: COLORS.textPrimary },
  gifImage: { width: 200, height: 150, borderRadius: 8 },
  roxyActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  roxyUseBtn: { backgroundColor: COLORS.roxy, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 },
  roxyUseBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  bubbleMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 4 },
  bubbleTime: { color: COLORS.textMuted, fontSize: 10 },
  readTick: { color: COLORS.textMuted, fontSize: 10, fontWeight: '700' },
  readTickRead: { color: COLORS.primary },
  emptyText: { color: COLORS.textMuted, textAlign: 'center', marginTop: 40 },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 6,
    padding: 12, borderTopWidth: 1, borderTopColor: COLORS.surface,
    backgroundColor: COLORS.background,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnText: { fontSize: 13, fontWeight: '700', color: COLORS.textSecondary },
  wingwomanBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  wingwomanIcon: { fontSize: 18 },
  nudgeBtn: {
    height: 36, width: 36, borderRadius: 18, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.roxy,
    alignItems: 'center', justifyContent: 'center',
  },
  nudgeBtnDisabled: { opacity: 0.5 },
  nudgeBtnText: { fontSize: 16 },
  input: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10,
    color: COLORS.textPrimary, fontSize: 15, maxHeight: 120,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: COLORS.surface },
  sendBtnText: { color: '#fff', fontSize: 24, lineHeight: 28 },
  reactOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  reactBarContainer: { position: 'absolute', bottom: 120, alignSelf: 'center' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  actionSheet: {
    backgroundColor: COLORS.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingBottom: 32, paddingTop: 8,
  },
  actionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 16, gap: 14 },
  actionRowIcon: { fontSize: 18 },
  actionRowIconDanger: { fontSize: 18 },
  actionRowText: { color: COLORS.textPrimary, fontSize: 16 },
  actionRowTextDanger: { color: COLORS.error, fontSize: 16, fontWeight: '600' },
  actionSeparator: { height: 1, backgroundColor: COLORS.surfaceLight, marginHorizontal: 16 },
  reportCard: {
    backgroundColor: COLORS.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, paddingBottom: 40,
  },
  reportTitle: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '700', marginBottom: 4 },
  reportSubtitle: { color: COLORS.textSecondary, fontSize: 14, marginBottom: 16 },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4, borderRadius: 10 },
  reasonRowSelected: { backgroundColor: COLORS.primary + '20' },
  reasonRadio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: COLORS.textMuted },
  reasonRadioSelected: { borderColor: COLORS.primary, backgroundColor: COLORS.primary },
  reasonLabel: { color: COLORS.textPrimary, fontSize: 15 },
  reasonSeparator: { height: 1, backgroundColor: COLORS.surfaceLight },
  reportDetailInput: {
    backgroundColor: COLORS.surfaceLight, borderRadius: 12, padding: 12,
    color: COLORS.textPrimary, fontSize: 14, minHeight: 72, marginTop: 16, textAlignVertical: 'top',
  },
  reportActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  reportCancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: COLORS.surfaceLight, alignItems: 'center' },
  reportCancelText: { color: COLORS.textSecondary, fontSize: 16, fontWeight: '600' },
  reportSubmitBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: COLORS.primary, alignItems: 'center' },
  reportSubmitBtnDisabled: { backgroundColor: COLORS.textMuted },
  reportSubmitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
```

- [ ] **Step 2: Run tsc**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -40
```

Expected: zero errors. Fix any type errors before proceeding.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/\(tabs\)/connect/chat/\[id\].tsx
git commit -m "feat(chat): add emoji/GIF/reactions/typing/read receipts/search — fix report modal + error state"
```

---

## TASK 10: Add realtime subscription to chats.tsx (fix unread race)

**Files:**
- Modify: `apps/mobile/app/(tabs)/grow/chats.tsx`

- [ ] **Step 1: Add realtime subscription after load**

Find the `load` function (line 42) and the `useEffect` at line 141. Add a second `useEffect` that subscribes to new messages for unread counting, established only after conversations are loaded:

After the closing `useEffect(() => { load(); }, [load]);` line, add:

```tsx
// Realtime: listen for new incoming messages to update unread counts live
useEffect(() => {
  if (!user || chats.length === 0) return;

  const convIds = chats.map((c) => c.id);
  const { activeConversationId, incrementUnread } = useConnectStore.getState();

  // One channel per chats screen mount — subscribes to any INSERT in user's conversations
  const channel = supabase
    .channel('chats-unread-listener')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
      },
      (payload) => {
        const msg = payload.new as { conversation_id: string; sender_id: string };
        if (!convIds.includes(msg.conversation_id)) return;
        if (msg.sender_id === user.id) return; // own message
        if (useConnectStore.getState().activeConversationId === msg.conversation_id) return; // already reading
        incrementUnread(msg.conversation_id);
        // Update lastMessagePreview
        setChats((prev) =>
          prev.map((c) =>
            c.id === msg.conversation_id
              ? { ...c, lastMessagePreview: (payload.new as any).content ?? '' }
              : c
          )
        );
      }
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}, [user, chats.length]); // re-establish when chat list changes
```

Also add `supabase` to imports at the top if not already there (it is imported).

- [ ] **Step 2: Verify**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/\(tabs\)/grow/chats.tsx
git commit -m "fix(chat): add realtime unread subscription to chats screen — fix race condition"
```

---

## TASK 11: Fix Studio Events — onCreated refresh + toast

**Files:**
- Modify: `apps/studio/app/(dashboard)/events/CreateEventForm.tsx`

- [ ] **Step 1: Add router.refresh() after creation**

The page is a Server Component so `onCreated` callback can't trigger re-render. Fix: use `useRouter` from `next/navigation` in `CreateEventForm` to refresh the page, and add a success state.

Replace the top of `CreateEventForm.tsx` adding `useRouter` import and success state:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
```

Add `const router = useRouter();` inside the component after `const [error, setError] = useState<string | null>(null);`.

Add `const [successMsg, setSuccessMsg] = useState<string | null>(null);` after the error state.

In `handleSubmit`, replace the `else` block (after `setLoading(false)`) from:
```tsx
} else {
  setTitle(''); setStartsAt(''); setEndsAt(''); setLocationText('');
  setIsPaid(false); setPriceDollars(''); setPayoutDelayDays('7');
  onCreated();
}
```
with:
```tsx
} else {
  setTitle(''); setStartsAt(''); setEndsAt(''); setLocationText('');
  setIsPaid(false); setPriceDollars(''); setPayoutDelayDays('7');
  setSuccessMsg('Event created successfully!');
  setTimeout(() => setSuccessMsg(null), 4000);
  router.refresh();
  onCreated();
}
```

In the JSX, add this below the `{error && ...}` line:
```tsx
{successMsg && (
  <p className="text-sm text-green-600 font-medium bg-green-50 border border-green-200 rounded-md px-3 py-2">
    ✓ {successMsg}
  </p>
)}
```

- [ ] **Step 2: Verify**

```bash
cd apps/studio && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add apps/studio/app/\(dashboard\)/events/CreateEventForm.tsx
git commit -m "fix(studio): events refresh after creation + success toast"
```

---

## TASK 12: Fix Studio Orders — error handling

**Files:**
- Modify: `apps/studio/app/(dashboard)/orders/page.tsx`

- [ ] **Step 1: Add error handling for edge function call**

Replace the edge function call block:
```tsx
const supabase = await createClient();
const { data: ordersData } = await supabase.functions.invoke('get-orders-business', {
  body: { business_id: business.id },
});

const orders = Array.isArray(ordersData) ? ordersData : (ordersData?.orders ?? []);
```

with:
```tsx
const supabase = await createClient();
let orders: any[] = [];
try {
  const { data: ordersData, error: fnError } = await supabase.functions.invoke('get-orders-business', {
    body: { business_id: business.id },
  });
  if (fnError) throw fnError;
  orders = Array.isArray(ordersData) ? ordersData : (ordersData?.orders ?? []);
} catch {
  return (
    <div className="max-w-5xl space-y-6">
      <h1 className="text-2xl font-bold">Orders</h1>
      <p className="text-destructive text-sm">
        Failed to load orders. Please refresh the page or contact support if this continues.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

```bash
cd apps/studio && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add apps/studio/app/\(dashboard\)/orders/page.tsx
git commit -m "fix(studio): add error handling to orders page edge function call"
```

---

## TASK 13: Fix Build tab — error handling + debounce cleanup

**Files:**
- Modify: `apps/mobile/app/(tabs)/build/index.tsx`

- [ ] **Step 1: Add error handling to getCommunityMemberIds and fix debounce cleanup**

Find `getCommunityMemberIds` (around line 191) and add a try/catch:
```tsx
const getCommunityMemberIds = useCallback(async (): Promise<string[] | undefined> => {
  if (!selectedCommunityId) return undefined;
  try {
    const { data: members, error } = await supabase
      .from('community_members')
      .select('user_id')
      .eq('community_id', selectedCommunityId);
    if (error) return undefined;
    return (members ?? []).map((m: any) => m.user_id);
  } catch {
    return undefined;
  }
}, [selectedCommunityId]);
```

Find `triggerBizLoad` (around line 205) and add a cleanup `useEffect` after it:
```tsx
// Cleanup debounce on unmount
useEffect(() => {
  return () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  };
}, []);
```

- [ ] **Step 2: Verify**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/\(tabs\)/build/index.tsx
git commit -m "fix(build): add error handling to getCommunityMemberIds + cleanup debounce on unmount"
```

---

## TASK 14: Fix Grow tab — loadSocial error state

**Files:**
- Modify: `apps/mobile/app/(tabs)/grow/index.tsx`

- [ ] **Step 1: Read lines 80-100 of grow/index.tsx**

Read the file to find the `loadSocial` function.

- [ ] **Step 2: Replace silent error swallow**

Find the pattern `.catch(() => {})` in `loadSocial` and replace with:
```tsx
.catch((e: Error) => {
  logError('grow_load_social_failed', e);
  // Show empty state — communities will be empty array, user sees empty state UI
});
```

Also check if there is a `setError` state. If not, add:
```tsx
const [socialError, setSocialError] = useState(false);
```

In the catch, set `setSocialError(true)`. In JSX, render an error banner when `socialError` is true:
```tsx
{socialError && (
  <View style={styles.errorBanner}>
    <Text style={styles.errorBannerText}>Could not load communities. Pull to refresh.</Text>
  </View>
)}
```

Add to styles:
```tsx
errorBanner: {
  backgroundColor: COLORS.error + '20',
  padding: 12,
  marginHorizontal: 16,
  borderRadius: 8,
},
errorBannerText: { color: COLORS.error, fontSize: 13, textAlign: 'center' },
```

- [ ] **Step 3: Verify and commit**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -20
git add apps/mobile/app/\(tabs\)/grow/index.tsx
git commit -m "fix(grow): replace silent loadSocial error swallow with error banner"
```

---

## TASK 15: Fix Sister Button — allow session restart

**Files:**
- Modify: `apps/mobile/app/(tabs)/connect/sister-button/index.tsx`

- [ ] **Step 1: Add restart session handler**

Read the file. Find where `sessionDone` is set to `true`. After the session-done UI renders (the section that shows resources/directory), add a "Start new session" button:

Find the section that renders when `sessionDone === true` — it likely shows a "Session complete" message. Add below it:

```tsx
<TouchableOpacity
  style={styles.restartBtn}
  onPress={() => {
    setMessages([]);
    setInput('');
    setSessionDone(false);
    setResources(null);
    setDirectory(null);
  }}
>
  <Text style={styles.restartBtnText}>Start new session</Text>
</TouchableOpacity>
```

Add to styles:
```tsx
restartBtn: {
  marginTop: 16,
  backgroundColor: COLORS.surface,
  borderRadius: 12,
  paddingVertical: 12,
  paddingHorizontal: 24,
  alignItems: 'center',
  borderWidth: 1,
  borderColor: COLORS.primary,
},
restartBtnText: { color: COLORS.primary, fontWeight: '600', fontSize: 15 },
```

- [ ] **Step 2: Verify and commit**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -20
git add apps/mobile/app/\(tabs\)/connect/sister-button/index.tsx
git commit -m "fix(sister-button): add start new session button after session completes"
```

---

## TASK 16: Fix Profile — distinguish badge load failure from zero badges

**Files:**
- Modify: `apps/mobile/app/(tabs)/profile/index.tsx`

- [ ] **Step 1: Read the badge fetch section**

Read the file and find the badge fetch (around lines 43-55).

- [ ] **Step 2: Add badgeLoadError state**

Add `const [badgeLoadError, setBadgeLoadError] = useState(false);` near other state declarations.

In the badge fetch catch block, set `setBadgeLoadError(true)`.

In JSX, where badges render, add a conditional:
```tsx
{badgeLoadError ? (
  <Text style={styles.badgeError}>Could not load badges</Text>
) : badges.length === 0 ? (
  <Text style={styles.noBadges}>No badges yet — keep engaging!</Text>
) : (
  // existing badge rendering
)}
```

Add to styles:
```tsx
badgeError: { color: COLORS.error, fontSize: 13 },
```

- [ ] **Step 3: Verify and commit**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -20
git add apps/mobile/app/\(tabs\)/profile/index.tsx
git commit -m "fix(profile): distinguish badge load error from zero badges"
```

---

## TASK 17: Final QA pass

- [ ] **Step 1: Run full lint**

```bash
cd apps/mobile && npx eslint . --ext .ts,.tsx --max-warnings 0 2>&1 | tail -20
```

Fix any errors. Re-run until clean.

- [ ] **Step 2: Run TypeScript**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -40
cd apps/studio && npx tsc --noEmit 2>&1 | head -40
```

Fix any errors. Re-run until clean.

- [ ] **Step 3: Run tests**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -20
```

Expected: all tests pass, zero failures.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: QA pass — lint tsc jest all clean"
```

---

## SELF-REVIEW

**Spec coverage check:**
- ✅ message_reactions table (Task 1)
- ✅ Emoji picker (Task 2 + 5)
- ✅ GIF support via Tenor (Task 6)
- ✅ Message reactions (Tasks 3, 4, 7, wired in Task 9)
- ✅ Typing indicators (Task 8, wired in Task 9)
- ✅ Read receipts UI (wired in Task 9)
- ✅ Chat search (wired in Task 9)
- ✅ Report modal bug fix (Task 9)
- ✅ Initial load error state + retry (Task 9)
- ✅ Unread race condition (Task 10)
- ✅ Studio events refresh + toast (Task 11)
- ✅ Studio orders error (Task 12)
- ✅ Build tab getCommunityMemberIds + debounce (Task 13)
- ✅ Grow tab loadSocial error (Task 14)
- ✅ Sister button restart (Task 15)
- ✅ Profile badge error (Task 16)

**Not included (deemed non-critical for this plan):**
- Connect tab stale community filter (minor UX, no crash)
- Events pagination (backlog — requires significant UI change)
- Build skeleton loading (polish, no data impact)
- Community room creator null check (low risk — creator profiles rarely deleted)

These can be picked up in a follow-on plan.
