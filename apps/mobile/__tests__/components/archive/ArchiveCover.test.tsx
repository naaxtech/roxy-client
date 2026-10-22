import { render, fireEvent, configure } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ArchiveCover } from '../../../components/archive/ArchiveCover';
import { COVER_ASPECT, COVER_GLYPH_EM, COVER_PADDING, COVER_TITLE, COVER_TITLE_MIN, coverTitleStep } from '../../../components/archive/archiveTokens';
import { IDENTITY, RADII, identityFor, inkOn } from '../../../lib/theme';
import { FONTS } from '../../../lib/typography';

// The cover is hidden from assistive tech on purpose (last test); query the
// hidden tree too so the visual assertions can reach it.
configure({ defaultIncludeHiddenElements: true });

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, string | number>;

/**
 * Design direction v2 › Archive: covers are uploaded and shown at 2:3, radius
 * 8, with no text over them. With no cover the entry gets a designed type
 * cover — an identity field picked from the entry id and the title in
 * Geologica 800 at 18/20, bottom start, three lines at most — never a gradient.
 */
describe('ArchiveCover', () => {
  it('shows an uploaded cover at 2:3 and radius 8 with nothing written over it', () => {
    const v = render(
      <ArchiveCover entryId="e1" title="Carmilla" coverUrl="https://example.test/c.jpg" width={104} testID="c" />,
    );
    const frame = flat(v.getByTestId('c'));
    expect(frame.width).toBe(104);
    expect(frame.height).toBe(104 * COVER_ASPECT);
    expect(COVER_ASPECT).toBe(3 / 2);
    expect(frame.borderRadius).toBe(RADII.sm);
    expect(v.getByTestId('c-image')).toBeTruthy();
    expect(v.queryByText('Carmilla')).toBeNull();
    expect(v.queryByTestId('c-type')).toBeNull();
  });

  it('designs a type cover when there is no upload: identity field from the id, title bottom start', () => {
    const v = render(<ArchiveCover entryId="entry-42" title="Rafiki" coverUrl={null} width={104} testID="c" />);
    const field = flat(v.getByTestId('c-type'));
    expect(field.backgroundColor).toBe(identityFor('entry-42'));
    expect(IDENTITY).toContain(field.backgroundColor);
    expect(field.justifyContent).toBe('flex-end');
    const title = v.getByText('Rafiki');
    expect(title.props.numberOfLines).toBe(3);
    const t = flat(title);
    expect(t.fontFamily).toBe(FONTS.display.extrabold);
    expect(t.fontSize).toBe(18);
    expect(t.lineHeight).toBe(20);
    expect(COVER_TITLE.fontSize).toBe(18);
    expect(t.color).toBe(inkOn(String(field.backgroundColor)));
  });

  it('picks the same field for the same entry every time, and from the id, not the title', () => {
    const a = render(<ArchiveCover entryId="same" title="One" coverUrl={null} width={80} testID="a" />);
    const b = render(<ArchiveCover entryId="same" title="Another title" coverUrl={null} width={80} testID="b" />);
    expect(flat(a.getByTestId('a-type')).backgroundColor).toBe(flat(b.getByTestId('b-type')).backgroundColor);
  });

  it('never paints a gradient', () => {
    const v = render(<ArchiveCover entryId="e1" title="Carol" coverUrl={null} width={104} testID="c" />);
    expect(v.UNSAFE_queryAllByType('LinearGradient' as never)).toHaveLength(0);
  });

  /**
   * Seen in the Wave 2 browser run: "But I'm a Cheerleader" broke as
   * "Cheerlea / der" on the 104 dp row cover, because one word was wider than
   * the field at 18 dp. A word is never split: the title steps down until its
   * longest word fits the field's inner width (GLYPH_EM per character).
   */
  it('steps the title down until its longest word fits, and never below the floor', () => {
    const inner = 104 - 2 * COVER_PADDING;
    const v = render(
      <ArchiveCover entryId="e1" title="But I'm a Cheerleader" coverUrl={null} width={104} testID="c" />,
    );
    const t = flat(v.getByText("But I'm a Cheerleader"));
    expect(Number(t.fontSize)).toBeLessThan(18);
    expect('Cheerleader'.length * COVER_GLYPH_EM * Number(t.fontSize)).toBeLessThanOrEqual(inner);
    expect(Number(t.lineHeight)).toBe(Number(t.fontSize) + 2);
    expect(coverTitleStep('Supercalifragilisticexpialidocious', 104).fontSize).toBe(COVER_TITLE_MIN);
    // Short words keep the direction's 18/20.
    expect(coverTitleStep('Tipping the Velvet', 104)).toEqual({ fontSize: 18, lineHeight: 20 });
  });

  it('falls back to the type cover when the uploaded image fails to load', () => {
    const v = render(
      <ArchiveCover entryId="e1" title="Carmilla" coverUrl="https://example.test/broken.jpg" width={104} testID="c" />,
    );
    fireEvent(v.getByTestId('c-image'), 'error');
    expect(v.queryByTestId('c-image')).toBeNull();
    expect(v.getByTestId('c-type')).toBeTruthy();
    expect(v.getByText('Carmilla')).toBeTruthy();
  });

  it('keeps the cover out of the screen reader: the row or card already says the title', () => {
    const v = render(<ArchiveCover entryId="e1" title="Carol" coverUrl={null} width={104} testID="c" />);
    const frame = v.getByTestId('c');
    expect(frame.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(frame.props.accessibilityElementsHidden).toBe(true);
  });
});
