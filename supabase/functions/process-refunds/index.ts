// supabase/functions/process-refunds/index.ts
import { getSupabaseClient } from '../_shared/auth.ts';
import { successResponse, errorResponse } from '../_shared/errorHandler.ts';
import Stripe from 'npm:stripe@14';

const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  // Service-role only — reject everything else
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.includes(SERVICE_ROLE_KEY)) {
    return errorResponse('Forbidden', 403);
  }

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient() });
  const supabase = getSupabaseClient();

  // Fetch up to 50 rows needing refund that haven't been processed yet
  const { data: rows } = await supabase
    .from('payment_logs')
    .select('id, payment_intent_id, stripe_refund_id')
    .eq('needs_refund', true)
    .is('stripe_refund_id', null)
    .limit(50);

  if (!rows || rows.length === 0) {
    return successResponse({ processed: 0, failed: 0, skipped: 0 });
  }

  let processed = 0;
  let failed = 0;

  // Process in batches of 10
  for (let i = 0; i < rows.length; i += 10) {
    const batch = rows.slice(i, i + 10);
    await Promise.all(
      batch.map(async (row: any) => {
        // Double-check idempotency — skip if already has refund id
        if (row.stripe_refund_id) { return; }

        try {
          const refund = await stripe.refunds.create(
            { payment_intent: row.payment_intent_id },
            { idempotencyKey: `refund:${row.payment_intent_id}` },
          );
          await supabase
            .from('payment_logs')
            .update({
              stripe_refund_id: refund.id,
              status: 'refunded',
              needs_refund: false,
              refund_error: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', row.id);
          processed++;
        } catch (err: any) {
          const errorCode = err?.raw?.code ?? err?.message ?? 'unknown';
          await supabase
            .from('payment_logs')
            .update({ refund_error: errorCode, updated_at: new Date().toISOString() })
            .eq('id', row.id);
          console.error(`Refund failed for payment_log ${row.id}:`, errorCode);
          failed++;
        }
      }),
    );
  }

  return successResponse({ processed, failed, skipped: rows.length - processed - failed });
});
