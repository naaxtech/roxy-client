import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { RetryEmailButton } from './RetryEmailButton';

export default async function StaffEmailQueuePage() {
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

  const { data: deadLetters } = await supabase
    .from('email_queue')
    .select('id, email_type, recipient_type, retry_count, last_error, created_at, payload')
    .eq('status', 'dead_letter')
    .order('created_at', { ascending: false })
    .limit(100);

  const emails = deadLetters ?? [];

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Email Queue</h1>
        {emails.length > 0 && (
          <Badge variant="destructive">{emails.length}</Badge>
        )}
      </div>
      <p className="text-muted-foreground -mt-4">Dead-letter emails that have exhausted retries.</p>

      {emails.length === 0 ? (
        <p className="text-sm text-muted-foreground">No dead-letter emails. All clear.</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="border-b">
                <th className="text-left px-4 py-2.5 font-medium">Type</th>
                <th className="text-left px-4 py-2.5 font-medium">Recipient</th>
                <th className="text-center px-4 py-2.5 font-medium">Retries</th>
                <th className="text-left px-4 py-2.5 font-medium">Last Error</th>
                <th className="text-left px-4 py-2.5 font-medium">Created</th>
                <th className="text-right px-4 py-2.5 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {emails.map(email => (
                <tr key={email.id} className="hover:bg-muted/30 align-top">
                  <td className="px-4 py-3">
                    <Badge variant="secondary" className="text-xs">
                      {email.email_type}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {email.recipient_type}
                    {(email.payload as any)?.business_name && (
                      <span className="ml-1 text-foreground">
                        — {(email.payload as any).business_name}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums text-muted-foreground">
                    {email.retry_count ?? 0}
                  </td>
                  <td className="px-4 py-3 max-w-[200px]">
                    <p className="text-xs text-destructive line-clamp-2">
                      {email.last_error ?? '—'}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(email.created_at).toLocaleDateString('en-US', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <RetryEmailButton emailId={email.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
