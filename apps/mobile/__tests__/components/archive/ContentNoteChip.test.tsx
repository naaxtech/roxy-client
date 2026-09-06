import { render, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ContentNoteChip, visibleNotes, NOTE_AGREEMENT_GATE } from '../../../components/archive/ContentNoteChip';
import { THEMES } from '../../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';
import { notePalette } from '../../../components/archive/archiveTokens';
import { useThemeStore } from '../../../store/themeStore';

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, string | number>;

afterEach(() => useThemeStore.setState({ theme: 'dark' }));

describe('ContentNoteChip', () => {
  it('renders the label and the agreement count', () => {
    const v = render(
      <ContentNoteChip label="On-page grief" agreeCount={12} agreed={false} index={0} onPress={jest.fn()} />
    );
    expect(v.getByText('On-page grief')).toBeTruthy();
    expect(v.getByText('12')).toBeTruthy();
  });

  it('rotates through the three palettes by index', () => {
    const c = THEMES.dark;
    const at = (index: number) => {
      const v = render(
        <ContentNoteChip label="n" agreeCount={3} agreed={false} index={index} onPress={jest.fn()} testID="chip" />
      );
      const style = flat(v.getByTestId('chip'));
      v.unmount();
      return style;
    };
    expect(at(0).backgroundColor).toBe(notePalette(c, 0, false).bg);
    expect(at(1).backgroundColor).toBe(notePalette(c, 1, false).bg);
    expect(at(2).backgroundColor).toBe(notePalette(c, 2, false).bg);
    expect(at(3).backgroundColor).toBe(notePalette(c, 0, false).bg);
  });

  it('goes pink once she has agreed, whatever slot it sat in', () => {
    const v = render(
      <ContentNoteChip label="n" agreeCount={4} agreed index={2} onPress={jest.fn()} testID="chip" />
    );
    expect(flat(v.getByTestId('chip')).backgroundColor).toBe(notePalette(THEMES.dark, 0, true).bg);
  });

  it('resolves in the light theme too', () => {
    useThemeStore.setState({ theme: 'light' });
    const v = render(
      <ContentNoteChip label="n" agreeCount={4} agreed={false} index={2} onPress={jest.fn()} testID="chip" />
    );
    expect(flat(v.getByTestId('chip')).backgroundColor).toBe(THEMES.light.surfaceLight);
  });

  it('is a checkbox that announces whether she has agreed', () => {
    const v = render(
      <ContentNoteChip label="On-page grief" agreeCount={12} agreed index={0} onPress={jest.fn()} testID="chip" />
    );
    const chip = v.getByTestId('chip');
    expect(chip.props.accessibilityRole).toBe('checkbox');
    expect(chip.props.accessibilityLabel).toBe('On-page grief, 12 members agree');
    // Bare accessibilityState renders no attribute at all on react-native-web.
    expect(chip.props['aria-checked']).toBe(true);
    expect(chip.props.accessibilityState.checked).toBe(true);
  });

  it('is tappable at the platform floor, sized not hit-slopped', () => {
    const v = render(
      <ContentNoteChip label="n" agreeCount={1} agreed={false} index={0} onPress={jest.fn()} testID="chip" />
    );
    const chip = v.getByTestId('chip');
    expect(flat(chip).minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    expect(chip.props.hitSlop).toBeUndefined();
  });

  it('calls back on press', () => {
    const onPress = jest.fn();
    const v = render(
      <ContentNoteChip label="n" agreeCount={1} agreed={false} index={0} onPress={onPress} testID="chip" />
    );
    fireEvent.press(v.getByTestId('chip'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('visibleNotes', () => {
  it('hides a note until three members agree', () => {
    expect(NOTE_AGREEMENT_GATE).toBe(3);
    const notes = [
      { id: 'a', label: 'grief', agreeCount: 3, agreed: false },
      { id: 'b', label: 'lone tag', agreeCount: 2, agreed: false },
      { id: 'c', label: 'racism', agreeCount: 40, agreed: true },
    ];
    expect(visibleNotes(notes).map((n) => n.id)).toEqual(['c', 'a']);
  });

  it('does not let her own agreement carry a note over the line on its own', () => {
    // agreeCount already includes her vote; the gate counts members, not
    // whether the tag is highlighted on her device.
    const notes = [{ id: 'a', label: 'x', agreeCount: 2, agreed: true }];
    expect(visibleNotes(notes)).toEqual([]);
  });

  it('takes a limit for the two that fit on a browse row', () => {
    const notes = [
      { id: 'a', label: 'a', agreeCount: 9, agreed: false },
      { id: 'b', label: 'b', agreeCount: 8, agreed: false },
      { id: 'c', label: 'c', agreeCount: 7, agreed: false },
    ];
    expect(visibleNotes(notes, 2).map((n) => n.id)).toEqual(['a', 'b']);
  });
});
