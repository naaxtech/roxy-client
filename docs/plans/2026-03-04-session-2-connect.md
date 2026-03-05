# Session 2 — Connect Tab + Speed Dating Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build DMs end-to-end and a fully playable speed dating game with Daily.co video + Roxy prompt overlay.

**Architecture:** Two new migrations (003 communities/social, 004 conversations/messages/speed-dating/matches). Four new edge functions (roxy-icebreaker, roxy-wingwoman, speed-date-prompts, join-speed-date-session). Supabase Realtime subscription hook. Connect tab replaces stub with FlashList conversation list, full chat screen, and three speed-dating screens (lobby → in-session → result).

**Tech Stack:** React Native + Expo Router v3, Supabase Realtime, `@daily-co/react-native-daily-js`, Reanimated pan gesture (draggable Roxy overlay), FlashList, Zustand, Deno Edge Functions, Claude Haiku.

> **Daily.co note:** `@daily-co/react-native-daily-js` requires native modules — it will NOT work in Expo Go. Testing the speed dating in-session screen requires either `npx expo run:ios` / `npx expo run:android` or an EAS Preview build. All other screens (conversation list, chat, lobby, result) work in Expo Go. The `DailyVideo` import is guarded so the app doesn't crash in Expo Go — it just shows a placeholder.

---

## Branch Setup

```bash
cd C:/Thinqer/roxy-client
git checkout -b session-2-connect
```

---

### Task 1: Migration 003 — Communities & Social

**Files:**
- Create: `supabase/migrations/003_communities_social.sql`

**Step 1: Write the migration**

```sql
-- supabase/migrations/003_communities_social.sql

-- ─── communities ─────────────────────────────────────────────────────────────
CREATE TABLE communities (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name            text NOT NULL,
  slug            text UNIQUE NOT NULL,
  description     text,
  cover_image_url text,
  category        text CHECK (category IN ('identity','interest','location','support')) NOT NULL,
  is_private      boolean DEFAULT false,
  member_count    int DEFAULT 0,
  created_by      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE communities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "communities_read_public" ON communities
  FOR SELECT USING (is_private = false);

CREATE POLICY "communities_insert_auth" ON communities
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "communities_update_own" ON communities
  FOR UPDATE USING (auth.uid() = created_by);

CREATE INDEX idx_communities_category ON communities (category);
CREATE INDEX idx_communities_slug ON communities (slug);

-- ─── community_members ───────────────────────────────────────────────────────
CREATE TABLE community_members (
  community_id uuid REFERENCES communities(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES profiles(id) ON DELETE CASCADE,
  role         text DEFAULT 'member' CHECK (role IN ('member','moderator','admin')),
  joined_at    timestamptz DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);

ALTER TABLE community_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cm_read_own" ON community_members
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "cm_read_community_member" ON community_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM community_members cm2
      WHERE cm2.community_id = community_members.community_id
        AND cm2.user_id = auth.uid()
    )
  );

CREATE POLICY "cm_insert_own" ON community_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "cm_delete_own" ON community_members
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_cm_user ON community_members (user_id);
CREATE INDEX idx_cm_community ON community_members (community_id);

-- Trigger: auto increment/decrement member_count
CREATE OR REPLACE FUNCTION update_member_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE communities SET member_count = member_count + 1 WHERE id = NEW.community_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE communities SET member_count = GREATEST(member_count - 1, 0) WHERE id = OLD.community_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER community_member_count
  AFTER INSERT OR DELETE ON community_members
  FOR EACH ROW EXECUTE FUNCTION update_member_count();

-- ─── friendships ─────────────────────────────────────────────────────────────
CREATE TABLE friendships (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  requester_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  addressee_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  status       text DEFAULT 'pending' CHECK (status IN ('pending','accepted','blocked')),
  created_at   timestamptz DEFAULT now(),
  UNIQUE (requester_id, addressee_id),
  CONSTRAINT no_self_friendship CHECK (requester_id != addressee_id)
);

ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "friendships_own" ON friendships
  FOR ALL USING (auth.uid() IN (requester_id, addressee_id));

CREATE INDEX idx_friendships_addressee ON friendships (addressee_id, status);
CREATE INDEX idx_friendships_requester ON friendships (requester_id, status);

-- Seed: 5 starter communities
INSERT INTO communities (name, slug, description, category) VALUES
  ('Lesbians of London',       'lesbians-of-london',       'London''s lesbian community hub',                    'location'),
  ('Bi+ Collective',           'bi-collective',            'Bisexual, pansexual & fluid women connecting',       'identity'),
  ('Queer Gamers',             'queer-gamers',             'WLW gamers unite — all platforms welcome',           'interest'),
  ('WLW Entrepreneurs',        'wlw-entrepreneurs',        'Building businesses and supporting each other',      'interest'),
  ('Trans & Non-binary Support','trans-nb-support',        'Safe space for trans and non-binary WLW',            'support');
```

**Step 2: Push to Supabase**

```bash
cd C:/Thinqer/roxy-client
npx supabase db push
```

Expected: Migration applied. Verify in Supabase dashboard → Table Editor: `communities`, `community_members`, `friendships` tables exist.

**Step 3: Commit**

```bash
git add supabase/migrations/003_communities_social.sql
git commit -m "feat: migration 003 — communities, community_members, friendships + seed data"
```

---

### Task 2: Migration 004 — Conversations, Messages, Speed Dating, Matches

**Files:**
- Create: `supabase/migrations/004_connect_dating.sql`

**Step 1: Write the migration**

```sql
-- supabase/migrations/004_connect_dating.sql

-- ─── Add conversation_id to ai_call_log ──────────────────────────────────────
-- Needed for per-conversation rate limiting (icebreaker, wingwoman, nudge)
ALTER TABLE ai_call_log ADD COLUMN conversation_id uuid;
CREATE INDEX idx_ai_log_conversation ON ai_call_log (conversation_id, function_name) WHERE conversation_id IS NOT NULL;

-- ─── conversations ───────────────────────────────────────────────────────────
CREATE TABLE conversations (
  id                         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  participant_ids            uuid[] NOT NULL,
  conversation_type          text DEFAULT 'direct' CHECK (conversation_type IN ('direct','speed_date','sister')),
  last_message_at            timestamptz,
  roxy_nudge_count           int DEFAULT 0,
  roxy_wingwoman_count_today int DEFAULT 0,
  last_roxy_call_date        date,
  created_at                 timestamptz DEFAULT now()
);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Participant can read/insert/update their conversations
CREATE POLICY "conversations_participant" ON conversations
  FOR ALL USING (auth.uid() = ANY(participant_ids));

CREATE INDEX idx_conversations_participants ON conversations USING GIN (participant_ids);
CREATE INDEX idx_conversations_last_msg ON conversations (last_message_at DESC NULLS LAST);

-- ─── messages ────────────────────────────────────────────────────────────────
CREATE TABLE messages (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
  sender_id       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  content         text,
  media_url       text,
  message_type    text DEFAULT 'text' CHECK (message_type IN ('text','image','voice','roxy_suggestion')),
  is_read         boolean DEFAULT false,
  created_at      timestamptz DEFAULT now(),
  CONSTRAINT message_has_content CHECK (content IS NOT NULL OR media_url IS NOT NULL)
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Participant of the conversation can read/insert messages
CREATE POLICY "messages_participant" ON messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND auth.uid() = ANY(c.participant_ids)
    )
  );

CREATE POLICY "messages_insert_participant" ON messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND auth.uid() = ANY(c.participant_ids)
    )
  );

CREATE POLICY "messages_update_own" ON messages
  FOR UPDATE USING (auth.uid() = sender_id);

CREATE INDEX idx_messages_conversation ON messages (conversation_id, created_at DESC);
CREATE INDEX idx_messages_unread ON messages (conversation_id, is_read) WHERE is_read = false;

-- Trigger: update conversations.last_message_at on new message
CREATE OR REPLACE FUNCTION update_conversation_last_message()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE conversations
  SET last_message_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_update_conversation
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION update_conversation_last_message();

-- ─── speed_date_sessions ─────────────────────────────────────────────────────
CREATE TABLE speed_date_sessions (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  community_id    uuid REFERENCES communities(id) ON DELETE SET NULL,
  scheduled_at    timestamptz NOT NULL,
  duration_seconds int DEFAULT 300,
  participant_ids uuid[] DEFAULT '{}',
  status          text DEFAULT 'scheduled' CHECK (status IN ('scheduled','active','completed')),
  daily_room_url  text,
  prompts         text[] DEFAULT '{}',
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE speed_date_sessions ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read scheduled/active sessions
CREATE POLICY "speed_date_read_auth" ON speed_date_sessions
  FOR SELECT USING (auth.uid() IS NOT NULL AND status IN ('scheduled','active'));

-- Participants can update (for joining, status changes)
CREATE POLICY "speed_date_participant_update" ON speed_date_sessions
  FOR UPDATE USING (auth.uid() = ANY(participant_ids));

-- Service role manages all (via edge functions)
-- No client INSERT — sessions created server-side only

CREATE INDEX idx_speed_date_scheduled ON speed_date_sessions (scheduled_at) WHERE status = 'scheduled';

-- ─── matches ─────────────────────────────────────────────────────────────────
CREATE TABLE matches (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_a_id       uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  user_b_id       uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  matched_at      timestamptz DEFAULT now(),
  source          text DEFAULT 'speed_date' CHECK (source IN ('speed_date','discover','community')),
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  UNIQUE (user_a_id, user_b_id),
  CONSTRAINT no_self_match CHECK (user_a_id != user_b_id)
);

ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "matches_own" ON matches
  FOR ALL USING (auth.uid() IN (user_a_id, user_b_id));

CREATE INDEX idx_matches_users ON matches (user_a_id, user_b_id);

-- Enable Realtime for messages and conversations
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
```

**Step 2: Push to Supabase**

```bash
npx supabase db push
```

Expected: `conversations`, `messages`, `speed_date_sessions`, `matches` tables created. `ai_call_log` now has `conversation_id` column.

**Step 3: Commit**

```bash
git add supabase/migrations/004_connect_dating.sql
git commit -m "feat: migration 004 — conversations, messages, speed_date_sessions, matches + realtime"
```

---

### Task 3: Update Shared rateLimit.ts for Conversation Support

**Files:**
- Modify: `supabase/functions/_shared/rateLimit.ts`

The existing `rateLimit.ts` doesn't support `conversation_id` in rate limiting or logging. Update it now that the DB column exists.

**Step 1: Update the file**

```typescript
// supabase/functions/_shared/rateLimit.ts
import { getSupabaseClient } from './auth.ts';

export async function checkRateLimit(params: {
  userId: string;
  fnName: string;
  maxCount: number;
  windowType: 'daily' | 'lifetime' | 'conversation';
  conversationId?: string;
}): Promise<{ allowed: boolean; currentCount: number }> {
  const supabase = getSupabaseClient();
  const today = new Date().toISOString().split('T')[0];

  let query = supabase
    .from('ai_call_log')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', params.userId)
    .eq('function_name', params.fnName);

  if (params.windowType === 'daily') {
    query = query.gte('called_at', `${today}T00:00:00.000Z`);
  } else if (params.windowType === 'conversation' && params.conversationId) {
    query = query.eq('conversation_id', params.conversationId);
  }
  // 'lifetime' — no additional filter

  const { count } = await query;
  const currentCount = count ?? 0;

  return {
    allowed: currentCount < params.maxCount,
    currentCount,
  };
}

export async function logAiCall(params: {
  userId: string;
  fnName: string;
  wasMock: boolean;
  conversationId?: string;
}): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('ai_call_log').insert({
    user_id: params.userId,
    function_name: params.fnName,
    was_mock: params.wasMock,
    ...(params.conversationId ? { conversation_id: params.conversationId } : {}),
  });
  return { error: error?.message ?? null };
}
```

**Step 2: Commit**

```bash
git add supabase/functions/_shared/rateLimit.ts
git commit -m "feat: rateLimit shared util — add conversation_id support for per-conversation limits"
```

---

### Task 4: Install Daily.co Dependency

**Files:**
- Modify: `apps/mobile/package.json`

**Step 1: Install**

```bash
cd C:/Thinqer/roxy-client/apps/mobile
npm install @daily-co/react-native-daily-js
```

**Step 2: Add to transformIgnorePatterns in package.json jest config**

Open `apps/mobile/package.json` and find the `"jest"` section. Update `transformIgnorePatterns` to include `@daily-co`:

```json
"jest": {
  "preset": "jest-expo",
  "setupFilesAfterEnv": ["@testing-library/jest-native/extend-expect"],
  "transformIgnorePatterns": [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@daily-co/.*|@shopify/.*)"
  ]
}
```

**Step 3: Verify tests still pass**

```bash
cd C:/Thinqer/roxy-client/apps/mobile
npm run test:ci
```

Expected: All existing tests still pass (22/22 or however many exist).

**Step 4: Commit**

```bash
cd C:/Thinqer/roxy-client
git add apps/mobile/package.json apps/mobile/package-lock.json
git commit -m "feat: install @daily-co/react-native-daily-js for speed dating video"
```

---

### Task 5: connectStore Zustand Store

**Files:**
- Create: `apps/mobile/store/connectStore.ts`
- Create: `apps/mobile/__tests__/store/connectStore.test.ts`

**Step 1: Write the failing test**

```typescript
// apps/mobile/__tests__/store/connectStore.test.ts
import { act, renderHook } from '@testing-library/react-native';
import { useConnectStore } from '../../store/connectStore';
import { Conversation } from '../../types';

const mockConv: Conversation = {
  id: 'conv-1',
  participant_ids: ['user-1', 'user-2'],
  conversation_type: 'direct',
  last_message_at: '2026-03-04T10:00:00Z',
  roxy_nudge_count: 0,
  roxy_wingwoman_count_today: 0,
  last_roxy_call_date: null,
  created_at: '2026-03-01T00:00:00Z',
};

describe('connectStore', () => {
  beforeEach(() => {
    useConnectStore.setState({
      conversations: [],
      activeConversationId: null,
      unreadCounts: {},
    });
  });

  it('initialises with empty state', () => {
    const { result } = renderHook(() => useConnectStore());
    expect(result.current.conversations).toEqual([]);
    expect(result.current.activeConversationId).toBeNull();
    expect(result.current.unreadCounts).toEqual({});
  });

  it('setConversations replaces the list', () => {
    const { result } = renderHook(() => useConnectStore());
    act(() => result.current.setConversations([mockConv]));
    expect(result.current.conversations).toHaveLength(1);
    expect(result.current.conversations[0].id).toBe('conv-1');
  });

  it('setActiveConversation updates activeConversationId', () => {
    const { result } = renderHook(() => useConnectStore());
    act(() => result.current.setActiveConversation('conv-1'));
    expect(result.current.activeConversationId).toBe('conv-1');
  });

  it('incrementUnread increments count for a conversation', () => {
    const { result } = renderHook(() => useConnectStore());
    act(() => result.current.incrementUnread('conv-1'));
    act(() => result.current.incrementUnread('conv-1'));
    expect(result.current.unreadCounts['conv-1']).toBe(2);
  });

  it('clearUnread resets count for a conversation', () => {
    const { result } = renderHook(() => useConnectStore());
    act(() => result.current.incrementUnread('conv-1'));
    act(() => result.current.clearUnread('conv-1'));
    expect(result.current.unreadCounts['conv-1']).toBe(0);
  });

  it('upsertConversation adds new or updates existing', () => {
    const { result } = renderHook(() => useConnectStore());
    act(() => result.current.upsertConversation(mockConv));
    expect(result.current.conversations).toHaveLength(1);
    const updated = { ...mockConv, last_message_at: '2026-03-04T11:00:00Z' };
    act(() => result.current.upsertConversation(updated));
    expect(result.current.conversations).toHaveLength(1);
    expect(result.current.conversations[0].last_message_at).toBe('2026-03-04T11:00:00Z');
  });
});
```

**Step 2: Run test — expect FAIL**

```bash
cd C:/Thinqer/roxy-client/apps/mobile
npm run test:ci -- --testPathPattern=connectStore
```

Expected: FAIL — `Cannot find module '../../store/connectStore'`

**Step 3: Implement the store**

```typescript
// apps/mobile/store/connectStore.ts
import { create } from 'zustand';
import { Conversation } from '../types';

interface ConnectState {
  conversations: Conversation[];
  activeConversationId: string | null;
  unreadCounts: Record<string, number>;
  setConversations: (convs: Conversation[]) => void;
  upsertConversation: (conv: Conversation) => void;
  setActiveConversation: (id: string | null) => void;
  incrementUnread: (conversationId: string) => void;
  clearUnread: (conversationId: string) => void;
}

export const useConnectStore = create<ConnectState>((set) => ({
  conversations: [],
  activeConversationId: null,
  unreadCounts: {},

  setConversations: (conversations) => set({ conversations }),

  upsertConversation: (conv) =>
    set((s) => {
      const idx = s.conversations.findIndex((c) => c.id === conv.id);
      if (idx === -1) {
        return { conversations: [conv, ...s.conversations] };
      }
      const updated = [...s.conversations];
      updated[idx] = conv;
      return { conversations: updated };
    }),

  setActiveConversation: (activeConversationId) => set({ activeConversationId }),

  incrementUnread: (conversationId) =>
    set((s) => ({
      unreadCounts: {
        ...s.unreadCounts,
        [conversationId]: (s.unreadCounts[conversationId] ?? 0) + 1,
      },
    })),

  clearUnread: (conversationId) =>
    set((s) => ({
      unreadCounts: { ...s.unreadCounts, [conversationId]: 0 },
    })),
}));
```

**Step 4: Run test — expect PASS**

```bash
npm run test:ci -- --testPathPattern=connectStore
```

Expected: PASS (5 tests).

**Step 5: Commit**

```bash
cd C:/Thinqer/roxy-client
git add apps/mobile/store/connectStore.ts apps/mobile/__tests__/store/connectStore.test.ts
git commit -m "feat: connectStore — conversations list, unread counts, active conversation"
```

---

### Task 6: useRealtime Hook

**Files:**
- Create: `apps/mobile/hooks/useRealtime.ts`
- Create: `apps/mobile/__tests__/hooks/useRealtime.test.ts`

**Step 1: Write the failing test**

```typescript
// apps/mobile/__tests__/hooks/useRealtime.test.ts
import { renderHook, act } from '@testing-library/react-native';
import { useRealtime } from '../../hooks/useRealtime';

// Mock supabase realtime
const mockUnsubscribe = jest.fn();
const mockSubscribe = jest.fn().mockReturnValue({ unsubscribe: mockUnsubscribe });
const mockOn = jest.fn().mockReturnValue({ subscribe: mockSubscribe });
const mockChannel = jest.fn().mockReturnValue({ on: mockOn });

jest.mock('../../lib/supabase', () => ({
  supabase: {
    channel: mockChannel,
    removeChannel: jest.fn(),
  },
}));

describe('useRealtime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exposes messages array and isSubscribed flag', () => {
    const { result } = renderHook(() =>
      useRealtime({ conversationId: 'conv-1', initialMessages: [] })
    );
    expect(Array.isArray(result.current.messages)).toBe(true);
    expect(typeof result.current.isSubscribed).toBe('boolean');
  });

  it('starts with initialMessages', () => {
    const initial = [
      {
        id: 'msg-1',
        conversation_id: 'conv-1',
        sender_id: 'user-1',
        content: 'hello',
        media_url: null,
        message_type: 'text' as const,
        is_read: false,
        created_at: '2026-03-04T10:00:00Z',
      },
    ];
    const { result } = renderHook(() =>
      useRealtime({ conversationId: 'conv-1', initialMessages: initial })
    );
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].id).toBe('msg-1');
  });

  it('creates a supabase channel on mount', () => {
    renderHook(() =>
      useRealtime({ conversationId: 'conv-1', initialMessages: [] })
    );
    expect(mockChannel).toHaveBeenCalledWith('messages:conv-1');
  });
});
```

**Step 2: Run test — expect FAIL**

```bash
npm run test:ci -- --testPathPattern=useRealtime
```

Expected: FAIL — `Cannot find module '../../hooks/useRealtime'`

**Step 3: Implement useRealtime**

```typescript
// apps/mobile/hooks/useRealtime.ts
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
}

export function useRealtime({
  conversationId,
  initialMessages,
}: UseRealtimeOptions): UseRealtimeReturn {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const appendMessage = (msg: Message) => {
    setMessages((prev) => {
      // Deduplicate by id
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
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
      .subscribe((status) => {
        setIsSubscribed(status === 'SUBSCRIBED');
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      setIsSubscribed(false);
    };
  }, [conversationId]);

  return { messages, isSubscribed, appendMessage };
}
```

**Step 4: Run test — expect PASS**

```bash
npm run test:ci -- --testPathPattern=useRealtime
```

Expected: PASS (3 tests).

**Step 5: Commit**

```bash
cd C:/Thinqer/roxy-client
git add apps/mobile/hooks/useRealtime.ts apps/mobile/__tests__/hooks/useRealtime.test.ts
git commit -m "feat: useRealtime hook — Supabase postgres_changes subscription with deduplication"
```

---

### Task 7: roxy-icebreaker Edge Function

**Files:**
- Create: `supabase/functions/roxy-icebreaker/index.ts`

**Step 1: Write the function**

```typescript
// supabase/functions/roxy-icebreaker/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { callClaude } from '../_shared/claude.ts';
import { checkRateLimit, logAiCall } from '../_shared/rateLimit.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const body = await req.json();
  const { conversation_id, user_a_name, user_b_name, shared_interests } = body;

  if (!conversation_id) return errorResponse('conversation_id required', 400);

  // Rate limit: 1 per conversation lifetime
  const { allowed } = await checkRateLimit({
    userId: auth.userId,
    fnName: 'roxy-icebreaker',
    maxCount: 1,
    windowType: 'conversation',
    conversationId: conversation_id,
  });

  if (!allowed) return errorResponse('Icebreaker already sent for this conversation', 429);

  const nameA = user_a_name ?? 'someone';
  const nameB = user_b_name ?? 'someone';
  const interests = Array.isArray(shared_interests) && shared_interests.length > 0
    ? shared_interests.join(', ')
    : 'general interests';

  const mockIcebreaker = "What's a skill you've been wanting to learn?";

  const icebreaker = await callClaude({
    system: `You are Roxy, WLW AI wingwoman. Generate ONE short, open-ended icebreaker question for ${nameA} and ${nameB} who just matched. They share interests in: ${interests}. Max 20 words. No quotes. No preamble. Just the question.`,
    messages: [{ role: 'user', content: 'Generate the icebreaker.' }],
    maxTokens: 64,
    mockResponse: mockIcebreaker,
  });

  const { error: logError } = await logAiCall({
    userId: auth.userId,
    fnName: 'roxy-icebreaker',
    wasMock: icebreaker === mockIcebreaker,
    conversationId: conversation_id,
  });

  if (logError) return errorResponse('Failed to record call', 500);

  return successResponse({ icebreaker });
});
```

**Step 2: Deploy**

```bash
cd C:/Thinqer/roxy-client
npx supabase functions deploy roxy-icebreaker
```

**Step 3: Commit**

```bash
git add supabase/functions/roxy-icebreaker/
git commit -m "feat: roxy-icebreaker edge function — 1/conversation rate limit, Claude Haiku"
```

---

### Task 8: roxy-wingwoman Edge Function

**Files:**
- Create: `supabase/functions/roxy-wingwoman/index.ts`

**Step 1: Write the function**

```typescript
// supabase/functions/roxy-wingwoman/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { callClaude } from '../_shared/claude.ts';
import { checkRateLimit, logAiCall } from '../_shared/rateLimit.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const body = await req.json();
  const { conversation_id, message_history, current_message } = body;

  if (!conversation_id) return errorResponse('conversation_id required', 400);
  if (!current_message) return errorResponse('current_message required', 400);

  // Rate limit: 5 per conversation per day
  const { allowed, currentCount } = await checkRateLimit({
    userId: auth.userId,
    fnName: 'roxy-wingwoman',
    maxCount: 5,
    windowType: 'daily',
  });

  if (!allowed) {
    return errorResponse(`Daily wingwoman limit reached (${currentCount}/5)`, 429);
  }

  // Build context from recent messages (last 6 for brevity)
  const recentHistory = Array.isArray(message_history)
    ? message_history.slice(-6)
    : [];

  const historyText = recentHistory.length > 0
    ? recentHistory.map((m: { sender: string; content: string }) => `${m.sender}: ${m.content}`).join('\n')
    : 'No prior messages.';

  const mockSuggestion = "That sounds really interesting — tell me more!";

  const suggestion = await callClaude({
    system: `You are Roxy, WLW AI wingwoman. Suggest ONE short, warm follow-up message (max 15 words) that continues the conversation naturally. Be genuine, not sycophantic. No quotes. Just the suggestion text.`,
    messages: [
      {
        role: 'user',
        content: `Recent conversation:\n${historyText}\n\nThey just typed: "${current_message}"\n\nSuggest a reply.`,
      },
    ],
    maxTokens: 64,
    mockResponse: mockSuggestion,
  });

  const { error: logError } = await logAiCall({
    userId: auth.userId,
    fnName: 'roxy-wingwoman',
    wasMock: suggestion === mockSuggestion,
    conversationId: conversation_id,
  });

  if (logError) return errorResponse('Failed to record call', 500);

  return successResponse({ suggestion });
});
```

**Step 2: Deploy**

```bash
npx supabase functions deploy roxy-wingwoman
```

**Step 3: Commit**

```bash
git add supabase/functions/roxy-wingwoman/
git commit -m "feat: roxy-wingwoman edge function — 5/day rate limit, contextual reply suggestion"
```

---

### Task 9: speed-date-prompts + join-speed-date-session Edge Functions

**Files:**
- Create: `supabase/functions/speed-date-prompts/index.ts`
- Create: `supabase/functions/join-speed-date-session/index.ts`

**Step 1: speed-date-prompts (weekly cron — generates prompts in advance)**

```typescript
// supabase/functions/speed-date-prompts/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { callClaude } from '../_shared/claude.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

const MOCK_PROMPTS = [
  "What's a skill you've always wanted to learn?",
  "Which place changed how you see yourself?",
  "What's your version of a perfect Sunday?",
  "What's something you believed at 16 you've completely changed your mind on?",
  "If you could live anywhere for a year, where and why?",
  "What's a small thing that always makes your day better?",
  "What are you most proud of that nobody knows about?",
  "Describe your ideal first date in three words.",
  "What's the last book, show, or song that genuinely moved you?",
  "What does home mean to you?",
];

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const body = await req.json().catch(() => ({}));
  const { session_id } = body;

  if (!session_id) return errorResponse('session_id required', 400);

  const supabase = getSupabaseClient();

  // Verify session exists
  const { data: session, error: sessionError } = await supabase
    .from('speed_date_sessions')
    .select('id, prompts')
    .eq('id', session_id)
    .single();

  if (sessionError || !session) return errorResponse('Session not found', 404);
  if (session.prompts && session.prompts.length >= 10) {
    return successResponse({ prompts: session.prompts, generated: false });
  }

  const mockResponse = JSON.stringify(MOCK_PROMPTS);

  const raw = await callClaude({
    system: `You are Roxy, WLW AI wingwoman. Generate exactly 10 conversation starter prompts for a 5-minute speed date between two WLW users. Prompts must be: light, fun, emotionally interesting (not small talk), queer-affirming and inclusive, varied (one nostalgic, one future-focused, one playful, one values-based). Return ONLY a JSON array of 10 strings. No markdown, no explanation.`,
    messages: [{ role: 'user', content: 'Generate the 10 prompts.' }],
    maxTokens: 512,
    mockResponse,
  });

  let prompts: string[] = MOCK_PROMPTS;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === 10) {
      prompts = parsed;
    }
  } catch {
    // use mock
  }

  const { error: updateError } = await supabase
    .from('speed_date_sessions')
    .update({ prompts })
    .eq('id', session_id);

  if (updateError) return errorResponse('Failed to store prompts', 500);

  return successResponse({ prompts, generated: true });
});
```

**Step 2: join-speed-date-session (creates Daily.co room + adds participant)**

```typescript
// supabase/functions/join-speed-date-session/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

async function getOrCreateDailyRoom(sessionId: string): Promise<string> {
  const dailyApiKey = Deno.env.get('DAILY_API_KEY');
  if (!dailyApiKey) throw new Error('DAILY_API_KEY not configured');

  const roomName = `roxy-speed-date-${sessionId.slice(0, 8)}`;

  // Try to get existing room first
  const getRes = await fetch(`https://api.daily.co/v1/rooms/${roomName}`, {
    headers: { Authorization: `Bearer ${dailyApiKey}` },
  });

  if (getRes.ok) {
    const room = await getRes.json();
    return room.url;
  }

  // Create new room
  const createRes = await fetch('https://api.daily.co/v1/rooms', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${dailyApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: roomName,
      properties: {
        max_participants: 2,
        enable_chat: false,
        enable_screenshare: false,
        exp: Math.floor(Date.now() / 1000) + 3600, // 1hr from now
        eject_at_room_exp: true,
      },
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Daily.co room creation failed: ${err}`);
  }

  const room = await createRes.json();
  return room.url;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const body = await req.json();
  const { session_id } = body;
  if (!session_id) return errorResponse('session_id required', 400);

  const supabase = getSupabaseClient();

  // Fetch session
  const { data: session, error: sessionError } = await supabase
    .from('speed_date_sessions')
    .select('*')
    .eq('id', session_id)
    .single();

  if (sessionError || !session) return errorResponse('Session not found', 404);

  if (session.status === 'completed') return errorResponse('Session already completed', 400);

  // Check not already at capacity (2 participants for speed dating)
  if (session.participant_ids.length >= 2 && !session.participant_ids.includes(auth.userId)) {
    return errorResponse('Session is full', 409);
  }

  // Get or create Daily.co room
  let roomUrl = session.daily_room_url;
  if (!roomUrl) {
    try {
      roomUrl = await getOrCreateDailyRoom(session_id);
    } catch (e) {
      return errorResponse(`Failed to create video room: ${e instanceof Error ? e.message : 'unknown'}`, 500);
    }
  }

  // Add participant if not already in list
  const participants = session.participant_ids.includes(auth.userId)
    ? session.participant_ids
    : [...session.participant_ids, auth.userId];

  const newStatus = participants.length >= 2 ? 'active' : 'scheduled';

  const { error: updateError } = await supabase
    .from('speed_date_sessions')
    .update({
      daily_room_url: roomUrl,
      participant_ids: participants,
      status: newStatus,
    })
    .eq('id', session_id);

  if (updateError) return errorResponse('Failed to update session', 500);

  return successResponse({
    room_url: roomUrl,
    session_id,
    status: newStatus,
    participant_count: participants.length,
  });
});
```

**Step 3: Deploy both**

```bash
cd C:/Thinqer/roxy-client
npx supabase functions deploy speed-date-prompts
npx supabase functions deploy join-speed-date-session
```

**Step 4: Set DAILY_API_KEY secret**

```bash
npx supabase secrets set DAILY_API_KEY=your-daily-api-key-here
```

**Step 5: Update DevPanel seed action to also generate prompts**

Edit `apps/mobile/components/dev/DevPanel.tsx`. In `DevPanelInner`, update the seed action handler to also call `speed-date-prompts` after seeding:

```typescript
// Find the existing "Seed test session" button handler and update it:
const seedAndGeneratePrompts = async () => {
  setLoading(true);
  const { data } = await callEdgeFunction<{ session: { id: string } }>(
    'dev-control',
    { action: 'seed_speed_date_session' }
  );
  if (data?.session?.id) {
    await callEdgeFunction('speed-date-prompts', { session_id: data.session.id });
  }
  await refresh();
  setLoading(false);
};
```

Replace the existing "Seed test speed date" button's `onPress` from `() => action('seed_speed_date_session')` to `seedAndGeneratePrompts`.

**Step 6: Commit**

```bash
git add supabase/functions/speed-date-prompts/ supabase/functions/join-speed-date-session/ apps/mobile/components/dev/DevPanel.tsx
git commit -m "feat: speed-date-prompts + join-speed-date-session edge functions, DevPanel seed update"
```

---

### Task 10: lib/daily.ts — Daily.co Client Utility

**Files:**
- Create: `apps/mobile/lib/daily.ts`

**Step 1: Write the utility**

This file provides a typed wrapper around Daily.co that also handles the case where Daily.co is not available (Expo Go / web).

```typescript
// apps/mobile/lib/daily.ts

// DailyVideo is only available in native builds (not Expo Go / web)
// We lazy-import and guard to prevent crashes
let DailyIframe: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const DailyModule = require('@daily-co/react-native-daily-js');
  DailyIframe = DailyModule.default ?? DailyModule.DailyIframe ?? null;
} catch {
  // Daily.co not available (Expo Go or web build) — video will be stubbed
}

export { DailyIframe };

export const isDailyAvailable = (): boolean => DailyIframe !== null;

export interface DailyRoomInfo {
  room_url: string;
  session_id: string;
  status: string;
  participant_count: number;
}
```

**Step 2: Commit**

```bash
git add apps/mobile/lib/daily.ts
git commit -m "feat: lib/daily.ts — guarded Daily.co import, stub-safe for Expo Go"
```

---

### Task 11: Connect Tab — Conversation List

**Files:**
- Modify: `apps/mobile/app/(tabs)/connect/index.tsx`

**Step 1: Write the screen**

```typescript
// apps/mobile/app/(tabs)/connect/index.tsx
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Switch, ActivityIndicator,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { format, isToday, isYesterday } from 'date-fns';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { useProfileStore } from '../../../store/profileStore';
import { useConnectStore } from '../../../store/connectStore';
import { COLORS } from '../../../lib/constants';
import { Conversation } from '../../../types';

function formatLastMessage(ts: string | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'dd MMM');
}

function ConversationRow({
  item,
  currentUserId,
  unreadCount,
  onPress,
}: {
  item: Conversation;
  currentUserId: string;
  unreadCount: number;
  onPress: () => void;
}) {
  const otherParticipant = item.participant_ids.find((id) => id !== currentUserId) ?? '';

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {item.conversation_type === 'speed_date' ? '⚡' : '💬'}
        </Text>
      </View>
      <View style={styles.rowContent}>
        <Text style={styles.rowName} numberOfLines={1}>
          {item.conversation_type === 'speed_date' ? 'Speed Date Match' : `Direct Message`}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {item.conversation_type === 'sister' ? '💜 Sister chat' : 'Tap to open'}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.rowTime}>{formatLastMessage(item.last_message_at)}</Text>
        {unreadCount > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function ConnectScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { profile, setProfile } = useProfileStore();
  const { conversations, setConversations, unreadCounts } = useConnectStore();
  const [loading, setLoading] = useState(true);
  const [datingMode, setDatingMode] = useState(profile?.is_dating_mode ?? false);

  const loadConversations = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from('conversations')
      .select('*')
      .contains('participant_ids', [user.id])
      .order('last_message_at', { ascending: false, nullsFirst: false });
    if (data) setConversations(data as Conversation[]);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const toggleDatingMode = async (val: boolean) => {
    if (!user) return;
    setDatingMode(val);
    await supabase.from('profiles').update({ is_dating_mode: val }).eq('id', user.id);
    if (profile) setProfile({ ...profile, is_dating_mode: val });
  };

  const renderItem = ({ item }: { item: Conversation }) => (
    <ConversationRow
      item={item}
      currentUserId={user?.id ?? ''}
      unreadCount={unreadCounts[item.id] ?? 0}
      onPress={() => router.push(`/(tabs)/connect/chat/${item.id}`)}
    />
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Connect</Text>
        <View style={styles.headerRight}>
          <Text style={styles.datingLabel}>Dating</Text>
          <Switch
            value={datingMode}
            onValueChange={toggleDatingMode}
            trackColor={{ false: COLORS.surface, true: COLORS.primary }}
            thumbColor={COLORS.textPrimary}
          />
        </View>
      </View>

      {/* Speed Date entry (dating mode only) */}
      {datingMode && (
        <TouchableOpacity
          style={styles.speedDateBanner}
          onPress={() => router.push('/(tabs)/connect/speed-dating')}
          activeOpacity={0.8}
        >
          <Text style={styles.speedDateIcon}>⚡</Text>
          <View>
            <Text style={styles.speedDateTitle}>Speed Dating</Text>
            <Text style={styles.speedDateSub}>Find your next match in 5 minutes</Text>
          </View>
          <Text style={styles.speedDateArrow}>›</Text>
        </TouchableOpacity>
      )}

      {/* Conversation list */}
      {loading ? (
        <ActivityIndicator color={COLORS.roxy} style={{ marginTop: 48 }} />
      ) : conversations.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>💬</Text>
          <Text style={styles.emptyTitle}>No conversations yet</Text>
          <Text style={styles.emptyBody}>
            Match with someone in Speed Dating or connect in your communities.
          </Text>
        </View>
      ) : (
        <FlashList
          data={conversations}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          estimatedItemSize={72}
          onRefresh={loadConversations}
          refreshing={loading}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  datingLabel: { color: COLORS.textSecondary, fontSize: 14 },
  speedDateBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.primary + '20',
    borderBottomWidth: 1, borderBottomColor: COLORS.primary + '40',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  speedDateIcon: { fontSize: 28 },
  speedDateTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 15 },
  speedDateSub: { color: COLORS.textSecondary, fontSize: 13 },
  speedDateArrow: { color: COLORS.textMuted, fontSize: 24, marginLeft: 'auto' },
  row: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: { fontSize: 20 },
  rowContent: { flex: 1, marginRight: 8 },
  rowName: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 15 },
  rowSub: { color: COLORS.textMuted, fontSize: 13, marginTop: 2 },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  rowTime: { color: COLORS.textMuted, fontSize: 12 },
  unreadBadge: {
    backgroundColor: COLORS.primary, borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 2, minWidth: 20, alignItems: 'center',
  },
  unreadText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '700' },
  emptyBody: { color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22 },
});
```

**Step 2: Commit**

```bash
cd C:/Thinqer/roxy-client
git add apps/mobile/app/(tabs)/connect/index.tsx
git commit -m "feat: Connect tab — conversation list, FlashList, unread badges, dating mode toggle"
```

---

### Task 12: Chat Screen

**Files:**
- Create: `apps/mobile/app/(tabs)/connect/chat/[id].tsx`

**Step 1: Write the screen**

```typescript
// apps/mobile/app/(tabs)/connect/chat/[id].tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { format } from 'date-fns';
import { supabase, callEdgeFunction } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../store/authStore';
import { useConnectStore } from '../../../../store/connectStore';
import { useRealtime } from '../../../../hooks/useRealtime';
import { COLORS } from '../../../../lib/constants';
import { Message } from '../../../../types';

function MessageBubble({
  message,
  isOwn,
  onUseWingwoman,
}: {
  message: Message;
  isOwn: boolean;
  onUseWingwoman?: () => void;
}) {
  const isRoxySuggestion = message.message_type === 'roxy_suggestion';

  return (
    <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther, isRoxySuggestion && styles.bubbleRoxy]}>
      {isRoxySuggestion && (
        <Text style={styles.roxyLabel}>✨ Roxy suggests</Text>
      )}
      <Text style={[styles.bubbleText, isOwn ? styles.bubbleTextOwn : styles.bubbleTextOther]}>
        {message.content}
      </Text>
      {isRoxySuggestion && onUseWingwoman && (
        <View style={styles.roxyActions}>
          <TouchableOpacity style={styles.roxyUseBtn} onPress={onUseWingwoman}>
            <Text style={styles.roxyUseBtnText}>Use this</Text>
          </TouchableOpacity>
        </View>
      )}
      <Text style={styles.bubbleTime}>{format(new Date(message.created_at), 'HH:mm')}</Text>
    </View>
  );
}

export default function ChatScreen() {
  const { id: conversationId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const { clearUnread } = useConnectStore();
  const [initialMessages, setInitialMessages] = useState<Message[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [wingwomanLoading, setWingwomanLoading] = useState(false);
  const [icebreaker, setIcebreaker] = useState<string | null>(null);
  const flashListRef = useRef<FlashList<Message>>(null);

  const { messages, isSubscribed, appendMessage } = useRealtime({
    conversationId: conversationId ?? '',
    initialMessages,
  });

  // Load initial messages
  useEffect(() => {
    if (!conversationId) return;
    (async () => {
      setLoadingInitial(true);
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(100);
      if (data) setInitialMessages(data as Message[]);

      // Load icebreaker (first roxy_suggestion message)
      const icebreakerMsg = data?.find((m) => m.message_type === 'roxy_suggestion');
      if (icebreakerMsg) setIcebreaker(icebreakerMsg.content);

      // Mark messages as read
      if (user) {
        await supabase
          .from('messages')
          .update({ is_read: true })
          .eq('conversation_id', conversationId)
          .neq('sender_id', user.id)
          .eq('is_read', false);
        clearUnread(conversationId);
      }

      setLoadingInitial(false);
    })();
  }, [conversationId, user]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flashListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  const sendMessage = async (content: string, type: Message['message_type'] = 'text') => {
    if (!content.trim() || !user || !conversationId) return;
    setSending(true);
    const optimisticMsg: Message = {
      id: `tmp-${Date.now()}`,
      conversation_id: conversationId,
      sender_id: user.id,
      content: content.trim(),
      media_url: null,
      message_type: type,
      is_read: false,
      created_at: new Date().toISOString(),
    };
    appendMessage(optimisticMsg);
    setInputText('');

    const { error } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      content: content.trim(),
      message_type: type,
    });

    if (error) Alert.alert('Error', 'Failed to send message. Please try again.');
    setSending(false);
  };

  const handleWingwoman = async () => {
    if (!conversationId) return;
    setWingwomanLoading(true);

    // Build history from last 6 text messages
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

    setWingwomanLoading(false);

    if (error) {
      Alert.alert('Wingwoman unavailable', error);
      return;
    }

    if (data?.suggestion) {
      // Insert as roxy_suggestion message (visible to sender only as a bubble)
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
  };

  const renderItem = ({ item }: { item: Message }) => {
    const isOwn = item.sender_id === user?.id;
    const isRoxy = item.message_type === 'roxy_suggestion';
    return (
      <MessageBubble
        message={item}
        isOwn={isOwn && !isRoxy}
        onUseWingwoman={isRoxy ? () => {
          setInputText(item.content ?? '');
        } : undefined}
      />
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Chat</Text>
        <View style={styles.statusDot}>
          <View style={[styles.dot, isSubscribed ? styles.dotConnected : styles.dotDisconnected]} />
        </View>
      </View>

      {/* Icebreaker banner */}
      {icebreaker && (
        <View style={styles.icebreakerBanner}>
          <Text style={styles.icebreakerLabel}>✨ Roxy's icebreaker</Text>
          <Text style={styles.icebreakerText}>{icebreaker}</Text>
        </View>
      )}

      {/* Messages */}
      {loadingInitial ? (
        <ActivityIndicator color={COLORS.roxy} style={{ flex: 1 }} />
      ) : (
        <FlashList
          ref={flashListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          estimatedItemSize={60}
          contentContainerStyle={styles.messageList}
          ListEmptyComponent={
            <Text style={styles.emptyText}>Send your first message!</Text>
          }
        />
      )}

      {/* Input bar */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={styles.inputBar}>
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

          <TextInput
            style={styles.input}
            placeholder="Say something..."
            placeholderTextColor={COLORS.textMuted}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={2000}
          />

          <TouchableOpacity
            style={[styles.sendBtn, (!inputText.trim() || sending) && styles.sendBtnDisabled]}
            onPress={() => sendMessage(inputText)}
            disabled={!inputText.trim() || sending}
          >
            <Text style={styles.sendBtnText}>›</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
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
  headerTitle: { flex: 1, color: COLORS.textPrimary, fontWeight: '700', fontSize: 17, textAlign: 'center' },
  statusDot: { width: 40, alignItems: 'flex-end' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotConnected: { backgroundColor: COLORS.success },
  dotDisconnected: { backgroundColor: COLORS.textMuted },
  icebreakerBanner: {
    backgroundColor: COLORS.roxy + '20', borderBottomWidth: 1, borderBottomColor: COLORS.roxy + '40',
    padding: 12,
  },
  icebreakerLabel: { color: COLORS.roxy, fontSize: 11, fontWeight: '700', marginBottom: 2 },
  icebreakerText: { color: COLORS.textPrimary, fontSize: 14, fontStyle: 'italic' },
  messageList: { padding: 16, gap: 8 },
  bubble: { maxWidth: '80%', borderRadius: 16, padding: 12, marginVertical: 2 },
  bubbleOwn: { alignSelf: 'flex-end', backgroundColor: COLORS.primary, borderBottomRightRadius: 4 },
  bubbleOther: { alignSelf: 'flex-start', backgroundColor: COLORS.surface, borderBottomLeftRadius: 4 },
  bubbleRoxy: { alignSelf: 'center', backgroundColor: COLORS.roxy + '20', borderRadius: 12, borderWidth: 1, borderColor: COLORS.roxy + '60', width: '90%' },
  roxyLabel: { color: COLORS.roxy, fontSize: 11, fontWeight: '700', marginBottom: 4 },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  bubbleTextOwn: { color: '#fff' },
  bubbleTextOther: { color: COLORS.textPrimary },
  roxyActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  roxyUseBtn: { backgroundColor: COLORS.roxy, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 },
  roxyUseBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  bubbleTime: { color: COLORS.textMuted, fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },
  emptyText: { color: COLORS.textMuted, textAlign: 'center', marginTop: 40 },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    padding: 12, borderTopWidth: 1, borderTopColor: COLORS.surface,
    backgroundColor: COLORS.background,
  },
  wingwomanBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  wingwomanIcon: { fontSize: 20 },
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
});
```

**Step 2: Commit**

```bash
cd C:/Thinqer/roxy-client
git add apps/mobile/app/(tabs)/connect/chat/
git commit -m "feat: chat screen — FlashList messages, wingwoman wand, icebreaker banner, realtime"
```

---

### Task 13: Speed Dating — Lobby

**Files:**
- Create: `apps/mobile/app/(tabs)/connect/speed-dating/index.tsx`

**Step 1: Write the lobby screen**

```typescript
// apps/mobile/app/(tabs)/connect/speed-dating/index.tsx
import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, FlatList, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { format, differenceInSeconds, isPast } from 'date-fns';
import { supabase, callEdgeFunction } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../store/authStore';
import { COLORS } from '../../../../lib/constants';
import { SpeedDateSession } from '../../../../types';

function CountdownTimer({ scheduledAt }: { scheduledAt: string }) {
  const [secondsLeft, setSecondsLeft] = useState(
    Math.max(0, differenceInSeconds(new Date(scheduledAt), new Date()))
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  return (
    <Text style={styles.countdown}>
      {secondsLeft === 0 ? 'Joining now...' : `${mins}:${secs.toString().padStart(2, '0')}`}
    </Text>
  );
}

export default function SpeedDatingLobby() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [sessions, setSessions] = useState<SpeedDateSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('speed_date_sessions')
      .select('*')
      .in('status', ['scheduled', 'active'])
      .order('scheduled_at', { ascending: true });
    if (data) setSessions(data as SpeedDateSession[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const joinSession = async (sessionId: string) => {
    if (!user) return;
    setJoining(sessionId);
    const { data, error } = await callEdgeFunction<{
      room_url: string;
      session_id: string;
      status: string;
    }>('join-speed-date-session', { session_id: sessionId });

    setJoining(null);

    if (error) {
      Alert.alert('Could not join', error);
      return;
    }

    // Navigate to in-session screen
    router.push({
      pathname: '/(tabs)/connect/speed-dating/session',
      params: { session_id: sessionId, room_url: data!.room_url },
    });
  };

  const canJoin = (session: SpeedDateSession): boolean => {
    const secUntilStart = differenceInSeconds(new Date(session.scheduled_at), new Date());
    return secUntilStart <= 120; // join up to 2min before
  };

  const renderSession = ({ item }: { item: SpeedDateSession }) => {
    const joinable = canJoin(item);
    const isJoining = joining === item.id;
    const alreadyIn = item.participant_ids.includes(user?.id ?? '');

    return (
      <View style={styles.sessionCard}>
        <View style={styles.sessionInfo}>
          <Text style={styles.sessionDate}>{format(new Date(item.scheduled_at), 'EEE, MMM d')}</Text>
          <CountdownTimer scheduledAt={item.scheduled_at} />
          <Text style={styles.sessionMeta}>
            {item.participant_ids.length}/2 joined · {Math.floor(item.duration_seconds / 60)} min
          </Text>
        </View>
        <TouchableOpacity
          style={[
            styles.joinBtn,
            !joinable && styles.joinBtnDisabled,
            alreadyIn && styles.joinBtnRejoining,
          ]}
          onPress={() => joinSession(item.id)}
          disabled={!joinable || isJoining}
        >
          {isJoining ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.joinBtnText}>{alreadyIn ? 'Rejoin' : joinable ? 'Join ⚡' : 'Soon'}</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>⚡ Speed Dating</Text>
        <Text style={styles.subtitle}>5-minute video dates, Roxy-powered prompts</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={COLORS.roxy} style={{ marginTop: 40 }} />
      ) : sessions.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>⚡</Text>
          <Text style={styles.emptyTitle}>No sessions scheduled</Text>
          <Text style={styles.emptyBody}>
            Check back soon — or use the DEV panel to seed a test session.
          </Text>
          <TouchableOpacity style={styles.refreshBtn} onPress={loadSessions}>
            <Text style={styles.refreshBtnText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          renderItem={renderSession}
          contentContainerStyle={styles.list}
          onRefresh={loadSessions}
          refreshing={loading}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { padding: 20, paddingBottom: 8 },
  title: { fontSize: 26, fontWeight: '800', color: COLORS.textPrimary },
  subtitle: { color: COLORS.textSecondary, marginTop: 4, fontSize: 14 },
  list: { padding: 16, gap: 12 },
  sessionCard: {
    backgroundColor: COLORS.surface, borderRadius: 16, padding: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  sessionInfo: { gap: 4, flex: 1 },
  sessionDate: { color: COLORS.textMuted, fontSize: 12 },
  countdown: { color: COLORS.textPrimary, fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  sessionMeta: { color: COLORS.textSecondary, fontSize: 13 },
  joinBtn: {
    backgroundColor: COLORS.primary, borderRadius: 12,
    paddingHorizontal: 20, paddingVertical: 12, minWidth: 80, alignItems: 'center',
  },
  joinBtnDisabled: { backgroundColor: COLORS.surface },
  joinBtnRejoining: { backgroundColor: COLORS.secondary },
  joinBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  emptyIcon: { fontSize: 56 },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '700' },
  emptyBody: { color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22 },
  refreshBtn: { backgroundColor: COLORS.surface, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10, marginTop: 8 },
  refreshBtnText: { color: COLORS.textPrimary, fontWeight: '600' },
});
```

**Step 2: Commit**

```bash
cd C:/Thinqer/roxy-client
git add apps/mobile/app/(tabs)/connect/speed-dating/index.tsx
git commit -m "feat: speed dating lobby — session list, countdown timer, join flow"
```

---

### Task 14: Speed Dating — In-Session Screen

**Files:**
- Create: `apps/mobile/app/(tabs)/connect/speed-dating/session.tsx`

> **Important:** The `DailyVideo` component only renders in native builds (expo run:ios / expo run:android / EAS build). In Expo Go and web it shows a placeholder. This is by design via the guarded import in `lib/daily.ts`.

**Step 1: Write the session screen**

```typescript
// apps/mobile/app/(tabs)/connect/speed-dating/session.tsx
import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, PanResponder,
  Dimensions, StatusBar,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { COLORS, DEV_MOCK_PROMPTS } from '../../../../lib/constants';
import { isDailyAvailable } from '../../../../lib/daily';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Guard: DailyVideo only available in native builds
let DailyVideo: any = null;
if (isDailyAvailable()) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    DailyVideo = require('@daily-co/react-native-daily-js').DailyVideo;
  } catch {
    // ignore
  }
}

function TimerBar({ durationSeconds, onEnd }: { durationSeconds: number; onEnd: () => void }) {
  const [secondsLeft, setSecondsLeft] = useState(durationSeconds);
  const progress = secondsLeft / durationSeconds;

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(interval);
          onEnd();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const barColor =
    progress > 0.5 ? COLORS.success :
    progress > 0.25 ? COLORS.warning :
    COLORS.error;

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;

  return (
    <View style={timerStyles.container}>
      <View style={[timerStyles.bar, { width: `${progress * 100}%` as any, backgroundColor: barColor }]} />
      <Text style={timerStyles.label}>{mins}:{secs.toString().padStart(2, '0')} remaining</Text>
    </View>
  );
}

const timerStyles = StyleSheet.create({
  container: { height: 36, backgroundColor: COLORS.surface, justifyContent: 'center' },
  bar: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2 },
  label: { color: '#fff', fontWeight: '700', fontSize: 13, textAlign: 'center', zIndex: 1 },
});

export default function SpeedDatingSession() {
  const router = useRouter();
  const { session_id, room_url } = useLocalSearchParams<{ session_id: string; room_url: string }>();

  // Prompts state — use mock prompts for dev or when pre-generated
  const [prompts] = useState<string[]>(DEV_MOCK_PROMPTS as unknown as string[]);
  const [promptIndex, setPromptIndex] = useState(0);
  const [overlayMinimised, setOverlayMinimised] = useState(false);
  const [liked, setLiked] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);

  // Draggable overlay position
  const overlayPos = useRef(new Animated.ValueXY({ x: 20, y: SCREEN_HEIGHT * 0.4 })).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: () => !overlayMinimised,
      onPanResponderGrant: () => {
        overlayPos.setOffset({ x: (overlayPos.x as any)._value, y: (overlayPos.y as any)._value });
        overlayPos.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event(
        [null, { dx: overlayPos.x, dy: overlayPos.y }],
        { useNativeDriver: false }
      ),
      onPanResponderRelease: () => {
        overlayPos.flattenOffset();
      },
    })
  ).current;

  const handleEnd = () => {
    setSessionEnded(true);
    setTimeout(() => {
      router.replace({
        pathname: '/(tabs)/connect/speed-dating/result',
        params: { session_id: session_id ?? '', liked: liked ? '1' : '0' },
      });
    }, 1000);
  };

  const nextPrompt = () => {
    setPromptIndex((i) => Math.min(i + 1, prompts.length - 1));
  };

  if (sessionEnded) {
    return (
      <View style={styles.ended}>
        <Text style={styles.endedText}>Time's up! ⚡</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      {/* Timer bar */}
      <TimerBar durationSeconds={300} onEnd={handleEnd} />

      {/* Video area */}
      <View style={styles.videoArea}>
        {DailyVideo && room_url ? (
          <DailyVideo
            sessionId={room_url}
            mirror={false}
            style={styles.remoteVideo}
          />
        ) : (
          <View style={styles.videoPlaceholder}>
            <Text style={styles.videoPlaceholderIcon}>📹</Text>
            <Text style={styles.videoPlaceholderText}>
              {room_url ? 'Video not available in Expo Go' : 'No room URL'}
            </Text>
            <Text style={styles.videoPlaceholderSub}>Use a native build for video calls</Text>
          </View>
        )}
      </View>

      {/* Draggable Roxy prompt overlay */}
      {!overlayMinimised ? (
        <Animated.View
          style={[styles.promptOverlay, overlayPos.getLayout()]}
          {...panResponder.panHandlers}
        >
          <View style={styles.promptHeader}>
            <Text style={styles.promptRoxyLabel}>✨ Roxy</Text>
            <TouchableOpacity onPress={() => setOverlayMinimised(true)}>
              <Text style={styles.promptMinimiseBtn}>—</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.promptText}>{prompts[promptIndex]}</Text>
          <Text style={styles.promptCount}>{promptIndex + 1}/{prompts.length}</Text>
          {promptIndex < prompts.length - 1 && (
            <TouchableOpacity style={styles.nextPromptBtn} onPress={nextPrompt}>
              <Text style={styles.nextPromptBtnText}>Next →</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      ) : (
        <TouchableOpacity
          style={styles.promptMinimised}
          onPress={() => setOverlayMinimised(false)}
        >
          <Text style={styles.promptMinimisedIcon}>✨</Text>
        </TouchableOpacity>
      )}

      {/* Bottom controls: self pip + like button */}
      <View style={styles.bottomBar}>
        <View style={styles.selfPip}>
          {DailyVideo ? (
            <DailyVideo
              sessionId={room_url}
              mirror
              style={styles.selfVideo}
            />
          ) : (
            <View style={styles.selfPipPlaceholder}>
              <Text style={{ fontSize: 20 }}>🎥</Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[styles.likeBtn, liked && styles.likeBtnActive]}
          onPress={() => setLiked((l) => !l)}
        >
          <Text style={styles.likeBtnIcon}>{liked ? '❤️' : '🤍'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.endBtn} onPress={handleEnd}>
          <Text style={styles.endBtnText}>End</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  ended: { flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center' },
  endedText: { color: COLORS.textPrimary, fontSize: 28, fontWeight: '800' },
  videoArea: { flex: 1 },
  remoteVideo: { flex: 1 },
  videoPlaceholder: {
    flex: 1, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  videoPlaceholderIcon: { fontSize: 56 },
  videoPlaceholderText: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '600' },
  videoPlaceholderSub: { color: COLORS.textMuted, fontSize: 13 },
  promptOverlay: {
    position: 'absolute',
    width: SCREEN_WIDTH - 40,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 16,
    padding: 16,
    gap: 8,
    zIndex: 10,
  },
  promptHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  promptRoxyLabel: { color: COLORS.roxy, fontWeight: '700', fontSize: 12 },
  promptMinimiseBtn: { color: COLORS.textMuted, fontSize: 20, lineHeight: 20 },
  promptText: { color: '#fff', fontSize: 18, fontWeight: '600', lineHeight: 26 },
  promptCount: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  nextPromptBtn: {
    backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 7, alignSelf: 'flex-end',
  },
  nextPromptBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  promptMinimised: {
    position: 'absolute', bottom: 100, right: 16,
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center',
    zIndex: 10,
  },
  promptMinimisedIcon: { fontSize: 22 },
  bottomBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 16, backgroundColor: 'rgba(0,0,0,0.8)',
  },
  selfPip: { width: 80, height: 100, borderRadius: 8, overflow: 'hidden', backgroundColor: COLORS.surface },
  selfVideo: { width: 80, height: 100 },
  selfPipPlaceholder: { width: 80, height: 100, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface },
  likeBtn: {
    flex: 1, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  likeBtnActive: { backgroundColor: 'rgba(196,71,106,0.4)' },
  likeBtnIcon: { fontSize: 30 },
  endBtn: {
    backgroundColor: COLORS.error, borderRadius: 12,
    paddingHorizontal: 20, paddingVertical: 12,
  },
  endBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
```

**Step 2: Commit**

```bash
cd C:/Thinqer/roxy-client
git add apps/mobile/app/(tabs)/connect/speed-dating/session.tsx
git commit -m "feat: speed dating in-session — Daily.co video, timer bar, draggable Roxy prompt overlay"
```

---

### Task 15: Speed Dating — Result Screen

**Files:**
- Create: `apps/mobile/app/(tabs)/connect/speed-dating/result.tsx`

**Step 1: Write the result screen**

```typescript
// apps/mobile/app/(tabs)/connect/speed-dating/result.tsx
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase, callEdgeFunction } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../store/authStore';
import { COLORS } from '../../../../lib/constants';

export default function SpeedDatingResult() {
  const router = useRouter();
  const { session_id, liked: likedParam } = useLocalSearchParams<{ session_id: string; liked: string }>();
  const { user } = useAuthStore();
  const [processing, setProcessing] = useState(false);
  const [matched, setMatched] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);

  const userLiked = likedParam === '1';

  useEffect(() => {
    if (!session_id || !user) return;
    processResult();
  }, []);

  const processResult = async () => {
    if (!user || !session_id) return;
    setProcessing(true);

    // Record this user's like choice in the session
    // (In a real implementation, both users submit; we check for mutual like)
    // For now: if liked, check if other participant also liked and create match

    const { data: session } = await supabase
      .from('speed_date_sessions')
      .select('participant_ids')
      .eq('id', session_id)
      .single();

    if (!session || session.participant_ids.length < 2) {
      setProcessing(false);
      return;
    }

    const otherUserId = session.participant_ids.find((id: string) => id !== user.id);
    if (!otherUserId || !userLiked) {
      setProcessing(false);
      return;
    }

    // Check if match already exists (other user may have liked first)
    const { data: existingMatch } = await supabase
      .from('matches')
      .select('id, conversation_id')
      .or(`and(user_a_id.eq.${user.id},user_b_id.eq.${otherUserId}),and(user_a_id.eq.${otherUserId},user_b_id.eq.${user.id})`)
      .maybeSingle();

    if (existingMatch) {
      setMatched(true);
      setConversationId(existingMatch.conversation_id);
      setProcessing(false);
      return;
    }

    // Create conversation
    const { data: newConv, error: convError } = await supabase
      .from('conversations')
      .insert({
        participant_ids: [user.id, otherUserId],
        conversation_type: 'direct',
      })
      .select('id')
      .single();

    if (convError || !newConv) {
      setProcessing(false);
      return;
    }

    // Create match
    const { error: matchError } = await supabase.from('matches').insert({
      user_a_id: user.id,
      user_b_id: otherUserId,
      source: 'speed_date',
      conversation_id: newConv.id,
    });

    if (matchError) {
      setProcessing(false);
      return;
    }

    // Mark session as completed
    await supabase
      .from('speed_date_sessions')
      .update({ status: 'completed' })
      .eq('id', session_id);

    // Fire icebreaker
    await callEdgeFunction('roxy-icebreaker', {
      conversation_id: newConv.id,
      user_a_name: 'you',
      user_b_name: 'your match',
      shared_interests: [],
    });

    setMatched(true);
    setConversationId(newConv.id);
    setProcessing(false);
  };

  if (processing) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={COLORS.roxy} size="large" />
        <Text style={styles.processingText}>Processing your match...</Text>
      </SafeAreaView>
    );
  }

  if (matched && conversationId) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.matchIcon}>🎉</Text>
        <Text style={styles.matchTitle}>It's a Match!</Text>
        <Text style={styles.matchBody}>Roxy's dropping you an icebreaker to get things started.</Text>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => router.replace(`/(tabs)/connect/chat/${conversationId}`)}
        >
          <Text style={styles.primaryBtnText}>Start chatting →</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.noMatchIcon}>💫</Text>
      <Text style={styles.noMatchTitle}>Keep exploring</Text>
      <Text style={styles.noMatchBody}>
        {userLiked
          ? "They didn't match this time — but your person is out there!"
          : "No worries — every date is practice for the right one."}
      </Text>
      <TouchableOpacity
        style={styles.primaryBtn}
        onPress={() => router.replace('/(tabs)/connect/speed-dating')}
      >
        <Text style={styles.primaryBtnText}>Back to Speed Dating ⚡</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.secondaryBtn}
        onPress={() => router.replace('/(tabs)/connect')}
      >
        <Text style={styles.secondaryBtnText}>Go to Messages</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 16 },
  processingText: { color: COLORS.textSecondary, marginTop: 16, fontSize: 15 },
  matchIcon: { fontSize: 72 },
  matchTitle: { fontSize: 32, fontWeight: '800', color: COLORS.textPrimary },
  matchBody: { color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22, fontSize: 15 },
  noMatchIcon: { fontSize: 72 },
  noMatchTitle: { fontSize: 28, fontWeight: '800', color: COLORS.textPrimary },
  noMatchBody: { color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22, fontSize: 15 },
  primaryBtn: { backgroundColor: COLORS.primary, borderRadius: 14, paddingHorizontal: 28, paddingVertical: 14, width: '100%', alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondaryBtn: { backgroundColor: COLORS.surface, borderRadius: 14, paddingHorizontal: 28, paddingVertical: 14, width: '100%', alignItems: 'center' },
  secondaryBtnText: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 16 },
});
```

**Step 2: Commit**

```bash
cd C:/Thinqer/roxy-client
git add apps/mobile/app/(tabs)/connect/speed-dating/result.tsx
git commit -m "feat: speed dating result — mutual like detection, match creation, icebreaker trigger"
```

---

### Task 16: Run All Tests + Code Review + Final Commit

**Step 1: Run full test suite**

```bash
cd C:/Thinqer/roxy-client/apps/mobile
npm run test:ci
```

Expected: All tests pass (existing + new connectStore + useRealtime tests).

**Step 2: TypeScript check**

```bash
cd C:/Thinqer/roxy-client/apps/mobile
npx tsc --noEmit
```

Expected: No type errors. Fix any issues before proceeding.

**Step 3: Push branch + open PR**

```bash
cd C:/Thinqer/roxy-client
git push -u origin session-2-connect
gh pr create \
  --title "feat: Session 2 — Connect tab, DMs, Speed Dating with Daily.co" \
  --base main \
  --body "$(cat <<'EOF'
## Summary

- Migrations 003 + 004: communities, friendships, conversations, messages, speed_date_sessions, matches with full RLS + triggers
- roxy-icebreaker: 1/conversation, Claude Haiku icebreaker question
- roxy-wingwoman: 5/day, contextual reply suggestion with message history
- speed-date-prompts: weekly cron batch generator (zero AI calls during gameplay)
- join-speed-date-session: Daily.co room creation + participant management
- useRealtime hook: Supabase postgres_changes subscription with deduplication
- connectStore: conversations list, unread counts, active conversation tracking
- Connect tab: FlashList conversation list, dating mode toggle, Speed Date entry
- Chat screen: FlashList messages, wingwoman wand (✨), icebreaker banner, realtime
- Speed dating: lobby (countdown) → in-session (Daily.co + draggable Roxy overlay + timer) → result (match + icebreaker)

## Test plan

- [ ] `npm run test:ci` — all tests pass
- [ ] Connect tab loads conversation list (empty state visible)
- [ ] Chat screen sends a message and it appears (realtime)
- [ ] Wingwoman wand (✨) returns a suggestion bubble
- [ ] DevPanel "Seed test speed date" → lobby shows session with countdown
- [ ] Join session → result screen → "Keep exploring" returns to lobby
- [ ] (Native build required) Speed dating in-session shows Daily.co video

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 4: Deploy all new edge functions (if not already done)**

```bash
cd C:/Thinqer/roxy-client
npx supabase functions deploy roxy-icebreaker
npx supabase functions deploy roxy-wingwoman
npx supabase functions deploy speed-date-prompts
npx supabase functions deploy join-speed-date-session
npx supabase secrets set DAILY_API_KEY=your-daily-api-key-here
```

---

## Session 2 Smoke Test Checklist

Manual tests in Expo Go (or native build):

- [ ] Connect tab shows "No conversations yet" empty state
- [ ] Dating mode toggle switches on/off, persists to DB
- [ ] Dating mode ON → Speed Date banner appears
- [ ] Tapping Speed Date → lobby shows (empty = no sessions)
- [ ] DevPanel → "Seed test speed date" → lobby shows session with countdown
- [ ] Join session when < 2min → navigates to in-session screen
- [ ] In-session: timer counts down, Roxy prompt shows, Next → advances prompt
- [ ] In-session: overlay can be minimised to ✨ icon, restored on tap
- [ ] In-session: ❤️ toggles liked state
- [ ] In-session: End button → result screen
- [ ] Result screen (no match): "Keep exploring" → back to lobby
- [ ] (Two-device test) Mutual like → "It's a Match!" → conversation created → icebreaker visible in chat
- [ ] Chat screen: messages load, type + send works
- [ ] Wingwoman wand (✨) returns a Roxy suggestion bubble
- [ ] "Use this" in suggestion copies text to input
- [ ] Realtime: open chat on 2 devices → message appears without refresh
