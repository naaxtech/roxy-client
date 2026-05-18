const crashlytics = () => ({
  log: async () => {},
  setAttribute: async () => {},
  recordError: async () => {},
  setUserId: async () => {},
});
module.exports = crashlytics;
module.exports.default = crashlytics;
