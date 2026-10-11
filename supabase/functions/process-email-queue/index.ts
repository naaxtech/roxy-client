// supabase/functions/process-email-queue/index.ts
import { handleCors } from '../_shared/cors.ts';
import { getSupabaseClient } from '../_shared/auth.ts';
import { errorResponse, successResponse } from '../_shared/errorHandler.ts';
import { isServiceRequest } from '../_shared/serviceAuth.ts';
import { renderTemplate } from '../_shared/emailTemplates.ts';
import { denoEnv, resolveEmailSender, resolveStudioUrl } from '../_shared/emailConfig.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
// Sender: Roxy <noreply@roxyhq.com>, replies to hello@roxyhq.com (EMAIL_FROM /
// EMAIL_REPLY_TO override). The old sender domain is retired.
const SENDER = resolveEmailSender(denoEnv);

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
    body: JSON.stringify({ from: SENDER.from, reply_to: SENDER.replyTo, to, subject, html }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.id as string;
}

// Templates live in _shared/emailTemplates.ts (pure, unit-tested). G-01: the
// inline switch that was here had no application_* cases, so every decision
// email threw "Unknown email type" and was dead-lettered.
const STUDIO_URL = resolveStudioUrl(denoEnv);

Deno.serve(async (req) => {
  const corsRes = handleCors(req);
  if (corsRes) return corsRes;

  // Exact `Bearer <service key>`, constant time, empty env => reject.
  // (Was `!== \`Bearer ${key}\``: an unset key made `Bearer undefined` pass.)
  if (!isServiceRequest(req)) {
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

      const { subject, html } = renderTemplate(row.email_type, row.payload, { studioUrl: STUDIO_URL });
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
