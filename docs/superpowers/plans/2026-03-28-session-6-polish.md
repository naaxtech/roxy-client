# Session 6 — Polish & Production Readiness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all identified bugs and missing features to make the Roxy app demo-ready and production-quality.

**Architecture:** Fix-first approach — no new features, no scope creep. Each task is an isolated bug fix or a discrete missing screen/function. Migrations are additive-only.

**Tech Stack:** Expo 51, Expo Router v3, React Native 0.74, TypeScript strict, Supabase (Postgres + Edge Functions Deno), Zustand, Claude Haiku via `callClaude` shared utility.

---

## Issues Found During Audit

| # | Severity | File | Issue |
|---|---|---|---|
| 1 | CRASH | `RoxyCompanionButton.tsx` | Navigates to `/(tabs)/grow/roxy-chat` — screen does not exist |
| 2 | BUG | `roxy-sister/index.ts` | Verifies conversation_id against DB — but screen uses virtual ID `sister-{user.id}`, always returns 403 |
| 3 | BUG | `session.tsx` (speed date) | `liked` state captured in stale timer closure — like button always reports `false` on session end |
| 4 | SILENT FAIL | `discover/index.tsx` | Calls `supabase.rpc('increment_reaction', ...)` — function doesn't exist in DB, reactions not persisted |
| 5 | TYPE ERROR | `types/index.ts` | `Badge.icon_url: string | null` — actual DB column is `emoji: string` |
| 6 | MISSING | — | No `roxy-chat` edge function |
| 7 | MISSING | — | No `/(tabs)/grow/roxy-chat.tsx` screen |

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| CREATE | `supabase/functions/roxy-chat/index.ts` | Wingwoman general chat edge function |
| CREATE | `apps/mobile/app/(tabs)/grow/roxy-chat.tsx` | Roxy chat screen (mirrors sister-button pattern) |
| CREATE | `supabase/migrations/010_increment_reaction.sql` | `increment_reaction(p_post_id, p_emoji)` SQL function |
| MODIFY | `supabase/functions/roxy-sister/index.ts` | Remove invalid DB conversation existence check |
| MODIFY | `apps/mobile/app/(tabs)/connect/speed-dating/session.tsx` | Fix stale closure: use ref for `liked` |
| MODIFY | `apps/mobile/types/index.ts` | Fix `Badge`: `icon_url` → `emoji` |

---

## Task 1: Create branch

- [ ] **Step 1: Create and checkout branch**

```bash
cd D:/Nicole/Dev/roxy/roxy-client
git checkout -b session-6-polish
```

---

## Task 2: Fix Badge type

**Files:**
- Modify: `apps/mobile/types/index.ts`

- [ ] **Step 1: Fix the Badge interface**

In `apps/mobile/types/index.ts`, change the `Badge` interface. Replace:

```ts
export interface Badge {
  id: string;
  name: string;
  description: string | null;
  icon_url: string | null;
  category: 'community' | 'connection' | 'milestone' | 'ally';
  points_value: number;
  requirement_type: string;
  requirement_threshold: number;
  created_at: string;
}
```

With:

```ts
export interface Badge {
  id: string;
  name: string;
  description: string | null;
  emoji: string;
  category: 'community' | 'connection' | 'milestone' | 'ally';
  points_value: number;
  requirement_type: string;
  requirement_threshold: number;
  created_at: string;
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors related to Badge.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/types/index.ts
git commit -m "fix: Badge type icon_url → emoji to match actual DB schema"
```

---

## Task 3: Add increment_reaction SQL function

**Files:**
- Create: `supabase/migrations/010_increment_reaction.sql`

- [ ] **Step 1: Create migration**

Create `supabase/migrations/010_increment_reaction.sql`:

```sql
-- Atomically increment a reaction emoji count on a post.
-- Called from client via supabase.rpc('increment_reaction', { p_post_id, p_emoji })
CREATE OR REPLACE FUNCTION public.increment_reaction(p_post_id uuid, p_emoji text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.posts
  SET reaction_counts = jsonb_set(
    COALESCE(reaction_counts, '{}'::jsonb),
    ARRAY[p_emoji],
    to_jsonb(COALESCE((reaction_counts->>p_emoji)::int, 0) + 1)
  )
  WHERE id = p_post_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_reaction(uuid, text) TO authenticated;
```

- [ ] **Step 2: Push migration to remote**

```bash
cd D:/Nicole/Dev/roxy/roxy-client
npx supabase db push
```

Expected: `Remote database is up to date.` or success message applying 010.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/010_increment_reaction.sql
git commit -m "feat: add increment_reaction SQL function for post reactions"
```

---

## Task 4: Fix roxy-sister — remove invalid DB conversation check

**Files:**
- Modify: `supabase/functions/roxy-sister/index.ts`

The sister screen uses `conversation_id = 'sister-' + user.id` (a virtual, non-UUID string). The current edge function verifies this against `conversations` table — always fails with 403 for real remote DB.

- [ ] **Step 1: Remove the DB conversation existence check**

In `supabase/functions/roxy-sister/index.ts`, remove this block entirely (lines 46-53):

```ts
  // Verify caller is a participant
  const { data: conv } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversation_id)
    .contains('participant_ids', [auth.userId])
    .maybeSingle();
  if (!conv) return errorResponse('Forbidden', 403);
```

Security is already enforced by `verifyJWT` — the function is authenticated. Rate limiting by `user_id + conversation_id` is sufficient.

- [ ] **Step 2: Deploy**

```bash
npx supabase functions deploy roxy-sister --project-ref ptymtdlysqbpxzlgsshp
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/roxy-sister/index.ts
git commit -m "fix: roxy-sister remove invalid DB conversation check — sister uses virtual conversation_id"
```

---

## Task 5: Fix stale liked closure in speed-dating session

**Files:**
- Modify: `apps/mobile/app/(tabs)/connect/speed-dating/session.tsx`

The timer's `setInterval` callback captures `handleEnd` at the time `session` loads. `handleEnd`'s `liked` value is stale — the like button's state is never seen by the timer's end-session call.

- [ ] **Step 1: Add a likedRef and wire it to the like toggle**

In `session.tsx`:

1. Add `const likedRef = useRef(false);` after the existing state declarations.

2. Change the Like button's `onPress` from:
```tsx
onPress={() => setLiked((v) => !v)}
```
To:
```tsx
onPress={() => {
  setLiked((v) => {
    likedRef.current = !v;
    return !v;
  });
}}
```

3. In `handleEnd`, change:
```ts
const partnerId = session?.participant_ids.find((id) => id !== user?.id) ?? null;
```
And the router.replace params, change `liked: liked ? '1' : '0'` to `liked: likedRef.current ? '1' : '0'`.

Full updated `handleEnd`:
```ts
const handleEnd = useCallback(() => {
  if (timerRef.current) clearInterval(timerRef.current);

  const partnerId = session?.participant_ids.find((id) => id !== user?.id) ?? null;

  if (callObject) {
    callObject.leave().catch(() => {});
  }

  router.replace({
    pathname: '/(tabs)/connect/speed-dating/result',
    params: {
      session_id: session_id ?? '',
      liked: likedRef.current ? '1' : '0',
      partner_id: partnerId ?? '',
    },
  });
}, [session, callObject, session_id, router, user]);
```

Note: `liked` is removed from the dependency array (we use `likedRef.current` instead).

- [ ] **Step 2: TypeScript check**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | grep session
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/(tabs)/connect/speed-dating/session.tsx
git commit -m "fix: speed date session liked state — use ref to avoid stale timer closure"
```

---

## Task 6: Create roxy-chat edge function

**Files:**
- Create: `supabase/functions/roxy-chat/index.ts`

General-purpose wingwoman chat. Virtual conversation_id (no DB backing needed). Rate limit: 20 messages/day.

- [ ] **Step 1: Create the edge function**

Create `supabase/functions/roxy-chat/index.ts`:

```ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT } from '../_shared/auth.ts';
import { checkRateLimit, logAiCall } from '../_shared/rateLimit.ts';
import { callClaude } from '../_shared/claude.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

const SYSTEM_PROMPT = `You are Roxy — a warm, witty WLW wingwoman. You help users with dating confidence, community connections, and personal growth. You feel like a best friend who genuinely gets it: affirming, practical, a little playful. Keep every response to 2–4 sentences. Never give clinical or medical advice. Never use the word "AI" — you're just Roxy.`;

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const body = await req.json();
  const { conversation_id, message } = body;
  if (!conversation_id || !message) return errorResponse('conversation_id and message required', 400);

  const DEV_MOCK = Deno.env.get('SUPABASE_URL')?.includes('localhost') ?? false;

  const { allowed } = await checkRateLimit({
    userId: auth.userId,
    fnName: 'roxy-chat',
    maxCount: 20,
    windowType: 'daily',
  });
  if (!allowed) return errorResponse("You've reached your daily chat limit with Roxy — come back tomorrow! 💜", 429);

  if (DEV_MOCK) {
    await logAiCall({ userId: auth.userId, fnName: 'roxy-chat', wasMock: true, conversationId: conversation_id });
    return successResponse({ response: "Hey! I'm Roxy 💜 Tell me what's going on — I'm all ears." });
  }

  const response = await callClaude({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: message }],
    maxTokens: 300,
    mockResponse: "Hey! I'm Roxy 💜 Tell me what's going on — I'm all ears.",
  });

  await logAiCall({ userId: auth.userId, fnName: 'roxy-chat', wasMock: false, conversationId: conversation_id });

  return successResponse({ response });
});
```

- [ ] **Step 2: Deploy**

```bash
npx supabase functions deploy roxy-chat --project-ref ptymtdlysqbpxzlgsshp
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/roxy-chat/index.ts
git commit -m "feat: roxy-chat edge function — general wingwoman chat, 20 msgs/day"
```

---

## Task 7: Create roxy-chat screen

**Files:**
- Create: `apps/mobile/app/(tabs)/grow/roxy-chat.tsx`

Mirrors the sister-button pattern exactly. Virtual conversation_id, local message state only.

- [ ] **Step 1: Create the screen**

Create `apps/mobile/app/(tabs)/grow/roxy-chat.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../../store/authStore';
import { callEdgeFunction } from '../../../lib/supabase';
import { COLORS } from '../../../lib/constants';

type Message = { role: 'user' | 'roxy'; content: string };

export default function RoxyChatScreen() {
  const router = useRouter();
  const { user } = useAuthStore();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const conversationId = `roxy-${user?.id ?? 'anon'}`;

  useEffect(() => {
    if (messages.length > 0) {
      scrollRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setLoading(true);

    try {
      const { data, error: fnError } = await callEdgeFunction<{ response: string }>('roxy-chat', {
        conversation_id: conversationId,
        message: text,
      });

      if (fnError) {
        Alert.alert('Roxy is unavailable', fnError);
        return;
      }

      if (data?.response) {
        setMessages((prev) => [...prev, { role: 'roxy', content: data.response }]);
      }
    } catch {
      Alert.alert('Something went wrong', 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backIcon}>‹</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Roxy ✨</Text>
            <Text style={styles.headerSub}>Your wingwoman</Text>
          </View>
          <View style={styles.backBtn} />
        </View>

        {/* Messages */}
        <ScrollView
          ref={scrollRef}
          style={styles.messageList}
          contentContainerStyle={styles.messageListContent}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>✨</Text>
              <Text style={styles.emptyTitle}>Hey! I'm Roxy</Text>
              <Text style={styles.emptyBody}>
                Your WLW wingwoman 💜{'\n'}Ask me anything — dating, community, confidence. I've got you.
              </Text>
            </View>
          )}

          {messages.map((msg, idx) => (
            <View
              key={idx}
              style={[
                styles.bubbleWrap,
                msg.role === 'user' ? styles.bubbleWrapUser : styles.bubbleWrapRoxy,
              ]}
            >
              <View style={[styles.bubble, msg.role === 'user' ? styles.bubbleUser : styles.bubbleRoxy]}>
                <Text style={[styles.bubbleText, msg.role === 'user' ? styles.bubbleTextUser : styles.bubbleTextRoxy]}>
                  {msg.content}
                </Text>
              </View>
            </View>
          ))}

          {loading && (
            <View style={styles.thinkingWrap}>
              <Text style={styles.thinkingText}>Roxy is thinking…</Text>
              <ActivityIndicator size="small" color={COLORS.roxy} style={{ marginLeft: 8 }} />
            </View>
          )}
        </ScrollView>

        {/* Input */}
        <View style={styles.inputArea}>
          <TextInput
            style={[styles.input, loading && styles.inputDisabled]}
            value={input}
            onChangeText={setInput}
            placeholder="Ask Roxy anything…"
            placeholderTextColor={COLORS.textMuted}
            multiline
            editable={!loading}
            returnKeyType="default"
          />
          <TouchableOpacity
            style={[styles.sendBtn, (loading || !input.trim()) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={loading || !input.trim()}
          >
            <Text style={styles.sendBtnText}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.surface,
  },
  backBtn: { width: 40, alignItems: 'center' },
  backIcon: { fontSize: 32, color: COLORS.textPrimary, lineHeight: 36 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textPrimary },
  headerSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 1 },
  messageList: { flex: 1 },
  messageListContent: { paddingHorizontal: 16, paddingVertical: 20, gap: 10, flexGrow: 1 },
  emptyState: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 60, gap: 12, paddingHorizontal: 16,
  },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '700' },
  emptyBody: { color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22, fontSize: 15 },
  bubbleWrap: { flexDirection: 'row', marginVertical: 4 },
  bubbleWrapUser: { justifyContent: 'flex-end' },
  bubbleWrapRoxy: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser: { backgroundColor: COLORS.primary, borderBottomRightRadius: 4 },
  bubbleRoxy: { backgroundColor: COLORS.surface, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: COLORS.roxy + '40' },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  bubbleTextUser: { color: '#fff' },
  bubbleTextRoxy: { color: COLORS.textPrimary },
  thinkingWrap: { flexDirection: 'row', alignItems: 'center', marginVertical: 8, paddingHorizontal: 4 },
  thinkingText: { color: COLORS.textMuted, fontSize: 13, fontStyle: 'italic' },
  inputArea: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: COLORS.surface, gap: 10,
  },
  input: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10,
    color: COLORS.textPrimary, fontSize: 15, maxHeight: 100,
    borderWidth: 1, borderColor: COLORS.surfaceLight,
  },
  inputDisabled: { opacity: 0.5 },
  sendBtn: { backgroundColor: COLORS.roxy, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10 },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
```

- [ ] **Step 2: TypeScript check**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1 | grep roxy-chat
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/(tabs)/grow/roxy-chat.tsx
git commit -m "feat: roxy-chat screen — general wingwoman chat accessible from companion button"
```

---

## Task 8: Run full test suite

- [ ] **Step 1: Run jest**

```bash
cd apps/mobile && npx jest --ci --passWithNoTests 2>&1 | tail -20
```

Expected: all tests pass. Fix any failures before proceeding.

- [ ] **Step 2: TypeScript full check**

```bash
cd apps/mobile && npx tsc --noEmit 2>&1
```

Expected: 0 errors.

---

## Task 9: Push branch and open PR

- [ ] **Step 1: Push branch**

```bash
cd D:/Nicole/Dev/roxy/roxy-client
git push -u origin session-6-polish
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --base main --title "feat: session 6 — roxy-chat, reaction fix, sister fix, liked closure fix" --body "$(cat <<'EOF'
## What's in this PR

- **feat:** roxy-chat edge function (wingwoman general chat, 20 msgs/day)
- **feat:** roxy-chat screen at /(tabs)/grow/roxy-chat — fixes RoxyCompanionButton crash
- **feat:** increment_reaction SQL function — post reactions now persist to DB
- **fix:** roxy-sister — remove invalid DB conversation check (was always returning 403)
- **fix:** speed-date session — stale liked closure using ref, like state now correct on session end
- **fix:** Badge type — icon_url → emoji to match actual DB schema

## Test checklist
- [ ] Tap sparkles FAB → "Chat with Roxy" → chat screen opens, no crash
- [ ] Send message to Roxy, get response
- [ ] React to a post in Discover — reactions persist after refresh
- [ ] Roxy Sister chat works (no 403)
- [ ] Speed date session: like a person, end session → result shows liked=true

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Post-PR: Manual Step Required

**DAILY_API_KEY** must be set for speed dating video to work:

```bash
npx supabase secrets set DAILY_API_KEY=your_key_here --project-ref ptymtdlysqbpxzlgsshp
```

Get the key from [Daily.co dashboard](https://dashboard.daily.co) → Developers → API Keys.
