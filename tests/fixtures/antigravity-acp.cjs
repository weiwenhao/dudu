const { appendFileSync } = require('node:fs');
const { connect } = require('node:net');
const { createInterface } = require('node:readline');

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const sessionId = 'native-agy-1';

createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) return;
  let result;
  switch (method) {
    case 'initialize':
      result = { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { list: {}, resume: {} } } };
      break;
    case 'session/list':
      result = { sessions: [{ sessionId, cwd: process.cwd() }] };
      break;
    case 'session/resume': {
      const stallPort = process.env.DUDU_TEST_ACP_STALL_PORT;
      if (stallPort) {
        const control = connect(Number(stallPort), '127.0.0.1');
        control.once('close', () => process.exit());
        return;
      }
      result = {};
      break;
    }
    case 'session/prompt':
      appendFileSync('prompts.jsonl', `${JSON.stringify({ sessionId: params.sessionId, prompt: params.prompt })}\n`);
      send({ method: 'session/update', params: { sessionId, update: {
        sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done.' },
      } } });
      result = { stopReason: 'end_turn' };
      break;
    default:
      send({ id, error: { code: -32601, message: `Unexpected ACP method: ${method}` } });
      return;
  }
  send({ id, result });
});
