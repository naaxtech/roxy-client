import { newIdempotencyKey, checkoutSignature } from '../../lib/idempotency';

const shipping = {
  name: 'Jane Doe', line1: '1 Main St', city: 'LA',
  state: 'CA', postal_code: '90001', country: 'US',
};

describe('newIdempotencyKey', () => {
  it('never repeats — a repeat would make Stripe reject a changed request', () => {
    const keys = new Set(Array.from({ length: 500 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(500);
  });

  it('stays inside the 255-char Idempotency-Key header limit', () => {
    expect(newIdempotencyKey().length).toBeLessThanOrEqual(255);
  });
});

describe('checkoutSignature', () => {
  const line = { product_id: 'p1', variant_id: null, quantity: 2 };

  it('is stable for the same basket and address', () => {
    expect(checkoutSignature([line], shipping)).toBe(checkoutSignature([line], shipping));
  });

  it('ignores basket ordering', () => {
    const other = { product_id: 'p2', variant_id: 'v9', quantity: 1 };
    expect(checkoutSignature([line, other], shipping)).toBe(checkoutSignature([other, line], shipping));
  });

  it('changes when the quantity changes', () => {
    expect(checkoutSignature([line], shipping)).not.toBe(
      checkoutSignature([{ ...line, quantity: 3 }], shipping)
    );
  });

  it('changes when the variant changes', () => {
    expect(checkoutSignature([line], shipping)).not.toBe(
      checkoutSignature([{ ...line, variant_id: 'v1' }], shipping)
    );
  });

  it('changes when the address changes', () => {
    expect(checkoutSignature([line], shipping)).not.toBe(
      checkoutSignature([line], { ...shipping, postal_code: '90002' })
    );
  });
});
