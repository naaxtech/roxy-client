const path = require('path');
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

// Alias react-native → react-native-web so internal RN modules (Platform, etc.)
// resolve correctly on web. Standard Expo web fix for RN 0.74+.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  'react-native': path.resolve(__dirname, 'node_modules/react-native-web'),
};

module.exports = config;
