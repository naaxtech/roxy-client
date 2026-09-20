import { createClient } from '@/lib/supabase/server';
import { isMissingFunction } from '@/lib/schema-availability';
import { feedbackReporterName } from '@/lib/feedbackReply';
import { FeedbackClient, type Feedback } from './FeedbackClient';

export const metadata = { title: 'Feedback — Roxy Studio' };

interface FeedbackRow {
  id: string;
  user_id: string;
  category: Feedback['category'];
  rating: number | null;
  message: string;
  screen_context: string | null;
  app_version: string | null;
  platform: string | null;
  status: Feedback['status'];
  internal_notes: string | null;
  created_at: string;
  profiles: { display_name: string | null; username: string | null } | null;
}

export default async function FeedbackPage() {
  const supabase = await createClient();
  const { data: feedback } = await supabase
    .from('app_feedback')
    .select(
      'id, user_id, category, rating, message, screen_context, app_version, platform, status, internal_notes, created_at, profiles(display_name, username)',
    )
    .order('created_at', { ascending: false })
    .limit(200);

  const rows = (feedback ?? []) as unknown as FeedbackRow[];
  const userIds = [...new Set(rows.map((row) => row.user_id))];

  const emails = new Map<string, string>();
  if (userIds.length > 0) {
    const contacts = await supabase.rpc('staff_feedback_contacts', { p_user_ids: userIds });
    if (!isMissingFunction(contacts.error) && contacts.data) {
      for (const row of contacts.data as { user_id: string; email: string | null }[]) {
        if (row.email) emails.set(row.user_id, row.email);
      }
    }
  }

  const initialFeedback: Feedback[] = rows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    category: row.category,
    rating: row.rating,
    message: row.message,
    screen_context: row.screen_context,
    app_version: row.app_version,
    platform: row.platform,
    status: row.status,
    internal_notes: row.internal_notes,
    created_at: row.created_at,
    reporterName: feedbackReporterName(row.profiles?.display_name, row.profiles?.username),
    reporterEmail: emails.get(row.user_id) ?? null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Feedback</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Bug reports and &quot;something&apos;s broken&quot; submissions from the app — not feature ideas (see Feature Requests).
        </p>
      </div>
      <FeedbackClient initialFeedback={initialFeedback} />
    </div>
  );
}
