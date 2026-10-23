import {
  parseAnswerCard,
  parseTextCard,
  QUESTION_KICK,
  textCardHeadline,
  textCardScale,
  TEXT_CARD_EXAMPLE,
  TEXT_CARD_EXAMPLE_BODY,
  TEXT_CARD_GRADIENT,
} from '../../lib/textCard';

describe('parseTextCard — the prototype composition, not a caption blob', () => {
  it('keeps a single line as the headline', () => {
    expect(parseTextCard('we made it.')).toEqual({
      kick: null, prompt: 'we made it.', sub: null,
    });
  });

  it('splits the London prompt the way Claude Design draws p3', () => {
    const parsed = parseTextCard(
      `${TEXT_CARD_EXAMPLE.prompt}\nBest answer gets pinned to the community board`,
    );
    expect(parsed.kick).toBeNull();
    expect(parsed.prompt).toBe(TEXT_CARD_EXAMPLE.prompt);
    expect(parsed.sub).toBe('Best answer gets pinned to the community board');
  });

  it('reads an all-caps first line as the kick pill', () => {
    expect(parseTextCard(TEXT_CARD_EXAMPLE_BODY)).toEqual({
      kick: TEXT_CARD_EXAMPLE.kick,
      prompt: TEXT_CARD_EXAMPLE.prompt,
      sub: TEXT_CARD_EXAMPLE.sub,
    });
  });

  it('does not treat a short shout as a kick when it is the only line', () => {
    expect(parseTextCard('WE MADE IT.')).toEqual({
      kick: null, prompt: 'WE MADE IT.', sub: null,
    });
  });

  it('does not steal a question as a kick', () => {
    expect(parseTextCard("WHAT'S YOUR SPOT?\nTell me.")).toEqual({
      kick: null,
      prompt: "WHAT'S YOUR SPOT?",
      sub: 'Tell me.',
    });
  });
});

describe('textCardScale', () => {
  it('uses the prototype 34px step for a short headline', () => {
    const style = textCardScale(TEXT_CARD_EXAMPLE.prompt.length);
    expect(style.fontSize).toBe(34);
    expect(style.fontWeight).toBe('800');
  });

  it('steps down so a long prompt still fits', () => {
    expect(textCardScale(20).fontSize).toBeGreaterThan(textCardScale(120).fontSize as number);
    expect(textCardScale(120).fontSize).toBeGreaterThan(textCardScale(400).fontSize as number);
  });
});

// Question of the day (2026-10-23, Nicole: "responding to a question post is
// weird and awkward"). Her answer is the headline of her post; the question is
// the quieter line that says what she is answering. Stored text is unchanged
// (kick, question, answer), so answers already posted read the new way too.
describe('parseAnswerCard — her answer to the question of the day', () => {
  const q = 'Which queer book or film found you at the right time?';

  it('splits kick, question and her answer', () => {
    expect(parseAnswerCard(`${QUESTION_KICK}\n${q}\nGilmore Girls, every autumn.`)).toEqual({
      kick: QUESTION_KICK, question: q, answer: 'Gilmore Girls, every autumn.',
    });
  });

  it('keeps a multi-line answer whole', () => {
    expect(parseAnswerCard(`${QUESTION_KICK}\n${q}\nCarol.\nThe train scene.`)?.answer)
      .toBe('Carol.\nThe train scene.');
  });

  it('reads the bare question as an answer card with no answer yet', () => {
    expect(parseAnswerCard(`${QUESTION_KICK}\n${q}\n`)).toEqual({ kick: QUESTION_KICK, question: q, answer: '' });
  });

  it('leaves every other text card alone', () => {
    expect(parseAnswerCard(TEXT_CARD_EXAMPLE_BODY)).toBeNull();
    expect(parseAnswerCard('we made it.')).toBeNull();
    expect(parseAnswerCard(QUESTION_KICK)).toBeNull();
  });
});

describe('textCardHeadline — the words a tile and a screen reader lead with', () => {
  it('is her answer on an answer card', () => {
    expect(textCardHeadline(`${QUESTION_KICK}\nWhat song?\nRunning Up That Hill`)).toBe('Running Up That Hill');
  });

  it('is the headline on any other text card', () => {
    expect(textCardHeadline(TEXT_CARD_EXAMPLE_BODY)).toBe(TEXT_CARD_EXAMPLE.prompt);
  });
});

describe('TEXT_CARD_GRADIENT', () => {
  // v2 (2026-10-21): the plum ramp was violet and a gradient; the text card is
  // the flat fieldInk field now (flatSurfaces.test.ts holds the ink pair).
  it('is the flat fieldInk field, not the plum ramp (v2)', () => {
    expect(TEXT_CARD_GRADIENT).toEqual(['#151113', '#151113']);
  });
});
