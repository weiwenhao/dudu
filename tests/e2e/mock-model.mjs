// A model on a local port that speaks OpenAI's chat completions over SSE, for end-to-end tests. A model is the one part of the thing
// that is outside the process, so it is the one part that is scripted: DSH runs for real, with its own loop, tools and logs, and
// reaches this server as it reaches any OpenAI-compatible gateway (the harness registers it as a provider route).
//
//   const model = await startMockModel({ replies });
//   model.url           http://127.0.0.1:<port>/v1
//   model.requests      what DSH asked, oldest first: { at, prompt, tools, system, toolResults, messages } (never the credential)
//   model.replies       the rules, which a test may replace between steps
//   await model.stop()
//
// Which reply is given follows from what the person said last: the rules are tried in order against that text, the first match answers,
// and with no match the model says "ok". A rule is
//
//   { when: string | RegExp | (context) => boolean,     the text of the last prompt contains it / matches it / the function says so
//     say?: string,                                      answer with this text
//     ask?: { question, options?: [label] , then?: (answer) => string },
//                                                        call DSH's question tool; when its result comes back, say `then(result)`
//                                                        (default: "got your answer: <result>")
//     calls?: [{ name, arguments }], then?: (results) => string,
//                                                        call these tools one after the other (a call whose tool is not offered ends
//                                                        the list); when the last result is back, say `then(results)`
//                                                        (default: "tool results: <results>")
//     fail?: { status, message },                        answer with an HTTP error
//     delay?: number }                                   wait this many ms before the first word (a turn that is seen to work)
//
// `context` is { prompt, hasToolResult, tools, system }. The prompt is the last message a person wrote, not the notes DSH adds to a turn.
import { createServer } from 'node:http';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const textOf = (content) => (typeof content === 'string' ? content : (Array.isArray(content) ? content : []).map((part) => part?.text ?? '').join('\n'));

// The notes DSH puts in the model's input as user messages (the runtime context, the time, a change of model, the instructions files of
// the folder): they are not what the person said. These are the openings DSH 0.2.0-rc.2 and 0.2.1-rc.3 write.
const NOTE = /^\s*(?:Current runtime context\.|Time sampled while preparing|\[model changed:|<system-reminder>)/;

function contextOf(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const system = textOf(messages.find((message) => message.role === 'system' || message.role === 'developer')?.content);
  let at = -1;
  messages.forEach((message, index) => { if (message.role === 'user' && !NOTE.test(textOf(message.content))) at = index; });
  const prompt = at < 0 ? '' : textOf(messages[at].content);
  const results = messages.slice(at + 1).filter((message) => message.role === 'tool');
  const tools = (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name).filter(Boolean);
  return { prompt, system, tools, hasToolResult: results.length > 0, toolResults: results.map((message) => textOf(message.content)), messages };
}

const matches = (rule, context) => {
  const when = rule.when;
  if (when === undefined) return true;
  if (typeof when === 'function') return Boolean(when(context));
  if (when instanceof RegExp) return when.test(context.prompt);
  return context.prompt.includes(String(when));
};

export async function startMockModel({ replies = [] } = {}) {
  const state = { replies, requests: [], sockets: new Set() };
  let counter = 0;

  const chunk = (id, model, delta, finish = null, extra = {}) => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
  const usage = (id, model, inputs, outputs) => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [], usage: { prompt_tokens: inputs, completion_tokens: outputs, total_tokens: inputs + outputs } })}\n\n`;

  async function answer(request, response) {
    const chunks = [];
    for await (const part of request) chunks.push(part);
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'The body is not JSON.', type: 'invalid_request_error' } })); return; }
    const context = contextOf(body);
    const model = body.model ?? 'mock-1';
    state.requests.push({ at: Date.now(), model, prompt: context.prompt, system: context.system.slice(0, 200), tools: context.tools, toolSchemas: body.tools ?? [], toolResults: context.toolResults, messages: context.messages.map((message) => ({ role: message.role, text: textOf(message.content).slice(0, 4000) })) });

    // DSH asks the model for a title of a session with the same route: a title is what it gets.
    const titling = /concise title/i.test(context.system) || /concise title/i.test(context.prompt);
    const rule = titling ? { say: 'Title' } : (state.replies.find((candidate) => matches(candidate, context)) ?? { say: 'ok' });
    if (rule.delay) await sleep(rule.delay);
    if (rule.fail) {
      response.writeHead(rule.fail.status ?? 400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: rule.fail.message ?? 'The model refused.', type: 'invalid_request_error', code: 'mock_failure' } }));
      return;
    }

    const id = `chatcmpl-mock-${++counter}`;
    // The tool this step calls, if any: the question tool once, or the next of the list of calls.
    const step = context.toolResults.length;
    const call = rule.ask && !context.hasToolResult && context.tools.includes('ask_user_question')
      ? { name: 'ask_user_question', arguments: askArguments(rule.ask) }
      : (!rule.ask && rule.calls && step < rule.calls.length && context.tools.includes(rule.calls[step].name) ? rule.calls[step] : null);
    const text = call ? '' : rule.ask && context.hasToolResult
      ? (rule.ask.then ?? ((result) => `got your answer: ${result}`))(context.toolResults.at(-1) ?? '')
      : rule.calls ? (rule.then ?? ((results) => `tool results: ${results.join(' / ')}`))(context.toolResults)
      : (rule.say ?? 'ok');

    if (body.stream === false) {
      const message = call
        ? { role: 'assistant', content: null, tool_calls: [{ id: `call_mock_${step + 1}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] }
        : { role: 'assistant', content: text };
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message, finish_reason: call ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } }));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    response.write(chunk(id, model, { role: 'assistant', content: '' }));
    if (call) {
      const args = JSON.stringify(call.arguments);
      response.write(chunk(id, model, { tool_calls: [{ index: 0, id: `call_mock_${step + 1}`, type: 'function', function: { name: call.name, arguments: '' } }] }));
      for (let at = 0; at < args.length; at += 24) response.write(chunk(id, model, { tool_calls: [{ index: 0, function: { arguments: args.slice(at, at + 24) } }] }));
      response.write(chunk(id, model, {}, 'tool_calls'));
    } else {
      for (const piece of text.match(/[\s\S]{1,12}/g) ?? ['']) response.write(chunk(id, model, { content: piece }));
      response.write(chunk(id, model, {}, 'stop'));
    }
    response.write(usage(id, model, 20, 5));
    response.end('data: [DONE]\n\n');
  }

  const askArguments = ({ question, options }) => ({ questions: [{ id: 'q1', question, ...(options ? { options: options.map((label) => ({ label })) } : {}) }] });

  const server = createServer((request, response) => {
    if (request.method === 'POST' && /\/chat\/completions$/.test(request.url ?? '')) {
      answer(request, response).catch((error) => { if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: { message: String(error?.message ?? error) } })); });
    } else if (request.method === 'GET' && /\/models$/.test(request.url ?? '')) {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ object: 'list', data: [{ id: 'mock-1', object: 'model' }] }));
    } else {
      response.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'Not found.' } }));
    }
  });
  server.on('connection', (socket) => { state.sockets.add(socket); socket.on('close', () => state.sockets.delete(socket)); });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}/v1`,
    get requests() { return state.requests; },
    get replies() { return state.replies; },
    set replies(next) { state.replies = next; },
    async stop() {
      for (const socket of state.sockets) socket.destroy();
      await new Promise((done) => server.close(done));
    },
  };
}
