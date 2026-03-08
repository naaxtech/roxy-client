# Session 4 — AI Safety + Gamification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Add Roxy Sister companion, Roxy Nudge, badge gamification, and block/report safety systems across migrations, edge functions, stores, and screens.

**Architecture:** TDD for stores. Subagent per task. Each task commits immediately. Migration 007 (badges/gamification), Migration 008 (reports/safety). Blocks reuse existing `friendships.status='blocked'` — no new table needed. Sister screen is a dedicated route; nudge button added to chat; badge grid added to Grow Zone 4.

**Tech Stack:** Expo Router v3, Zustand, Supabase Postgres + Edge Functions (Deno), `claude-haiku-4-5-20251001`, `@shopify/flash-list`, `date-fns`, Jest + RNTL

**Branch:** `session-4-ai-safety` (already created)
**Working dir:** `C:\Thinqer\roxy-client`
**Test command:** `cd apps/mobile && npx jest --ci --passWithNoTests` — expect 46 passing before any new work; 51 after Task 5.

---

## Key Context (read before every task)

- **COLORS**: `apps/mobile/lib/constants.ts` — primary `#C4476A`, secondary `#8B5CF6` (lavender), surface `#2d1b4e`
- **Types**: `apps/mobile/types/index.ts` — Badge, UserBadgeProgress, Report already defined
- **callEdgeFunction**: `apps/mobile/lib/supabase.ts`
- **Store pattern**: `create<State>((set) => ({ ... }))` — see `store/feedStore.ts`
- **FlashList**: always `@shopify/flash-list`, never `FlatList`
- **Anti-pattern**: `jest.mock()` must be FIRST, inline factory, no external variable refs
- **Anti-pattern**: Bash subagents cannot write files — use Write/Edit tools
- **Edge fn boilerplate**: always import from `../_shared/{auth,rateLimit,claude,cors,errorHandler}`
- **DEV_MOCK guard**: `const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;`
- **Next migration numbers**: 007, 008

---

## Tasks

| # | Task | Files | Tests | Status |
|---|---|---|---|---|
| 1 | Migration 007 — badges + user_badge_progress | `supabase/migrations/007_gamification.sql` | — | ⏳ |
| 2 | Migration 008 — reports | `supabase/migrations/008_safety.sql` | — | ⏳ |
| 3 | `roxy-nudge` edge function | `supabase/functions/roxy-nudge/index.ts` | — | ⏳ |
| 4 | `roxy-sister` edge function | `supabase/functions/roxy-sister/index.ts` | — | ⏳ |
| 5 | `safetyStore` + tests (TDD) | `store/safetyStore.ts` + `__tests__/store/safetyStore.test.ts` | +5 | ⏳ |
| 6 | Sister Button screen | `app/(tabs)/connect/sister-button/index.tsx` | — | ⏳ |
| 7 | Chat safety menu (block + report) | `app/(tabs)/connect/chat/[id].tsx` | — | ⏳ |
| 8 | Grow tab: badge grid (Zone 4 extension) | `app/(tabs)/grow/index.tsx` | — | ⏳ |
| 9 | Chat nudge button | `app/(tabs)/connect/chat/[id].tsx` | — | ⏳ |
| 10 | Final verification + PR #4 | — | 51 total | ⏳ |

---

## Task 1: Migration 007 — Gamification

**File:** `supabase/migrations/007_gamification.sql`

```sql
-- ============================================================
-- 007_gamification.sql
-- badges, user_badge_progress
-- ============================================================

CREATE TABLE IF NOT EXISTS badges (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name                  text NOT NULL,
  description           text NOT NULL,
  emoji                 text NOT NULL,
  category              text NOT NULL CHECK (category IN ('community','connection','milestone','ally')),
  points_value          int NOT NULL DEFAULT 10,
  requirement_type      text NOT NULL,   -- 'connections','messages','speed_dates','community_joins'
  requirement_threshold int NOT NULL DEFAULT 1,
  created_at            timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_badge_progress (
  user_id       uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  badge_id      uuid REFERENCES badges(id)   ON DELETE CASCADE NOT NULL,
  current_value int NOT NULL DEFAULT 0,
  earned_at     timestamptz,             -- NULL = not yet earned
  PRIMARY KEY (user_id, badge_id)
);

-- RLS
ALTER TABLE badges              ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badge_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "badges_read_all"   ON badges              FOR SELECT USING (true);
CREATE POLICY "ubp_owner_select"  ON user_badge_progress FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "ubp_owner_insert"  ON user_badge_progress FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "ubp_owner_update"  ON user_badge_progress FOR UPDATE USING (user_id = auth.uid());

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ubp_user ON user_badge_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_ubp_badge ON user_badge_progress(badge_id);

-- ============================================================
-- PL/pgSQL: award points + set earned_at when badge completed
-- ============================================================
CREATE OR REPLACE FUNCTION award_badge_points()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  badge_points int;
BEGIN
  -- Only fire when earned_at transitions NULL → value
  IF OLD.earned_at IS NOT NULL OR NEW.earned_at IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT points_value INTO badge_points FROM badges WHERE id = NEW.badge_id;
  UPDATE profiles SET gamification_points = gamification_points + badge_points
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_award_badge_points
  AFTER UPDATE ON user_badge_progress
  FOR EACH ROW EXECUTE FUNCTION award_badge_points();

-- ============================================================
-- Seed: 4 starter badges
-- ============================================================
INSERT INTO badges (name, description, emoji, category, points_value, requirement_type, requirement_threshold) VALUES
  ('First Connection',   'Made your first friend on Roxy',         '💜', 'connection', 25,  'connections',     1),
  ('Conversation Starter','Sent your first message',               '💬', 'connection', 10,  'messages',        1),
  ('Speed Dater',        'Completed your first speed date',        '⚡', 'milestone',  50,  'speed_dates',     1),
  ('Community Builder',  'Joined your first community',            '🏳️‍🌈', 'community', 15, 'community_joins', 1)
ON CONFLICT DO NOTHING;
```

**Commit:**
```bash
git add supabase/migrations/007_gamification.sql
git commit -m "feat: migration 007 — badges, user_badge_progress + RLS + seed"
```

---

## Task 2: Migration 008 — Safety

**File:** `supabase/migrations/008_safety.sql`

Note: Blocking reuses `friendships.status = 'blocked'` (already in schema 003). Only `reports` needs a new table.

```sql
-- ============================================================
-- 008_safety.sql
-- reports table
-- (blocks use existing friendships.status='blocked')
-- ============================================================

CREATE TABLE IF NOT EXISTS reports (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  reporter_id      uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  reported_user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  content_type     text NOT NULL CHECK (content_type IN ('message','post','profile')),
  content_id       uuid,                -- message/post id, null for profile reports
  reason           text NOT NULL CHECK (reason IN ('harassment','spam','inappropriate','hate_speech','other')),
  detail           text,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewed','dismissed')),
  reviewed_by      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       timestamptz DEFAULT now(),
  CONSTRAINT no_self_report CHECK (reporter_id != reported_user_id)
);

-- RLS
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reports_insert_own"  ON reports FOR INSERT WITH CHECK (reporter_id = auth.uid());
CREATE POLICY "reports_select_own"  ON reports FOR SELECT USING (reporter_id = auth.uid());
-- Admins can update (reviewed_by / status) — managed via service role key in edge functions

-- Index
CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports(reported_user_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id);
```

**Commit:**
```bash
git add supabase/migrations/008_safety.sql
git commit -m "feat: migration 008 — reports table + RLS (blocks via friendships)"
```

---

## Task 3: `roxy-nudge` Edge Function

**File:** `supabase/functions/roxy-nudge/index.ts`

Rate: **3 per user lifetime**. Fetches last message timestamp to contextualise. Generates a warm, short nudge.

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

  const { allowed } = await checkRateLimit({
    userId: auth.userId,
    fnName: 'roxy-nudge',
    maxCount: 3,
    windowType: 'lifetime',
  });
  if (!allowed) return errorResponse('Nudge limit reached — you have 3 nudges lifetime', 429);

  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

  const supabase = getSupabaseClient();

  // Fetch last 3 messages for context
  const { data: recentMessages } = await supabase
    .from('messages')
    .select('sender_id, content, created_at')
    .eq('conversation_id', conversation_id)
    .order('created_at', { ascending: false })
    .limit(3);

  const context = (recentMessages ?? [])
    .reverse()
    .map((m: { sender_id: string; content: string }) =>
      `${m.sender_id === auth.userId ? 'You' : 'Her'}: ${m.content ?? '[media]'}`
    )
    .join('\n');

  const nudge = await callClaude({
    system: `You are Roxy, a warm and encouraging WLW wingwoman. The user wants a gentle nudge to re-engage with someone they've been chatting with. Write one encouraging sentence (max 18 words) that feels personal and warm, ending with a 💜 emoji. Never be pushy.`,
    messages: [{ role: 'user', content: context ? `Recent messages:\n${context}\n\nGenerate nudge.` : 'Generate nudge.' }],
    maxTokens: 64,
    mockResponse: MOCK_NUDGE,
  });

  await logAiCall({ userId: auth.userId, fnName: 'roxy-nudge', wasMock: DEV_MOCK, conversationId: conversation_id });

  return successResponse({ nudge });
});
```

**Commit:**
```bash
git add supabase/functions/roxy-nudge/index.ts
git commit -m "feat: roxy-nudge edge function — 3-lifetime nudge, conversation context"
```

---

## Task 4: `roxy-sister` Edge Function

**File:** `supabase/functions/roxy-sister/index.ts`

Rate: **10 per conversation**. Turn number is server-authoritative (count from `ai_call_log`). Resources appear at turn 7+. Professional directory at turn 10. Emergency number always provided.

```ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { checkRateLimit, logAiCall } from '../_shared/rateLimit.ts';
import { callClaude } from '../_shared/claude.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

const CRISIS_KEYWORDS = ['suicide', 'kill myself', 'end it', 'hurt myself', 'self harm', 'want to die', 'can\'t go on'];

const RESOURCES = [
  { name: 'Crisis Text Line', contact: 'Text HOME to 741741', type: 'text' },
  { name: 'The Trevor Project', contact: '1-866-488-7386', type: 'call' },
  { name: 'Trans Lifeline', contact: '877-565-8860', type: 'call' },
  { name: 'LGBTQ+ National Hotline', contact: '1-888-843-4564', type: 'call' },
];

const PROFESSIONAL_DIRECTORY = [
  { name: 'Psychology Today (LGBTQ+ filter)', url: 'psychologytoday.com/us/therapists/lesbian-gay-bisexual-transgender' },
  { name: 'GLMA Provider Directory', url: 'glma.org/index.cfm?fuseaction=Page.viewPage&pageId=940' },
  { name: 'National Queer & Trans Therapists of Color', url: 'nqttcn.com/directory' },
];

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const body = await req.json();
  const { conversation_id, message } = body;
  if (!conversation_id || !message) return errorResponse('conversation_id and message required', 400);

  const { allowed } = await checkRateLimit({
    userId: auth.userId,
    fnName: 'roxy-sister',
    maxCount: 10,
    windowType: 'conversation',
    conversationId: conversation_id,
  });
  if (!allowed) return errorResponse('Session limit reached — please connect with a professional', 429);

  // Server-authoritative turn number
  const supabase = getSupabaseClient();
  const { count } = await supabase
    .from('ai_call_log')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', auth.userId)
    .eq('function_name', 'roxy-sister')
    .eq('conversation_id', conversation_id);
  const turnNumber = (count ?? 0) + 1;

  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

  const isCrisis = CRISIS_KEYWORDS.some((kw) => message.toLowerCase().includes(kw));
  const showResources = isCrisis || turnNumber >= 7;
  const showDirectory = turnNumber >= 10;

  const systemPrompt = turnNumber <= 6 && !isCrisis
    ? `You are Roxy Sister, a compassionate mental health companion for WLW and queer women. Listen deeply, validate feelings, ask one gentle follow-up question. Never give clinical advice. Be warm and affirming. Max 3 sentences.`
    : `You are Roxy Sister, a compassionate companion. The user may need professional support. Validate their feelings briefly (1 sentence), gently mention that a professional can offer deeper support (1 sentence), and affirm you're here. Max 2 sentences.`;

  const mockResponse = turnNumber <= 6
    ? "Thank you for sharing that with me — you're so brave for reaching out 💜 What feels most heavy for you right now?"
    : "You deserve real support, and talking to a professional can make such a difference 💜 I'm here with you.";

  const response = await callClaude({
    system: systemPrompt,
    messages: [{ role: 'user', content: message }],
    maxTokens: 128,
    mockResponse,
  });

  await logAiCall({ userId: auth.userId, fnName: 'roxy-sister', wasMock: DEV_MOCK, conversationId: conversation_id });

  return successResponse({
    response,
    turn_number: turnNumber,
    is_final_turn: turnNumber >= 10,
    resources: showResources ? RESOURCES : undefined,
    professional_directory: showDirectory ? PROFESSIONAL_DIRECTORY : undefined,
  });
});
```

**Commit:**
```bash
git add supabase/functions/roxy-sister/index.ts
git commit -m "feat: roxy-sister edge function — 10-turn crisis companion, progressive resources"
```

---

## Task 5: `safetyStore` + Tests (TDD)

**Write tests FIRST, run to confirm failure, then implement.**

### Step 1: Write failing tests

**File:** `apps/mobile/__tests__/store/safetyStore.test.ts`

```ts
import { useSafetyStore } from '../../store/safetyStore';

const initialState = {
  blockedUserIds: new Set<string>(),
  reportedUserIds: new Set<string>(),
};

beforeEach(() => {
  useSafetyStore.setState({ ...initialState, blockedUserIds: new Set(), reportedUserIds: new Set() });
});

describe('safetyStore', () => {
  it('has correct initial state', () => {
    const state = useSafetyStore.getState();
    expect(state.blockedUserIds.size).toBe(0);
    expect(state.reportedUserIds.size).toBe(0);
  });

  it('addBlock adds userId to blockedUserIds', () => {
    useSafetyStore.getState().addBlock('user-1');
    const { blockedUserIds } = useSafetyStore.getState();
    expect(blockedUserIds.has('user-1')).toBe(true);
  });

  it('addBlock does not add duplicates', () => {
    useSafetyStore.getState().addBlock('user-1');
    useSafetyStore.getState().addBlock('user-1');
    expect(useSafetyStore.getState().blockedUserIds.size).toBe(1);
  });

  it('addReport adds userId to reportedUserIds', () => {
    useSafetyStore.getState().addReport('user-2');
    expect(useSafetyStore.getState().reportedUserIds.has('user-2')).toBe(true);
  });

  it('isBlocked returns true for blocked users', () => {
    useSafetyStore.getState().addBlock('user-3');
    expect(useSafetyStore.getState().isBlocked('user-3')).toBe(true);
    expect(useSafetyStore.getState().isBlocked('user-4')).toBe(false);
  });
});
```

### Step 2: Run to confirm 5 failures
```bash
cd apps/mobile && npx jest --ci safetyStore.test --passWithNoTests 2>&1 | tail -10
```
Expected: `safetyStore.ts` not found / 5 failing.

### Step 3: Implement store

**File:** `apps/mobile/store/safetyStore.ts`

```ts
import { create } from 'zustand';

interface SafetyState {
  blockedUserIds: Set<string>;
  reportedUserIds: Set<string>;
  addBlock: (userId: string) => void;
  addReport: (userId: string) => void;
  isBlocked: (userId: string) => boolean;
}

export const useSafetyStore = create<SafetyState>((set, get) => ({
  blockedUserIds: new Set(),
  reportedUserIds: new Set(),

  addBlock: (userId) =>
    set((s) => ({ blockedUserIds: new Set([...s.blockedUserIds, userId]) })),

  addReport: (userId) =>
    set((s) => ({ reportedUserIds: new Set([...s.reportedUserIds, userId]) })),

  isBlocked: (userId) => get().blockedUserIds.has(userId),
}));
```

### Step 4: Confirm 51 passing
```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -5
```
Expected: `Tests: 51 passed`

**Commit:**
```bash
git add apps/mobile/__tests__/store/safetyStore.test.ts apps/mobile/store/safetyStore.ts
git commit -m "feat: safetyStore + 5 tests — block/report user state"
```

---

## Task 6: Sister Button Screen

**File:** `apps/mobile/app/(tabs)/connect/sister-button/index.tsx`

Lavender UI. Turn counter. Progressive resources. Emergency button always present. Creates/reuses a `conversation_type: 'sister'` conversation.

```tsx
import { useState, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, Linking, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase, callEdgeFunction } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../store/authStore';
import { COLORS } from '../../../../lib/constants';

const LAVENDER = '#8B5CF6';
const LAVENDER_LIGHT = '#A78BFA';
const LAVENDER_BG = '#1e1040';

type SisterMessage = {
  id: string;
  role: 'user' | 'sister' | 'resource';
  content: string;
  turn?: number;
};

type Resource = { name: string; contact: string; type: string };

export default function SisterButton() {
  const { user } = useAuthStore();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SisterMessage[]>([
    {
      id: 'intro',
      role: 'sister',
      content: "Hi, I'm Roxy Sister 💜 I'm here to listen — no judgment, just support. What's on your mind?",
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [turnNumber, setTurnNumber] = useState(0);
  const [resources, setResources] = useState<Resource[]>([]);
  const [sessionEnded, setSessionEnded] = useState(false);

  const getOrCreateConversation = useCallback(async (): Promise<string> => {
    if (conversationId) return conversationId;
    if (!user) throw new Error('Not authenticated');

    // Find existing sister conversation
    const { data: existing } = await supabase
      .from('conversations')
      .select('id')
      .contains('participant_ids', [user.id])
      .eq('conversation_type', 'sister')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      setConversationId(existing.id);
      return existing.id;
    }

    // Create new
    const { data: created, error } = await supabase
      .from('conversations')
      .insert({ participant_ids: [user.id], conversation_type: 'sister' })
      .select('id')
      .single();

    if (error || !created) throw new Error('Could not create session');
    setConversationId(created.id);
    return created.id;
  }, [conversationId, user]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || sessionEnded) return;

    setInput('');
    setLoading(true);
    const userMsg: SisterMessage = { id: Date.now().toString(), role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const convId = await getOrCreateConversation();
      const { data, error } = await callEdgeFunction<{
        response: string;
        turn_number: number;
        is_final_turn: boolean;
        resources?: Resource[];
      }>('roxy-sister', { conversation_id: convId, message: text });

      if (error || !data) {
        setMessages((prev) => [...prev, { id: `err-${Date.now()}`, role: 'sister', content: "I'm having a little trouble right now. Please try again, or call a helpline directly 💜" }]);
        return;
      }

      const sisterMsg: SisterMessage = { id: `s-${Date.now()}`, role: 'sister', content: data.response, turn: data.turn_number };
      setTurnNumber(data.turn_number);
      setMessages((prev) => [...prev, sisterMsg]);

      if (data.resources && data.resources.length > 0) {
        setResources(data.resources);
        setMessages((prev) => [
          ...prev,
          {
            id: `res-${Date.now()}`,
            role: 'resource',
            content: data.professional_directory
              ? '💜 You deserve ongoing support. Here are some professional resources:'
              : '💜 These helplines are here for you:',
          },
        ]);
      }

      if (data.is_final_turn) setSessionEnded(true);
    } catch {
      setMessages((prev) => [...prev, { id: `err-${Date.now()}`, role: 'sister', content: "Something went wrong 💜 You can always call a helpline directly." }]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [input, loading, sessionEnded, getOrCreateConversation]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>💜 Roxy Sister</Text>
          {turnNumber > 0 && (
            <Text style={styles.turnCount}>Turn {turnNumber} of 10</Text>
          )}
        </View>
        <View style={{ width: 60 }} />
      </View>

      {/* Emergency button */}
      <TouchableOpacity style={styles.emergencyBtn} onPress={() => Linking.openURL('tel:988')}>
        <Text style={styles.emergencyText}>🆘 Crisis Line: 988</Text>
      </TouchableOpacity>

      {/* Messages */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scrollRef} style={styles.messageList} contentContainerStyle={{ padding: 16, gap: 12 }}>
          {messages.map((msg) => (
            <View key={msg.id} style={[styles.bubble, msg.role === 'user' ? styles.bubbleUser : msg.role === 'resource' ? styles.bubbleResource : styles.bubbleSister]}>
              <Text style={[styles.bubbleText, msg.role === 'user' ? styles.bubbleTextUser : styles.bubbleTextSister]}>
                {msg.content}
              </Text>
            </View>
          ))}

          {/* Resource cards */}
          {resources.length > 0 && messages.some((m) => m.role === 'resource') && (
            <View style={styles.resourceCards}>
              {resources.map((r) => (
                <TouchableOpacity
                  key={r.name}
                  style={styles.resourceCard}
                  onPress={() => {
                    if (r.type === 'call') Linking.openURL(`tel:${r.contact.replace(/[^0-9]/g, '')}`);
                  }}
                >
                  <Text style={styles.resourceName}>{r.name}</Text>
                  <Text style={styles.resourceContact}>{r.contact}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {loading && (
            <View style={styles.bubbleSister}>
              <Text style={styles.bubbleTextSister}>💜 ...</Text>
            </View>
          )}

          {sessionEnded && (
            <View style={styles.sessionEndCard}>
              <Text style={styles.sessionEndText}>
                This session has ended 💜 Please consider reaching out to a professional for ongoing support.
              </Text>
              <TouchableOpacity style={styles.sessionEndBtn} onPress={() => router.back()}>
                <Text style={styles.sessionEndBtnText}>Return to Connect</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>

        {/* Input bar */}
        {!sessionEnded && (
          <View style={styles.inputBar}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Share what's on your mind…"
              placeholderTextColor={COLORS.textMuted}
              multiline
              maxLength={500}
              editable={!loading}
            />
            <TouchableOpacity style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnDisabled]} onPress={handleSend} disabled={!input.trim() || loading}>
              <Text style={styles.sendBtnText}>Send</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: LAVENDER_BG },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: LAVENDER + '30' },
  backBtn: { width: 60 },
  backText: { color: LAVENDER_LIGHT, fontSize: 18 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: '#fff', fontWeight: '700', fontSize: 16 },
  turnCount: { color: LAVENDER_LIGHT, fontSize: 12, marginTop: 2 },
  emergencyBtn: { backgroundColor: '#EF4444' + '20', borderWidth: 1, borderColor: '#EF4444' + '50', marginHorizontal: 16, marginTop: 8, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  emergencyText: { color: '#EF4444', fontWeight: '700', fontSize: 13 },
  messageList: { flex: 1 },
  bubble: { maxWidth: '85%', borderRadius: 16, padding: 12 },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: LAVENDER, borderBottomRightRadius: 4 },
  bubbleSister: { alignSelf: 'flex-start', backgroundColor: COLORS.surface, borderBottomLeftRadius: 4 },
  bubbleResource: { alignSelf: 'flex-start', backgroundColor: LAVENDER + '20', borderWidth: 1, borderColor: LAVENDER + '40', borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  bubbleTextUser: { color: '#fff' },
  bubbleTextSister: { color: COLORS.textPrimary },
  resourceCards: { gap: 8, width: '100%' },
  resourceCard: { backgroundColor: LAVENDER + '15', borderWidth: 1, borderColor: LAVENDER + '40', borderRadius: 10, padding: 12 },
  resourceName: { color: LAVENDER_LIGHT, fontWeight: '700', fontSize: 13 },
  resourceContact: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  sessionEndCard: { backgroundColor: LAVENDER + '20', borderRadius: 12, padding: 16, alignItems: 'center', gap: 12 },
  sessionEndText: { color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20 },
  sessionEndBtn: { backgroundColor: LAVENDER, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 8 },
  sessionEndBtnText: { color: '#fff', fontWeight: '700' },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: LAVENDER + '30', gap: 8, backgroundColor: LAVENDER_BG },
  input: { flex: 1, backgroundColor: COLORS.surface, color: COLORS.textPrimary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, maxHeight: 100 },
  sendBtn: { backgroundColor: LAVENDER, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
```

Also add a "Roxy Sister" entry point to the Connect tab list screen (a banner card at top):

**Modify:** `apps/mobile/app/(tabs)/connect/index.tsx` — add `SisterBanner` component above the conversation list:

```tsx
// Add at the top of the connect screen, above the FlashList
// Import at top: import { useRouter } from 'expo-router'; (already present)
// Add this component:
function SisterBanner() {
  const router = useRouter();
  return (
    <TouchableOpacity style={sisterStyles.banner} onPress={() => router.push('/(tabs)/connect/sister-button')}>
      <Text style={sisterStyles.bannerEmoji}>💜</Text>
      <View style={{ flex: 1 }}>
        <Text style={sisterStyles.bannerTitle}>Roxy Sister</Text>
        <Text style={sisterStyles.bannerSub}>Confidential support, any time</Text>
      </View>
      <Text style={sisterStyles.bannerArrow}>›</Text>
    </TouchableOpacity>
  );
}

const sisterStyles = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#8B5CF6' + '20', borderWidth: 1,
    borderColor: '#8B5CF6' + '40', borderRadius: 12,
    marginHorizontal: 16, marginBottom: 12, padding: 14,
  },
  bannerEmoji: { fontSize: 24 },
  bannerTitle: { color: '#A78BFA', fontWeight: '700', fontSize: 15 },
  bannerSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 1 },
  bannerArrow: { color: '#8B5CF6', fontSize: 20 },
});
```

Then render `<SisterBanner />` as the `ListHeaderComponent` of the FlashList in connect/index.tsx.

**Commit:**
```bash
git add apps/mobile/app/(tabs)/connect/sister-button/index.tsx apps/mobile/app/(tabs)/connect/index.tsx
git commit -m "feat: Roxy Sister screen + connect banner — 10-turn crisis companion"
```

---

## Task 7: Chat Safety Menu (Block + Report)

**Modify:** `apps/mobile/app/(tabs)/connect/chat/[id].tsx`

Add three-dot menu (⋮) to chat header. Tapping it opens a modal with Block + Report options.

**Key additions to [id].tsx:**

```tsx
// 1. Add imports:
import { Modal, Pressable } from 'react-native';
import { useSafetyStore } from '../../../../store/safetyStore';

// 2. Add state:
const [menuOpen, setMenuOpen] = useState(false);
const [reportModalOpen, setReportModalOpen] = useState(false);
const [reportReason, setReportReason] = useState<string | null>(null);

// safetyStore
const { addBlock, addReport } = useSafetyStore();

// Other user id (first participant that isn't me)
const otherUserId = conversation?.participant_ids?.find((id) => id !== user?.id) ?? null;

// 3. handleBlock:
const handleBlock = useCallback(async () => {
  if (!otherUserId || !user) return;
  setMenuOpen(false);
  // Upsert friendship as blocked
  await supabase.from('friendships').upsert({
    requester_id: user.id,
    addressee_id: otherUserId,
    status: 'blocked',
  }, { onConflict: 'requester_id,addressee_id' });
  addBlock(otherUserId);
  router.back();
}, [otherUserId, user, addBlock, router]);

// 4. handleReport:
const handleReport = useCallback(async () => {
  if (!otherUserId || !user || !reportReason) return;
  await supabase.from('reports').insert({
    reporter_id: user.id,
    reported_user_id: otherUserId,
    content_type: 'profile',
    reason: reportReason,
  });
  addReport(otherUserId);
  setReportModalOpen(false);
  Alert.alert('Reported', 'Thank you — our team will review this report.');
}, [otherUserId, user, reportReason, addReport]);

// 5. In JSX, add ⋮ button to header:
// Header right side → replace status dot with:
<TouchableOpacity onPress={() => setMenuOpen(true)} style={{ padding: 8 }}>
  <Text style={{ color: COLORS.textSecondary, fontSize: 20 }}>⋮</Text>
</TouchableOpacity>

// 6. Menu Modal:
<Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
  <Pressable style={menuStyles.overlay} onPress={() => setMenuOpen(false)}>
    <View style={menuStyles.menu}>
      <TouchableOpacity style={menuStyles.menuItem} onPress={handleBlock}>
        <Text style={menuStyles.menuItemDanger}>🚫 Block this person</Text>
      </TouchableOpacity>
      <View style={menuStyles.separator} />
      <TouchableOpacity style={menuStyles.menuItem} onPress={() => { setMenuOpen(false); setReportModalOpen(true); }}>
        <Text style={menuStyles.menuItemText}>⚠️ Report this person</Text>
      </TouchableOpacity>
    </View>
  </Pressable>
</Modal>

// 7. Report Modal:
<Modal visible={reportModalOpen} transparent animationType="slide" onRequestClose={() => setReportModalOpen(false)}>
  <View style={reportStyles.sheet}>
    <Text style={reportStyles.title}>Report reason</Text>
    {['harassment', 'spam', 'inappropriate', 'hate_speech', 'other'].map((reason) => (
      <TouchableOpacity key={reason} style={[reportStyles.option, reportReason === reason && reportStyles.optionSelected]}
        onPress={() => setReportReason(reason)}>
        <Text style={reportStyles.optionText}>{reason.replace('_', ' ')}</Text>
      </TouchableOpacity>
    ))}
    <TouchableOpacity style={[reportStyles.submitBtn, !reportReason && reportStyles.submitBtnDisabled]}
      onPress={handleReport} disabled={!reportReason}>
      <Text style={reportStyles.submitText}>Submit Report</Text>
    </TouchableOpacity>
    <TouchableOpacity onPress={() => setReportModalOpen(false)}>
      <Text style={reportStyles.cancelText}>Cancel</Text>
    </TouchableOpacity>
  </View>
</Modal>
```

**StyleSheet additions:**
```ts
const menuStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-start', alignItems: 'flex-end', paddingTop: 80, paddingRight: 16 },
  menu: { backgroundColor: COLORS.surface, borderRadius: 12, minWidth: 200, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.surfaceLight },
  menuItem: { padding: 16 },
  menuItemText: { color: COLORS.textPrimary, fontSize: 15 },
  menuItemDanger: { color: COLORS.error, fontSize: 15 },
  separator: { height: 1, backgroundColor: COLORS.surfaceLight },
});

const reportStyles = StyleSheet.create({
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: COLORS.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 12 },
  title: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: 4 },
  option: { padding: 14, borderRadius: 10, backgroundColor: COLORS.surfaceLight },
  optionSelected: { borderWidth: 2, borderColor: COLORS.primary },
  optionText: { color: COLORS.textPrimary, fontSize: 15, textTransform: 'capitalize' },
  submitBtn: { backgroundColor: COLORS.primary, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 4 },
  submitBtnDisabled: { opacity: 0.4 },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  cancelText: { color: COLORS.textMuted, textAlign: 'center', fontSize: 14, paddingVertical: 8 },
});
```

**Commit:**
```bash
git add apps/mobile/app/(tabs)/connect/chat/[id].tsx
git commit -m "feat: chat safety — block/report menu (three-dot header + reason picker)"
```

---

## Task 8: Grow Tab — Badge Grid (Zone 4 Extension)

**Modify:** `apps/mobile/app/(tabs)/grow/index.tsx`

Add badge fetching and a grid below the Journey progress bar. Badges load from `user_badge_progress` joined to `badges`.

**Additions to grow/index.tsx:**

```tsx
// New state + fetch (add alongside existing queries in useEffect):
const [badgeProgress, setBadgeProgress] = useState<Array<{
  badge_id: string;
  current_value: number;
  earned_at: string | null;
  badges: { name: string; emoji: string; requirement_threshold: number; description: string };
}>>([]);

// In the fetch useEffect (alongside communities + friendships):
const { data: bp } = await supabase
  .from('user_badge_progress')
  .select('badge_id, current_value, earned_at, badges(name, emoji, requirement_threshold, description)')
  .eq('user_id', userId);
if (bp) setBadgeProgress(bp as any);

// Badge grid component (add below Zone 4 Journey card):
{badgeProgress.length > 0 && (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>My Badges</Text>
    <View style={badgeStyles.grid}>
      {badgeProgress.map((bp) => {
        const earned = !!bp.earned_at;
        const progress = Math.min(bp.current_value / bp.badges.requirement_threshold, 1);
        return (
          <View key={bp.badge_id} style={[badgeStyles.card, !earned && badgeStyles.cardLocked]}>
            <Text style={badgeStyles.emoji}>{earned ? bp.badges.emoji : '🔒'}</Text>
            <Text style={badgeStyles.name}>{bp.badges.name}</Text>
            {!earned && (
              <View style={badgeStyles.progressTrack}>
                <View style={[badgeStyles.progressFill, { width: `${progress * 100}%` as any }]} />
              </View>
            )}
            {earned && <Text style={badgeStyles.earnedText}>Earned ✓</Text>}
          </View>
        );
      })}
    </View>
  </View>
)}
```

**Badge StyleSheet:**
```ts
const badgeStyles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { width: '47%', backgroundColor: COLORS.surface, borderRadius: 12, padding: 12, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: COLORS.primary + '40' },
  cardLocked: { opacity: 0.6, borderColor: COLORS.surfaceLight },
  emoji: { fontSize: 28 },
  name: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 13, textAlign: 'center' },
  earnedText: { color: COLORS.success, fontSize: 11, fontWeight: '600' },
  progressTrack: { width: '100%', height: 4, backgroundColor: COLORS.surfaceLight, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: COLORS.primary, borderRadius: 2 },
});
```

**Commit:**
```bash
git add apps/mobile/app/(tabs)/grow/index.tsx
git commit -m "feat: Grow tab — badge grid in Zone 4 with progress bars"
```

---

## Task 9: Chat — Nudge Button

**Modify:** `apps/mobile/app/(tabs)/connect/chat/[id].tsx`

Add a "💜 Nudge" button next to the wingwoman button in the input bar. Calls `roxy-nudge`. Shows result as a system message. Disabled after 3 uses (429 response).

**Additions:**
```tsx
// State:
const [nudgeDisabled, setNudgeDisabled] = useState(false);
const [nudgeLoading, setNudgeLoading] = useState(false);

// Handler:
const handleNudge = useCallback(async () => {
  if (!conversationId || nudgeLoading || nudgeDisabled) return;
  setNudgeLoading(true);
  const { data, error } = await callEdgeFunction<{ nudge: string }>('roxy-nudge', { conversation_id: conversationId });
  setNudgeLoading(false);
  if (error?.includes('429') || error?.includes('limit')) {
    setNudgeDisabled(true);
    Alert.alert('Nudge limit reached', "You've used all 3 lifetime nudges 💜");
    return;
  }
  if (data?.nudge) {
    // Insert as roxy_suggestion message
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: user?.id,
      content: `💜 Roxy says: ${data.nudge}`,
      message_type: 'roxy_suggestion',
    });
  }
}, [conversationId, nudgeLoading, nudgeDisabled, user]);

// JSX — add alongside wingwoman button in input bar:
<TouchableOpacity
  style={[styles.roxyBtn, (nudgeDisabled || nudgeLoading) && { opacity: 0.4 }]}
  onPress={handleNudge}
  disabled={nudgeDisabled || nudgeLoading}
>
  <Text style={styles.roxyBtnText}>{nudgeLoading ? '…' : '💜'}</Text>
</TouchableOpacity>
```

**Commit:**
```bash
git add apps/mobile/app/(tabs)/connect/chat/[id].tsx
git commit -m "feat: chat nudge button — roxy-nudge integration, 3-lifetime limit guard"
```

---

## Task 10: Final Verification + PR #4

### Step 1: Run tests
```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -5
```
Expected: `Tests: 51 passed, 10 suites`

### Step 2: Expo Web preview
```
preview_start "Expo Web"
```
Expected: Metro bundles in <2s, no errors.

Check:
- Connect tab loads with Sister banner
- Sister screen opens + first message visible
- Chat screen shows ⋮ button in header
- Grow tab shows Zone 4 (Journey + badge section)

### Step 3: Push + PR
```bash
git push -u origin session-4-ai-safety
gh pr create --base main --title "Session 4 — Roxy Sister, Nudge, Badges, Safety" --body "..."
```

PR body bullets:
- Migration 007: badges + user_badge_progress + grant trigger + 4 seed badges
- Migration 008: reports table + RLS
- `roxy-nudge` edge function: 3-lifetime nudge with conversation context
- `roxy-sister` edge function: 10-turn crisis companion, progressive resources, professional directory
- `safetyStore` + 5 tests: block/report state (51 total passing)
- Sister Button screen: lavender UI, turn counter, emergency button, resource cards
- Chat: three-dot safety menu (block → friendships upsert, report → reports insert)
- Grow Zone 4: badge grid with earned/in-progress states
- Chat: nudge button with lifetime limit guard

---

## Architecture Notes for Sub-agents

### Adding Sister Banner to connect/index.tsx
The `SisterBanner` component must be added as `ListHeaderComponent` to the existing FlashList — DO NOT add it as a sibling element outside the list (breaks scroll behavior). Look for `<FlashList` and add `ListHeaderComponent={<SisterBanner />}`.

### [id].tsx Chat Screen — where to add things
- **Header right**: currently has a status dot — ADD the ⋮ button ALONGSIDE it (or replace the dot), not in the input bar
- **Input bar**: currently has `✨ Wingwoman` button + text input + send — add `💜 Nudge` BETWEEN the wingwoman button and the text input
- **Modals**: add BELOW the return statement's outermost `<View>` (inside it, not outside)
- **`conversationId`**: in the chat screen, comes from `useLocalSearchParams<{ id: string }>()` — use `params.id` as the `conversation_id`

### grow/index.tsx — where to add badge grid
Zone 4 is the last `<View style={styles.section}>` block. Add the badge grid as a NEW section AFTER Zone 4, inside the `<ScrollView>`. Fetch badge progress inside the same `useEffect` that fetches communities and friendships.

### Blocks via friendships
Use `.upsert()` with `onConflict: 'requester_id,addressee_id'` to handle both new blocks and updating an existing pending/accepted friendship to blocked. This uses the existing friendships table — no migration needed.
