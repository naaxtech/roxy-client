import {
  canCreateEvent,
  canTagShop,
  eventBlockedReason,
  shopPostBlockedReason,
} from '../../lib/createAccess';

describe('canCreateEvent', () => {
  it('is only for an official community account', () => {
    expect(canCreateEvent({ official_community_id: 'c1' })).toBe(true);
    expect(canCreateEvent({ official_community_id: null })).toBe(false);
    expect(canCreateEvent(null)).toBe(false);
  });
});

describe('canTagShop', () => {
  it('lets a community account or an approved seller tag an item', () => {
    expect(canTagShop({ official: true, sellerApproved: false })).toBe(true);
    expect(canTagShop({ official: false, sellerApproved: true })).toBe(true);
    expect(canTagShop({ official: false, sellerApproved: false })).toBe(false);
  });
});

describe('blocked reasons', () => {
  it('clears when she is allowed', () => {
    expect(eventBlockedReason(true)).toBeNull();
    expect(shopPostBlockedReason(true)).toBeNull();
  });

  it('explains the lock when she is not', () => {
    expect(eventBlockedReason(false)).toMatch(/community/i);
    expect(shopPostBlockedReason(false)).toMatch(/shop item/i);
  });
});
