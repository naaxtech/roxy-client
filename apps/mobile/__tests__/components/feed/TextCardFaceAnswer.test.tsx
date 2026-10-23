/**
 * An answer to the question of the day, on the card. Her words are the
 * headline; the question sits above them as the quieter line that says what
 * she is answering. Before (2026-10-23) the question was the headline and her
 * answer the small grey line under it, so her post read as Roxy's question.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

import { TextCardFace } from '../../../components/feed/TextCardFace';
import { QUESTION_KICK, textCardScale } from '../../../lib/textCard';

const Q = 'Which queer book or film found you at the right time?';
const A = 'Gilmore Girls, every autumn. It feels like a warm blanket.';

describe('TextCardFace — answer card', () => {
  it('leads with her answer; the question is the quieter line above it', () => {
    const v = render(<TextCardFace content={`${QUESTION_KICK}\n${Q}\n${A}`} testIDPrefix="c" />);

    expect(v.getByTestId('c-kick')).toBeTruthy();
    expect(v.getByTestId('c-question').props.children).toBe(Q);
    expect(v.getByTestId('c-prompt').props.children).toBe(A);
    expect(v.queryByTestId('c-sub')).toBeNull();

    const question = StyleSheet.flatten(v.getByTestId('c-question').props.style);
    const answer = StyleSheet.flatten(v.getByTestId('c-prompt').props.style);
    expect(answer.fontSize).toBe(textCardScale(A.length).fontSize);
    expect(question.fontSize).toBeLessThan(answer.fontSize as number);

    // Reading order: question, then her answer.
    const json = JSON.stringify(v.toJSON());
    expect(json.indexOf('"c-question"')).toBeLessThan(json.indexOf('"c-prompt"'));
  });

  it('a profile tile shows her answer, not the same question on every tile', () => {
    const v = render(<TextCardFace content={`${QUESTION_KICK}\n${Q}\n${A}`} size="tile" testIDPrefix="t" />);
    expect(v.getByTestId('t-prompt').props.children).toBe(A);
    expect(v.queryByTestId('t-question')).toBeNull();
  });

  it('while she has not typed yet, the composer preview holds a faint place for her answer', () => {
    const v = render(
      <TextCardFace content={`${QUESTION_KICK}\n${Q}\n`} size="preview" answerPlaceholder="Your answer" testIDPrefix="p" />,
    );
    expect(v.getByTestId('p-question').props.children).toBe(Q);
    expect(v.getByTestId('p-answer-placeholder').props.children).toBe('Your answer');
    expect(v.queryByTestId('p-prompt')).toBeNull();
  });

  it('the For You question page itself keeps the question as its headline', () => {
    const v = render(<TextCardFace content={`${QUESTION_KICK}\n${Q}`} testIDPrefix="d" />);
    expect(v.getByTestId('d-prompt').props.children).toBe(Q);
    expect(v.queryByTestId('d-question')).toBeNull();
  });
});
