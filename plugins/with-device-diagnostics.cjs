const fs = require('fs');
const path = require('path');
const {
  IOSConfig,
  createRunOncePlugin,
  withAppDelegate,
} = require('@expo/config-plugins');

function withDeviceDiagnostics(config) {
  const sourcePath = path.join(__dirname, 'device-diagnostics', 'DSBotDiagnostics.swift');
  const sourceContents = fs.readFileSync(sourcePath, 'utf8');

  config = IOSConfig.XcodeProjectFile.withBuildSourceFile(config, {
    filePath: 'DSBotDiagnostics.swift',
    contents: sourceContents,
    overwrite: true,
  });

  return withAppDelegate(config, (modConfig) => {
    const appDelegate = modConfig.modResults;

    if (appDelegate.language !== 'swift') {
      throw new Error(
        'with-device-diagnostics requires a Swift AppDelegate to start native diagnostics.'
      );
    }

    if (appDelegate.contents.includes('DSBotDiagnostics.start()')) {
      return modConfig;
    }

    const launchMarker = appDelegate.contents.indexOf('didFinishLaunchingWithOptions');
    const methodBodyStart =
      launchMarker === -1 ? -1 : appDelegate.contents.indexOf('{', launchMarker);

    if (methodBodyStart === -1) {
      throw new Error(
        'with-device-diagnostics could not find didFinishLaunchingWithOptions in AppDelegate.swift.'
      );
    }

    const firstLineEnd = appDelegate.contents.indexOf('\n', methodBodyStart);
    if (firstLineEnd === -1) {
      throw new Error(
        'with-device-diagnostics could not find the AppDelegate launch method body.'
      );
    }

    const bodyLineStart = firstLineEnd + 1;
    const followingText = appDelegate.contents.slice(bodyLineStart);
    const indent = (followingText.match(/^[ \t]*/) || [''])[0];
    const insertAt = bodyLineStart + indent.length;
    const startupCall = `DSBotDiagnostics.start()\n${indent}`;

    appDelegate.contents =
      appDelegate.contents.slice(0, insertAt) +
      startupCall +
      appDelegate.contents.slice(insertAt);
    return modConfig;
  });
}

module.exports = createRunOncePlugin(
  withDeviceDiagnostics,
  'with-device-diagnostics',
  '1.0.0'
);
