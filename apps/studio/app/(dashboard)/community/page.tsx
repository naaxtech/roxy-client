import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';

export default async function CommunityPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return null;

  const { data: memberRows } = await supabase
    .from('community_members')
    .select('communities(id, name, description, member_count), role')
    .eq('user_id', userId)
    .eq('role', 'admin');

  const communities = (memberRows ?? []).map((r: any) => ({
    ...r.communities,
    role: r.role,
  }));

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Community</h1>
        <p className="text-muted-foreground mt-1">Communities you manage.</p>
      </div>

      {communities.length === 0 ? (
        <p className="text-muted-foreground text-sm">You are not an admin of any community.</p>
      ) : (
        <ul className="space-y-4">
          {communities.map((c: any) => (
            <li key={c.id} className="border rounded-lg p-6 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{c.name}</h2>
                <Badge variant="outline">{c.member_count ?? 0} members</Badge>
              </div>
              {c.description && (
                <p className="text-sm text-muted-foreground">{c.description}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
