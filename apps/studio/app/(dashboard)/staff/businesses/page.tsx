import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { ApproveBusinessButton, RejectBusinessButton } from './BusinessApprovalClient';

export default async function StaffBusinessesPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) notFound();

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_staff')
    .eq('id', userId)
    .single();
  if (!profile?.is_staff) notFound();

  // Pending businesses: not yet verified, not rejected (no rejection reason)
  const { data: pending } = await supabase
    .from('businesses')
    .select('id, name, category, location_city, is_wlw_owned, created_at, owner_id, profiles(display_name), business_rejection_reason')
    .eq('is_verified', false)
    .is('business_rejection_reason', null)
    .order('created_at', { ascending: true });

  // Already rejected (for reference)
  const { data: rejected } = await supabase
    .from('businesses')
    .select('id, name, category, created_at, business_rejection_reason, profiles(display_name)')
    .eq('is_verified', false)
    .not('business_rejection_reason', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20);

  const pendingList = pending ?? [];
  const rejectedList = rejected ?? [];

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-3">
          Business Applications
          {pendingList.length > 0 && (
            <Badge variant="destructive">{pendingList.length}</Badge>
          )}
        </h1>
        <p className="text-muted-foreground mt-1">
          Review and approve business profiles. Approved businesses receive a confirmation email and can list products in Roxy.
        </p>
      </div>

      {/* Pending */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Pending Review</h2>
        {pendingList.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending applications.</p>
        ) : (
          <div className="space-y-3">
            {pendingList.map(biz => (
              <div key={biz.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold">{biz.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {(biz.profiles as any)?.display_name ?? 'Unknown owner'}
                      {biz.category && <> · {biz.category}</>}
                      {biz.location_city && <> · {biz.location_city}</>}
                    </p>
                    {biz.is_wlw_owned && (
                      <Badge variant="secondary" className="mt-1 text-xs">WLW-owned</Badge>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      Applied {new Date(biz.created_at).toLocaleDateString('en-US', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <ApproveBusinessButton businessId={biz.id} />
                    <RejectBusinessButton businessId={biz.id} businessName={biz.name} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Rejected */}
      {rejectedList.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-muted-foreground">Recently Rejected</h2>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="border-b">
                  <th className="text-left px-4 py-2.5 font-medium">Business</th>
                  <th className="text-left px-4 py-2.5 font-medium">Reason</th>
                  <th className="text-left px-4 py-2.5 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rejectedList.map(biz => (
                  <tr key={biz.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <p className="font-medium">{biz.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(biz.profiles as any)?.display_name}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-[240px]">
                      {biz.business_rejection_reason}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(biz.created_at).toLocaleDateString('en-US', {
                        day: 'numeric', month: 'short',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
