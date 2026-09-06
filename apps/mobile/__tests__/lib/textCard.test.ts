import {
  parseTextCard,
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

describe('TEXT_CARD_GRADIENT', () => {
  it('is the plum ramp from p3, not the brand orange', () => {
    expect(TEXT_CARD_GRADIENT).toEqual(['#2A1B6E', '#6D28A8', '#B02478']);
  });
});
