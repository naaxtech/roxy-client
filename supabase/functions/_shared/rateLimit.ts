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
