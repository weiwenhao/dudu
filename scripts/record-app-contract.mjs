// Writes the shapes of the answers a plugin gives to a phone app (tests/support/app-contract-cases.mjs) as JSON on standard output.
//   node scripts/record-app-contract.mjs <plugin checkout> "<what app it is for>" > tests/fixtures/app-contract-<app>-shapes.json
// Run it against the checkout of the commit a phone app was built from (`git archive <commit> host package.json | tar -x -C <folder>`, with node_modules linked in) when that app is released.
// An app that is out there keeps its file for good: the plugin may answer with more, never with less.
import { resolve } from 'node:path';
import { sampleResponses, shapeOf } from '../tests/support/app-contract-cases.mjs';

const root = resolve(process.argv[2] ?? '.');
const app = process.argv[3] ?? 'unnamed';
const samples = await sampleResponses(root);
const shapes = Object.fromEntries(Object.entries(samples).map(([name, value]) => [name, [...shapeOf(value)].sort()]));
process.stdout.write(`${JSON.stringify({ app, recordedFrom: root.split('/').slice(-1)[0], shapes }, null, 1)}\n`);
