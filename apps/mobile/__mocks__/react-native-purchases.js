// Jest stand-in for react-native-purchases 10.15.1 (mapped in package.json
// `jest.moduleNameMapper`). The real package touches NativeModules and pulls in
// RevenueCat's web SDK at import time; no test should reach a store.
//
// Inert by default: an unconfigured SDK with no offerings and no customer.
// Tests that exercise the money path replace it with their own
// `jest.mock('react-native-purchases', factory)`.
//
// Enum values copied from @revenuecat/purchases-typescript-internal 19.14.1
// (dist/generated/error-codes.d.ts, dist/offerings.d.ts), the versions
// react-native-purchases 10.15.1 depends on.
// src: https://unpkg.com/@revenuecat/purchases-typescript-internal@19.14.1/dist/generated/error-codes.d.ts · react-native-purchases 10.15.1 · 2026-10-27

const PURCHASES_ERROR_CODE = {
  UNKNOWN_ERROR: '0',
  PURCHASE_CANCELLED_ERROR: '1',
  STORE_PROBLEM_ERROR: '2',
  PURCHASE_NOT_ALLOWED_ERROR: '3',
  PURCHASE_INVALID_ERROR: '4',
  PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR: '5',
  PRODUCT_ALREADY_PURCHASED_ERROR: '6',
  RECEIPT_ALREADY_IN_USE_ERROR: '7',
  NETWORK_ERROR: '10',
  INVALID_CREDENTIALS_ERROR: '11',
  RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR: '13',
  OPERATION_ALREADY_IN_PROGRESS_ERROR: '15',
  PAYMENT_PENDING_ERROR: '20',
  CONFIGURATION_ERROR: '23',
  OFFLINE_CONNECTION_ERROR: '35',
};

const emptyCustomer = {
  entitlements: { active: {}, all: {} },
  activeSubscriptions: [],
  managementURL: null,
};

const Purchases = {
  configure: () => undefined,
  setLogHandler: () => undefined,
  isConfigured: async () => false,
  logIn: async () => ({ customerInfo: emptyCustomer, created: false }),
  logOut: async () => emptyCustomer,
  getOfferings: async () => ({ all: {}, current: null }),
  getCustomerInfo: async () => emptyCustomer,
  purchasePackage: async () => {
    throw Object.assign(new Error('Purchases are not available in tests'), {
      code: PURCHASES_ERROR_CODE.CONFIGURATION_ERROR,
      userCancelled: false,
    });
  },
  restorePurchases: async () => emptyCustomer,
  PURCHASES_ERROR_CODE,
};

module.exports = Purchases;
module.exports.default = Purchases;
module.exports.PURCHASES_ERROR_CODE = PURCHASES_ERROR_CODE;
module.exports.__esModule = true;
