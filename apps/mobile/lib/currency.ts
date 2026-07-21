/**
 * Currency formatting helpers for international price display.
 *
 * WHY THIS EXISTS:
 * Single source of truth for money formatting across the app.
 * Never hardcode `$20.00` — use formatMoney() instead.
 * Ensures consistent currency symbols and locale-aware grouping everywhere.
 */

/**
 * Normalize currency code to uppercase ISO 4217.
 * Defaults to USD if not provided or invalid.
 * @param currency - Currency code (case-insensitive), e.g. 'usd', 'gbp', 'eur'
 * @returns Normalized uppercase ISO code, e.g. 'USD', 'GBP', 'EUR'
 */
export function currencyCode(currency?: string): string {
  if (!currency || currency.trim() === '') {
    return 'USD';
  }
  return currency.toUpperCase();
}

/**
 * Format cents as currency-aware money string with symbol and grouping.
 * Uses Intl.NumberFormat with currency style for locale-aware formatting.
 * Falls back to USD if currency code is invalid.
 *
 * @param cents - Amount in cents (e.g. 2000 for $20.00)
 * @param currency - Currency code, optional (defaults to 'USD')
 * @returns Formatted string with currency symbol and grouping, e.g. '$20.00', '£20.00', '€1,500.00'
 *
 * @example
 * formatMoney(2000) // '$20.00'
 * formatMoney(2000, 'gbp') // '£20.00'
 * formatMoney(150000, 'eur') // '€1.500,00' or similar (locale-dependent)
 */
export function formatMoney(cents: number, currency?: string): string {
  const dollars = cents / 100;
  let code = currencyCode(currency);

  try {
    const formatter = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: code,
    });
    return formatter.format(dollars);
  } catch {
    // Invalid currency code — fall back to USD
    try {
      const formatter = new Intl.NumberFormat('en', {
        style: 'currency',
        currency: 'USD',
      });
      return formatter.format(dollars);
    } catch {
      // Last resort — just return the numeric value (should never happen)
      return `$${dollars.toFixed(2)}`;
    }
  }
}
