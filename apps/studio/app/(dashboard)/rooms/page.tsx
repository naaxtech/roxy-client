import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { RoomsClient } from './RoomsClient';

export default async function RoomsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  // Get communities where the user is admin or moderator
  const { data: memberships } = await supabase
    .from('community_members')
    .select('community_id, communities(id, name)')
    .eq('user_id', user.id)
    .in('role', ['admin', 'moderator']);

  const communities = (memberships ?? [])
    .map(m => {
      const c = m.communities as unknown as { id: string; name: string } | null;
      return c;
    })
    .filter((c): c is { id: string; name: string } => c != null);

  const communityIds = communities.map(c => c.id);

  let rooms: any[] = [];
  if (communityIds.length > 0) {
    const { data } = await supabase
      .from('community_rooms')
      .select(`
        id, name, description, room_type, status,
        participant_count, max_participants,
        scheduled_at, started_at, community_id,
        communities(name)
      `)
      .in('community_id', communityIds)
      .order('created_at', { ascending: false });

    rooms = (data ?? []).map((r: any) => ({
      ...r,
      community_name: (r.communities as any)?.name ?? '',
    }));
  }

  if (communities.length === 0) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">Rooms</h1>
        <p className="text-muted-foreground">
          You need to be an admin or moderator of a community to manage rooms.{' '}
          <a href="/community" className="text-primary underline-offset-4 hover:underline">
            Go to Community.
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <RoomsClient rooms={rooms} communities={communities} />
    </div>
  );
}
