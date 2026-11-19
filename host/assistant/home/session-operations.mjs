import { createNativeSessionActivity } from '../../native-session-activity.mjs';
import { mapPresets, streamHandle, summaryFrom } from '../../native-bridge.mjs';
import { validateAnswers } from '../../native-conversation.mjs';

const fail = (code) => { throw Object.assign(new Error(code), { code }); };

/** The same bounded host operations used by native session controls. No caller-selected RPC or raw command line. */
export function createAssistantSessionOperations({ rpc, dsh, controller }) {
  const remote = {
    async call(endpoint, ...args) {
      const answer = await rpc.call('/api', endpoint, ...args);
      if (answer?.ok === false) fail('upstream_error');
      return answer?.ok === true ? answer.value : answer;
    },
    open: (endpoint, ...args) => rpc.open('/api', endpoint, ...args),
  };
  const activity = createNativeSessionActivity({
    remote, streamHandle, fail, summaryOf: summaryFrom,
    rowOf: async (id) => {
      const result = await controller.list();
      return (result.items ?? result).find((row) => (row.sessionId ?? row.id) === id);
    },
  });
  return {
    models: () => controller.modelCatalog(),
    async execute(action, args) {
      if (action === 'catalog') {
        const [models, permissions, presets] = await Promise.all([
          controller.modelCatalog(), remote.call('permissionPresets/catalog'), remote.call('agentPresets/list'),
        ]);
        return { outcome: 'success', models, permissions: permissions?.options ?? [], presets: mapPresets(presets) };
      }
      if (action === 'project-rename' || action === 'project-delete') {
        await remote.call(action === 'project-rename' ? 'workspace/rename' : 'workspace/delete', {
          workspaceId: args.id, ...(action === 'project-rename' ? { title: args.title } : {}),
        });
        return { outcome: 'success' };
      }
      const id = /^dsh:(.+)$/su.exec(args.session)?.[1];
      if (!id || id.startsWith('dudu-assistant-')) return { outcome: 'needs_clarification', code: 'invalid_session' };
      switch (action) {
        case 'archive':
          await dsh.archive(id, { stop: args.stop === true });
          return { outcome: 'success' };
        case 'unarchive':
          await dsh.unarchive(id);
          return { outcome: 'success' };
        case 'pin':
          await remote.call(args.pinned ? 'workspace/pinSession' : 'workspace/unpinSession', { sessionId: id });
          return { outcome: 'success' };
        case 'prompt':
          if (!args.text?.trim() && !args.attachments?.length) return { outcome: 'needs_clarification', code: 'invalid_message' };
          await dsh.unarchive(id);
          await dsh.prompt(id, args.text ?? '', { attachments: args.attachments ?? [], requestId: args.requestId, steer: args.steer === true });
          return { outcome: 'success', accepted: true };
        case 'preset': {
          const catalog = mapPresets(await remote.call('agentPresets/list'));
          if (!catalog.some((preset) => preset.id === args.preset)) return { outcome: 'needs_clarification', code: 'invalid_preset' };
          await remote.call('agentPresets/select', id, args.preset);
          return { outcome: 'success' };
        }
        case 'questions': {
          const value = await remote.call('session/projections', { sessionId: id });
          return { outcome: 'success', questions: value?.values?.userQuestions?.active ?? [] };
        }
        case 'answer': {
          const value = await remote.call('session/projections', { sessionId: id });
          const call = value?.values?.userQuestions?.active?.find((call) => call.callId === args.callId);
          const answer = validateAnswers(call, args.answers);
          const accepted = await remote.call('userQuestions/answer', id, args.callId, answer);
          return { outcome: accepted === true ? 'success' : 'error', ...(accepted === true ? {} : { code: 'stale_question' }) };
        }
        case 'rename':
          await dsh.renameTitle(id, args.title);
          return { outcome: 'success' };
        case 'model': {
          const catalog = await controller.modelCatalog();
          const model = catalog.groups.find((group) => group.id === args.provider)?.models.find((model) => model.id === args.model);
          if (!model || args.reasoningEffort && !model.reasoning?.efforts?.some((effort) => effort.id === args.reasoningEffort)) return { outcome: 'needs_clarification', code: 'invalid_model' };
          await dsh.selectModel(id, args);
          return { outcome: 'success' };
        }
        case 'queue': {
          if (args.action === 'edit' && (typeof args.text !== 'string' || !args.text.trim() || args.text.length > 60_000)) return { outcome: 'needs_clarification', code: 'invalid_message' };
          const change = { kind: args.action, ...(args.action === 'edit' ? { content: [{ type: 'text', text: args.text }] } : {}) };
          await remote.call('session/updateQueue', { sessionId: id, itemId: args.itemId, action: change });
          return { outcome: 'success' };
        }
        case 'command': {
          if (!['goal', 'plan', 'compact'].includes(args.command) || args.command === 'compact' && args.argument
            || /[\u0000-\u001f\u007f]/u.test(args.argument ?? '')) return { outcome: 'needs_clarification', code: 'invalid_command' };
          const result = await remote.call('commands/execute', {
            agentId: id, line: `/${args.command}${args.argument?.trim() ? ` ${args.argument.trim()}` : ''}`, submittedAttachments: [],
          });
          return { outcome: result?.result?.kind === 'success' ? 'success' : 'error', result: result?.result };
        }
        case 'fork':
          return { outcome: 'success', ...await remote.call('session/fork', { sessionId: id, atSeq: args.sourceEventSeq }) };
        case 'team': case 'jobs': case 'job-output': case 'job-stop': {
          const method = { team: 'session.team', jobs: 'session.jobs', 'job-output': 'session.job.output', 'job-stop': 'session.job.stop' }[action];
          return { outcome: 'success', ...await activity.dispatch(method, { id, ...(args.jobId ? { jobId: args.jobId } : {}) }) };
        }
        default: return { outcome: 'error', code: 'unknown_action' };
      }
    },
  };
}
