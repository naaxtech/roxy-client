import { currencyCode, formatMoney } from '../../lib/currency';

describe('currency', () => {
  describe('currencyCode', () => {
    it('returns normalized uppercase ISO code for lowercase input', () => {
      expect(currencyCode('usd')).toBe('USD');
    });

    it('returns USD for undefined', () => {
      expect(currencyCode(undefined)).toBe('USD');
    });

    it('returns USD for empty string', () => {
      expect(currencyCode('')).toBe('USD');
    });

    it('returns GBP for gbp input', () => {
      expect(currencyCode('gbp')).toBe('GBP');
    });

    it('handles mixed case input', () => {
      expect(currencyCode('UsD')).toBe('USD');
    });
  });

  describe('formatMoney', () => {
    it('formats cents as dollars with currency symbol', () => {
      expect(formatMoney(2000)).toBe('$20.00');
    });

    it('formats with GBP symbol for gbp currency', () => {
      expect(formatMoney(2000, 'gbp')).toBe('£20.00');
    });

    it('formats EUR with comma grouping and euro symbol', () => {
      const result = formatMoney(150000, 'eur');
      expect(result).toContain('1,500.00');
      expect(result).toContain('€');
    });

    it('formats zero cents correctly', () => {
      expect(formatMoney(0)).toBe('$0.00');
    });

    it('formats 999 cents to $9.99', () => {
      expect(formatMoney(999, 'USD')).toBe('$9.99');
    });

    it('does not throw on invalid currency and falls back to USD', () => {
      expect(() => formatMoney(1234, 'xxx')).not.toThrow();
      const result = formatMoney(1234, 'xxx');
      expect(result).toContain('12.34');
    });

    it('does not throw on empty currency string and returns USD format', () => {
      expect(() => formatMoney(1000, '')).not.toThrow();
      const result = formatMoney(1000, '');
      expect(result).toMatch(/^\$/);
    });

    it('does not throw on undefined currency and returns USD format', () => {
      expect(() => formatMoney(1000, undefined)).not.toThrow();
      const result = formatMoney(1000, undefined);
      expect(result).toMatch(/^\$/);
    });

    it('handles negative values', () => {
      const result = formatMoney(-2000);
      expect(result).toContain('-');
      expect(result).toContain('20.00');
    });

    it('handles large values with grouping', () => {
      const result = formatMoney(1234567);
      expect(result).toContain('12,345.67');
    });
  });
});
