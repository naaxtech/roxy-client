const crashlytics = () => ({
  recordError: jest.fn(),
  log: jest.fn(),
  setUserId: jest.fn(),
  setCrashlyticsCollectionEnabled: jest.fn(),
});
crashlytics.default = crashlytics;
module.exports = crashlytics;
