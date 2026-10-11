import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { logError } from './errorLogger';
import type { Feature } from './features';

/**
 * "You're in" and her first five minutes (G-11; audit ideal flow step 9).
 *
 * The moment a reviewer says yes is the highest-intent moment she will ever
 * have in Roxy, and activation research is blunt about it: the members who
 * make a first connection in the first session are the ones who stay. So the
 * approval gets a celebration once, and then four small, tappable steps that
 * each open a screen that already exists.
 *
 * Everything here is per user AND per device: two women can share a phone,
 * and the checklist is a nudge, not a record — losing it on reinstall is fine.
 */

/** An approval older than this is history, not news: no confetti. */
export const WELCOME_WINDOW_DAYS = 14;

export const welcomeSeenKey = (userId: string) => `roxy_welcome_in_seen:${userId}`;
export const firstStepsKey = (userId: string) => `roxy_first_steps:${userId}`;

export type FirstStepId = 'say_hi' | 'follow_three' | 'dm_settings' | 'introduce';
const STEP_IDS: readonly FirstStepId[] = ['say_hi', 'follow_three', 'dm_settings', 'introduce'];

export interface FirstStep {
  id: FirstStepId;
  title: string;
  body: string;
  icon: string;
  route: string;
  a11yLabel: string;
}

export interface FirstStepsState {
  done: FirstStepId[];
  dismissed: boolean;
}

export interface AdmissionCommunity {
  id: string;
  name: string;
  slug: string | null;
}

type ApplicationDecision = { status: string; decided_at: string | null } | null | undefined;

/** Was she approved recently enough that this is news? */
export function isFreshAdmission(app: ApplicationDecision, now: Date = new Date()): boolean {
  if (!app || app.status !== 'approved' || !app.decided_at) return false;
  const decided = Date.parse(app.decided_at);
  if (Number.isNaN(decided)) return false;
  return now.getTime() - decided <= WELCOME_WINDOW_DAYS * 86_400_000;
}

/**
 * Should the root layout send this member to the "You're in" screen?
 *
 * Exactly once per user per device: the seen flag is checked first, so after
 * the first greeting this never touches the network again. Only a FRESH
 * approval qualifies — her own application row (not profiles.admitted_at,
 * which the grandfathering in 130 stamps on every pre-gate member). Any read
 * failure fails quiet: a missed party is better than a member stuck on it.
 */
export async function shouldGreetNewMember(userId: string, now: Date = new Date()): Promise<boolean> {
  try {
    if (await AsyncStorage.getItem(welcomeSeenKey(userId))) return false;
    const { data, error } = await supabase
      .from('membership_applications')
      .select('status, decided_at')
      .eq('auth_user_id', userId)
      .maybeSingle();
    if (error) {
      logError(error, 'welcomeIn.shouldGreet');
      return false;
    }
    return isFreshAdmission(data as ApplicationDecision, now);
  } catch (e) {
    logError(e, 'welcomeIn.shouldGreet');
    return false;
  }
}

export async function markWelcomeSeen(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(welcomeSeenKey(userId), new Date().toISOString());
  } catch (e) {
    logError(e, 'welcomeIn.markSeen');
  }
}

const EMPTY: FirstStepsState = { done: [], dismissed: false };

export async function loadFirstSteps(userId: string): Promise<FirstStepsState> {
  try {
    const raw = await AsyncStorage.getItem(firstStepsKey(userId));
    if (!raw) return { ...EMPTY, done: [] };
    const parsed = JSON.parse(raw) as Partial<FirstStepsState>;
    const done = Array.isArray(parsed.done)
      ? parsed.done.filter((id): id is FirstStepId => STEP_IDS.includes(id as FirstStepId))
      : [];
    return { done, dismissed: parsed.dismissed === true };
  } catch {
    // A corrupted value is a fresh checklist, never a crash on her first screen.
    return { ...EMPTY, done: [] };
  }
}

async function saveFirstSteps(userId: string, state: FirstStepsState): Promise<void> {
  try {
    await AsyncStorage.setItem(firstStepsKey(userId), JSON.stringify(state));
  } catch (e) {
    logError(e, 'welcomeIn.saveFirstSteps');
  }
}

export async function markStepDone(userId: string, id: FirstStepId): Promise<FirstStepsState> {
  const state = await loadFirstSteps(userId);
  if (!state.done.includes(id)) state.done = [...state.done, id];
  await saveFirstSteps(userId, state);
  return state;
}

export async function dismissFirstSteps(userId: string): Promise<FirstStepsState> {
  const state = await loadFirstSteps(userId);
  const next = { ...state, dismissed: true };
  await saveFirstSteps(userId, next);
  return next;
}

/**
 * The community whose code let her in: her application's community_id (the
 * server copies it from the code at redemption — 130 redeem_invite_code), so
 * this works without reading invite_codes, which members cannot.
 */
export async function fetchAdmissionCommunity(userId: string): Promise<AdmissionCommunity | null> {
  try {
    const { data: app, error } = await supabase
      .from('membership_applications')
      .select('community_id')
      .eq('auth_user_id', userId)
      .maybeSingle();
    if (error) {
      logError(error, 'welcomeIn.admissionCommunity');
      return null;
    }
    const communityId = (app as { community_id?: string | null } | null)?.community_id;
    if (!communityId) return null;
    const { data: community, error: cErr } = await supabase
      .from('communities')
      .select('id, name, slug')
      .eq('id', communityId)
      .maybeSingle();
    if (cErr) {
      logError(cErr, 'welcomeIn.admissionCommunity');
      return null;
    }
    return (community as AdmissionCommunity | null) ?? null;
  } catch (e) {
    logError(e, 'welcomeIn.admissionCommunity');
    return null;
  }
}

/**
 * The four steps, each pointing at a screen that already exists. A step her
 * access cannot open (limited launch tiers) is left out rather than shown and
 * then walled by ComingSoon — that is a dead button with extra steps.
 */
export function buildFirstSteps(opts: {
  community: AdmissionCommunity | null;
  /** Roxy Official — the say-hi room when her own community is not open to her tier yet. */
  official?: AdmissionCommunity | null;
  can: (feature: Feature) => boolean;
  canCommunity: (slug?: string | null) => boolean;
}): FirstStep[] {
  const { community, official = null, can, canCommunity } = opts;
  const steps: FirstStep[] = [];

  // The reviewer joined her to this community at approval (130 _apply_decision);
  // this step is to walk in and say hi, which is where first replies come from.
  if (community && canCommunity(community.slug)) {
    steps.push({
      id: 'say_hi',
      title: `Say hi in ${community.name}`,
      body: "You're already a member. Pop in and wave — they said yes to you.",
      icon: 'chatbubbles-outline',
      route: `/community/${community.id}`,
      a11yLabel: `Open ${community.name} and say hi`,
    });
  } else if (official && can('officialChat')) {
    // Limited launch: the public tier has Roxy Official chat and the Archive.
    steps.push({
      id: 'say_hi',
      title: `Say hi in ${official.name}`,
      body: 'Everyone new starts here. Wave — someone always waves back.',
      icon: 'chatbubbles-outline',
      route: `/community/channels/${official.id}`,
      a11yLabel: `Open ${official.name} chat and say hi`,
    });
  }
  if (can('discover')) {
    steps.push({
      id: 'follow_three',
      title: 'Follow three women',
      body: 'Start with the members everyone keeps talking about.',
      icon: 'people-outline',
      route: '/(tabs)/discover',
      a11yLabel: 'Find three members to follow',
    });
  }
  steps.push({
    id: 'dm_settings',
    title: 'Choose who can message you',
    body: 'Messages start as requests. You decide who gets through — and block or report lives on every chat.',
    icon: 'shield-checkmark-outline',
    route: '/(tabs)/you/settings',
    a11yLabel: 'Choose who can message you',
  });
  if (can('create')) {
    steps.push({
      id: 'introduce',
      title: 'Introduce yourself',
      body: 'A few lines about you. Who you are, what brought you here.',
      icon: 'sparkles-outline',
      route: '/community/create-post',
      a11yLabel: 'Write a post introducing yourself',
    });
  }
  return steps;
}
