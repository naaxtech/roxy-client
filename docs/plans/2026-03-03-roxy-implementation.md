# Roxy — Full Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build Roxy — a production-ready WLW community + dating + AI wingwoman app in React Native + Expo, wired to real Supabase + Anthropic from day one, across 5 vertical-slice sessions.

**Architecture:** Monorepo (`roxy-client/apps/mobile/` + `roxy-client/supabase/`). All Claude API calls server-side via Supabase Edge Functions (Deno). RLS on every table. Speed dating prompts batch-generated weekly and stored in DB — zero AI calls during gameplay. Dev cost guardrails in every edge function from day one.

**Tech Stack:** React Native + Expo SDK 51 + Expo Router v3, Supabase (Postgres + Auth + Realtime + Storage + Edge Functions), `claude-haiku-4-5-20251001`, Daily.co, Zustand, FlashList, Expo Notifications + OneSignal, Jest + React Native Testing Library, Deno test.

---

# SESSION 1 — Foundation

**End state:** Expo Go shows app → auth (magic link / Apple / Google) → 4-step onboarding → Grow tab with live Roxy greeting card. Dev panel visible in dev builds with AI pause toggle.

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `roxy-client/apps/mobile/package.json`
- Create: `roxy-client/apps/mobile/app.json`
- Create: `roxy-client/apps/mobile/tsconfig.json`
- Create: `roxy-client/apps/mobile/babel.config.js`
- Create: `roxy-client/.env.example`
- Create: `roxy-client/.gitignore`
- Create: `roxy-client/README.md`

**Step 1: Create the mobile app package.json**

```json
{
  "name": "roxy-mobile",
  "version": "1.0.0",
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start",
    "android": "expo run:android",
    "ios": "expo run:ios",
    "web": "expo start --web",
    "test": "jest --watchAll",
    "test:ci": "jest --ci",
    "lint": "eslint . --ext .ts,.tsx"
  },
  "dependencies": {
    "expo": "~51.0.0",
    "expo-router": "~3.5.0",
    "react": "18.2.0",
    "react-native": "0.74.0",
    "@supabase/supabase-js": "^2.43.0",
    "zustand": "^4.5.0",
    "@shopify/flash-list": "^1.6.4",
    "@daily-co/react-native-daily-js": "^0.60.0",
    "expo-notifications": "~0.28.0",
    "expo-image-picker": "~15.0.0",
    "expo-av": "~14.0.0",
    "react-native-reanimated": "~3.10.0",
    "react-native-safe-area-context": "4.10.1",
    "react-native-screens": "3.31.1",
    "react-native-gesture-handler": "~2.16.0",
    "date-fns": "^3.6.0",
    "@react-native-async-storage/async-storage": "1.23.1",
    "react-native-url-polyfill": "^2.0.0"
  },
  "devDependencies": {
    "@babel/core": "^7.24.0",
    "@types/react": "~18.2.0",
    "@types/react-native": "~0.73.0",
    "typescript": "^5.3.0",
    "jest": "^29.7.0",
    "jest-expo": "~51.0.0",
    "@testing-library/react-native": "^12.4.0",
    "@testing-library/jest-native": "^5.4.3",
    "eslint": "^8.57.0",
    "eslint-config-expo": "~7.0.0"
  },
  "jest": {
    "preset": "jest-expo",
    "setupFilesAfterFramework": ["@testing-library/jest-native/extend-expect"],
    "transformIgnorePatterns": [
      "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@daily-co/.*|@shopify/.*)"
    ]
  }
}
```

**Step 2: Create app.json**

```json
{
  "expo": {
    "name": "Roxy",
    "slug": "roxy",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "automatic",
    "splash": {
      "image": "./assets/splash.png",
      "resizeMode": "contain",
      "backgroundColor": "#1a0a2e"
    },
    "ios": {
      "supportsTablet": false,
      "bundleIdentifier": "com.roxy.app",
      "infoPlist": {
        "NSCameraUsageDescription": "Roxy needs camera access for speed dating video calls and profile photos.",
        "NSMicrophoneUsageDescription": "Roxy needs microphone access for speed dating video calls.",
        "NSPhotoLibraryUsageDescription": "Roxy needs photo library access to upload your profile picture."
      }
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#1a0a2e"
      },
      "package": "com.roxy.app",
      "permissions": ["CAMERA", "RECORD_AUDIO", "READ_EXTERNAL_STORAGE"]
    },
    "web": {
      "favicon": "./assets/favicon.png",
      "bundler": "metro"
    },
    "plugins": [
      "expo-router",
      "expo-notifications",
      [
        "expo-image-picker",
        { "photosPermission": "Roxy needs access to your photos to set your profile picture." }
      ]
    ],
    "experiments": {
      "typedRoutes": true
    },
    "scheme": "roxy"
  }
}
```

**Step 3: Create tsconfig.json**

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "paths": {
      "@/*": ["./*"]
    }
  }
}
```

**Step 4: Create babel.config.js**

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-reanimated/plugin'],
  };
};
```

**Step 5: Create .env.example at repo root**

```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ANTHROPIC_API_KEY=sk-ant-...
DAILY_API_KEY=your-daily-key
ONESIGNAL_APP_ID=your-onesignal-id
```

**Step 6: Create .gitignore**

```
# Env
.env
.env.local
.env.*.local
supabase/.env

# Expo
.expo/
dist/
web-build/

# Native
ios/
android/
*.orig.*
*.jks
*.p8
*.p12
*.key
*.mobileprovision

# Node
node_modules/

# Supabase
supabase/.branches
supabase/.temp
```

**Step 7: Install dependencies**

```bash
cd roxy-client/apps/mobile && npm install
```

Expected: node_modules populated, no peer dep errors.

**Step 8: Create assets directory with placeholder files**

```bash
mkdir -p roxy-client/apps/mobile/assets
# Create 1x1 pixel placeholder PNGs for icon, splash, adaptive-icon, favicon
# (Replace with real assets before App Store submission)
```

**Step 9: Commit**

```bash
git init roxy-client
cd roxy-client
git add .
git commit -m "feat: monorepo scaffold, Expo 51 config, all dependencies"
```

---

### Task 2: Types & constants

**Files:**
- Create: `apps/mobile/types/index.ts`
- Create: `apps/mobile/lib/constants.ts`

**Step 1: Write the types file**

```typescript
// apps/mobile/types/index.ts

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  pronouns: string[];
  identity_labels: string[];
  is_dating_mode: boolean;
  dating_looking_for: string[];
  age_min_pref: number;
  age_max_pref: number;
  location_city: string | null;
  location_country: string | null;
  is_verified: boolean;
  is_active: boolean;
  last_seen_at: string;
  gamification_points: number;
  badge_ids: string[];
  push_token: string | null;
  notification_preferences: Record<string, boolean>;
  is_ghost: boolean;
  created_at: string;
  updated_at: string;
}

export interface RoxyGreeting {
  id: string;
  user_id: string;
  greeting_text: string;
  context_data: Record<string, unknown> | null;
  generated_date: string;
  was_opened: boolean;
}

export interface Community {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  cover_image_url: string | null;
  category: 'identity' | 'interest' | 'location' | 'support';
  is_private: boolean;
  member_count: number;
  created_by: string;
  created_at: string;
}

export interface Conversation {
  id: string;
  participant_ids: string[];
  conversation_type: 'direct' | 'speed_date' | 'sister';
  last_message_at: string | null;
  roxy_nudge_count: number;
  roxy_wingwoman_count_today: number;
  last_roxy_call_date: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  content: string | null;
  media_url: string | null;
  message_type: 'text' | 'image' | 'voice' | 'roxy_suggestion';
  is_read: boolean;
  created_at: string;
}

export interface SpeedDateSession {
  id: string;
  community_id: string | null;
  scheduled_at: string;
  duration_seconds: number;
  participant_ids: string[];
  status: 'scheduled' | 'active' | 'completed';
  daily_room_url: string | null;
  prompts: string[];
  created_at: string;
}

export interface Match {
  id: string;
  user_a_id: string;
  user_b_id: string;
  matched_at: string;
  source: 'speed_date' | 'discover' | 'community';
  conversation_id: string | null;
}

export interface Post {
  id: string;
  author_id: string;
  community_id: string;
  content: string;
  media_urls: string[];
  post_type: 'standard' | 'event' | 'poll' | 'resource';
  is_pinned: boolean;
  is_flagged: boolean;
  reaction_counts: Record<string, number>;
  comment_count: number;
  created_at: string;
  updated_at: string;
}

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

export interface EdgeFnResponse<T = unknown> {
  success: boolean;
  data: T | null;
  error: string | null;
}
```

**Step 2: Write constants**

```typescript
// apps/mobile/lib/constants.ts

export const IDENTITY_LABELS = [
  'Lesbian', 'Bisexual', 'Queer', 'Pansexual', 'Trans',
  'Non-binary', 'Questioning', 'WLW ally', 'Prefer not to say',
];

export const PRONOUNS = [
  'she/her', 'they/them', 'she/they', 'any/all', 'other',
];

export const INTERESTS = [
  'Music', 'Books', 'Art', 'Activism', 'Sport', 'Travel', 'Gaming', 'Film',
  'Food', 'Wellness', 'Coding', 'Nature', 'Crafts', 'Comedy', 'Dancing',
  'Fashion', 'Yoga', 'Podcasts', 'Photography', 'Writing', 'Theatre',
  'Politics', 'Volunteering', 'Pets',
];

export const COLORS = {
  primary: '#C4476A',      // deep rose
  secondary: '#8B5CF6',   // purple
  accent: '#F472B6',      // pink
  background: '#1a0a2e',  // deep dark purple
  surface: '#2d1b4e',     // card surface
  surfaceLight: '#3d2b5e',
  textPrimary: '#FFFFFF',
  textSecondary: '#C4B5D4',
  textMuted: '#8B7AA8',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  roxy: '#E879A6',         // Roxy brand pink
  devPanel: '#FF1493',     // hot pink dev button
};

export const ROXY_SISTER_RESOURCES = {
  mindout: { name: 'Mindout LGBT+ Helpline', number: '0300 304 7000' },
  samaritans: { name: 'Samaritans', number: '116 123' },
  crisisText: { name: 'Crisis Text Line', instruction: 'Text HELLO to 85258' },
  lgbtFoundation: { name: 'LGBT Foundation', url: 'https://lgbt.foundation' },
};

export const DEV_MOCK_PROMPTS = [
  "What's a skill you've always wanted to learn?",
  "Which place changed how you see yourself?",
  "What's your version of a perfect Sunday?",
  "What's something you believed at 16 that you've completely changed your mind on?",
  "If you could live anywhere for a year, where and why?",
  "What's a small thing that always makes your day better?",
  "What are you most proud of that nobody knows about?",
  "Describe your ideal first date in three words.",
  "What's the last book / show / song that genuinely moved you?",
  "What does home mean to you?",
];
```

**Step 3: Commit**

```bash
git add apps/mobile/types apps/mobile/lib/constants.ts
git commit -m "feat: shared types and constants"
```

---

### Task 3: Supabase client

**Files:**
- Create: `apps/mobile/lib/supabase.ts`
- Test: `apps/mobile/__tests__/lib/supabase.test.ts`

**Step 1: Write the failing test**

```typescript
// apps/mobile/__tests__/lib/supabase.test.ts
import { supabase } from '../../lib/supabase';

describe('supabase client', () => {
  it('exports a supabase client instance', () => {
    expect(supabase).toBeDefined();
    expect(typeof supabase.from).toBe('function');
    expect(typeof supabase.auth.getSession).toBe('function');
  });
});
```

**Step 2: Run test — expect FAIL**

```bash
cd apps/mobile && npm run test:ci -- --testPathPattern=supabase
```

Expected: `Cannot find module '../../lib/supabase'`

**Step 3: Implement supabase.ts**

```typescript
// apps/mobile/lib/supabase.ts
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export const callEdgeFunction = async <T>(
  name: string,
  body: Record<string, unknown>
): Promise<{ data: T | null; error: string | null }> => {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) return { data: null, error: error.message };
  return { data: data as T, error: null };
};
```

**Step 4: Run test — expect PASS**

```bash
npm run test:ci -- --testPathPattern=supabase
```

**Step 5: Commit**

```bash
git add apps/mobile/lib/supabase.ts apps/mobile/__tests__/lib/supabase.test.ts
git commit -m "feat: supabase client with AsyncStorage session persistence"
```

---

### Task 4: Zustand stores

**Files:**
- Create: `apps/mobile/store/authStore.ts`
- Create: `apps/mobile/store/profileStore.ts`
- Create: `apps/mobile/store/roxyChatStore.ts`
- Test: `apps/mobile/__tests__/store/authStore.test.ts`

**Step 1: Write failing test for authStore**

```typescript
// apps/mobile/__tests__/store/authStore.test.ts
import { useAuthStore } from '../../store/authStore';
import { act, renderHook } from '@testing-library/react-native';

describe('authStore', () => {
  it('initialises with null user and session', () => {
    const { result } = renderHook(() => useAuthStore());
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it('setSession updates user and session', () => {
    const { result } = renderHook(() => useAuthStore());
    const mockSession = { user: { id: 'user-1', email: 'test@test.com' }, access_token: 'tok' } as any;
    act(() => result.current.setSession(mockSession));
    expect(result.current.user?.id).toBe('user-1');
    expect(result.current.session).toBe(mockSession);
  });
});
```

**Step 2: Run test — expect FAIL**

```bash
npm run test:ci -- --testPathPattern=authStore
```

**Step 3: Implement stores**

```typescript
// apps/mobile/store/authStore.ts
import { create } from 'zustand';
import { Session, User } from '@supabase/supabase-js';

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  setSession: (session: Session | null) => void;
  setLoading: (loading: boolean) => void;
  signOut: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  loading: true,
  setSession: (session) => set({ session, user: session?.user ?? null, loading: false }),
  setLoading: (loading) => set({ loading }),
  signOut: () => set({ user: null, session: null, loading: false }),
}));
```

```typescript
// apps/mobile/store/profileStore.ts
import { create } from 'zustand';
import { Profile } from '../types';

interface ProfileState {
  profile: Profile | null;
  onboardingStep: number;
  setProfile: (profile: Profile | null) => void;
  setOnboardingStep: (step: number) => void;
}

export const useProfileStore = create<ProfileState>((set) => ({
  profile: null,
  onboardingStep: 1,
  setProfile: (profile) => set({ profile }),
  setOnboardingStep: (step) => set({ onboardingStep: step }),
}));
```

```typescript
// apps/mobile/store/roxyChatStore.ts
import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  role: 'user' | 'roxy';
  content: string;
  timestamp: string;
}

interface RoxyChatState {
  messages: ChatMessage[];
  isOpen: boolean;
  isTyping: boolean;
  addMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  setOpen: (open: boolean) => void;
  setTyping: (typing: boolean) => void;
  clear: () => void;
}

export const useRoxyChatStore = create<RoxyChatState>((set) => ({
  messages: [],
  isOpen: false,
  isTyping: false,
  addMessage: (msg) =>
    set((s) => ({
      messages: [
        ...s.messages,
        { ...msg, id: Date.now().toString(), timestamp: new Date().toISOString() },
      ],
    })),
  setOpen: (isOpen) => set({ isOpen }),
  setTyping: (isTyping) => set({ isTyping }),
  clear: () => set({ messages: [] }),
}));
```

**Step 4: Run test — expect PASS**

```bash
npm run test:ci -- --testPathPattern=authStore
```

**Step 5: Commit**

```bash
git add apps/mobile/store/
git commit -m "feat: zustand stores for auth, profile, roxyChat"
```

---

### Task 5: Migration 001 — Core identity tables

**Files:**
- Create: `supabase/migrations/001_core_identity.sql`

**Step 1: Initialise Supabase in the repo**

```bash
cd roxy-client
npx supabase init
```

Expected: `supabase/` directory created with `config.toml`.

**Step 2: Write the migration**

```sql
-- supabase/migrations/001_core_identity.sql

-- ─── profiles ───────────────────────────────────────────────────────────────
CREATE TABLE profiles (
  id                       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username                 text UNIQUE NOT NULL,
  display_name             text NOT NULL,
  bio                      text,
  avatar_url               text,
  pronouns                 text[] DEFAULT '{}',
  identity_labels          text[] DEFAULT '{}',
  is_dating_mode           boolean DEFAULT false,
  dating_looking_for       text[] DEFAULT '{}',
  age_min_pref             int DEFAULT 18,
  age_max_pref             int DEFAULT 99,
  location_city            text,
  location_country         text,
  is_verified              boolean DEFAULT false,
  is_active                boolean DEFAULT true,
  last_seen_at             timestamptz DEFAULT now(),
  gamification_points      int DEFAULT 0,
  badge_ids                uuid[] DEFAULT '{}',
  push_token               text,
  notification_preferences jsonb DEFAULT '{}',
  is_ghost                 boolean DEFAULT false,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_public" ON profiles
  FOR SELECT USING (is_active = true AND is_ghost = false);

CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles_insert_own" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE INDEX idx_profiles_username ON profiles (username);
CREATE INDEX idx_profiles_dating_mode ON profiles (is_dating_mode) WHERE is_dating_mode = true;
CREATE INDEX idx_profiles_last_seen ON profiles (last_seen_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── roxy_greetings ─────────────────────────────────────────────────────────
CREATE TABLE roxy_greetings (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  greeting_text  text NOT NULL,
  context_data   jsonb,
  generated_date date DEFAULT CURRENT_DATE,
  was_opened     boolean DEFAULT false,
  UNIQUE (user_id, generated_date)
);

ALTER TABLE roxy_greetings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "greetings_own" ON roxy_greetings
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_greetings_user_date ON roxy_greetings (user_id, generated_date);

-- ─── dev_config (dev environment only — prod DB will not have rows) ──────────
CREATE TABLE dev_config (
  key   text PRIMARY KEY,
  value text NOT NULL
);

ALTER TABLE dev_config ENABLE ROW LEVEL SECURITY;

-- Only callable by service role (edge functions) — no client access
CREATE POLICY "dev_config_service_only" ON dev_config
  FOR ALL USING (false);

-- ─── AI call audit log ───────────────────────────────────────────────────────
CREATE TABLE ai_call_log (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  function_name text NOT NULL,
  called_at    timestamptz DEFAULT now(),
  was_mock     boolean DEFAULT false
);

ALTER TABLE ai_call_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_log_service_only" ON ai_call_log
  FOR ALL USING (false);

CREATE INDEX idx_ai_log_user_fn ON ai_call_log (user_id, function_name, called_at DESC);
```

**Step 3: Push migration to your Supabase project**

```bash
cd roxy-client
npx supabase db push --project-ref YOUR_PROJECT_REF
```

Expected: Migration applied, tables visible in Supabase dashboard.

**Step 4: Seed dev_config (run once, dev project only)**

```sql
-- Run in Supabase SQL editor on your DEV project only:
INSERT INTO dev_config (key, value) VALUES ('ai_enabled', 'false')
ON CONFLICT (key) DO NOTHING;
```

**Step 5: Commit**

```bash
git add supabase/
git commit -m "feat: migration 001 — profiles, roxy_greetings, dev_config, ai_call_log"
```

---

### Task 6: Edge Function shared utilities

**Files:**
- Create: `supabase/functions/_shared/cors.ts`
- Create: `supabase/functions/_shared/auth.ts`
- Create: `supabase/functions/_shared/claude.ts`
- Create: `supabase/functions/_shared/rateLimit.ts`
- Create: `supabase/functions/_shared/errorHandler.ts`
- Create: `supabase/functions/_shared/devGuard.ts`

**Step 1: cors.ts**

```typescript
// supabase/functions/_shared/cors.ts
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  return null;
}
```

**Step 2: auth.ts**

```typescript
// supabase/functions/_shared/auth.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export function getSupabaseClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );
}

export async function verifyJWT(
  req: Request
): Promise<{ userId: string } | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.replace('Bearer ', '');
  const supabase = getSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) return null;
  return { userId: user.id };
}
```

**Step 3: claude.ts — with dev guard built in**

```typescript
// supabase/functions/_shared/claude.ts
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.24.0';
import { getSupabaseClient } from './auth.ts';

const anthropic = new Anthropic({
  apiKey: Deno.env.get('ANTHROPIC_API_KEY')!,
});

export async function isAiEnabled(): Promise<boolean> {
  // Check env var first (fastest)
  const envFlag = Deno.env.get('ROXY_AI_ENABLED');
  if (envFlag === 'false') return false;

  // Check dev_config table (allows runtime toggle without redeploy)
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from('dev_config')
      .select('value')
      .eq('key', 'ai_enabled')
      .maybeSingle();
    if (data?.value === 'false') return false;
  } catch {
    // dev_config doesn't exist in prod — that's fine, proceed
  }
  return true;
}

export async function callClaude(params: {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  mockResponse?: string;
}): Promise<string> {
  const enabled = await isAiEnabled();

  if (!enabled) {
    return params.mockResponse ?? '[dev: AI paused]';
  }

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: params.maxTokens ?? 256,
    system: params.system,
    messages: params.messages,
  });

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type');
  return block.text;
}
```

**Step 4: rateLimit.ts**

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
    .select('id', { count: 'exact' })
    .eq('user_id', params.userId)
    .eq('function_name', params.fnName);

  if (params.windowType === 'daily') {
    query = query.gte('called_at', `${today}T00:00:00.000Z`);
  }
  if (params.windowType === 'conversation' && params.conversationId) {
    query = query.eq('conversation_id' as any, params.conversationId);
  }

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
}): Promise<void> {
  const supabase = getSupabaseClient();
  await supabase.from('ai_call_log').insert({
    user_id: params.userId,
    function_name: params.fnName,
    was_mock: params.wasMock,
  });
}
```

**Step 5: errorHandler.ts**

```typescript
// supabase/functions/_shared/errorHandler.ts
import { corsHeaders } from './cors.ts';

export function errorResponse(message: string, status = 500): Response {
  return new Response(
    JSON.stringify({ success: false, data: null, error: message }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

export function successResponse<T>(data: T, status = 200): Response {
  return new Response(
    JSON.stringify({ success: true, data, error: null }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
```

**Step 6: Commit**

```bash
git add supabase/functions/_shared/
git commit -m "feat: edge function shared utilities (cors, auth, claude, rateLimit, errorHandler)"
```

---

### Task 7: dev-control edge function

**Files:**
- Create: `supabase/functions/dev-control/index.ts`

**Step 1: Write the function**

```typescript
// supabase/functions/dev-control/index.ts
import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  // Only available in non-production environments
  if (Deno.env.get('ENVIRONMENT') === 'production') {
    return errorResponse('Not available in production', 403);
  }

  const { action, value } = await req.json();

  const supabase = getSupabaseClient();

  if (action === 'get_status') {
    const { data: aiConfig } = await supabase
      .from('dev_config')
      .select('value')
      .eq('key', 'ai_enabled')
      .maybeSingle();

    const today = new Date().toISOString().split('T')[0];
    const counts: Record<string, number> = {};
    const fns = ['roxy-greeting', 'roxy-icebreaker', 'roxy-wingwoman', 'roxy-nudge', 'roxy-sister', 'roxy-onboarding'];

    for (const fn of fns) {
      const { count } = await supabase
        .from('ai_call_log')
        .select('id', { count: 'exact' })
        .eq('user_id', auth.userId)
        .eq('function_name', fn)
        .gte('called_at', `${today}T00:00:00.000Z`);
      counts[fn] = count ?? 0;
    }

    return successResponse({
      ai_enabled: aiConfig?.value !== 'false',
      call_counts: counts,
    });
  }

  if (action === 'set_ai_enabled') {
    await supabase
      .from('dev_config')
      .upsert({ key: 'ai_enabled', value: value ? 'true' : 'false' });

    return successResponse({ ai_enabled: value });
  }

  if (action === 'reset_counters') {
    const today = new Date().toISOString().split('T')[0];
    await supabase
      .from('ai_call_log')
      .delete()
      .eq('user_id', auth.userId)
      .gte('called_at', `${today}T00:00:00.000Z`);

    return successResponse({ reset: true });
  }

  if (action === 'clear_greeting_cache') {
    const today = new Date().toISOString().split('T')[0];
    await supabase
      .from('roxy_greetings')
      .delete()
      .eq('user_id', auth.userId)
      .eq('generated_date', today);

    return successResponse({ cleared: true });
  }

  if (action === 'seed_speed_date_session') {
    const scheduledAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('speed_date_sessions')
      .insert({
        scheduled_at: scheduledAt,
        duration_seconds: 300,
        participant_ids: [auth.userId],
        status: 'scheduled',
        prompts: [
          "What's a skill you've always wanted to learn?",
          "Which place changed how you see yourself?",
          "What's your version of a perfect Sunday?",
          "What are you most proud of that nobody knows about?",
          "Describe your ideal first date in three words.",
          "What's the last thing that genuinely made you laugh?",
          "What does home mean to you?",
          "What's something you believed at 16 you've totally changed your mind on?",
          "If you could live anywhere for a year, where?",
          "What small thing always makes your day better?",
        ],
      })
      .select()
      .single();

    return successResponse({ session: data });
  }

  return errorResponse('Unknown action', 400);
});
```

**Step 2: Deploy edge function**

```bash
cd roxy-client
npx supabase functions deploy dev-control --project-ref YOUR_PROJECT_REF
```

**Step 3: Commit**

```bash
git add supabase/functions/dev-control/
git commit -m "feat: dev-control edge function for AI pause toggle and test helpers"
```

---

### Task 8: roxy-greeting edge function

**Files:**
- Create: `supabase/functions/roxy-greeting/index.ts`

**Step 1: Write the function**

```typescript
// supabase/functions/roxy-greeting/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { callClaude } from '../_shared/claude.ts';
import { logAiCall } from '../_shared/rateLimit.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const supabase = getSupabaseClient();
  const today = new Date().toISOString().split('T')[0];

  // Cache check — return today's greeting if it exists
  const { data: cached } = await supabase
    .from('roxy_greetings')
    .select('greeting_text')
    .eq('user_id', auth.userId)
    .eq('generated_date', today)
    .maybeSingle();

  if (cached) {
    return successResponse({ greeting: cached.greeting_text, cached: true });
  }

  // Gather context
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, identity_labels')
    .eq('id', auth.userId)
    .single();

  const name = profile?.display_name ?? 'friend';
  const labels = profile?.identity_labels?.join(', ') ?? '';

  const mockResponse = `Hey ${name} — Roxy here. (dev: AI paused)`;

  const greeting = await callClaude({
    system: `You are Roxy, an AI wingwoman for a WLW community platform. Write one warm, personal greeting card message for ${name}. Max 2 sentences. Tone: warm, witty, queer-affirming. Never say good morning/evening. Never be generic. The user identifies as: ${labels}.`,
    messages: [{ role: 'user', content: 'Generate my greeting.' }],
    maxTokens: 128,
    mockResponse,
  });

  // Store in cache
  await supabase.from('roxy_greetings').insert({
    user_id: auth.userId,
    greeting_text: greeting,
    generated_date: today,
  });

  await logAiCall({
    userId: auth.userId,
    fnName: 'roxy-greeting',
    wasMock: greeting === mockResponse,
  });

  return successResponse({ greeting, cached: false });
});
```

**Step 2: Deploy**

```bash
npx supabase functions deploy roxy-greeting --project-ref YOUR_PROJECT_REF
```

**Step 3: Set secrets**

```bash
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-YOUR_KEY --project-ref YOUR_PROJECT_REF
npx supabase secrets set ROXY_AI_ENABLED=false --project-ref YOUR_PROJECT_REF
npx supabase secrets set ENVIRONMENT=development --project-ref YOUR_PROJECT_REF
```

**Step 4: Commit**

```bash
git add supabase/functions/roxy-greeting/
git commit -m "feat: roxy-greeting edge function with 1/day cache and dev guard"
```

---

### Task 9: useAuth hook

**Files:**
- Create: `apps/mobile/hooks/useAuth.ts`
- Test: `apps/mobile/__tests__/hooks/useAuth.test.ts`

**Step 1: Write failing test**

```typescript
// apps/mobile/__tests__/hooks/useAuth.test.ts
import { renderHook, act } from '@testing-library/react-native';
import { useAuth } from '../../hooks/useAuth';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: jest.fn().mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } }),
      signInWithOtp: jest.fn().mockResolvedValue({ error: null }),
      signOut: jest.fn().mockResolvedValue({ error: null }),
    },
  },
}));

describe('useAuth', () => {
  it('exposes signIn, signOut, user, session, loading', () => {
    const { result } = renderHook(() => useAuth());
    expect(typeof result.current.signIn).toBe('function');
    expect(typeof result.current.signOut).toBe('function');
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
  });
});
```

**Step 2: Run test — expect FAIL**

```bash
npm run test:ci -- --testPathPattern=useAuth
```

**Step 3: Implement useAuth.ts**

```typescript
// apps/mobile/hooks/useAuth.ts
import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';

export function useAuth() {
  const { user, session, loading, setSession, setLoading, signOut: storeSignOut } = useAuthStore();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: 'roxy://auth/callback' },
    });
    return { error };
  };

  const signInWithApple = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: 'roxy://auth/callback' },
    });
    return { error };
  };

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: 'roxy://auth/callback' },
    });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    storeSignOut();
  };

  return { user, session, loading, signIn, signInWithApple, signInWithGoogle, signOut };
}
```

**Step 4: Run test — expect PASS**

```bash
npm run test:ci -- --testPathPattern=useAuth
```

**Step 5: Commit**

```bash
git add apps/mobile/hooks/useAuth.ts apps/mobile/__tests__/hooks/useAuth.test.ts
git commit -m "feat: useAuth hook with magic link, Apple, Google sign-in"
```

---

### Task 10: Auth screens

**Files:**
- Create: `apps/mobile/app/_layout.tsx` (root layout with auth guard)
- Create: `apps/mobile/app/(auth)/welcome.tsx`
- Create: `apps/mobile/app/(auth)/login.tsx`
- Create: `apps/mobile/app/(auth)/_layout.tsx`

**Step 1: Root layout with auth guard**

```typescript
// apps/mobile/app/_layout.tsx
import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuth } from '../hooks/useAuth';
import { useProfileStore } from '../store/profileStore';
import { supabase } from '../lib/supabase';

export default function RootLayout() {
  const { user, loading } = useAuth();
  const { profile, setProfile } = useProfileStore();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (loading) return;

    const inAuth = segments[0] === '(auth)';

    if (!user && !inAuth) {
      router.replace('/(auth)/welcome');
      return;
    }

    if (user && !inAuth) {
      // Fetch profile to check onboarding state
      supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (!data) {
            router.replace('/(auth)/onboarding/step1-identity');
          } else {
            setProfile(data);
          }
        });
    }

    if (user && inAuth) {
      router.replace('/(tabs)/grow');
    }
  }, [user, loading, segments]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
```

**Step 2: Auth layout**

```typescript
// apps/mobile/app/(auth)/_layout.tsx
import { Stack } from 'expo-router';

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

**Step 3: Welcome screen**

```typescript
// apps/mobile/app/(auth)/welcome.tsx
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import { COLORS } from '../../lib/constants';

export default function WelcomeScreen() {
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const { signIn, signInWithApple, signInWithGoogle } = useAuth();
  const router = useRouter();

  const handleMagicLink = async () => {
    if (!email) return;
    setLoading(true);
    const { error } = await signIn(email);
    setLoading(false);
    if (!error) setSent(true);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.logo}>Roxy</Text>
        <Text style={styles.tagline}>Your community. Your story.</Text>
      </View>

      {sent ? (
        <View style={styles.content}>
          <Text style={styles.sentTitle}>Check your email ✉️</Text>
          <Text style={styles.sentBody}>We sent a magic link to {email}</Text>
        </View>
      ) : (
        <View style={styles.content}>
          <TouchableOpacity style={styles.btn} onPress={signInWithApple}>
            <Text style={styles.btnText}> Continue with Apple</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.btn, styles.btnGoogle]} onPress={signInWithGoogle}>
            <Text style={styles.btnText}>Continue with Google</Text>
          </TouchableOpacity>

          {!showEmail ? (
            <TouchableOpacity onPress={() => setShowEmail(true)}>
              <Text style={styles.emailLink}>Use email instead</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.emailContainer}>
              <TextInput
                style={styles.input}
                placeholder="your@email.com"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
              />
              <TouchableOpacity
                style={[styles.btn, loading && styles.btnDisabled]}
                onPress={handleMagicLink}
                disabled={loading}
              >
                <Text style={styles.btnText}>{loading ? 'Sending...' : 'Send magic link'}</Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={styles.privacy}>We never share your data with third parties.</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logo: { fontSize: 64, fontWeight: '800', color: COLORS.roxy },
  tagline: { fontSize: 18, color: COLORS.textSecondary, marginTop: 8 },
  content: { padding: 24, gap: 12 },
  btn: { backgroundColor: COLORS.primary, borderRadius: 12, padding: 16, alignItems: 'center' },
  btnGoogle: { backgroundColor: COLORS.surface },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: COLORS.textPrimary, fontWeight: '600', fontSize: 16 },
  emailLink: { color: COLORS.textSecondary, textAlign: 'center', marginTop: 8 },
  emailContainer: { gap: 8 },
  input: {
    backgroundColor: COLORS.surface, borderRadius: 12, padding: 14,
    color: COLORS.textPrimary, fontSize: 16,
  },
  sentTitle: { fontSize: 24, fontWeight: '700', color: COLORS.textPrimary, textAlign: 'center' },
  sentBody: { color: COLORS.textSecondary, textAlign: 'center', marginTop: 8 },
  privacy: { color: COLORS.textMuted, fontSize: 12, textAlign: 'center', marginTop: 12 },
});
```

**Step 4: Commit**

```bash
git add apps/mobile/app/
git commit -m "feat: root layout auth guard, welcome screen with magic link + Apple + Google"
```

---

### Task 11: Onboarding flow (4 steps)

**Files:**
- Create: `apps/mobile/app/(auth)/onboarding/step1-identity.tsx`
- Create: `apps/mobile/app/(auth)/onboarding/step2-interests.tsx`
- Create: `apps/mobile/app/(auth)/onboarding/step3-photo.tsx`
- Create: `apps/mobile/app/(auth)/onboarding/step4-status.tsx`
- Create: `apps/mobile/components/ui/ChipSelector.tsx` (shared across steps)

**Step 1: ChipSelector UI component**

```typescript
// apps/mobile/components/ui/ChipSelector.tsx
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../../lib/constants';

interface Props {
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  max?: number;
}

export function ChipSelector({ options, selected, onToggle, max }: Props) {
  return (
    <View style={styles.container}>
      {options.map((opt) => {
        const isSelected = selected.includes(opt);
        const isDisabled = !isSelected && max !== undefined && selected.length >= max;
        return (
          <TouchableOpacity
            key={opt}
            style={[styles.chip, isSelected && styles.chipSelected, isDisabled && styles.chipDisabled]}
            onPress={() => !isDisabled && onToggle(opt)}
            activeOpacity={0.7}
          >
            <Text style={[styles.label, isSelected && styles.labelSelected]}>{opt}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1.5, borderColor: COLORS.textMuted,
  },
  chipSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipDisabled: { opacity: 0.4 },
  label: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '500' },
  labelSelected: { color: COLORS.textPrimary },
});
```

**Step 2: Step 1 — Identity**

```typescript
// apps/mobile/app/(auth)/onboarding/step1-identity.tsx
import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { ChipSelector } from '../../../components/ui/ChipSelector';
import { IDENTITY_LABELS, PRONOUNS, COLORS } from '../../../lib/constants';

export default function Step1Identity() {
  const [username, setUsername] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const [pronouns, setPronouns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const { user } = useAuthStore();
  const router = useRouter();

  const checkUsername = async (val: string) => {
    setUsername(val);
    if (val.length < 3 || !/^[a-z0-9_]+$/i.test(val)) {
      setUsernameAvailable(null);
      return;
    }
    const { data } = await supabase
      .from('profiles')
      .select('username')
      .eq('username', val.toLowerCase())
      .maybeSingle();
    setUsernameAvailable(!data);
  };

  const handleNext = async () => {
    if (!usernameAvailable || !displayName || labels.length === 0) return;
    setLoading(true);
    const { error } = await supabase.from('profiles').upsert({
      id: user!.id,
      username: username.toLowerCase(),
      display_name: displayName,
      identity_labels: labels,
      pronouns,
    });
    setLoading(false);
    if (error) { Alert.alert('Error', error.message); return; }
    router.push('/(auth)/onboarding/step2-interests');
  };

  const usernameHint = username.length < 3 ? '' : usernameAvailable === true ? '✓ Available' : usernameAvailable === false ? '✗ Taken' : '';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.step}>Step 1 of 4</Text>
        <Text style={styles.headline}>How do you identify?</Text>

        <Text style={styles.label}>Username</Text>
        <TextInput
          style={styles.input}
          placeholder="@yourname"
          placeholderTextColor={COLORS.textMuted}
          autoCapitalize="none"
          value={username}
          onChangeText={checkUsername}
        />
        {usernameHint ? <Text style={[styles.hint, usernameAvailable ? styles.hintGood : styles.hintBad]}>{usernameHint}</Text> : null}

        <Text style={styles.label}>Display name</Text>
        <TextInput
          style={styles.input}
          placeholder="How you'll appear"
          placeholderTextColor={COLORS.textMuted}
          value={displayName}
          onChangeText={setDisplayName}
        />

        <Text style={styles.label}>Identity</Text>
        <ChipSelector options={IDENTITY_LABELS} selected={labels} onToggle={(v) => setLabels((p) => p.includes(v) ? p.filter((x) => x !== v) : [...p, v])} />

        <Text style={[styles.label, { marginTop: 16 }]}>Pronouns</Text>
        <ChipSelector options={PRONOUNS} selected={pronouns} onToggle={(v) => setPronouns((p) => p.includes(v) ? p.filter((x) => x !== v) : [...p, v])} />

        <TouchableOpacity
          style={[styles.btn, loading && styles.btnDisabled]}
          onPress={handleNext}
          disabled={loading}
        >
          <Text style={styles.btnText}>{loading ? 'Saving...' : 'Next →'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: 24, gap: 8 },
  step: { color: COLORS.textMuted, fontSize: 13 },
  headline: { fontSize: 28, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 16 },
  label: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600', marginTop: 12 },
  input: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, color: COLORS.textPrimary, fontSize: 16 },
  hint: { fontSize: 12, marginTop: 2 },
  hintGood: { color: COLORS.success },
  hintBad: { color: COLORS.error },
  btn: { backgroundColor: COLORS.primary, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 16 },
});
```

**Step 3: Step 2 — Interests**

```typescript
// apps/mobile/app/(auth)/onboarding/step2-interests.tsx
import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { ChipSelector } from '../../../components/ui/ChipSelector';
import { INTERESTS, COLORS } from '../../../lib/constants';

export default function Step2Interests() {
  const [interests, setInterests] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const { user } = useAuthStore();
  const router = useRouter();

  const handleNext = async () => {
    if (interests.length < 1) return;
    setLoading(true);
    await supabase.from('profiles').update({ dating_looking_for: interests }).eq('id', user!.id);
    setLoading(false);
    router.push('/(auth)/onboarding/step3-photo');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.step}>Step 2 of 4</Text>
        <Text style={styles.headline}>What lights you up?</Text>
        <Text style={styles.sub}>Pick up to 8</Text>
        <ChipSelector options={INTERESTS} selected={interests} max={8}
          onToggle={(v) => setInterests((p) => p.includes(v) ? p.filter((x) => x !== v) : [...p, v])} />
        <TouchableOpacity style={[styles.btn, loading && styles.btnDisabled]} onPress={handleNext} disabled={loading}>
          <Text style={styles.btnText}>{loading ? 'Saving...' : 'Next →'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: 24, gap: 12 },
  step: { color: COLORS.textMuted, fontSize: 13 },
  headline: { fontSize: 28, fontWeight: '700', color: COLORS.textPrimary },
  sub: { color: COLORS.textSecondary, fontSize: 14 },
  btn: { backgroundColor: COLORS.primary, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 16 },
});
```

**Step 4: Step 3 — Photo**

```typescript
// apps/mobile/app/(auth)/onboarding/step3-photo.tsx
import { useState } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { COLORS } from '../../../lib/constants';

export default function Step3Photo() {
  const [uri, setUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const { user } = useAuthStore();
  const router = useRouter();

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) setUri(result.assets[0].uri);
  };

  const handleNext = async () => {
    if (uri) {
      setUploading(true);
      const ext = uri.split('.').pop();
      const path = `${user!.id}/avatar.${ext}`;
      const response = await fetch(uri);
      const blob = await response.blob();
      const { error } = await supabase.storage.from('avatars').upload(path, blob, { upsert: true });
      if (!error) {
        const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
        await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', user!.id);
      }
      setUploading(false);
    }
    router.push('/(auth)/onboarding/step4-status');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.step}>Step 3 of 4</Text>
        <Text style={styles.headline}>Add a photo</Text>
        <Text style={styles.sub}>Optional, but it helps people connect with you.</Text>

        <TouchableOpacity style={styles.photoBtn} onPress={pickImage}>
          {uri
            ? <Image source={{ uri }} style={styles.preview} />
            : <Text style={styles.photoBtnText}>Tap to choose photo</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity style={[styles.btn, uploading && styles.btnDisabled]} onPress={handleNext} disabled={uploading}>
          <Text style={styles.btnText}>{uploading ? 'Uploading...' : uri ? 'Next →' : 'Skip for now'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { flex: 1, padding: 24, gap: 16 },
  step: { color: COLORS.textMuted, fontSize: 13 },
  headline: { fontSize: 28, fontWeight: '700', color: COLORS.textPrimary },
  sub: { color: COLORS.textSecondary, fontSize: 15 },
  photoBtn: {
    width: 160, height: 160, borderRadius: 80, backgroundColor: COLORS.surface,
    alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginTop: 24,
  },
  photoBtnText: { color: COLORS.textMuted, textAlign: 'center', padding: 16 },
  preview: { width: 160, height: 160, borderRadius: 80 },
  btn: { backgroundColor: COLORS.primary, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 'auto' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 16 },
});
```

**Step 5: Step 4 — Status (Meet Roxy)**

```typescript
// apps/mobile/app/(auth)/onboarding/step4-status.tsx
import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../store/authStore';
import { callEdgeFunction } from '../../../lib/supabase';
import { COLORS } from '../../../lib/constants';

const GOALS = [
  { key: 'community', label: 'COMMUNITY', sub: 'Find your people, build connections' },
  { key: 'friendship', label: 'FRIENDSHIP', sub: 'Make real friends in the WLW community' },
  { key: 'dating', label: 'DATING', sub: 'Meet someone special', enablesDating: true },
] as const;

export default function Step4Status() {
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const { user } = useAuthStore();
  const router = useRouter();

  const toggle = (key: string) =>
    setSelected((p) => p.includes(key) ? p.filter((x) => x !== key) : [...p, key]);

  const handleFinish = async () => {
    if (selected.length === 0) return;
    setLoading(true);
    const isDating = selected.includes('dating');
    await supabase.from('profiles').update({ is_dating_mode: isDating }).eq('id', user!.id);
    await callEdgeFunction('roxy-onboarding', { user_id: user!.id });
    setLoading(false);
    router.replace('/(tabs)/grow');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.step}>Step 4 of 4</Text>
        <Text style={styles.headline}>What are you here for?</Text>

        {GOALS.map((g) => (
          <TouchableOpacity
            key={g.key}
            style={[styles.card, selected.includes(g.key) && styles.cardSelected]}
            onPress={() => toggle(g.key)}
          >
            <Text style={styles.cardTitle}>{g.label}</Text>
            <Text style={styles.cardSub}>{g.sub}</Text>
          </TouchableOpacity>
        ))}

        <TouchableOpacity
          style={[styles.btn, (loading || selected.length === 0) && styles.btnDisabled]}
          onPress={handleFinish}
          disabled={loading || selected.length === 0}
        >
          <Text style={styles.btnText}>{loading ? 'Setting up...' : 'Meet Roxy →'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { flex: 1, padding: 24, gap: 12 },
  step: { color: COLORS.textMuted, fontSize: 13 },
  headline: { fontSize: 28, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 8 },
  card: {
    backgroundColor: COLORS.surface, borderRadius: 16, padding: 20,
    borderWidth: 2, borderColor: 'transparent',
  },
  cardSelected: { borderColor: COLORS.primary, backgroundColor: COLORS.surfaceLight },
  cardTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textPrimary, letterSpacing: 1 },
  cardSub: { color: COLORS.textSecondary, marginTop: 4 },
  btn: { backgroundColor: COLORS.primary, borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 'auto' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 16 },
});
```

**Step 6: Commit**

```bash
git add apps/mobile/app/(auth)/onboarding/ apps/mobile/components/
git commit -m "feat: 4-step onboarding flow (identity, interests, photo, status)"
```

---

### Task 12: Tab navigation + Grow tab (Zone 1 — greeting card)

**Files:**
- Create: `apps/mobile/app/(tabs)/_layout.tsx`
- Create: `apps/mobile/app/(tabs)/grow/index.tsx`
- Create: `apps/mobile/app/(tabs)/connect/index.tsx` (stub)
- Create: `apps/mobile/app/(tabs)/discover/index.tsx` (stub)
- Create: `apps/mobile/app/(tabs)/build/index.tsx` (stub)
- Create: `apps/mobile/hooks/useProfile.ts`

**Step 1: Tab layout**

```typescript
// apps/mobile/app/(tabs)/_layout.tsx
import { Tabs } from 'expo-router';
import { COLORS } from '../../lib/constants';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: COLORS.background, borderTopColor: COLORS.surface },
        tabBarActiveTintColor: COLORS.roxy,
        tabBarInactiveTintColor: COLORS.textMuted,
      }}
    >
      <Tabs.Screen name="grow" options={{ title: 'Grow' }} />
      <Tabs.Screen name="discover" options={{ title: 'Discover' }} />
      <Tabs.Screen name="connect" options={{ title: 'Connect' }} />
      <Tabs.Screen name="build" options={{ title: 'Build' }} />
    </Tabs>
  );
}
```

**Step 2: useProfile hook**

```typescript
// apps/mobile/hooks/useProfile.ts
import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { useProfileStore } from '../store/profileStore';

export function useProfile() {
  const { user } = useAuthStore();
  const { profile, setProfile } = useProfileStore();

  useEffect(() => {
    if (!user || profile) return;
    supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
      .then(({ data }) => { if (data) setProfile(data); });
  }, [user]);

  return { profile };
}
```

**Step 3: Grow tab — greeting card (Zone 1)**

```typescript
// apps/mobile/app/(tabs)/grow/index.tsx
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { callEdgeFunction } from '../../../lib/supabase';
import { useProfile } from '../../../hooks/useProfile';
import { COLORS } from '../../../lib/constants';

export default function GrowScreen() {
  const { profile } = useProfile();
  const [greeting, setGreeting] = useState<string | null>(null);
  const [greetingLoading, setGreetingLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    setGreetingLoading(true);
    callEdgeFunction<{ greeting: string }>('roxy-greeting', {})
      .then(({ data }) => {
        setGreeting(data?.greeting ?? null);
        setGreetingLoading(false);
      });
  }, [profile]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Zone 1 — Roxy Greeting Card */}
        <View style={styles.greetingCard}>
          <View style={styles.roxyDot} />
          {greetingLoading ? (
            <ActivityIndicator color={COLORS.roxy} style={{ marginTop: 24 }} />
          ) : (
            <Text style={styles.greetingText}>{greeting ?? 'Hey — Roxy here. 👋'}</Text>
          )}
          <Text style={styles.greetingLabel}>✨ Your daily message from Roxy</Text>
        </View>

        {/* Zone 2 — Communities placeholder */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Communities</Text>
          <Text style={styles.emptyState}>Join your first community in Discover →</Text>
        </View>

        {/* Zone 3 — People placeholder */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your People</Text>
          <Text style={styles.emptyState}>Add your first connection in Discover →</Text>
        </View>

        {/* Zone 4 — Progress placeholder */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Journey</Text>
          <Text style={styles.emptyState}>Earn your first badge by posting in a community →</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: 16, gap: 16 },
  greetingCard: {
    backgroundColor: COLORS.surface, borderRadius: 24, padding: 24,
    minHeight: 180, justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.primary + '40',
  },
  roxyDot: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.roxy, marginBottom: 12,
  },
  greetingText: { fontSize: 18, color: COLORS.textPrimary, lineHeight: 28, fontWeight: '500' },
  greetingLabel: { color: COLORS.textMuted, fontSize: 12, marginTop: 12 },
  section: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 8 },
  emptyState: { color: COLORS.textMuted, fontSize: 14 },
});
```

**Step 4: Stub screens for other tabs**

```typescript
// apps/mobile/app/(tabs)/connect/index.tsx
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../../../lib/constants';

export default function ConnectScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.text}>Connect — coming in Session 2</Text>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center' },
  text: { color: COLORS.textMuted },
});
```

*(Repeat the same stub pattern for `discover/index.tsx` and `build/index.tsx`)*

**Step 5: Commit**

```bash
git add apps/mobile/app/(tabs)/ apps/mobile/hooks/useProfile.ts
git commit -m "feat: tab navigation, Grow tab with live Roxy greeting card, stub tabs"
```

---

### Task 13: Dev Panel component

**Files:**
- Create: `apps/mobile/components/dev/DevPanel.tsx`

**Step 1: Write the component**

```typescript
// apps/mobile/components/dev/DevPanel.tsx
// This file is only included in __DEV__ builds
import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, Switch
} from 'react-native';
import { callEdgeFunction } from '../../lib/supabase';
import { COLORS } from '../../lib/constants';

interface DevStatus {
  ai_enabled: boolean;
  call_counts: Record<string, number>;
}

export function DevPanel() {
  if (!__DEV__) return null;

  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<DevStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    const { data } = await callEdgeFunction<DevStatus>('dev-control', { action: 'get_status' });
    if (data) setStatus(data);
  };

  useEffect(() => { if (visible) refresh(); }, [visible]);

  const toggleAi = async (val: boolean) => {
    setLoading(true);
    await callEdgeFunction('dev-control', { action: 'set_ai_enabled', value: val });
    await refresh();
    setLoading(false);
  };

  const action = async (a: string) => {
    setLoading(true);
    await callEdgeFunction('dev-control', { action: a });
    await refresh();
    setLoading(false);
  };

  return (
    <>
      {/* Floating button */}
      <TouchableOpacity style={styles.fab} onPress={() => setVisible(true)}>
        <Text style={styles.fabText}>DEV</Text>
      </TouchableOpacity>

      <Modal visible={visible} animationType="slide" transparent>
        <View style={styles.overlay}>
          <View style={styles.panel}>
            <Text style={styles.title}>🛠 ROXY DEV PANEL</Text>

            <View style={styles.row}>
              <Text style={styles.rowLabel}>AI Calls</Text>
              <Switch
                value={status?.ai_enabled ?? false}
                onValueChange={toggleAi}
                disabled={loading}
                trackColor={{ false: COLORS.error, true: COLORS.success }}
              />
              <Text style={[styles.badge, status?.ai_enabled ? styles.badgeLive : styles.badgePaused]}>
                {status?.ai_enabled ? 'LIVE' : 'PAUSED'}
              </Text>
            </View>

            {status && (
              <ScrollView style={styles.counts}>
                {Object.entries(status.call_counts).map(([fn, count]) => (
                  <Text key={fn} style={styles.countRow}>{fn.replace('roxy-', '')}: <Text style={styles.countNum}>{count}</Text></Text>
                ))}
              </ScrollView>
            )}

            <TouchableOpacity style={styles.actionBtn} onPress={() => action('reset_counters')}>
              <Text style={styles.actionBtnText}>Reset all counters</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} onPress={() => action('clear_greeting_cache')}>
              <Text style={styles.actionBtnText}>Clear greeting cache</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, styles.actionBtnAccent]} onPress={() => action('seed_speed_date_session')}>
              <Text style={styles.actionBtnText}>Seed test speed date</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.closeBtn} onPress={() => setVisible(false)}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute', bottom: 100, left: 16,
    backgroundColor: COLORS.devPanel, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6, zIndex: 9999,
  },
  fabText: { color: '#fff', fontWeight: '800', fontSize: 11 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  panel: { backgroundColor: COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 12 },
  title: { fontSize: 16, fontWeight: '800', color: COLORS.textPrimary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowLabel: { flex: 1, color: COLORS.textSecondary, fontSize: 15 },
  badge: { fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeLive: { backgroundColor: COLORS.success + '30', color: COLORS.success },
  badgePaused: { backgroundColor: COLORS.error + '30', color: COLORS.error },
  counts: { maxHeight: 140, backgroundColor: COLORS.background, borderRadius: 8, padding: 8 },
  countRow: { color: COLORS.textMuted, fontSize: 13, paddingVertical: 2 },
  countNum: { color: COLORS.textPrimary, fontWeight: '600' },
  actionBtn: { backgroundColor: COLORS.background, borderRadius: 10, padding: 12, alignItems: 'center' },
  actionBtnAccent: { backgroundColor: COLORS.primary + '40' },
  actionBtnText: { color: COLORS.textSecondary, fontWeight: '600' },
  closeBtn: { backgroundColor: COLORS.primary, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 4 },
  closeBtnText: { color: '#fff', fontWeight: '700' },
});
```

**Step 2: Mount DevPanel in root layout**

Edit `apps/mobile/app/_layout.tsx` — add inside the return, after `<Stack>`:

```typescript
import { DevPanel } from '../components/dev/DevPanel';

// Inside return:
<Stack screenOptions={{ headerShown: false }} />
{__DEV__ && <DevPanel />}
```

**Step 3: Commit**

```bash
git add apps/mobile/components/dev/ apps/mobile/app/_layout.tsx
git commit -m "feat: DevPanel component with AI pause toggle, call counts, test session seeder"
```

---

### Task 14: roxy-onboarding edge function

**Files:**
- Create: `supabase/functions/roxy-onboarding/index.ts`

**Step 1: Write and deploy**

```typescript
// supabase/functions/roxy-onboarding/index.ts
import { handleCors } from '../_shared/cors.ts';
import { verifyJWT, getSupabaseClient } from '../_shared/auth.ts';
import { callClaude, isAiEnabled } from '../_shared/claude.ts';
import { logAiCall } from '../_shared/rateLimit.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

const SEED_COMMUNITIES = [
  'Lesbians of London', 'Bi+ Collective', 'Queer Gamers',
  'WLW Entrepreneurs', 'Trans & Non-binary Support',
];

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const auth = await verifyJWT(req);
  if (!auth) return errorResponse('Unauthorized', 401);

  const supabase = getSupabaseClient();

  // Rate limit: 1 per user lifetime
  const { count } = await supabase
    .from('ai_call_log')
    .select('id', { count: 'exact' })
    .eq('user_id', auth.userId)
    .eq('function_name', 'roxy-onboarding');
  if ((count ?? 0) > 0) return errorResponse('Already called', 429);

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, identity_labels, dating_looking_for')
    .eq('id', auth.userId)
    .single();

  const mockResult = {
    community_suggestions: SEED_COMMUNITIES.slice(0, 3),
    welcome_message: `Welcome to Roxy, ${profile?.display_name ?? 'friend'}! (dev: AI paused)`,
    first_goal: 'Join your first community and say hello.',
  };

  const raw = await callClaude({
    system: `You are Roxy. A new WLW user just joined. Return ONLY a JSON object (no markdown):
{"community_suggestions":["name1","name2","name3"],"welcome_message":"one warm sentence","first_goal":"one small achievable goal"}
Available communities: ${SEED_COMMUNITIES.join(', ')}
User identity: ${profile?.identity_labels?.join(', ')}`,
    messages: [{ role: 'user', content: `My name is ${profile?.display_name}. Generate my onboarding data.` }],
    maxTokens: 256,
    mockResponse: JSON.stringify(mockResult),
  });

  let result = mockResult;
  try { result = JSON.parse(raw); } catch { /* use mock */ }

  await logAiCall({ userId: auth.userId, fnName: 'roxy-onboarding', wasMock: raw === JSON.stringify(mockResult) });

  return successResponse(result);
});
```

```bash
npx supabase functions deploy roxy-onboarding --project-ref YOUR_PROJECT_REF
git add supabase/functions/roxy-onboarding/
git commit -m "feat: roxy-onboarding edge function with community suggestions"
```

---

### Task 15: Supabase Storage bucket

**Step 1: Create avatars bucket (run in Supabase SQL editor)**

```sql
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true);

CREATE POLICY "avatars_read_public" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

CREATE POLICY "avatars_upload_own" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "avatars_update_own" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'avatars' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );
```

**Step 2: Commit note**

```bash
git commit --allow-empty -m "chore: avatars storage bucket created in Supabase dashboard"
```

---

### Task 16: Session 1 smoke test

**Step 1: Start Expo Go**

```bash
cd apps/mobile && npx expo start
```

**Step 2: Manual test checklist**

- [ ] App opens on welcome screen
- [ ] Magic link email is sent and link opens the app
- [ ] Onboarding step 1: username availability check works (300ms debounce)
- [ ] Onboarding step 2: can select up to 8 interests, 9th is disabled
- [ ] Onboarding step 3: photo picker opens, skip works
- [ ] Onboarding step 4: selecting Dating enables is_dating_mode in DB
- [ ] Tapping "Meet Roxy" navigates to Grow tab
- [ ] Grow tab shows Roxy greeting card with text (or loading shimmer)
- [ ] DEV button visible at bottom-left (hot pink)
- [ ] Dev panel opens, shows AI PAUSED
- [ ] Toggling AI to LIVE and back works
- [ ] "Clear greeting cache" then reload fetches new greeting

**Step 3: Run all unit tests**

```bash
npm run test:ci
```

Expected: all tests pass.

**Step 4: Final Session 1 commit**

```bash
git add .
git commit -m "feat: Session 1 complete — auth, onboarding, Grow tab, dev guardrails"
```

---

---

# SESSION 2 — Connect Tab + Speed Dating Game

> **Full detail follows the same pattern as Session 1.**
> Each task: write test → run failing → implement → run passing → commit.

---

### Task 1: Migrations 002 + 003

**Files:**
- Create: `supabase/migrations/002_communities_social.sql`
- Create: `supabase/migrations/003_connect_dating.sql`

**Migration 002:**

```sql
-- supabase/migrations/002_communities_social.sql
CREATE TABLE communities (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name           text NOT NULL,
  slug           text UNIQUE NOT NULL,
  description    text,
  cover_image_url text,
  category       text CHECK (category IN ('identity','interest','location','support')),
  is_private     boolean DEFAULT false,
  member_count   int DEFAULT 0,
  created_by     uuid REFERENCES profiles(id),
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE communities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "communities_read_public" ON communities FOR SELECT USING (NOT is_private);
CREATE POLICY "communities_insert_auth" ON communities FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE community_members (
  community_id uuid REFERENCES communities(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES profiles(id) ON DELETE CASCADE,
  role         text DEFAULT 'member' CHECK (role IN ('member','moderator','admin')),
  joined_at    timestamptz DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);

ALTER TABLE community_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cm_read_own" ON community_members FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "cm_insert_own" ON community_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cm_delete_own" ON community_members FOR DELETE USING (auth.uid() = user_id);

-- Auto increment/decrement member_count
CREATE OR REPLACE FUNCTION update_member_count() RETURNS TRIGGER LANGUAGE plpgsql AS $$
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

CREATE TABLE friendships (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  requester_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  addressee_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  status       text DEFAULT 'pending' CHECK (status IN ('pending','accepted','blocked')),
  created_at   timestamptz DEFAULT now(),
  UNIQUE (requester_id, addressee_id)
);

ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "friendships_own" ON friendships FOR ALL USING (auth.uid() IN (requester_id, addressee_id));

CREATE INDEX idx_friendships_addressee ON friendships (addressee_id, status);
```

**Migration 003:**

```sql
-- supabase/migrations/003_connect_dating.sql
CREATE TABLE conversations (
  id                           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  participant_ids              uuid[] NOT NULL,
  conversation_type            text DEFAULT 'direct' CHECK (conversation_type IN ('direct','speed_date','sister')),
  last_message_at              timestamptz,
  roxy_nudge_count             int DEFAULT 0,
  roxy_wingwoman_count_today   int DEFAULT 0,
  last_roxy_call_date          date,
  created_at                   timestamptz DEFAULT now()
);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conversations_participant" ON conversations
  FOR ALL USING (auth.uid() = ANY(participant_ids));

CREATE TABLE messages (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  content         text,
  media_url       text,
  message_type    text DEFAULT 'text' CHECK (message_type IN ('text','image','voice','roxy_suggestion')),
  is_read         boolean DEFAULT false,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "messages_participant" ON messages FOR ALL USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = conversation_id AND auth.uid() = ANY(c.participant_ids)
  )
);

CREATE INDEX idx_messages_conv_time ON messages (conversation_id, created_at DESC);

-- Auto-update conversations.last_message_at on new message
CREATE OR REPLACE FUNCTION update_conversation_last_message() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER messages_update_conversation
  AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION update_conversation_last_message();

CREATE TABLE speed_date_sessions (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  community_id    uuid REFERENCES communities(id),
  scheduled_at    timestamptz NOT NULL,
  duration_seconds int DEFAULT 300,
  participant_ids  uuid[] DEFAULT '{}',
  status          text DEFAULT 'scheduled' CHECK (status IN ('scheduled','active','completed')),
  daily_room_url  text,
  prompts         text[] DEFAULT '{}',
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE speed_date_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sds_read_participant" ON speed_date_sessions FOR SELECT USING (
  auth.uid() = ANY(participant_ids) OR array_length(participant_ids, 1) IS NULL
);
CREATE POLICY "sds_insert_auth" ON speed_date_sessions FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "sds_update_participant" ON speed_date_sessions FOR UPDATE USING (auth.uid() = ANY(participant_ids));

CREATE TABLE matches (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_a_id      uuid REFERENCES profiles(id) ON DELETE CASCADE,
  user_b_id      uuid REFERENCES profiles(id) ON DELETE CASCADE,
  matched_at     timestamptz DEFAULT now(),
  source         text CHECK (source IN ('speed_date','discover','community')),
  conversation_id uuid REFERENCES conversations(id),
  UNIQUE (user_a_id, user_b_id)
);

ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "matches_own" ON matches FOR ALL USING (auth.uid() IN (user_a_id, user_b_id));
```

```bash
npx supabase db push --project-ref YOUR_PROJECT_REF
git add supabase/migrations/
git commit -m "feat: migrations 002+003 — communities, social graph, conversations, messages, speed dating"
```

---

### Task 2: roxy-icebreaker + roxy-wingwoman edge functions

*(Both follow the same `callClaude` + rate limit + mock pattern established in Session 1.)*

**roxy-icebreaker** (`supabase/functions/roxy-icebreaker/index.ts`):
- Input: `{ conversation_id }`
- Rate limit: 1 per conversation lifetime (check `ai_call_log` by conversation_id)
- On success: INSERT message with `message_type: 'roxy_suggestion'` into conversation
- Mock: `"What's a skill you've always wanted to learn?"`
- Deploy + commit

**roxy-wingwoman** (`supabase/functions/roxy-wingwoman/index.ts`):
- Input: `{ conversation_id }`
- Rate limit: 5 per conversation per calendar day (`roxy_wingwoman_count_today`)
- Fetch last 10 messages as context
- On success: return suggestion text (don't INSERT — user chooses to send it)
- Mock: `"That sounds really interesting — tell me more!"`
- Deploy + commit

---

### Task 3: useRealtime hook

**Files:**
- Create: `apps/mobile/hooks/useRealtime.ts`
- Test: `apps/mobile/__tests__/hooks/useRealtime.test.ts`

Subscribe to messages by `conversation_id`, conversations by `participant_ids`, matches. Return `unsubscribe` on unmount. Test that subscription is called with correct filter.

---

### Task 4: Connect tab — conversation list

**File:** `apps/mobile/app/(tabs)/connect/index.tsx`

- Fetch conversations WHERE `participant_ids` contains current user, sorted by `last_message_at DESC`
- Show: other participant's avatar + name, last message preview (50 chars), timestamp, unread indicator
- Dating mode toggle in header (heart icon → updates `profiles.is_dating_mode`)
- Tap row → navigate to `connect/chat/[id]`
- FAB: compose new DM (search users by username)
- Realtime subscription for new conversations

---

### Task 5: Chat screen `[id].tsx`

**File:** `apps/mobile/app/(tabs)/connect/chat/[id].tsx`

- FlashList of messages, inverted
- `roxy_suggestion` type: pink bubble, "Suggested by Roxy" label
- Input bar: text field + image picker icon + Roxy wand button
- Wand button: calls `roxy-wingwoman`, shows suggestion above input, user taps to send
- Icebreaker banner at top if zero messages (calls `roxy-icebreaker` on first render)
- Read receipts: mark `is_read = true` when screen focused
- Realtime subscription

---

### Task 6: Daily.co integration

**File:** `apps/mobile/lib/daily.ts`

```typescript
// apps/mobile/lib/daily.ts
import Daily from '@daily-co/react-native-daily-js';

export async function createDailyRoom(sessionId: string): Promise<string> {
  // Call your Daily REST API via a Supabase Edge Function
  // Returns room URL
  const response = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/create-daily-room`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ session_id: sessionId }),
  });
  const { data } = await response.json();
  return data.url;
}
```

Also create `supabase/functions/create-daily-room/index.ts`:
- Verify JWT
- POST to `https://api.daily.co/v1/rooms` with `DAILY_API_KEY`
- Set `exp` to `session.scheduled_at + duration_seconds + 300` (5 min buffer)
- Return room URL
- Update `speed_date_sessions.daily_room_url`
- Deploy + set `DAILY_API_KEY` secret

---

### Task 7: Speed Dating — Lobby screen

**File:** `apps/mobile/app/(tabs)/connect/speed-dating/index.tsx`

- Fetch `speed_date_sessions` WHERE `status = 'scheduled'` AND `scheduled_at > now()`
- Cards: community name, time, participant count, duration
- "Join" button: check camera + mic permissions → create/join Daily room → navigate to session screen
- Empty state: "No speed dates scheduled. Check community events."
- Dev panel "Seed test session" button feeds this list

---

### Task 8: Speed Dating — In-session screen

**File:** `apps/mobile/app/(tabs)/connect/speed-dating/session.tsx`

```typescript
// Key structure — implement fully:
// - DailyVideo component from @daily-co/react-native-daily-js
// - Timer countdown (useEffect + setInterval, clears on unmount)
// - Color shift: green (>60s) → yellow (30-60s) → red (<30s)
// - Prompt overlay: semi-transparent View over video
//   - Text from session.prompts[promptIndex]
//   - "Next →" button increments promptIndex (wraps around)
//   - Draggable via PanGestureHandler + Animated.View from Reanimated
//   - Minimise button: collapses to small Roxy dot, tap to expand
// - Small self-view (PiP) bottom-left
// - Like button bottom-right
// - On timer zero: call leaveMeeting(), navigate to result screen
// - On like: INSERT into a session_likes table (or local state for MVP)
//   Mutual like check: if other participant also liked → create match
```

---

### Task 9: Speed Dating — Result screen

**File:** `apps/mobile/app/(tabs)/connect/speed-dating/result.tsx`

- Receive `matched: boolean`, `matchedUserId?: string` as route params
- If matched: celebration UI, "Open chat" CTA → navigate to `connect/chat/[conversationId]`
- If not: "Keep exploring" → back to lobby

---

### Task 10: Weekly prompt generation cron

**File:** `supabase/functions/speed-date-prompts/index.ts`

- Triggered by Supabase pg_cron (set up in dashboard: `0 9 * * 1` = every Monday 9am)
- Fetches all `speed_date_sessions` with `status = 'scheduled'` AND empty `prompts`
- For each: calls `callClaude` with the batch prompt (see design doc)
- Updates `speed_date_sessions.prompts`
- If AI paused: uses `DEV_MOCK_PROMPTS` from constants
- Deploy + set up cron in Supabase dashboard

---

### Task 11: Session 2 smoke test + commit

```bash
npm run test:ci
# Manual: test DM flow, icebreaker, wingwoman button
# Manual: seed test session → join → see Daily.co video + Roxy overlay
# Manual: Next prompt cycles through array
# Manual: drag overlay to reposition
git commit -m "feat: Session 2 complete — Connect tab, DMs, Speed Dating with Daily.co + Roxy overlay"
```

---

---

# SESSION 3 — Discover Tab + Build Tab

---

### Task 1: Migrations 004 + 005

```sql
-- 004_content_feed.sql: posts, events tables (full schema from design doc)
-- 005_build_tab.sql: businesses, impact_projects tables
```
RLS: posts readable if user is community member. Events readable publicly.

---

### Task 2: roxy-onboarding edge function (already built Session 1)

Wire onboarding result to Grow tab zones 2-4 in this session.

---

### Task 3: Discover tab — Feed surface

**File:** `apps/mobile/app/(tabs)/discover/index.tsx`

- Segmented control: Feed | Events
- Feed: FlashList of posts from user's communities, sorted by `created_at DESC`
- Post card: avatar, display name, community tag, content text, media images, reaction row
- Reactions: heart / laugh / fire / pride flag — tap increments `reaction_counts[key]` in DB
- Comment count tap → opens bottom sheet with comments
- FAB: compose new post (community selector + text + image)
- If `is_dating_mode`: dating profile cards injected every 8 posts
- Community discovery section at the bottom

---

### Task 4: Discover tab — Events surface

- List + calendar toggle
- Event card: cover image, title, community, date/time, attendee count, RSVP button
- RSVP: `INCREMENT attendee_count`, track in local state

---

### Task 5: Build tab

**File:** `apps/mobile/app/(tabs)/build/index.tsx`

- Section A: Business Directory — grid, search input, category filter chips, verified badge
- Section B: Impact Projects — list, progress bar, "Support this" button
- "List my business" form → INSERT into businesses
- "Start a project" form → INSERT into impact_projects
- Tagline: "Roxy does not take a cut. This directory is for the community, by the community."

---

### Task 6: Wire Grow tab zones 2–4

- Zone 2 (Communities): fetch `community_members` for current user → communities list, horizontal scroll
- Zone 3 (People): fetch accepted `friendships`, show presence dot (last_seen_at < 5min)
- Zone 4 (Progress): fetch `user_badge_progress` — show badge closest to completion + progress bar
- Collapse/expand chevron behaviour for all three zones

---

### Task 7: Session 3 smoke test + commit

```bash
npm run test:ci
git commit -m "feat: Session 3 complete — Discover feed+events, Build tab, Grow tab fully wired"
```

---

---

# SESSION 4 — Roxy AI Complete + Gamification + Safety

---

### Task 1: Migration 006

```sql
-- 006_gamification_safety.sql
-- badges, user_badge_progress, reports, blocked_users
-- grant_badge_if_earned() PL/pgSQL function
-- Triggers on posts, friendships, speed_date_sessions, businesses INSERT
```

---

### Task 2: Remaining edge functions

- `roxy-nudge`: 48h silence detection, 3-lifetime limit, last 3 messages as context
- `roxy-sister`: mental health companion, turn counter, crisis resources at turn 7, full directory at turn 10, session log (turn counts only, NO message content)
- `content-moderation`: Claude flags hate_speech/violence/self_harm, sets `is_flagged`, rejects post if hate/violence
- `send-notification`: fetch push_token, check `notification_preferences`, send via OneSignal API

---

### Task 3: Sister Button screen

**File:** `apps/mobile/app/(tabs)/connect/sister-button/index.tsx`

Full lavender UI. Turn counter "Turn N of 10". Professional directory at turn 10. Emergency button (`tel:999`) always visible at bottom.

---

### Task 4: Badge system UI

- Badge grid in Profile screen
- Progress bars in Grow tab Zone 4
- Toast notification when badge earned

---

### Task 5: Safety systems

- Block: three-dot menu on every profile → INSERT blocked_users → RLS filter all queries bidirectionally
- Report: reason picker sheet → INSERT reports → offer to auto-block → confirmation
- Ghost mode toggle in Settings → sets `is_ghost = true` → filtered from public queries
- Message requests inbox: messages from non-friends go to separate list, content hidden until accepted
- New user 24h DM grace period: check `profiles.created_at + 24h` before allowing DM from stranger

---

### Task 6: Push notifications

- Request permission after onboarding, store token in `profiles.push_token`
- Subscribe to match events, message events, badge grants → call `send-notification`
- OneSignal tags: `identity_labels`, `dating_mode`, community memberships

---

### Task 7: Session 4 smoke test + commit

```bash
npm run test:ci
git commit -m "feat: Session 4 complete — all Roxy AI, gamification, safety systems, push notifications"
```

---

---

# SESSION 5 — Profile, Settings, GDPR & Deploy

---

### Task 1: Profile screen

- Own profile: avatar (edit tap → image picker), display_name, @username, pronouns chips, bio (280 char limit), stats row, badge grid
- Other profile: Add Friend / Message / Like (dating mode) / Report (three-dot menu)
- Edit profile form: bio, display name, pronouns, identity labels

---

### Task 2: Settings screen

All sections from design doc: account, privacy, notifications, safety, about, sign out.

---

### Task 3: GDPR

- Soft delete: `is_active = false`, 30-day grace, reactivation available
- Hard delete: after 30 days, delete profile row (cascades via ON DELETE CASCADE)
- Data export: Edge Function `user-data-export` generates JSON of all user rows
- Confirmation email via Supabase Auth email templates

---

### Task 4: eas.json + CI

```json
// eas.json
{
  "cli": { "version": ">= 7.0.0" },
  "build": {
    "preview": {
      "distribution": "internal",
      "ios": { "simulator": false },
      "android": { "buildType": "apk" }
    },
    "production": {
      "ios": { "resourceClass": "m-medium" },
      "android": { "buildType": "app-bundle" }
    }
  },
  "submit": {
    "production": {}
  }
}
```

`.github/workflows/ci.yml`:
- Trigger: push to main + PRs
- Jobs: lint → unit-test → edge-fn-test → expo export --platform web

---

### Task 5: Pre-launch checklist verification

Work through every item in the design doc checklist. Each item gets a commit confirming it's verified.

---

### Task 6: Final commit

```bash
npm run test:ci
git add .
git commit -m "feat: Session 5 complete — profile, settings, GDPR, EAS, CI — Roxy v1.0 ready to ship"
```

---

## Notes for all sessions

- **Every edge function** calls `isAiEnabled()` first. No exceptions.
- **Every new table** gets RLS enabled + policies in the same migration file.
- **Commit after every task**, not at the end of sessions.
- **Dev Panel** is always available in `__DEV__` builds — use it to toggle AI, seed data, clear caches.
- **`claude-haiku-4-5-20251001`** is the only Claude model used. Never use Opus or Sonnet — cost control.
- Speed dating prompts are **always pre-generated** and stored in DB. The in-session screen never calls Claude.
