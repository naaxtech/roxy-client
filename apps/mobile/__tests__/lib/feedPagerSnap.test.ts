import {
  clampPageIndex,
  pageStepFromDrag,
  pageStepFromWheel,
  snapPageOffset,
} from '../../lib/feedPagerSnap';

describe('snapPageOffset', () => {
  it('snaps a rest offset to the page it is already on', () => {
    expect(snapPageOffset(0, 836, 5)).toBe(0);
    expect(snapPageOffset(1672, 836, 5)).toBe(1672);
  });

  it('snaps a stuck-between-pages offset to the nearer page', () => {
    // 1400 sits between page 1 (836) and page 2 (1672). TikTok never rests here.
    expect(snapPageOffset(1400, 836, 5)).toBe(1672);
    expect(snapPageOffset(932, 836, 5)).toBe(836);
  });

  it('clamps past the last page and above the first', () => {
    expect(snapPageOffset(99999, 836, 3)).toBe(1672);
    expect(snapPageOffset(-80, 836, 3)).toBe(0);
  });

  it('returns 0 before the page has been measured', () => {
    expect(snapPageOffset(400, 0, 4)).toBe(0);
  });
});

describe('pageStepFromWheel', () => {
  it('turns a downward wheel into the next page', () => {
    expect(pageStepFromWheel(120)).toBe(1);
  });

  it('turns an upward wheel into the previous page', () => {
    expect(pageStepFromWheel(-120)).toBe(-1);
  });

  it('ignores a residual tick so a trackpad does not skip pages', () => {
    expect(pageStepFromWheel(2)).toBe(0);
    expect(pageStepFromWheel(-2)).toBe(0);
  });
});

describe('pageStepFromDrag', () => {
  it('pages forward when the finger swipes up', () => {
    expect(pageStepFromDrag(620, 140)).toBe(1);
  });

  it('pages backward when the finger swipes down', () => {
    expect(pageStepFromDrag(180, 700)).toBe(-1);
  });

  it('treats a tap as no page so a like can fire', () => {
    expect(pageStepFromDrag(400, 406)).toBe(0);
  });
});

describe('clampPageIndex', () => {
  it('stays inside the list', () => {
    expect(clampPageIndex(-1, 5)).toBe(0);
    expect(clampPageIndex(9, 5)).toBe(4);
    expect(clampPageIndex(2, 5)).toBe(2);
  });

  it('returns 0 for an empty list', () => {
    expect(clampPageIndex(3, 0)).toBe(0);
  });
});
