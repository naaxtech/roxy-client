import { createClient } from '@/lib/supabase/server';
import { FeedbackClient } from './FeedbackClient';

export const metadata = { title: 'Feedback — Roxy Studio' };

export default async function FeedbackPage() {
  const supabase = await createClient();
  const { data: feedback } = await supabase
    .from('app_feedback')
    .select('id, user_id, category, rating, message, screen_context, app_version, platform, status, internal_notes, created_at')
    .order('created_at', { ascending: false })
    .limit(200);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Feedback</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Bug reports and &quot;something&apos;s broken&quot; submissions from the app — not feature ideas (see Feature Requests).
        </p>
      </div>
      <FeedbackClient initialFeedback={feedback ?? []} />
    </div>
  );
}
