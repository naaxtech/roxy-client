import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (!userId) return null;

  const { data: stripeAccount } = await supabase
    .from('host_stripe_accounts')
    .select('stripe_account_id, onboarding_complete')
    .eq('user_id', userId)
    .maybeSingle();

  const { data: memberRows } = await supabase
    .from('community_members')
    .select('communities(id, name)')
    .eq('user_id', userId)
    .eq('role', 'admin');

  const communityIds = (memberRows ?? [])
    .map((r: any) => r.communities?.id)
    .filter(Boolean);

  const { count: upcomingCount } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .in('community_id', communityIds.length ? communityIds : ['none'])
    .gte('starts_at', new Date().toISOString());

  const stripeIncomplete = stripeAccount && !stripeAccount.onboarding_complete;
  const stripeNotStarted = !stripeAccount;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Welcome back.</p>
      </div>

      {stripeNotStarted && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 flex items-center justify-between">
          <p className="text-yellow-800 text-sm font-medium">
            Connect Stripe to enable paid events
          </p>
          <Link href="/settings" className="text-sm underline text-yellow-700">
            Go to Settings →
          </Link>
        </div>
      )}
      {stripeIncomplete && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 flex items-center justify-between">
          <p className="text-yellow-800 text-sm font-medium">
            Stripe setup incomplete — paid events locked
          </p>
          <Link href="/settings" className="text-sm underline text-yellow-700">
            Resume Setup →
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Communities
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{memberRows?.length ?? 0}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Upcoming Events
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{upcomingCount ?? 0}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Stripe Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={stripeAccount?.onboarding_complete ? 'default' : 'secondary'}>
              {stripeAccount?.onboarding_complete
                ? 'Connected'
                : stripeAccount
                  ? 'Incomplete'
                  : 'Not connected'}
            </Badge>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
