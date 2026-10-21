import { APP_FONT_MAP } from '../../hooks/useAppFonts';
import { FONT_FAMILIES, LEGACY_FONT_FAMILIES } from '../../lib/typography';

describe('useAppFonts registers exactly the v2 faces', () => {
  it('loads every family lib/typography names, and nothing else', () => {
    expect(Object.keys(APP_FONT_MAP).sort()).toEqual([...FONT_FAMILIES].sort());
  });

  it('no longer downloads the superseded Outfit / Figtree faces', () => {
    for (const legacy of LEGACY_FONT_FAMILIES) {
      expect(Object.keys(APP_FONT_MAP)).not.toContain(legacy);
    }
  });
});
