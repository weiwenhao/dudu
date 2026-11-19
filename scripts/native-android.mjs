import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, createWriteStream, copyFileSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startAndroidFixture } from '../native/android/test/fixture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = new Set(process.argv.slice(2));
for (const value of args) {
  if (!['--e2e', '--install', '--unit'].includes(value)) throw new Error(`Unknown argument: ${value}`);
}
const sdk = process.env.ANDROID_HOME || path.join(homedir(), 'Library/Android/sdk');
const java = process.env.JAVA_HOME || '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
if (!existsSync(path.join(java, 'bin/java'))) throw new Error('Set JAVA_HOME to JDK 21.');
const adb = path.join(sdk, 'platform-tools/adb');
const runFolder = path.join(root, '.local/qa/android', new Date().toISOString().replaceAll(/[:.]/g, '-'));
mkdirSync(runFolder, { recursive: true });
const env = { ...process.env, JAVA_HOME: java, ANDROID_HOME: sdk };
let fixture;
let serial;
let result = { success: false, kind: args.has('--e2e') ? 'android-emulator-e2e' : 'android-build', output: runFolder };
function adbRun(...arguments_) {
  return execFileSync(adb, [...(serial ? ['-s', serial] : []), ...arguments_], { encoding: 'utf8', timeout: 30000 });
}
async function gradle(tasks, extra = []) {
  const log = createWriteStream(path.join(runFolder, 'gradle.log'), { flags: 'a' });
  const process_ = spawn(path.join(root, 'native/android/gradlew'), [...tasks, ...extra, '--no-daemon', '--console=plain'],
    { cwd: path.join(root, 'native/android'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const output of [process_.stdout, process_.stderr]) output.on('data', data => {
    process.stdout.write(data); log.write(data);
  });
  const code = await new Promise((resolve, reject) => {
    process_.once('error', reject); process_.once('close', resolve);
  });
  await new Promise(resolve => log.end(resolve));
  if (code !== 0) throw new Error(`Android Gradle task failed (${code}).`);
}
try {
  console.log(`Android build/check logs: ${runFolder}`);
  if (args.has('--e2e') || args.has('--install')) {
    const devices = adbRun('devices').split('\n').map(line => line.trim().split(/\s+/))
      .filter(([id, status]) => /^emulator-\d+$/.test(id) && status === 'device');
    const selected = process.env.ANDROID_SERIAL;
    serial = selected || (devices.length === 1 ? devices[0][0] : null);
    if (!serial || !/^emulator-\d+$/.test(serial) || !devices.some(([id]) => id === serial))
      throw new Error('Start one Android emulator, or set ANDROID_SERIAL to its emulator-* ID. Physical devices are never selected.');
    env.ANDROID_SERIAL = serial;
    if (adbRun('shell', 'getprop', 'sys.boot_completed').trim() !== '1') throw new Error('Wait for the emulator to finish booting.');
    result.emulator = serial;
  }
  if (args.has('--e2e')) {
    fixture = await startAndroidFixture();
    const origin = `http://10.0.2.2:${fixture.port}`;
    const selectedCases = process.env.DUDU_ANDROID_TEST_CASES?.split(',').map(value => value.trim()) ?? [];
    if (selectedCases.some(value => !/^[A-Za-z][A-Za-z0-9_]*$/.test(value))) {
      throw new Error('DUDU_ANDROID_TEST_CASES must contain comma-separated HomeFlowTest method names.');
    }
    adbRun('shell', 'rm', '-rf', '/sdcard/Download/dudu-android-review');
    try {
      await gradle([':app:connectedDebugAndroidTest'], [
        `-Pandroid.testInstrumentationRunnerArguments.fixtureOrigin=${origin}`,
        '-Pandroid.testInstrumentationRunnerArguments.language=zh-CN',
        ...(selectedCases.length ? [`-Pandroid.testInstrumentationRunnerArguments.class=${selectedCases
          .map(name => `app.dudu.android.HomeFlowTest#${name}`).join(',')}`] : []),
      ]);
    } finally {
      try { adbRun('pull', '/sdcard/Download/dudu-android-review', path.join(runFolder, 'screenshots')); }
      catch { /* An early runner failure may produce no screenshots. */ }
    }
    const reports = path.join(root, 'native/android/app/build/outputs/androidTest-results/connected/debug');
    function cases(folder) {
      if (!existsSync(folder)) return 0;
      return readdirSync(folder, { withFileTypes: true }).reduce((sum, entry) => sum + (entry.isDirectory()
        ? cases(path.join(folder, entry.name)) : entry.name.endsWith('.xml')
          ? [...readFileSync(path.join(folder, entry.name), 'utf8').matchAll(/<testcase\b/g)].length : 0), 0);
    }
    result.tests = { instrumented: cases(reports), service: 'real native HTTP/SQLite with isolated session fixtures' };
    if (selectedCases.length) result.tests.cases = selectedCases;
  } else if (args.has('--unit')) {
    await gradle([':app:testDebugUnitTest']);
  } else {
    await gradle([':app:assembleDebug', ':app:testDebugUnitTest', ':app:lintDebug']);
    const apk = path.join(root, 'native/android/app/build/outputs/apk/debug/app-debug.apk');
    copyFileSync(apk, path.join(runFolder, 'dudu-debug.apk'));
    result.apk = apk;
    if (args.has('--install')) {
      adbRun('install', '-r', apk);
      adbRun('shell', 'am', 'start', '-n', 'app.dudu.android/.MainActivity');
    }
  }
  result.success = true;
} catch (error) {
  result.error = error.message;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  await fixture?.close();
  writeFileSync(path.join(runFolder, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`Android result: ${path.join(runFolder, 'result.json')}`);
}
