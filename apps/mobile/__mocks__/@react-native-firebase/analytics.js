const analytics = () => ({
  logScreenView: jest.fn().mockResolvedValue(undefined),
  logEvent: jest.fn().mockResolvedValue(undefined),
  setUserId: jest.fn().mockResolvedValue(undefined),
});
analytics.default = analytics;
module.exports = analytics;
