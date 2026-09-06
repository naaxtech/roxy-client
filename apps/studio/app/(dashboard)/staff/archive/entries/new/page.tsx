import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ArchiveEntryForm } from '../ArchiveEntryForm';

export const dynamic = 'force-dynamic';

export default async function NewArchiveEntryPage() {
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

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/staff/archive/entries" className="hover:underline">
            Archive entries
          </Link>
        </p>
        <h1 className="text-2xl font-bold mt-1">Add an Archive entry</h1>
        <p className="text-muted-foreground mt-1 max-w-prose">
          This goes live as soon as you save, unless you set the status to pending or hidden.
          You can add more photos after it exists.
        </p>
      </div>
      <ArchiveEntryForm />
    </div>
  );
}
