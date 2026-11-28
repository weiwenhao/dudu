import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { environmentValue, mergedEnvironment } from '../native/environment.mjs';

/**
 * A mark of the models Antigravity has: `agy models`, hashed. It lists every model the account has, one line for each model and effort (`gemini-4-neon-high<TAB>Gemini 4 Neon (High)`), makes
 * no conversation, and is the same text every time it is asked. The models that OAR reads in an ACP session (which does make one: `session/new`) are those same models, so while the mark is what
 * it was, what was read then is still right. The lines are hashed as they are, with no guess at which of them are one model in several efforts (`gpt-oss-120b-medium` is a model whose name ends
 * in an effort). Nothing is said, and the models are read in full, when agy cannot say: signed out, offline, a gemini folder of its own (`agy models` cannot be told which one to read, so it
 * would answer for another account), or a version that prints something else.
 * @param {{ installation: any, env?: Record<string, string | null> }} options `env` is the overlay a harness is started with (a name set to null is removed).
 * @returns {Promise<string | null>}
 */
export async function antigravityModelsMark({ installation, env = {}, timeoutMs = 30_000 }) {
  if (installation?.via !== 'executable' || !installation.command) return null;
  const environment = mergedEnvironment(env);
  if (environmentValue(environment, 'GEMINI_HOME')) return null;
  const output = await new Promise((resolve) => {
    execFile(installation.command, ['models'], { env: environment, timeout: timeoutMs, maxBuffer: 1_000_000, windowsHide: true }, (error, stdout) => resolve(error ? null : String(stdout)));
  });
  const lines = (output ?? '').split('\n').map((line) => line.trimEnd()).filter(Boolean);
  // Every line is `id<TAB>name`: anything else is a format this was not written for, and is not trusted.
  if (!lines.length || !lines.every((line) => /^[^\t]+\t[^\t]+$/.test(line))) return null;
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}
