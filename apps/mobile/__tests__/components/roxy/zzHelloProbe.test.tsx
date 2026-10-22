/**
 * Scratch probe left by lane C while moving HelloRoxySheet onto reanimated
 * (untracked, never committed; lane rules forbid deleting files). Safe to
 * delete. Finding: in jest, a re-render of a reanimated component recomputes
 * its initial style from the mount-time updater, so a sample taken right after
 * a React commit can show the starting position until the next mapper run.
 * HelloRoxySheet now swaps faces by opacity (no commit mid-rise).
 */
describe.skip('zzHelloProbe (scratch, safe to delete)', () => {
  it('is empty', () => {});
});
