/**
 * Question of the day, as a For You page (audit top-10 #4).
 *
 * A static local list, so it costs no table and no round trip: the same
 * question for everyone on a given day, chosen by the date. One tap opens the
 * composer with the question already on the card; her answer goes under it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../lib/errorLogger', () => ({ logError: jest.fn() }));

import {
  DAILY_PROMPTS,
  DAILY_PROMPT_KICK,
  dailyPromptFor,
  dailyPromptDraft,
  dailyPromptFromParam,
  hasAnsweredDailyPrompt,
  isDailyPromptItem,
  isDailyPromptId,
  isUnansweredDraft,
  markDailyPromptAnswered,
  onDailyPromptAnswered,
  withDailyPrompt,
} from '../../lib/dailyPrompt';
import { parseTextCard } from '../../lib/textCard';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('dailyPromptFor', () => {
  it('is the same question all day and a different one tomorrow', () => {
    const morning = dailyPromptFor(new Date(2026, 9, 11, 7, 0));
    const night = dailyPromptFor(new Date(2026, 9, 11, 23, 30));
    const tomorrow = dailyPromptFor(new Date(2026, 9, 12, 7, 0));

    expect(night).toEqual(morning);
    expect(tomorrow.index).not.toBe(morning.index);
    expect(morning.dateKey).toBe('2026-10-11');
    expect(morning.question).toBe(DAILY_PROMPTS[morning.index]);
  });

  it('walks the whole list before repeating', () => {
    const seen = new Set<number>();
    for (let d = 0; d < DAILY_PROMPTS.length; d += 1) {
      seen.add(dailyPromptFor(new Date(2026, 0, 1 + d, 12)).index);
    }
    expect(seen.size).toBe(DAILY_PROMPTS.length);
  });

  it('carries a stable page id per day, so the pager key never collides with a post', () => {
    const p = dailyPromptFor(new Date(2026, 9, 11, 12));
    expect(p.id).toBe('daily-prompt-2026-10-11');
    expect(isDailyPromptItem(p)).toBe(true);
    expect(isDailyPromptItem({ id: 'post-1', post_type: 'standard' })).toBe(false);
    expect(isDailyPromptId(p.id)).toBe(true);
    expect(isDailyPromptId('8f0c2b6e-0000-4000-8000-000000000000')).toBe(false);
  });

  it('every question reads as a question and fits a card', () => {
    for (const q of DAILY_PROMPTS) {
      expect(q.trim()).toBe(q);
      expect(q.endsWith('?')).toBe(true);
      expect(q.length).toBeLessThanOrEqual(90);
    }
  });
});

describe('the composer draft', () => {
  it('renders as a kick + the question, with her answer as the quieter line', () => {
    const draft = dailyPromptDraft('What song is your first crush?');
    expect(parseTextCard(draft)).toEqual({
      kick: DAILY_PROMPT_KICK,
      prompt: 'What song is your first crush?',
      sub: null,
    });
    expect(parseTextCard(`${draft}Anything by Tegan and Sara`).sub).toBe('Anything by Tegan and Sara');
  });

  it('knows when she has not written an answer yet', () => {
    const q = DAILY_PROMPTS[0];
    expect(isUnansweredDraft(dailyPromptDraft(q), q)).toBe(true);
    expect(isUnansweredDraft(`${dailyPromptDraft(q)}   \n `, q)).toBe(true);
    expect(isUnansweredDraft(`${dailyPromptDraft(q)}mine`, q)).toBe(false);
    expect(isUnansweredDraft('anything', null)).toBe(false);
  });

  it('reads the route param defensively — only a real list index opens a prompt', () => {
    expect(dailyPromptFromParam('0')).toBe(DAILY_PROMPTS[0]);
    expect(dailyPromptFromParam(['1'])).toBe(DAILY_PROMPTS[1]);
    expect(dailyPromptFromParam(undefined)).toBeNull();
    expect(dailyPromptFromParam('-1')).toBeNull();
    expect(dailyPromptFromParam(String(DAILY_PROMPTS.length))).toBeNull();
    expect(dailyPromptFromParam('1.5')).toBeNull();
    expect(dailyPromptFromParam('<script>')).toBeNull();
  });
});

describe('withDailyPrompt', () => {
  const prompt = dailyPromptFor(new Date(2026, 9, 11, 12));
  const rows = ['a', 'b', 'c', 'd'].map((id) => ({ id }));

  it('slots the question in as the third page, never the first', () => {
    expect(withDailyPrompt(rows, prompt).map((r) => r.id))
      .toEqual(['a', 'b', prompt.id, 'c', 'd']);
  });

  it('goes last on a short feed, and stays out of an empty one', () => {
    expect(withDailyPrompt(rows.slice(0, 1), prompt).map((r) => r.id)).toEqual(['a', prompt.id]);
    expect(withDailyPrompt([], prompt)).toEqual([]);
  });
});

describe('answered today', () => {
  it('is remembered per member and per day', async () => {
    expect(await hasAnsweredDailyPrompt('u1', '2026-10-11')).toBe(false);
    await markDailyPromptAnswered('u1', '2026-10-11');

    expect(await hasAnsweredDailyPrompt('u1', '2026-10-11')).toBe(true);
    expect(await hasAnsweredDailyPrompt('u2', '2026-10-11')).toBe(false);
    expect(await hasAnsweredDailyPrompt('u1', '2026-10-12')).toBe(false);
  });

  it('never throws when storage fails, and treats it as unanswered', async () => {
    const spy = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    await expect(hasAnsweredDailyPrompt('u1', '2026-10-11')).resolves.toBe(false);
    spy.mockRestore();
    const set = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk'));
    await expect(markDailyPromptAnswered('u1', '2026-10-11')).resolves.toBeUndefined();
    set.mockRestore();
  });

  it('does nothing without a user id', async () => {
    await markDailyPromptAnswered('', '2026-10-11');
    expect(await hasAnsweredDailyPrompt('', '2026-10-11')).toBe(false);
  });

  it('tells a listening Feed the moment she answers, even when storage fails', async () => {
    const heard: string[] = [];
    const off = onDailyPromptAnswered((u, d) => heard.push(`${u}@${d}`));
    await markDailyPromptAnswered('u1', '2026-10-11');
    const set = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk'));
    await markDailyPromptAnswered('u1', '2026-10-12');
    set.mockRestore();
    off();
    await markDailyPromptAnswered('u1', '2026-10-13');

    expect(heard).toEqual(['u1@2026-10-11', 'u1@2026-10-12']);
  });
});
