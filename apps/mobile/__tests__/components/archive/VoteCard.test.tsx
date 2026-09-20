import { render, fireEvent } from '@testing-library/react-native';
import { Text, StyleSheet } from 'react-native';
import { VoteCard } from '../../../components/archive/VoteCard';
import { THEMES } from '../../../lib/theme';
import { MIN_TOUCH_TARGET } from '../../../lib/touchTargets';
import { useThemeStore } from '../../../store/themeStore';

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, string | number>;

afterEach(() => useThemeStore.setState({ theme: 'dark' }));

describe('VoteCard', () => {
  it('asks her to rate out of 5 stars', () => {
    const v = render(<VoteCard myStars={null} onRate={jest.fn()} />);
    expect(v.getByText('Seen it? Rate it out of 5.')).toBeTruthy();
  });

  it('calls back with the star she tapped', () => {
    const onRate = jest.fn();
    const v = render(<VoteCard myStars={null} onRate={onRate} testID="v" />);
    fireEvent.press(v.getByTestId('v-star-4'));
    expect(onRate).toHaveBeenCalledWith(4);
  });

  it('marks every star up to her rating as selected', () => {
    const v = render(<VoteCard myStars={3} onRate={jest.fn()} testID="v" />);
    expect(v.getByTestId('v-star-1').props['aria-selected']).toBe(true);
    expect(v.getByTestId('v-star-3').props['aria-selected']).toBe(true);
    expect(v.getByTestId('v-star-4').props['aria-selected']).toBe(false);
  });

  it('sizes each star to the touch-target floor', () => {
    const v = render(<VoteCard myStars={null} onRate={jest.fn()} testID="v" />);
    expect(flat(v.getByTestId('v-star-1')).minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    expect(flat(v.getByTestId('v-star-5')).minWidth).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });

  it('shows a review comment box when she is allowed to write one', () => {
    const onCommentChange = jest.fn();
    const v = render(
      <VoteCard
        myStars={5}
        onRate={jest.fn()}
        canComment
        comment="Loved it"
        onCommentChange={onCommentChange}
        onSubmitComment={jest.fn()}
        testID="v"
      />,
    );
    expect(v.getByTestId('v-comment')).toBeTruthy();
    fireEvent.changeText(v.getByTestId('v-comment'), 'The gloves scene.');
    expect(onCommentChange).toHaveBeenCalledWith('The gloves scene.');
  });

  it('hides the comment box while she cannot write a review', () => {
    const v = render(
      <VoteCard myStars={4} onRate={jest.fn()} canComment={false} testID="v" />,
    );
    expect(v.queryByTestId('v-comment')).toBeNull();
    expect(v.queryByTestId('v-review-submit')).toBeNull();
  });

  it('publishes the comment when she submits', () => {
    const onSubmitComment = jest.fn();
    const v = render(
      <VoteCard
        myStars={5}
        onRate={jest.fn()}
        canComment
        comment="Loved it"
        onCommentChange={jest.fn()}
        onSubmitComment={onSubmitComment}
        testID="v"
      />,
    );
    fireEvent.press(v.getByTestId('v-review-submit'));
    expect(onSubmitComment).toHaveBeenCalledTimes(1);
  });

  it('resolves in the light theme', () => {
    useThemeStore.setState({ theme: 'light' });
    const v = render(<VoteCard myStars={null} onRate={jest.fn()} testID="v" />);
    expect(flat(v.getByTestId('v')).backgroundColor).toBe(THEMES.light.surface);
  });

  it('hosts the row of secondary actions the entry screen puts in this card', () => {
    const v = render(
      <VoteCard myStars={null} onRate={jest.fn()} footer={<Text>+ Watchlist</Text>} />,
    );
    expect(v.getByText('+ Watchlist')).toBeTruthy();
  });

  /**
   * "0 star to 5 stars exactly."
   *
   * The scale ran 1..5 with no way back. Once she had tapped anything, the
   * lowest thing she could say about a work was one star — and a rating cast by
   * accident could never be taken back, only moved. A rating control that
   * cannot return to unrated is not a 0..5 scale; it is a 1..5 scale with a
   * trap door.
   */
  it('clears the rating when she taps the star she already chose', () => {
    const onRate = jest.fn();
    const v = render(
      <VoteCard myStars={3} onRate={onRate} testID="vote" />,
    );
    fireEvent.press(v.getByTestId('vote-star-3'));
    expect(onRate).toHaveBeenCalledWith(0);
  });

  it('still sets a different star normally', () => {
    const onRate = jest.fn();
    const v = render(
      <VoteCard myStars={3} onRate={onRate} testID="vote" />,
    );
    fireEvent.press(v.getByTestId('vote-star-5'));
    expect(onRate).toHaveBeenCalledWith(5);
  });

  it('tapping one star while unrated sets one star, never clears', () => {
    const onRate = jest.fn();
    const v = render(
      <VoteCard myStars={null} onRate={onRate} testID="vote" />,
    );
    fireEvent.press(v.getByTestId('vote-star-1'));
    expect(onRate).toHaveBeenCalledWith(1);
  });

  it('says what she has chosen, and what tapping again will do', () => {
    // Five icons with no readout is a control that never confirms it heard you.
    const rated = render(<VoteCard myStars={4} onRate={jest.fn()} testID="vote" />);
    expect(rated.getByTestId('vote-value')).toBeTruthy();
    expect(rated.getByText(/4 of 5/)).toBeTruthy();

    const unrated = render(<VoteCard myStars={null} onRate={jest.fn()} testID="vote" />);
    expect(unrated.getByText(/Tap to rate/i)).toBeTruthy();
  });
});
