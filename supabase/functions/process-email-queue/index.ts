// supabase/functions/process-email-queue/index.ts
import { handleCors } from '../_shared/cors.ts';
import { getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = 'Roxy <noreply@getroxy.app>';

function backoffMinutes(retryCount: number): number {
  const schedule = [0, 2, 10, 60, 360];
  return schedule[Math.min(retryCount, schedule.length - 1)];
}

async function sendEmail(to: string, subject: string, html: string): Promise<string> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.id as string;
}

function renderTemplate(emailType: string, payload: Record<string, unknown>): { subject: string; html: string } {
  switch (emailType) {
    case 'order_shipped_buyer':
      return {
        subject: `Your order #${payload.order_short_id} has shipped!`,
        html: `<h2>Your order has shipped</h2>
               <p>Tracking: <a href="${payload.carrier_url}">${payload.tracking_number}</a></p>
               <p>${payload.items_summary}</p>`,
      };
    case 'product_approved':
      return {
        subject: `Your product "${payload.product_name}" has been approved`,
        html: `<h2>Product Approved!</h2>
               <p>"${payload.product_name}" is now live on Roxy.</p>`,
      };
    case 'product_rejected':
      return {
        subject: `Update on your product "${payload.product_name}"`,
        html: `<h2>Product Not Approved</h2>
               <p>Reason: ${payload.rejection_reason}</p>
               <p>You can edit and resubmit from Roxy Studio.</p>`,
      };
    case 'refund_notification_buyer':
      return {
        subject: `Refund processed for order #${payload.order_short_id}`,
        html: `<h2>Refund Processed</h2>
               <p>$${((payload.amount_cents as number) / 100).toFixed(2)} has been refunded for order #${payload.order_short_id}.</p>`,
      };
    case 'dispute_alert_business':
      return {
        subject: `Action required: Dispute on order #${payload.order_short_id}`,
        html: `<h2>Dispute Alert</h2>
               <p>A dispute has been opened for order #${payload.order_short_id}.</p>
               <p>Response due: ${payload.response_due_by}</p>
               <p><a href="https://roxycommunity.netlify.app/orders">View in Studio</a></p>`,
      };
    case 'business_approved':
      return {
        subject: `Congratulations! Your Roxy business profile is active`,
        html: `<h2>Welcome to Roxy Marketplace, ${payload.display_name}! 🎉</h2>
               <p>Your business <strong>${payload.business_name}</strong> has been approved and your Roxy business profile is now active.</p>
               <p>You can now log into <a href="https://roxycommunity.netlify.app">Roxy Studio</a> to:</p>
               <ul>
                 <li>Add and manage your products</li>
                 <li>Connect Stripe to receive payments</li>
                 <li>Track orders and payouts</li>
               </ul>
               <p>Welcome to the community! 💜</p>`,
      };
    case 'business_rejected':
      return {
        subject: `Update on your Roxy business application`,
        html: `<h2>Hi ${payload.display_name},</h2>
               <p>Thank you for applying to sell on Roxy. Unfortunately, we're unable to approve <strong>${payload.business_name}</strong> at this time.</p>
               <p><strong>Reason:</strong> ${payload.rejection_reason}</p>
               <p>If you believe this is an error or would like to reapply, please reach out to our team.</p>`,
      };
    default:
      throw new Error(`Unknown email type: ${emailType}`);
  }
}

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  // Require Authorization header with service role key
  const authHeader = req.headers.get('Authorization');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authHeader || authHeader !== `Bearer ${serviceRoleKey}`) {
    return errorResponse('Unauthorized', 401);
  }

  if (!RESEND_API_KEY) return errorResponse('RESEND_API_KEY not set', 500);

  const supabase = getSupabaseClient();

  // Step 1: Reset stuck rows (processing > 5 min)
  await supabase
    .from('email_queue')
    .update({
      status: 'failed',
      last_error: 'Processing timeout — reset by cron',
      processing_since: null,
    })
    .eq('status', 'processing')
    .lt('processing_since', new Date(Date.now() - 5 * 60 * 1000).toISOString());

  // Step 2: Claim batch with FOR UPDATE SKIP LOCKED via RPC
  const { data: rows, error: claimErr } = await supabase.rpc('claim_email_queue_batch', { p_limit: 10 });
  if (claimErr) return errorResponse(`Claim error: ${claimErr.message}`, 500);
  if (!rows || rows.length === 0) return successResponse({ processed: 0 });

  let processed = 0;
  for (const row of rows) {
    try {
      // Get recipient email from auth.users
      const { data: { user }, error: userErr } =
        await supabase.auth.admin.getUserById(row.recipient_user_id);
      if (userErr || !user?.email) throw new Error('Recipient email not found');

      const { subject, html } = renderTemplate(row.email_type, row.payload);
      const messageId = await sendEmail(user.email, subject, html);

      await supabase
        .from('email_queue')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          resend_message_id: messageId,
          processing_since: null,
        })
        .eq('id', row.id);

      processed++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const newRetryCount = (row.retry_count ?? 0) + 1;
      const isDeadLetter = newRetryCount >= 5;
      const nextRetry = new Date(
        Date.now() + backoffMinutes(newRetryCount) * 60 * 1000
      ).toISOString();

      await supabase
        .from('email_queue')
        .update({
          status: isDeadLetter ? 'dead_letter' : 'failed',
          retry_count: newRetryCount,
          next_retry_at: nextRetry,
          last_error: errMsg.slice(0, 500), // cap length, no PII
          processing_since: null,
        })
        .eq('id', row.id);
    }
  }

  return successResponse({ processed });
});
