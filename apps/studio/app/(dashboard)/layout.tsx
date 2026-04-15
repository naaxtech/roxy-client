import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AppSidebar } from '@/components/AppSidebar';
import { Header } from '@/components/Header';

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
    .select('is_staff, display_name')
    .eq('id', userId)
    .single();

  const isStaff = profile?.is_staff === true;
  const userEmail = data.claims.email as string | undefined;
  const displayName = (profile?.display_name as string | null) ?? undefined;
  const initials = displayName
    ? displayName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
    : userEmail
      ? userEmail[0].toUpperCase()
      : 'R';

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AppSidebar isStaff={isStaff} userEmail={userEmail} userInitials={initials} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
