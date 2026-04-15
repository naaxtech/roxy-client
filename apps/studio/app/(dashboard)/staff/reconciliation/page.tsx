import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { ResolveButton } from './ResolveButton';

export default async function StaffReconciliationPage() {
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

  const { data: alerts } = await supabase
    .from('reconciliation_alerts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  const alertList = alerts ?? [];
  const unresolvedCount = alertList.filter(a => !a.resolved_at).length;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Reconciliation</h1>
        {unresolvedCount > 0 && (
          <Badge variant="destructive">{unresolvedCount}</Badge>
        )}
      </div>
      <p className="text-muted-foreground -mt-4">
        Payment reconciliation alerts requiring review.
      </p>

      {alertList.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reconciliation alerts. All clear.</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="border-b">
                <th className="text-left px-4 py-2.5 font-medium">Order</th>
                <th className="text-left px-4 py-2.5 font-medium">Alert Type</th>
                <th className="text-left px-4 py-2.5 font-medium">Details</th>
                <th className="text-left px-4 py-2.5 font-medium">Created</th>
                <th className="text-left px-4 py-2.5 font-medium">Status</th>
                <th className="text-right px-4 py-2.5 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {alertList.map((alert: Record<string, unknown>) => {
                const resolved = Boolean(alert.resolved_at);
                return (
                  <tr key={String(alert.id)} className="hover:bg-muted/30 align-top">
                    <td className="px-4 py-3 font-mono text-xs">
                      {alert.order_id
                        ? `…${String(alert.order_id).slice(-8).toUpperCase()}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="text-xs">
                        {String(alert.alert_type ?? '—')}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 max-w-[260px]">
                      <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-all line-clamp-3">
                        {alert.details
                          ? JSON.stringify(alert.details, null, 2)
                          : '—'}
                      </pre>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(String(alert.created_at)).toLocaleDateString('en-US', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-3">
                      {resolved ? (
                        <Badge className="bg-green-100 text-green-800 border-green-200">
                          Resolved
                        </Badge>
                      ) : (
                        <Badge variant="destructive">Open</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!resolved && <ResolveButton alertId={String(alert.id)} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
