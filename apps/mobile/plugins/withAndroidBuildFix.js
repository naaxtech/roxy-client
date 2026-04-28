/**
 * Config plugin: Fix Gradle/AGP compatibility for Expo 51 on EAS Build.
 *
 * EAS moved to AGP 8.4+ which broke two Expo 51 APIs:
 *
 * 1. expo-image 1.13.x reads `kspVersion` from root project ext — not set by
 *    expo-build-properties 0.12.x. Injected after `kotlinVersion`.
 *
 * 2. expo-modules-core uses `components.release` (removed in AGP 8.4).
 *    Pinned to AGP 8.3.2, the last compatible version.
 */
const { withProjectBuildGradle } = require('@expo/config-plugins');

module.exports = function withAndroidBuildFix(config) {
  return withProjectBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    // 1. Inject kspVersion into the ext block, after kotlinVersion.
    if (!contents.includes('kspVersion')) {
      contents = contents.replace(
        /(kotlinVersion\s*=\s*"[^"]*")/,
        '$1\n        kspVersion = "1.9.24-1.0.20"'
      );
    }

    // 2. Pin AGP to 8.3.2 — removes the `components.release` breakage.
    contents = contents.replace(
      /classpath\("com\.android\.tools\.build:gradle:[^"]*"\)/g,
      'classpath("com.android.tools.build:gradle:8.3.2")'
    );
    contents = contents.replace(
      /classpath\('com\.android\.tools\.build:gradle:[^']*'\)/g,
      "classpath('com.android.tools.build:gradle:8.3.2')"
    );

    config.modResults.contents = contents;
    return config;
  });
};
