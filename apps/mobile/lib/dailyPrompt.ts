import AsyncStorage from '@react-native-async-storage/async-storage';
import { logError } from './errorLogger';

/**
 * Question of the day, as a page in For You (audit "loved product" #4).
 *
 * Most of what women post on Roxy is already words (27 of 42 posts at the
 * audit), and the hardest post is the one with nothing to say yet. A question
 * hands her the first line: one tap opens the composer with the question on
 * the card, and her answer becomes the quieter line under it.
 *
 * A static local list on purpose — no table, no round trip, nothing to
 * moderate. Everyone gets the same question on the same calendar day, so the
 * answers that land in For You are a conversation, not noise. Questions are
 * warm and low-stakes: nothing that asks her to out herself, name an ex, or
 * say where she lives.
 */
export const DAILY_PROMPTS: readonly string[] = [
  'What song would play when you walk into a room?',
  'What is your comfort show, and why that one?',
  'Which queer book or film found you at the right time?',
  'What is the best date you have ever been on?',
  'What tiny thing made you smile this week?',
  'What would your perfect slow Sunday look like?',
  'What is a hill you will happily die on?',
  'Who is a woman you admire, and what did she teach you?',
  'What is the best thing in your fridge right now?',
  'What hobby would you start if time were free?',
  'What is your go-to karaoke song?',
  'What is the kindest thing a stranger has done for you?',
  'Which fictional character would you take to dinner?',
  'What is something you are proud of this year?',
  'What is your love language, honestly?',
  'What is your favourite way to spend a rainy day?',
  'What is a small ritual that keeps you sane?',
  'Which album could you play front to back forever?',
  'What would you tell your younger self?',
  'What is the most you ever laughed at a party?',
  'What is your green flag in a friend?',
];

/** The card's kick line. All caps and short, so `parseTextCard` reads it as a kick. */
export const DAILY_PROMPT_KICK = 'QUESTION OF THE DAY';

const ID_PREFIX = 'daily-prompt-';
const ANSWERED_PREFIX = 'roxy.dailyPromptAnswered.';

export type DailyPrompt = {
  /** Pager key. Never a post id: posts are uuids. */
  id: string;
  /** Local calendar day, `YYYY-MM-DD`. */
  dateKey: string;
  /** Index into `DAILY_PROMPTS`; travels to the composer as a route param. */
  index: number;
  question: string;
  kind: 'daily_prompt';
};

function localDateKey(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Whole local days since 1970, so the question turns over at her midnight. */
function localDayNumber(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

/** Today's question. The list is walked in order, so it never repeats until it wraps. */
export function dailyPromptFor(now: Date = new Date()): DailyPrompt {
  const n = DAILY_PROMPTS.length;
  const index = ((localDayNumber(now) % n) + n) % n;
  const dateKey = localDateKey(now);
  return { id: `${ID_PREFIX}${dateKey}`, dateKey, index, question: DAILY_PROMPTS[index], kind: 'daily_prompt' };
}

export function isDailyPromptItem(item: unknown): item is DailyPrompt {
  return !!item && typeof item === 'object' && (item as { kind?: unknown }).kind === 'daily_prompt';
}

/** For callers that only hold the pager key (e.g. "mark this page seen"). */
export function isDailyPromptId(id: string): boolean {
  return id.startsWith(ID_PREFIX);
}

/**
 * The page sits third: the first thing she sees is the community, not a
 * question about herself, and one swipe later the question meets her. A short
 * feed puts it last; an empty feed keeps its own empty state.
 */
export const DAILY_PROMPT_SLOT = 2;

export function withDailyPrompt<T>(rows: T[], prompt: DailyPrompt): (T | DailyPrompt)[] {
  if (rows.length === 0) return rows;
  const at = Math.min(DAILY_PROMPT_SLOT, rows.length);
  return [...rows.slice(0, at), prompt, ...rows.slice(at)];
}

/** What the composer opens with: the kick, the question, and a fresh line for her. */
export function dailyPromptDraft(question: string): string {
  return `${DAILY_PROMPT_KICK}\n${question}\n`;
}

/** True while the draft is still only the question — there is nothing of hers to post. */
export function isUnansweredDraft(content: string, question: string | null): boolean {
  if (!question) return false;
  return content.trim() === dailyPromptDraft(question).trim();
}

/**
 * The composer's `prompt` route param back to a question. Only an exact
 * in-range index counts: a param is anything a link can carry, and arbitrary
 * text must never become words on her card.
 */
export function dailyPromptFromParam(param: string | string[] | undefined): string | null {
  const raw = Array.isArray(param) ? param[0] : param;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const i = Number(raw);
  return i < DAILY_PROMPTS.length ? DAILY_PROMPTS[i] : null;
}

function answeredKey(userId: string, dateKey: string): string {
  return `${ANSWERED_PREFIX}${userId}.${dateKey}`;
}

/** Once she has answered today, For You stops asking. Per member, per day. */
export async function hasAnsweredDailyPrompt(userId: string, dateKey: string): Promise<boolean> {
  if (!userId) return false;
  try {
    return (await AsyncStorage.getItem(answeredKey(userId, dateKey))) !== null;
  } catch (e) {
    logError(e, 'dailyPrompt.read');
    return false;
  }
}

export async function markDailyPromptAnswered(userId: string, dateKey: string): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(answeredKey(userId, dateKey), '1');
  } catch (e) {
    // The post is live either way; at worst the question comes back on her next
    // cold start today. This session still drops it, below.
    logError(e, 'dailyPrompt.write');
  }
  for (const fn of Array.from(answeredListeners)) {
    try { fn(userId, dateKey); } catch (e) { logError(e, 'dailyPrompt.listener'); }
  }
}

type AnsweredListener = (userId: string, dateKey: string) => void;
const answeredListeners = new Set<AnsweredListener>();

/**
 * The Feed tab stays mounted while she answers in the composer; this is how it
 * hears that the question is done, so the page is gone when she swipes back.
 */
export function onDailyPromptAnswered(fn: AnsweredListener): () => void {
  answeredListeners.add(fn);
  return () => { answeredListeners.delete(fn); };
}
