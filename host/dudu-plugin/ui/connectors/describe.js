// What the host says about a connector, put into words in the language of the page: the grey line under its name, and what its state looks like.
import { diagnostic, T } from '../strings.js';

const P = T.settings.connectorsPage;
const joined = (parts) => parts.filter(Boolean).join(' · ');
const firstLine = (text) => String(text ?? '').split('\n').map((line) => line.trim()).find(Boolean) ?? '';
const baseName = (command) => String(command ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '';

/** The grey line under a connected connector's name, made from what the host says it is (`about`). */
export function aboutLine(about) {
  if (!about) return '';
  const tools = typeof about.tools === 'number' ? P.about.tools(about.tools) : '';
  if (about.kind === 'remote') return joined([about.host, tools]);
  if (about.kind === 'local') return joined([about.command && P.about.thisComputer(baseName(about.command)), tools]);
  if (about.kind === 'cli') return about.command ? P.about.commandLine(about.command) : '';
  if (about.kind === 'sentence') return firstLine(about.text);
  return '';
}

/** A timeout has the owner's words; any other message is the host's, translated where it is a known one and shown as it is where it is not. */
const errorWords = (message) => {
  if (message === 'timeout') return P.state.timedOut;
  return typeof message === 'string' ? diagnostic(message) : '';
};

/**
 * What a state looks like in a row: the dot (`tone`) or the spinner and the words by it, the line that takes the place of the grey one when the state
 * tells what to do (`bad`: in red), and the one thing the row offers to do about it (`verb`). No state is a connector that is fine: nothing is said.
 */
export function describeState(state, line) {
  if (!state) return { line };
  switch (state.status) {
    case 'needs-auth': return { line, tone: 'wait', words: T.settings.connectors.needsAuth, verb: 'authorize' };
    // A sign-in by device code shows the code to enter in the browser in place of the grey line: it is what the owner needs, not an explanation.
    case 'waiting': return { line: state.code || line, spin: true, words: P.state.waiting, verb: 'cancel' };
    case 'needs-login': return { line: state.login ? P.state.login(state.login) : line, tone: 'wait', words: P.state.needsLogin, verb: 'retry' };
    case 'missing': return { line: state.command ? P.state.notFound(state.command, state.install) : line, bad: Boolean(state.command), tone: 'bad', words: P.state.missing, verb: 'retry' };
    case 'error': return { line, tone: 'bad', words: errorWords(state.message), verb: 'retry' };
    default: return { line };
  }
}
