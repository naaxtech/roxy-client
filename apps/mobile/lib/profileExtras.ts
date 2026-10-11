import { supabase } from './supabase';
import { logError } from './errorLogger';

/**
 * Profile prompts (133 §9a) and the Archive top-four shelf (133 §9b).
 * Reads RESOLVE with what is visible (RLS withholds across a block and from
 * unapproved viewers); writes REJECT when nothing landed.
 */

export const PROMPTS = [
  { key: 'comfort_show', label: 'My comfort show is…' },
  { key: 'ask_me_about', label: 'Ask me about…' },
  { key: 'perfect_sunday', label: 'My perfect Sunday…' },
  { key: 'currently_obsessed', label: 'Currently obsessed with…' },
  { key: 'green_flag', label: 'A green flag for me is…' },
  { key: 'find_me_at', label: 'Find me at…' },
] as const;

export type PromptKey = (typeof PROMPTS)[number]['key'];
export type PromptAnswer = { prompt_key: PromptKey; answer: string };

/** The DB CHECK is 1..150 trimmed. */
export const PROMPT_MAX = 150;
/** Shown on a profile; the editor lets her keep up to this many. */
export const PROMPT_LIMIT = 3;

export function promptLabel(key: string): string {
  return PROMPTS.find((p) => p.key === key)?.label ?? key;
}

export async function fetchProfilePrompts(userId: string): Promise<PromptAnswer[]> {
  try {
    return await readPrompts(userId);
  } catch (e) {
    // A courtesy section: a failure renders nothing, never the screen's error.
    logError(e, 'profileExtras.fetchPrompts');
    return [];
  }
}

async function readPrompts(userId: string): Promise<PromptAnswer[]> {
  const { data, error } = await supabase
    .from('profile_prompts')
    .select('prompt_key, answer, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: true });
  if (error) {
    logError(error, 'profileExtras.fetchPrompts');
    return [];
  }
  return ((data ?? []) as PromptAnswer[]).filter((r) => PROMPTS.some((p) => p.key === r.prompt_key));
}

export async function savePromptAnswer(userId: string, key: PromptKey, answer: string): Promise<void> {
  const text = answer.trim().slice(0, PROMPT_MAX);
  if (!text) {
    const { error } = await supabase.from('profile_prompts').delete().eq('user_id', userId).eq('prompt_key', key);
    if (error) { logError(error, 'profileExtras.clearPrompt'); throw new Error('prompt-failed'); }
    return;
  }
  const { data, error } = await supabase
    .from('profile_prompts')
    .upsert({ user_id: userId, prompt_key: key, answer: text, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,prompt_key' })
    .select('prompt_key')
    .maybeSingle();
  if (error || !data) {
    if (error) logError(error, 'profileExtras.savePrompt');
    throw new Error('prompt-failed');
  }
}

export type ShelfEntry = { slot: number; id: string; slug: string; title: string; media_type: string; cover_gradient: string | null };

export async function fetchArchiveShelf(userId: string): Promise<ShelfEntry[]> {
  try {
    return await readShelf(userId);
  } catch (e) {
    logError(e, 'profileExtras.fetchShelf');
    return [];
  }
}

async function readShelf(userId: string): Promise<ShelfEntry[]> {
  const { data, error } = await supabase
    .from('archive_shelf')
    .select('slot, entry:archive_entries!archive_shelf_entry_id_fkey(id, slug, title, media_type, cover_gradient)')
    .eq('profile_id', userId)
    .order('slot', { ascending: true });
  if (error) {
    logError(error, 'profileExtras.fetchShelf');
    return [];
  }
  return ((data ?? []) as unknown as { slot: number; entry: Omit<ShelfEntry, 'slot'> | null }[])
    .filter((r) => !!r.entry)
    .map((r) => ({ slot: r.slot, ...(r.entry as Omit<ShelfEntry, 'slot'>) }));
}

/** Replace her whole shelf (max four, in order) — one statement server-side. */
export async function setArchiveShelf(entryIds: string[]): Promise<void> {
  const { error } = await supabase.rpc('set_archive_shelf', { p_entry_ids: entryIds.slice(0, 4) });
  if (error) {
    logError(error, 'profileExtras.setShelf');
    throw new Error('shelf-failed');
  }
}
