import { createFeedPagerWebController } from '../../lib/feedPagerWeb';

function controller(overrides: {
  index?: number;
  count?: number;
  pageH?: number;
  now?: () => number;
} = {}) {
  const goToIndex = jest.fn();
  let now = 0;
  const c = createFeedPagerWebController({
    getPageH: () => overrides.pageH ?? 836,
    getCount: () => overrides.count ?? 5,
    getIndex: () => overrides.index ?? 0,
    goToIndex,
    now: overrides.now ?? (() => now),
    lockMs: 400,
  });
  return {
    goToIndex,
    advance: (ms: number) => { now += ms; },
    wheel: (deltaY: number) => {
      const preventDefault = jest.fn();
      c.onWheel({ deltaY, preventDefault } as unknown as WheelEvent);
      return preventDefault;
    },
    swipe: (startY: number, endY: number) => {
      c.onPointerDown({ clientY: startY, pointerId: 1 } as PointerEvent);
      c.onPointerUp({ clientY: endY, pointerId: 1 } as PointerEvent);
    },
    tap: (y = 400) => {
      c.onPointerDown({ clientY: y, pointerId: 1 } as PointerEvent);
      c.onPointerUp({ clientY: y + 3, pointerId: 1 } as PointerEvent);
    },
    click: () => {
      const event = {
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      };
      c.onClickCapture(event as unknown as MouseEvent);
      return event;
    },
  };
}

describe('createFeedPagerWebController — TikTok paging', () => {
  it('pages forward once per wheel burst and swallows the native pixel scroll', () => {
    const c = controller();
    const preventDefault = c.wheel(400);
    expect(preventDefault).toHaveBeenCalled();
    expect(c.goToIndex).toHaveBeenCalledWith(1);
  });

  it('does not skip pages when a trackpad keeps firing during the lock', () => {
    const c = controller();
    c.wheel(400);
    c.wheel(400);
    c.wheel(400);
    expect(c.goToIndex).toHaveBeenCalledTimes(1);
    expect(c.goToIndex).toHaveBeenCalledWith(1);
  });

  it('pages again after the lock, so a second flick is another page', () => {
    const c = controller({ index: 1 });
    c.wheel(400);
    expect(c.goToIndex).toHaveBeenCalledWith(2);
    c.advance(400);
    c.wheel(400);
    expect(c.goToIndex).toHaveBeenCalledWith(2);
    // still index 1 in the getter — second call is also 1+1
    expect(c.goToIndex).toHaveBeenCalledTimes(2);
  });

  it('pages forward on an upward swipe and swallows the click that would like', () => {
    const c = controller({ index: 0 });
    c.swipe(620, 140);
    expect(c.goToIndex).toHaveBeenCalledWith(1);
    const click = c.click();
    expect(click.stopPropagation).toHaveBeenCalled();
    expect(click.preventDefault).toHaveBeenCalled();
  });

  it('pages backward on a downward swipe', () => {
    const c = controller({ index: 2 });
    c.swipe(180, 700);
    expect(c.goToIndex).toHaveBeenCalledWith(1);
  });

  it('does not page a tap, so the like button still works', () => {
    const c = controller();
    c.tap();
    expect(c.goToIndex).not.toHaveBeenCalled();
    const click = c.click();
    expect(click.stopPropagation).not.toHaveBeenCalled();
  });

  it('does not walk off either end of the list', () => {
    const top = controller({ index: 0 });
    top.wheel(-400);
    expect(top.goToIndex).not.toHaveBeenCalled();

    const bottom = controller({ index: 4, count: 5 });
    bottom.wheel(400);
    expect(bottom.goToIndex).not.toHaveBeenCalled();
  });
});
