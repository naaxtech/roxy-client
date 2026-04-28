/**
 * Config plugin: Fix Gradle/AGP compatibility for Expo 51 on EAS Build.
 *
 * Addresses two breaking changes introduced when EAS moved to AGP 8.4+:
 *
 * 1. expo-image 1.13.x reads `kspVersion` from root project ext — it's not set
 *    by expo-build-properties 0.12.x. We inject it after `kotlinVersion`.
 *
 * 2. expo-modules-core uses `components.release` (SoftwareComponent API) which
 *    was removed in AGP 8.4. We pin AGP to 8.3.2 (last compatible version).
 *
 * Also pins the Gradle wrapper to 8.6 (required minimum for AGP 8.3.x).
 */

const { withProjectBuildGradle, withDangerousMods } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

function withKspVersionAndAgpPin(config) {
  return withProjectBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    // 1. Inject kspVersion after kotlinVersion in the ext block.
    //    KSP version format: {kotlinVersion}-{kspPatchVersion}
    if (!contents.includes('kspVersion')) {
      contents = contents.replace(
        /(kotlinVersion\s*=\s*"[^"]*")/,
        '$1\n        kspVersion = "1.9.24-1.0.20"'
      );
    }

    // 2. Pin AGP to 8.3.2 — last version before SoftwareComponent API removal.
    //    Matches both single-quoted and double-quoted classpath declarations.
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
}

function withGradleWrapperPin(config) {
  return withDangerousMods(config, [
    'android',
    async (config) => {
      const wrapperPath = path.join(
        config.modRequest.projectRoot,
        'android',
        'gradle',
        'wrapper',
        'gradle-wrapper.properties'
      );
      if (fs.existsSync(wrapperPath)) {
        let contents = fs.readFileSync(wrapperPath, 'utf8');
        // AGP 8.3.x requires Gradle >= 8.4; 8.6 is safe and broadly cached.
        contents = contents.replace(
          /distributionUrl=.+/,
          'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.6-all.zip'
        );
        fs.writeFileSync(wrapperPath, contents);
      }
      return config;
    },
  ]);
}

module.exports = function withAndroidBuildFix(config) {
  config = withKspVersionAndAgpPin(config);
  config = withGradleWrapperPin(config);
  return config;
};
