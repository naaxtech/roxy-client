import { handLabel, setRoomHand } from '../../lib/roomHands';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

import { supabase } from '../../lib/supabase';

/**
 * Raise-hand in an audio room.
 *
 * The prototype's button is `Raise hand to speak` / `Hand raised — in queue`
 * (behaviour 1834). The `room_hands` table may not exist yet, so a failed
 * write must still leave the button in the raised state locally — otherwise
 * the branch cannot ship until a migration lands, which is how raise-hand
 * stayed unbuilt.
 */

describe('handLabel', () => {
  it('says the queue when it is up, and the ask when it is not', () => {
    expect(handLabel(false)).toBe('Raise hand to speak');
    expect(handLabel(true)).toBe('Hand raised — in queue');
  });
});

describe('setRoomHand', () => {
  beforeEach(() => {
    (supabase.from as jest.Mock).mockReset();
  });

  it('reports saved when the write lands', async () => {
    const chain = {
      upsert: jest.fn().mockResolvedValue({ error: null }),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
    };
    (supabase.from as jest.Mock).mockReturnValue(chain);
    await expect(setRoomHand('r1', 'u1', true)).resolves.toBe('saved');
    expect(supabase.from).toHaveBeenCalledWith('room_hands');
  });

  it('falls back to local when the table is not there yet', async () => {
    (supabase.from as jest.Mock).mockReturnValue({
      upsert: jest.fn().mockResolvedValue({ error: { message: 'relation room_hands does not exist', code: '42P01' } }),
    });
    await expect(setRoomHand('r1', 'u1', true)).resolves.toBe('local');
  });
});
