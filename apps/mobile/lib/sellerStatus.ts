/**
 * Where a woman is in the "Sell on Roxy" pipeline.
 *
 * The prototype draws this as a three-step machine — not applied → in review →
 * approved — and gates the Shop tab, shoppable post tags and the Product row in
 * the create sheet on the last state. The schema has no such column: what it has
 * is a `businesses` row per seller with three independent booleans that happen
 * to fall in that order.
 *
 *  - no row at all         → she has never applied
 *  - a row, not yet usable → a human or Stripe has not finished with it
 *  - verified, can sell,
 *    and Stripe connected  → approved
 *
 * Deriving it in one pure function rather than at each call site is the point:
 * three call sites each doing their own `is_verified && can_sell` is three
 * chances to disagree about who is allowed to take money. If a real
 * `seller_status` column ever lands, this is the only place that changes.
 */
export type SellerStatus = 'none' | 'review' | 'approved';

export type SellerBusinessRow = {
  is_verified?: boolean | null;
  can_sell?: boolean | null;
  stripe_account_id?: string | null;
};

export function deriveSellerStatus(rows: SellerBusinessRow[] | null | undefined): SellerStatus {
  if (!rows || rows.length === 0) return 'none';

  const approved = rows.some(
    (r) => r.is_verified === true && r.can_sell === true && !!r.stripe_account_id
  );
  return approved ? 'approved' : 'review';
}

/** The label the You tab and the create sheet both show. One source, one wording. */
export function sellerStatusLabel(status: SellerStatus): string {
  if (status === 'approved') return 'Approved ✓';
  if (status === 'review') return 'In review';
  return 'Apply';
}

/**
 * The only question the rest of the app should ask. Named for what it permits
 * rather than for the state, so a call site reads as a permission check and a
 * fourth state could never accidentally mean "yes".
 */
export function canSell(status: SellerStatus): boolean {
  return status === 'approved';
}
