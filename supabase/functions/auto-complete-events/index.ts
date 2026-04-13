// supabase/functions/auto-complete-events/index.ts
import { getSupabaseClient } from '../_shared/auth.ts';
import { successResponse, errorResponse } from '../_shared/errorHandler.ts';

const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.includes(SERVICE_ROLE_KEY)) {
    return errorResponse('Forbidden', 403);
  }

  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('events')
    .update({ status: 'completed' })
    .eq('status', 'active')
    .eq('is_paid', true)
    .not('ends_at', 'is', null)
    .lt('ends_at', new Date().toISOString())
    .eq('payout_blocked', false)
    .select('id');

  if (error) {
    console.error('auto-complete-events error:', error);
    return errorResponse('Failed to auto-complete events', 500);
  }

  return successResponse({ completed: data?.length ?? 0 });
});
