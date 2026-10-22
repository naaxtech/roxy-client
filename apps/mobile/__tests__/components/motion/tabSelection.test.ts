/**
 * The tab the navigator has just committed (jank audit #3/F4 follow-up).
 *
 * TabFade used to learn about a tab switch from React Navigation's 'state'
 * event, which arrives AFTER the commit that shows the new tab, behind that
 * tab's own effects: the screencast at 4x CPU showed 4 frames (~65 ms) of
 * bare ground before the fade even started. The tab bar host renders in the
 * same commit as the navigator, so it publishes the selected route key here
 * in a layout effect; subscribers re-render before the browser paints.
 */
import { tabSelection, useCommittedTabKey } from '../../../components/motion/tabSelection';
import { act, renderHook } from '@testing-library/react-native';

afterEach(() => act(() => tabSelection.publish(null)));

describe('tabSelection', () => {
  it('starts empty and holds the last published key', () => {
    expect(tabSelection.get()).toBeNull();
    tabSelection.publish('discover-1');
    expect(tabSelection.get()).toBe('discover-1');
  });

  it('re-renders subscribers when the key changes, not when it is published again', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useCommittedTabKey();
    });
    expect(result.current).toBeNull();
    act(() => tabSelection.publish('feed-1'));
    expect(result.current).toBe('feed-1');
    const after = renders;
    act(() => tabSelection.publish('feed-1'));
    expect(renders).toBe(after);
  });
});
