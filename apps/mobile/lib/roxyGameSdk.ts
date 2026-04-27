// Returns a JS string injected into the WebView before page load.
// The game calls window.Roxy.* and the RN host responds via onMessage.

export function buildRoxySDK(user: { id: string; displayName: string }): string {
  return `
(function() {
  window.Roxy = {
    _userId: ${JSON.stringify(user.id)},
    _displayName: ${JSON.stringify(user.displayName)},

    getUser: function() {
      return { id: window.Roxy._userId, displayName: window.Roxy._displayName };
    },

    close: function() {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'roxy:close' }));
    },

    shareScore: function(score, message) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'roxy:shareScore',
        score: score,
        message: message || '',
      }));
    },
  };

})();
true;
`;
}
