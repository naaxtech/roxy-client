import { createClient } from '@/lib/supabase/server';
import { FeatureRequestsClient } from './FeatureRequestsClient';

export const metadata = { title: 'Feature Requests — Roxy Studio' };

export default async function FeatureRequestsPage() {
  const supabase = await createClient();
  const { data: features } = await supabase
    .from('feature_requests')
    .select('id, title, description, type, status, vote_count, created_at, created_by')
    .order('vote_count', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Feature Requests</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Community-pitched ideas and Roxy team picks — sorted by votes.
        </p>
      </div>
      <FeatureRequestsClient initialFeatures={features ?? []} />
    </div>
  );
}
