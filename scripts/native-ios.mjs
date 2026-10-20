import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const install = args.includes('--install');
const testing = args.includes('--test');
const option = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} needs a value.`);
  return args[index + 1];
};
const configuration = option('--configuration', testing ? 'Debug' : 'Release');
if (!['Release', 'Debug'].includes(configuration)) throw new Error('Unsupported build configuration.');
const derived = join(root, '.local', 'native-ios');
await mkdir(derived, { recursive: true });
const run = (command, options) => execFileSync(command, options, { cwd: root, stdio: 'inherit' });
run('xcodegen', ['generate', '--spec', 'native/project.yml', '--project', 'native']);
run('xcodebuild', [
  '-project', 'native/DSBotNative.xcodeproj', '-scheme', 'dsbot',
  '-configuration', configuration, '-sdk', 'iphoneos',
  '-destination', 'generic/platform=iOS', '-derivedDataPath', derived,
  '-jobs', '2', '-allowProvisioningUpdates', '-allowProvisioningDeviceRegistration', 'build',
]);
const app = join(derived, 'Build', 'Products', `${configuration}-iphoneos`, 'dsbot.app');
console.log(`Native SwiftUI app: ${app}`);
if (install || testing) {
  const requested = option('--device', process.env.DSBOT_DEVICE);
  const report = join(derived, 'devices.json');
  run('xcrun', ['devicectl', 'list', 'devices', '--json-output', report]);
  const data = JSON.parse(await readFile(report, 'utf8'));
  const paired = (data.result?.devices ?? []).filter((item) =>
    item.connectionProperties?.pairingState === 'paired'
    && item.hardwareProperties?.reality === 'physical');
  const matches = requested
    ? paired.filter((item) => [item.identifier, item.hardwareProperties?.udid,
      item.deviceProperties?.name].includes(requested))
    : paired.filter((item) => item.connectionProperties?.tunnelState !== 'unavailable');
  if (matches.length !== 1) throw new Error('Pass --device with the intended paired physical iPhone identifier.');
  const device = matches[0];
  if (install && !testing) {
    run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', device.identifier, app, '--timeout', '60']);
  }
  if (testing) {
    const result = join(derived, `tests-${Date.now()}.xcresult`);
    run('xcodebuild', [
      '-project', 'native/DSBotNative.xcodeproj', '-scheme', 'dsbot',
      '-configuration', configuration, '-destination', `platform=iOS,id=${device.hardwareProperties.udid}`,
      '-destination-timeout', '30', '-derivedDataPath', derived,
      '-resultBundlePath', result, '-parallel-testing-enabled', 'NO',
      '-allowProvisioningUpdates', '-allowProvisioningDeviceRegistration', 'test',
    ]);
    console.log(`Native test results: ${result}`);
  }
}
