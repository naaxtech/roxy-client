import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/Sidebar';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims) {
    redirect('/auth/login');
  }

  const userId = data.claims.sub as string;
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_staff')
    .eq('id', userId)
    .single();
  const isStaff = profile?.is_staff === true;

  return (
    <div className="flex min-h-screen">
      <Sidebar isStaff={isStaff} />
      <main className="flex-1 p-8 overflow-auto">{children}</main>
    </div>
  );
}
