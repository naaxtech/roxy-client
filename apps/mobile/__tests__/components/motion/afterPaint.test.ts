import { afterPaint } from '../../../components/motion/afterPaint';

/**
 * `afterPaint` is how a tap shows its feedback before heavy work starts: the
 * work must run after the frame that carries the feedback, never inside it.
 */
describe('afterPaint', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('waits for the next frame AND the task after it (the paint lands in between)', () => {
    const order: string[] = [];
    const raf = jest.spyOn(global, 'requestAnimationFrame');
    afterPaint(() => order.push('work'));
    expect(order).toEqual([]);
    expect(raf).toHaveBeenCalledTimes(1);

    // The frame callback alone (before paint) must not run the work.
    const frame = raf.mock.calls[0][0];
    frame(0);
    expect(order).toEqual([]);

    jest.runOnlyPendingTimers();
    expect(order).toEqual(['work']);
    raf.mockRestore();
  });

  it('a cancelled call never runs (the bar unmounted, or a newer tap took over)', () => {
    const work = jest.fn();
    const cancel = afterPaint(work);
    cancel();
    jest.runAllTimers();
    expect(work).not.toHaveBeenCalled();
  });

  it('cancelling after the frame but before the task still stops it', () => {
    const work = jest.fn();
    const raf = jest.spyOn(global, 'requestAnimationFrame');
    const cancel = afterPaint(work);
    raf.mock.calls[0][0](0);
    cancel();
    jest.runAllTimers();
    expect(work).not.toHaveBeenCalled();
    raf.mockRestore();
  });
});
