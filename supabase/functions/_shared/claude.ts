import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.24.0';
import { getSupabaseClient } from './auth.ts';

const anthropic = new Anthropic({
  apiKey: Deno.env.get('ANTHROPIC_API_KEY')!,
});

export async function isAiEnabled(): Promise<boolean> {
  // Check env var first (fastest path — set via supabase secrets)
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
    // dev_config doesn't exist or has no row in prod — proceed normally
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
    model: 'claude-sonnet-4-6',
    max_tokens: params.maxTokens ?? 256,
    system: params.system,
    messages: params.messages,
  });

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected Claude response type');
  return block.text;
}
