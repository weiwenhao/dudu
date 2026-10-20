import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import qrcode from 'qrcode-terminal';

try {
  const path = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'harness-mobile', 'connection.json');
  const { url, pairingUrl } = JSON.parse(await readFile(path, 'utf8'));
  if (pairingUrl) console.log(`\n电脑配对页：${pairingUrl}`);
  console.log(`\n${url}\n`);
  qrcode.generate(url, { small: true });
} catch {
  console.error('The Harness Mobile Desktop plugin is not running. See README.md for installation.');
  process.exitCode = 1;
}
