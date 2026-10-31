// Runs the end-to-end tests (tests/e2e). The plugin is packaged once, here: every test file starts its own DSH from that package, and
// packaging is not something several of them can do at the same moment. Files to run can be named: `npm run test:e2e -- tests/e2e/dashboard.e2e.test.ts`.
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'host', 'dudu-plugin', 'package.json'), 'utf8'));
execFileSync('node', [join(root, 'scripts', 'package-desktop.mjs')], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });

const named = process.argv.slice(2).filter((argument) => !argument.startsWith('-'));
const files = named.length ? named : readdirSync(join(root, 'tests', 'e2e')).filter((file) => file.endsWith('.e2e.test.ts')).map((file) => join('tests', 'e2e', file));
const result = spawnSync('node', ['--experimental-strip-types', '--test', ...process.argv.slice(2).filter((argument) => argument.startsWith('-')), ...files], {
  cwd: root, stdio: 'inherit', env: { ...process.env, DUDU_E2E_TGZ: join(root, '.local', 'release', `dudu-${version}.tgz`) },
});
process.exit(result.status ?? 1);
