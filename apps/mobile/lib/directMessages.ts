import { supabase } from './supabase';
import { Analytics } from './analytics';

/** Find or create the 1:1 conversation between two users. Returns the conversation id. */
export async function openDirectChat(userId: string, partnerId: string): Promise<string> {
  const { data, error: searchError } = await supabase
    .from('conversations')
    .select('id')
    .contains('participant_ids', [userId, partnerId])
    .eq('conversation_type', 'direct')
    .limit(1)
    .maybeSingle();
  if (searchError) throw searchError;

  if (data) {
    Analytics.dmOpened(data.id);
    return data.id;
  }

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({ participant_ids: [userId, partnerId], conversation_type: 'direct' })
    .select('id')
    .single();
  if (error) throw error;

  Analytics.dmCreated();
  return created.id;
}
