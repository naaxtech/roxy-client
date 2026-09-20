import { hostedTabFlags } from '../../lib/profileHosted';

describe('hostedTabFlags', () => {
  it('hides every hosted tab when she has nothing upcoming', () => {
    expect(hostedTabFlags({ events: 0, rooms: 0, games: 0 })).toEqual({
      events: false, rooms: false, games: false,
    });
  });

  it('shows only the tabs that have rows — never an empty Events strip', () => {
    expect(hostedTabFlags({ events: 2, rooms: 0, games: 1 })).toEqual({
      events: true, rooms: false, games: true,
    });
  });
});
