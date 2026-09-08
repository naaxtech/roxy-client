import { supabase } from './supabase';

/**
 * Raise-hand in an audio room.
 *
 * The prototype's labels are `Raise hand to speak` / `Hand raised — in queue`
 * (behaviour 1834). The write is defensive: `room_hands` may not exist on a
 * given environment yet, and a failed write must still leave the button in
 * the raised state locally so the branch can ship before the migration lands.
 */

export function handLabel(raised: boolean): string {
  return raised ? 'Hand raised — in queue' : 'Raise hand to speak';
}

export async function setRoomHand(
  roomId: string,
  userId: string,
  raised: boolean,
): Promise<'saved' | 'local'> {
  try {
    if (raised) {
      const { error } = await supabase.from('room_hands').upsert({
        room_id: roomId,
        user_id: userId,
        raised_at: new Date().toISOString(),
      });
      return error ? 'local' : 'saved';
    }

    const { error } = await supabase
      .from('room_hands')
      .delete()
      .eq('room_id', roomId)
      .eq('user_id', userId);
    return error ? 'local' : 'saved';
  } catch {
    return 'local';
  }
}
