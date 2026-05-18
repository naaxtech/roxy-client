const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const WEB_STUBS = {
  '@daily-co/react-native-daily-js': 'empty',
  '@daily-co/react-native-webrtc': 'empty',
  'react-native-background-timer': 'empty',
  'react-native-callkeep': 'empty',
  '@react-native-community/async-storage': 'empty',
  '@react-native-firebase/analytics': path.join(__dirname, 'web-stubs/firebase-analytics.js'),
  '@react-native-firebase/crashlytics': path.join(__dirname, 'web-stubs/firebase-crashlytics.js'),
  '@react-native-firebase/app': path.join(__dirname, 'web-stubs/firebase-app.js'),
  '@stripe/stripe-react-native': path.join(__dirname, 'web-stubs/stripe-native.js'),
};

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web') {
    const stub = WEB_STUBS[moduleName];
    if (stub === 'empty') {
      return { type: 'empty' };
    }
    if (typeof stub === 'string') {
      return { type: 'sourceFile', filePath: stub };
    }

    // react-native internal relative imports (e.g. TextInputState → Utilities/Platform)
    const fromRn =
      context.originModulePath.includes(`${path.sep}react-native${path.sep}`) &&
      !context.originModulePath.includes('react-native-web');
    if (fromRn && (moduleName === '../../Utilities/Platform' || moduleName.endsWith('Utilities/Platform'))) {
      return context.resolveRequest(context, 'react-native-web/dist/exports/Platform', platform);
    }
  }

  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
