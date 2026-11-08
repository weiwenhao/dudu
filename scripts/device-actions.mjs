// node scripts/device-actions.mjs <timeline.jsonl> [--minutes N] [--slow MS]
// Reads a timeline pulled from the phone (npm run logs:pull) and says which taps were followed by a wait: see scripts/lib/device-actions.mjs.
import { readFile } from 'node:fs/promises';
import { analyzeActions, describeActions } from './lib/device-actions.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? Number(args[index + 1]) : fallback; };
const file = args.find((arg, index) => !arg.startsWith('--') && !['--minutes', '--slow'].includes(args[index - 1]));
if (!file) { console.error('node scripts/device-actions.mjs <timeline.jsonl> [--minutes N] [--slow MS]'); process.exit(1); }
const entries = (await readFile(file, 'utf8')).split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
const minutes = option('--minutes', 0);
console.log(describeActions(analyzeActions(entries, { since: minutes ? Date.now() - minutes * 60_000 : -Infinity, slowMs: option('--slow', 1000) })));
