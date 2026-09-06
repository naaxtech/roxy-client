import { Text, TextInput } from 'react-native';
import { applyBrandType } from '../../lib/applyBrandType';
import { FONTS } from '../../lib/typography';

describe('applyBrandType', () => {
  it('makes Figtree the default Text face so weight-only labels still look like the prototype', () => {
    applyBrandType();
    const text = Text as typeof Text & { defaultProps?: { style?: unknown } };
    const style = Array.isArray(text.defaultProps?.style)
      ? text.defaultProps.style[0]
      : text.defaultProps?.style;
    expect(style).toEqual({ fontFamily: FONTS.text.regular });
    const input = TextInput as typeof TextInput & { defaultProps?: { style?: unknown } };
    const inputStyle = Array.isArray(input.defaultProps?.style)
      ? input.defaultProps.style[0]
      : input.defaultProps?.style;
    expect(inputStyle).toEqual({ fontFamily: FONTS.text.regular });
  });
});
