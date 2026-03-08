const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Stub out Daily.co and its native deps on web — guarded at runtime via lib/daily.ts
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && (
    moduleName === '@daily-co/react-native-daily-js' ||
    moduleName === '@daily-co/react-native-webrtc' ||
    moduleName === 'react-native-background-timer' ||
    moduleName === 'react-native-callkeep' ||
    moduleName === '@react-native-community/async-storage'
  )) {
    return { type: 'empty' };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
