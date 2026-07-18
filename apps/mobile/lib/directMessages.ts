import { supabase } from './supabase';
import { Analytics } from './analytics';

async function findDirectConversation(userId: string, partnerId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('conversations')
    .select('id')
    .contains('participant_ids', [userId, partnerId])
    .eq('conversation_type', 'direct')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

/** Find or create the 1:1 conversation between two users. Returns the conversation id. */
export async function openDirectChat(userId: string, partnerId: string): Promise<string> {
  const existing = await findDirectConversation(userId, partnerId);
  if (existing) {
    Analytics.dmOpened(existing);
    return existing;
  }

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({ participant_ids: [userId, partnerId], conversation_type: 'direct' })
    .select('id')
    .single();

  if (error) {
    // 23505: another session won the create race (unique index from migration
    // 058) — the conversation exists now, so return it instead of failing.
    if ((error as { code?: string }).code === '23505') {
      const raced = await findDirectConversation(userId, partnerId);
      if (raced) {
        Analytics.dmOpened(raced);
        return raced;
      }
    }
    throw error;
  }

  Analytics.dmCreated();
  return created.id;
}
