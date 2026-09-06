import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isMissingColumn } from '@/lib/schema-availability';
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
  const first = await supabase
    .from('profiles')
    .select('is_staff, staff_role, display_name')
    .eq('id', userId)
    .single();

  let profile = first.data as {
    is_staff: boolean | null;
    staff_role?: string | null;
    display_name: string | null;
  } | null;

  if (isMissingColumn(first.error)) {
    const fallback = await supabase
      .from('profiles')
      .select('is_staff, display_name')
      .eq('id', userId)
      .single();
    profile = fallback.data ? { ...fallback.data, staff_role: null } : null;
  }

  const isStaff = profile?.is_staff === true;
  const isCore = profile?.staff_role === 'core';
  const userEmail = data.claims.email as string | undefined;
  const displayName = (profile?.display_name as string | null) ?? undefined;
  const initials = displayName
    ? displayName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
    : userEmail
      ? userEmail[0].toUpperCase()
      : 'R';

  return (
    // `relative` on both the shell and <main> is load-bearing, not decoration.
    // An absolutely positioned descendant with no positioned ancestor resolves its
    // containing block to the initial containing block, so it escapes BOTH the
    // shell's overflow-hidden and <main>'s overflow-y-auto and extends the document
    // instead — the page then scrolls past the 100vh shell into empty space.
    // Radix form primitives ship exactly such a node: <Checkbox> inside a <form>
    // renders a hidden bubble input with
    // `position:absolute; opacity:0; transform:translateX(-100%)`
    // (@radix-ui/react-checkbox 1.3.3), which is why /settings, /invites,
    // /applications and /products were affected. Making <main> a containing block
    // keeps such nodes clipped to the scroll container on every dashboard route.
    <div className="relative flex h-screen overflow-hidden bg-background">
      <AppSidebar isStaff={isStaff} isCore={isCore} userEmail={userEmail} userInitials={initials} />
      <div className="flex flex-1 flex-col min-h-0">
        <Header isStaff={isStaff} isCore={isCore} />
        <main className="relative flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
