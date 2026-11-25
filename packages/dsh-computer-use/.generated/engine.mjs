// Generated from @deepseek-ai/dsh-tool-executor-ptc@0.2.2-rc.3; see upstream.json and README.md.
export const imports = ["@deepseek-ai/cordis","@deepseek-ai/dsh-brand","@deepseek-ai/dsh-llm","@deepseek-ai/dsh-sandbox","@deepseek-ai/dsh-scope","@deepseek-ai/dsh-tools","@deepseek-ai/dsh-tools/pipeline","@deepseek-ai/dsh-util-values"];
export function createEngine(dependencies) {
  const module = { exports: {} };
  const exports = module.exports;
  const require = (name) => {
    if (!Object.hasOwn(dependencies, name)) throw new Error('Missing DSH dependency: ' + name);
    return dependencies[name];
  };
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// packages/dsh-computer-use/entry.mjs
var entry_exports = {};
__export(entry_exports, {
  createProgramTransport: () => createProgramTransport
});
module.exports = __toCommonJS(entry_exports);
var import_dsh_tools2 = require("@deepseek-ai/dsh-tools");
var import_pipeline3 = require("@deepseek-ai/dsh-tools/pipeline");

// packages/dsh-computer-use/vendor/ptc.ts
var import_cordis = require("@deepseek-ai/cordis");
var import_dsh_brand = require("@deepseek-ai/dsh-brand");
var import_dsh_llm2 = require("@deepseek-ai/dsh-llm");
var import_dsh_sandbox = require("@deepseek-ai/dsh-sandbox");
var import_dsh_util_values = require("@deepseek-ai/dsh-util-values");
var import_dsh_tools = require("@deepseek-ai/dsh-tools");
var import_pipeline = require("@deepseek-ai/dsh-tools/pipeline");
var import_dsh_scope = require("@deepseek-ai/dsh-scope");

// packages/dsh-computer-use/vendor/errors.ts
var import_dsh_llm = require("@deepseek-ai/dsh-llm");
var ToolCallLimitExceededError = class extends Error {
  /**
   * Describe the rejected call and how to correct the program.
   * @param limit - Timeout-derived maximum tool-call attempts for one run_code invocation.
   * @param callNumber - One-based attempt rejected without invoking the tool.
   * @param callsPerMinute - Attempts granted per minute of run_code timeout.
   */
  constructor(limit, callNumber, callsPerMinute) {
    super(`run_code exceeded its limit of ${limit} tool calls (${callsPerMinute} per minute of its timeout); call ${callNumber} was not dispatched. The run_code program may contain an infinite loop. Check loop termination or split the work into smaller run_code calls.`);
    this.name = "ToolCallLimitExceededError";
  }
};
var CodeRunFailedError = class extends import_dsh_llm.HarnessError {
  constructor(message) {
    super(message, "CODE_RUN_FAILED");
    this.name = "CodeRunFailedError";
  }
};

// packages/dsh-computer-use/vendor/ptc.ts
function runCodeFlavor(language, execution = {
  programDescription: "the program to execute",
  outputInstruction: "Curate the program output.",
  codeDescription: `The ${language} program to execute, following this tool's execution instructions.`
}) {
  return {
    description: `Execute a ${language} program against the available tools. Takes two required arguments: \`code\`, ${execution.programDescription}, and \`description\`, a short summary of what the program does. Call tools as \`await tools.name(args)\` per the declarations in the system prompt. ${execution.outputInstruction} Image-bearing subtool results are attached after the run.`,
    codeDescription: execution.codeDescription
  };
}
var TYPESCRIPT_FLAVOR = runCodeFlavor("TypeScript");
var TYPESCRIPT_FUNCTION_FLAVOR = runCodeFlavor("TypeScript", {
  programDescription: "the BODY of an async function (erasable syntax only; top-level `await` and `return` work)",
  outputInstruction: "Only what you print or return is program output \u2014 curate it.",
  codeDescription: "The program: the body of an async TypeScript function."
});
var PYTHON_FLAVOR = runCodeFlavor("Python");
var RUN_CODE_FLAVORS = {
  typescript: TYPESCRIPT_FLAVOR,
  python: PYTHON_FLAVOR
};
function requirePtcRuntime(ctx) {
  const runtime = ctx.get("ptcRuntime");
  if (runtime === void 0) {
    throw new Error('dsh-tools: mode "ptc" requires a PTC runtime \u2014 load a ctx.ptcRuntime implementation (e.g. @deepseek-ai/dsh-ptc-runtime-node) or load @deepseek-ai/dsh-tool-executor-native');
  }
  if (!Object.hasOwn(RUN_CODE_FLAVORS, runtime.language)) {
    const known = Object.keys(RUN_CODE_FLAVORS).map((name) => JSON.stringify(name)).join(", ");
    throw new Error(`dsh-tools: no SDK renderer registered for runtime language ${JSON.stringify(runtime.language)} (known: ${known})`);
  }
  return runtime;
}
var RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION = 'Clear, concise description of what this program does in active voice, 5-10 words (shown in the UI). Examples: "Count TODO markers across packages"; "Read failing test and its fixture"; "Rename config key in every cordis.yml".';
var RUN_CODE_CONTROLS = {
  timeoutMs: { type: "number", description: "Positive elapsed-time budget in milliseconds, capped by the deployment maximum." },
  sandbox_permissions: { type: "string", enum: [...import_dsh_sandbox.ESCALATION_TARGETS], description: "Wider sandbox mode for this complete program execution; requires justification and approval." },
  justification: { type: "string", description: "Reason this complete program needs wider access, shown to the user for approval. Use the language of the user\u2019s current request." }
};
function controlParameters(runtime) {
  return {
    ...runtime.timeout === void 0 ? {} : {
      timeoutMs: {
        ...RUN_CODE_CONTROLS.timeoutMs,
        description: `Positive elapsed-time budget in milliseconds, including nested tool and approval waits. Default ${runtime.timeout.defaultMs}; capped at ${runtime.timeout.maxMs}. Zero does not disable the deadline.`
      }
    },
    ...runtime.sandboxMode === void 0 ? {} : {
      sandbox_permissions: RUN_CODE_CONTROLS.sandbox_permissions,
      justification: RUN_CODE_CONTROLS.justification
    }
  };
}
function escalationGuidance(mode) {
  return mode === void 0 ? "" : " A sandbox escalation approves this complete program for one execution only. Nested tools retain their own policies and approvals. Request wider access only after evidence of a denial. Earlier effects may already have completed: inspect them before explicitly retrying. Programs are never replayed automatically.";
}
function resolveFlavor(runtime) {
  return runtime.language === "typescript" && runtime.programFormat === "function-body" ? TYPESCRIPT_FUNCTION_FLAVOR : RUN_CODE_FLAVORS[runtime.language];
}
function jsonNormalizeArgs(value) {
  let snapshot;
  try {
    snapshot = (0, import_dsh_util_values.snapshotJsonValue)(value);
  } catch (error) {
    throw new Error(`tool arguments must be lossless JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (snapshot === void 0) {
    throw new Error("tool arguments must be lossless JSON (call the tool with an arguments object, e.g. `{}`)");
  }
  const logged = (0, import_dsh_util_values.snapshotJsonValue)(snapshot);
  if (logged === void 0) {
    throw new Error("tool arguments could not be detached for durable logging");
  }
  return { dispatched: snapshot, logged };
}
var JSON_INDENT = "  ";
var MAX_JSON_INDENT_CHARS = 10;
function renderJsonValue(value) {
  const chunks = [];
  const tasks = [{ kind: "value", value, depth: 0, compact: false }];
  for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
    if (task.kind === "text") {
      chunks.push(task.text);
      continue;
    }
    const current = task.value;
    if (current === null || typeof current === "boolean" || typeof current === "number") {
      chunks.push(String(current));
      continue;
    }
    if (typeof current === "string") {
      chunks.push(JSON.stringify(current));
      continue;
    }
    const compact = task.compact || (task.depth + 1) * JSON_INDENT.length > MAX_JSON_INDENT_CHARS;
    const childDepth = task.depth + 1;
    if (Array.isArray(current)) {
      chunks.push("[");
      if (current.length === 0) {
        chunks.push("]");
        continue;
      }
      tasks.push({ kind: "text", text: compact ? "]" : `
${JSON_INDENT.repeat(task.depth)}]` });
      for (let index = current.length - 1; index >= 0; index--) {
        const item = current[index];
        if (item === void 0) throw new Error("cannot render a sparse JSON array");
        tasks.push({ kind: "value", value: item, depth: childDepth, compact });
        tasks.push({
          kind: "text",
          text: compact ? index === 0 ? "" : "," : `${index === 0 ? "\n" : ",\n"}${JSON_INDENT.repeat(childDepth)}`
        });
      }
      continue;
    }
    const keys = Object.keys(current);
    chunks.push("{");
    if (keys.length === 0) {
      chunks.push("}");
      continue;
    }
    tasks.push({ kind: "text", text: compact ? "}" : `
${JSON_INDENT.repeat(task.depth)}}` });
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index];
      if (key === void 0) throw new Error("cannot render a missing JSON object key");
      const item = current[key];
      if (item === void 0) throw new Error("cannot render an undefined JSON object property");
      tasks.push({ kind: "value", value: item, depth: childDepth, compact });
      tasks.push({
        kind: "text",
        text: compact ? `${index === 0 ? "" : ","}${JSON.stringify(key)}:` : `${index === 0 ? "\n" : ",\n"}${JSON_INDENT.repeat(childDepth)}${JSON.stringify(key)}: `
      });
    }
  }
  return chunks.join("");
}
function renderValue(value) {
  return typeof value === "string" ? value : renderJsonValue(value);
}
async function resolveWorkingDirectory(ctx, exec) {
  if (exec.agent === void 0) return void 0;
  const directories = ctx.get("workingDirectory");
  if (directories === void 0) throw new Error("dsh-tools: run_code with an Agent requires workingDirectory");
  return directories.ensure(exec.agent, exec.signal);
}
function resolveSandboxPolicy(ctx, exec) {
  const policy = ctx.get("sandboxPolicy");
  if (policy === void 0) throw new Error("dsh-tools: confined PTC runtime requires sandboxPolicy");
  return policy.resolve(exec.agent === void 0 ? {} : { session: exec.agent.session });
}
function createRunCodeTool(ctx, executor, config, calls) {
  const { maxSubCallsPerMinute, maxParallelSubCalls: maxParallel } = config;
  const tools = ctx.tools;
  const logger = ctx.logger;
  async function shapeDispatchLog(dispatch) {
    try {
      return await ctx.waterfall(
        (0, import_dsh_scope.scopeTarget)(tools, dispatch.agent),
        "tools/ptc-dispatch-log",
        dispatch,
        () => Promise.resolve(dispatch.content)
      );
    } catch (error) {
      logger.warn(`tools: ptc-dispatch-log listener failed for ${dispatch.name}: ${(0, import_pipeline.toolErrorMessage)(error)}; logging the original settled content`);
      return dispatch.content;
    }
  }
  const stateOwners = /* @__PURE__ */ new WeakMap();
  const definition = (0, import_dsh_tools.defineTool)({
    name: import_dsh_tools.RUN_CODE_NAME,
    // The description and `code` parameter description are placeholders here:
    // the language-aware getters installed below replace both, resolving the
    // loaded runtime's flavor at schema-emission time so the schema the MODEL
    // sees matches the SDK section's language. Argument VALIDATION still keys
    // off this static spec (defineTool closes over it), which is language-
    // independent (one required string `code`).
    description: TYPESCRIPT_FLAVOR.description,
    parameters: {
      code: { type: "string", required: true, description: TYPESCRIPT_FLAVOR.codeDescription },
      description: {
        type: "string",
        required: true,
        description: RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION
      },
      ...RUN_CODE_CONTROLS
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          logs: { type: "array", required: true, items: { type: "string" } },
          result: { type: "json" },
          sandbox: {
            type: "object",
            additionalProperties: false,
            properties: {
              mode: { type: "string", required: true, enum: ["read-only", "workspace-write", "danger-full-access"] },
              denied: { type: "boolean", required: true },
              enforcement: { type: "string", enum: ["full", "partial"] }
            }
          }
        }
      },
      render: (_args, value) => {
        const rendered = value.result === void 0 ? "" : renderValue(value.result);
        const parts = [value.logs.join("\n"), rendered].filter((part) => part.length > 0);
        if (value.sandbox?.enforcement === "partial") parts.push("File sandbox enforcement is partial on this host.");
        if (value.sandbox?.denied) parts.push(`The ${value.sandbox.mode} file sandbox denied an operation.${escalationGuidance(ctx.get("ptcRuntime")?.sandboxMode)}`);
        return [{ type: "text", text: parts.length > 0 ? parts.join("\n") : "(run_code completed with no output)" }];
      }
    },
    async execute(args, exec) {
      if (args.description.trim().length === 0) {
        throw new Error("invalid description: expected a non-empty string");
      }
      const runtime = requirePtcRuntime(ctx);
      const run = async (callSignal) => {
        (0, import_dsh_sandbox.validateEscalationArgs)(args.sandbox_permissions, args.justification);
        if (args.timeoutMs !== void 0 && runtime.timeout === void 0) {
          throw new Error("timeoutMs is not available for this PTC runtime");
        }
        if (args.timeoutMs !== void 0 && (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0)) {
          throw new Error("invalid timeoutMs: expected a positive finite number");
        }
        const standingPolicy = runtime.sandboxMode === void 0 ? void 0 : resolveSandboxPolicy(ctx, exec);
        let policy = standingPolicy;
        if (args.sandbox_permissions !== void 0 && args.justification !== void 0) {
          if (standingPolicy === void 0) throw new Error("sandbox_permissions is not available for this PTC runtime");
          const approvedMode = await (0, import_dsh_sandbox.approveEscalation)({
            requestedMode: args.sandbox_permissions,
            justification: args.justification,
            effectiveMode: standingPolicy.mode,
            subject: "program"
          }, {
            approver: ctx.get("approval"),
            agent: exec.agent,
            callId: exec.callId,
            toolName: import_dsh_tools.RUN_CODE_NAME,
            signal: callSignal
          });
          policy = { ...standingPolicy, mode: approvedMode };
        }
        const cwd = await resolveWorkingDirectory(ctx, { ...exec, signal: callSignal });
        callSignal.throwIfAborted();
        const runController = new AbortController();
        const onOuterAbort = () => {
          runController.abort(callSignal.reason);
        };
        callSignal.addEventListener("abort", onOuterAbort, { once: true });
        let toolCallAttempts = 0;
        let maxSubCalls;
        const pendingQueue = [];
        const inFlight = /* @__PURE__ */ new Set();
        const logWork = /* @__PURE__ */ new Set();
        const commitQueue = [];
        let exclusiveActive = false;
        let driving = false;
        let driverRun = Promise.resolve();
        let wake;
        const wakeup = () => {
          const release = wake;
          wake = void 0;
          release?.();
        };
        const drive = () => {
          if (driving) return driverRun;
          driving = true;
          driverRun = (async () => {
            try {
              for (; ; ) {
                const signal = new Promise((resolve) => {
                  wake = resolve;
                });
                const commitHead = commitQueue[0];
                if (commitHead !== void 0 && commitHead.settled) {
                  commitQueue.shift();
                  await commitHead.commit();
                  if (commitHead.mode === "exclusive") exclusiveActive = false;
                  continue;
                }
                const head = pendingQueue[0];
                if (head !== void 0) {
                  if (runController.signal.aborted) {
                    pendingQueue.shift();
                    head.abandon();
                    continue;
                  }
                  const mode = head.classify();
                  const capacity = !exclusiveActive && (mode === "exclusive" ? inFlight.size === 0 : inFlight.size < maxParallel);
                  if (capacity) {
                    if (mode === "exclusive") exclusiveActive = true;
                    head.mode = mode;
                    pendingQueue.shift();
                    commitQueue.push(head);
                    await head.start();
                    const flight = head.flight.finally(() => {
                      inFlight.delete(flight);
                      wakeup();
                    });
                    inFlight.add(flight);
                    continue;
                  }
                }
                if (pendingQueue.length === 0 && commitQueue.length === 0 && inFlight.size === 0) return;
                await signal;
              }
            } finally {
              driving = false;
              wake = void 0;
            }
          })();
          return driverRun;
        };
        const drainDispatches = async () => {
          await drive();
          while (logWork.size > 0) await Promise.allSettled([...logWork]);
        };
        const runOver = () => runController.signal.aborted;
        const binding = (schema) => async (rawArgs) => {
          const { name } = schema;
          if (runOver()) {
            throw new Error(`run_code run is over (${String(runController.signal.reason)}); ${name} not dispatched`);
          }
          const n = ++toolCallAttempts;
          if (n > maxSubCalls) {
            const error = new ToolCallLimitExceededError(maxSubCalls, n, maxSubCallsPerMinute);
            runController.abort(error);
            throw error;
          }
          const normalized = jsonNormalizeArgs(rawArgs);
          const subCallId = (0, import_dsh_brand.brandString)(`${String(exec.callId)}:ptc:${n}`);
          const input = {
            callId: subCallId,
            rootCallId: exec.rootCallId,
            name,
            schema,
            arguments: normalized.dispatched,
            ...exec.agent ? { agent: exec.agent } : {},
            ...exec.toolSet !== void 0 ? { toolSet: exec.toolSet } : {},
            parent: exec.token,
            signal: runController.signal
          };
          const outcome = await new Promise((resolve, reject) => {
            let parked;
            const settle = (result) => {
              resolve(result.isError ? { isError: true, message: result.error.message } : { isError: false, value: result.value });
              const agent = exec.agent;
              if (agent === void 0) return;
              const task = (async () => {
                const logged = await shapeDispatchLog({
                  exec,
                  agent,
                  subCallId,
                  name,
                  isError: result.isError,
                  // The registry deep-froze this projection at result
                  // finalization; append snapshots the final copy again, so
                  // the log stays detached.
                  content: result.content
                });
                agent.session.append("tool/ptc-dispatch", {
                  rootCallId: exec.rootCallId,
                  parentCallId: exec.callId,
                  subCallId,
                  name,
                  // The SIBLING parse of the dispatched value: byte-identical JSON,
                  // but a separate object — a tool mutating its args cannot desync
                  // this record from what it actually received.
                  arguments: normalized.logged,
                  isError: result.isError,
                  ...result.error?.info === void 0 ? {} : { error: result.error.info },
                  content: logged,
                  ...result.meta === void 0 ? {} : { meta: result.meta }
                });
              })().finally(() => {
                logWork.delete(task);
              });
              logWork.add(task);
            };
            pendingQueue.push({
              flight: Promise.resolve(),
              settled: false,
              // Re-read per driver pass against the same agent view the SDK
              // declared; fail-closed exclusive when undeclared/invalid.
              classify: () => executor.executionMode(input).kind,
              abandon: () => {
                reject(new Error(`run_code run is over (${String(runController.signal.reason)}); ${name} tool call abandoned`));
              },
              async start() {
                exec.agent?.session.append("tool/ptc-dispatch-start", {
                  rootCallId: exec.rootCallId,
                  parentCallId: exec.callId,
                  subCallId,
                  name,
                  arguments: normalized.logged
                });
                const prepared = await executor.prepare(input);
                if (prepared.kind === "dispatch") {
                  this.flight = executor.dispatch(prepared.exec).then((dispatchOutcome) => {
                    parked = { kind: dispatchOutcome.kind, exec: prepared.exec, result: dispatchOutcome.result };
                    this.settled = true;
                  });
                  return;
                }
                parked = { kind: prepared.kind, exec: prepared.exec, result: prepared.result };
                this.settled = true;
              },
              async commit() {
                if (parked === void 0) return;
                const result = await executor.complete(parked.exec, parked);
                if (!result.isError && result.content.some((block) => block.type === "image")) {
                  exec.deferContext((0, import_dsh_llm2.createUserMessage)({
                    content: result.content,
                    source: { kind: "ptc-mode" }
                  }));
                }
                for (const context of result.additionalContexts ?? []) {
                  exec.deferContext(context);
                }
                if (result.concludesTurn) exec.concludeTurn();
                settle(result);
                while (logWork.size > maxParallel) await Promise.race(logWork);
              }
            });
            wakeup();
            void drive();
          });
          if (runOver()) {
            throw new Error(`run_code run is over (${String(runController.signal.reason)}); ${name} result discarded`);
          }
          if (outcome.isError) throw new Error(outcome.message);
          return outcome.value;
        };
        const functions = /* @__PURE__ */ Object.create(null);
        for (const schema of tools.schemas(exec.agent, exec.toolSet)) {
          Object.defineProperty(functions, schema.name, { enumerable: true, value: binding((0, import_dsh_util_values.deepFreeze)(schema)) });
        }
        try {
          let result;
          try {
            if (exec.agent !== void 0) {
              const agent = exec.agent;
              let runtimes = stateOwners.get(agent);
              if (runtimes === void 0) stateOwners.set(agent, runtimes = /* @__PURE__ */ new WeakSet());
              let provider = runtime;
              for (; ; ) {
                const original = provider[import_cordis.symbols.original];
                if (original === void 0) break;
                provider = original;
              }
              if (!runtimes.has(provider)) {
                agent.ctx.effect(() => () => runtime.release(agent), "PTC retained environment");
                runtimes.add(provider);
              }
            }
            const spec = runtime.resolve({
              program: args.code,
              ...exec.agent === void 0 || policy?.mode !== standingPolicy?.mode ? {} : { stateOwner: exec.agent },
              bindings: [{
                global: "tools",
                functions,
                errorClass: { name: "ToolCallError", memberNameProperty: "toolName" }
              }],
              signal: runController.signal,
              ...cwd !== void 0 ? { cwd } : {},
              ...policy !== void 0 ? { sandboxPolicy: policy } : {},
              ...args.timeoutMs !== void 0 ? { timeoutMs: args.timeoutMs } : {}
            });
            maxSubCalls = spec.timeoutMs === null ? Infinity : Math.floor(spec.timeoutMs / 6e4 * maxSubCallsPerMinute);
            result = await runtime.run(spec);
          } finally {
            runController.abort("run_code settled");
            await drainDispatches();
          }
          if (result.error) {
            const limitError = runController.signal.reason instanceof ToolCallLimitExceededError ? runController.signal.reason : void 0;
            if (result.error.kind === "abort" && exec.signal.aborted && limitError === void 0) {
              const message = runtime.retainsState ? `tool call aborted: ${result.error.message}` : "tool call aborted";
              const error = new import_dsh_llm2.HarnessError(message, import_dsh_tools.TOOL_ABORTED);
              error.name = "AbortError";
              throw error;
            }
            const logsText = result.logs.length > 0 ? `
Captured output:
${result.logs.join("\n")}` : "";
            const sandboxText = result.sandbox === void 0 ? "" : `
File sandbox: ${result.sandbox.mode}${result.sandbox.enforcement === void 0 ? "" : `; enforcement: ${result.sandbox.enforcement}`}${result.sandbox.denied ? "; operation denied" : ""}.`;
            const failureText = limitError === void 0 || limitError.message === result.error.message ? result.error.message : `${limitError.message}
${result.error.message}`;
            throw new CodeRunFailedError(`code run failed (${result.error.kind}): ${failureText}${logsText}${sandboxText}${result.sandbox?.denied ? escalationGuidance(runtime.sandboxMode) : ""}`);
          }
          return {
            logs: result.logs,
            ...result.sandbox === void 0 ? {} : { sandbox: result.sandbox },
            ...result.value !== void 0 ? { result: result.value } : {}
          };
        } finally {
          callSignal.removeEventListener("abort", onOuterAbort);
        }
      };
      return exec.agent === void 0 || runtime.sandboxMode === void 0 && !runtime.retainsState ? run(exec.signal) : calls.run(
        exec.agent.session.id,
        exec.signal,
        () => runtime.sandboxMode === void 0 ? void 0 : resolveSandboxPolicy(ctx, exec).mode,
        run
      );
    },
    // The model-authored description is the call's always-visible UI label
    // (the bash `description` precedent); the program itself rides rawInput.
    presentCall: (args) => ({
      card: "generic",
      title: args.description,
      kind: "execute",
      rawInput: args.code
    })
    // Deliberately no presentResult: the generic card fallback keeps this
    // title and reads durable result content without duplicating a large raw
    // result into the host view payload.
  });
  Object.defineProperty(definition, "description", {
    enumerable: true,
    get: () => {
      const runtime = requirePtcRuntime(ctx);
      const instructions = runtime.executionInstructions;
      return resolveFlavor(runtime).description + (instructions ? ` ${instructions}` : "") + " Each program starts in the Session's current directory. Running programs keep their initial directory." + escalationGuidance(runtime.sandboxMode);
    }
  });
  Object.defineProperty(definition, "parameters", {
    enumerable: true,
    // Recompile through the same spec→schema projection defineTool used, so
    // the emitted schema always matches the validated specification.
    get: () => {
      const runtime = requirePtcRuntime(ctx);
      return (0, import_dsh_tools.parameterSchemaSpecToJsonSchema)({
        code: { type: "string", required: true, description: resolveFlavor(runtime).codeDescription },
        description: { type: "string", required: true, description: RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION },
        ...controlParameters(runtime)
      });
    }
  });
  return definition;
}

// packages/dsh-computer-use/vendor/ptc-calls.ts
var import_pipeline2 = require("@deepseek-ai/dsh-tools/pipeline");
var PtcCalls = class {
  calls = /* @__PURE__ */ new Map();
  resets = /* @__PURE__ */ new Map();
  disposed = false;
  /**
   * Observe policy changes for the owning executor.
   * @param ctx - Executor lifecycle and Session events.
   */
  constructor(ctx) {
    ctx.on("session/event", (session, event) => {
      if (event.type !== "sandbox/mode") return;
      for (const call of this.calls.get(session.id) ?? []) {
        if (call.mode !== void 0 && call.mode !== event.data.mode) call.controller.abort(new Error("sandbox mode changed"));
      }
    }, { global: true });
    ctx.effect(() => async () => {
      this.disposed = true;
      const calls = [...this.calls.values()].flatMap((calls2) => [...calls2]);
      for (const call of calls) call.controller.abort(new Error("PTC tool executor disposed"));
      await Promise.allSettled([...calls.map((call) => call.done), ...[...this.resets.values()].map((reset) => reset.done)]);
    }, "PTC calls");
  }
  /**
   * Await canceled predecessors before resolving authority and admitting a call.
   * @param sessionId - Calling Session.
   * @param signal - Caller cancellation.
   * @param mode - Current standing mode, if supported, read after preceding cleanup.
   * @param run - Complete call, including nested-tool cleanup.
   * @returns The call result.
   */
  async run(sessionId, signal, mode, run) {
    for (; ; ) {
      const reset = this.resets.get(sessionId);
      if (reset !== void 0) {
        try {
          await reset.done;
        } catch (error) {
          throw new CodeRunFailedError(`Program environment unavailable: ${(0, import_pipeline2.toolErrorMessage)(error)}. Ask the host to reset it before running more code.`);
        }
        continue;
      }
      const pending = [...this.calls.get(sessionId) ?? []].filter((call2) => call2.signal.aborted);
      if (pending.length === 0) break;
      await Promise.all(pending.map((call2) => call2.done));
    }
    signal.throwIfAborted();
    if (this.disposed) throw new Error("PTC tool executor disposed");
    const controller = new AbortController();
    const done = Promise.withResolvers();
    const currentSignal = AbortSignal.any([signal, controller.signal]);
    const call = { mode: mode(), controller, signal: currentSignal, done: done.promise };
    let calls = this.calls.get(sessionId);
    if (calls === void 0) this.calls.set(sessionId, calls = /* @__PURE__ */ new Set());
    calls.add(call);
    try {
      return await run(currentSignal);
    } finally {
      calls.delete(call);
      if (calls.size === 0) this.calls.delete(sessionId);
      done.resolve(void 0);
    }
  }
  /**
   * Cancel calls and release their environment independently of program cooperation.
   * A failed release blocks new calls until a later reset succeeds.
   * @param sessionId - Calling Session.
   * @param release - Host operation that terminates and cleans the owned environment.
   * @param notify - Queue the state-loss notice after cleanup and before admitting new calls.
   * @returns Completion after release and all canceled calls settle; concurrent resets share it.
   */
  reset(sessionId, release, notify) {
    if (this.disposed) return Promise.reject(new Error("PTC tool executor disposed"));
    const previous = this.resets.get(sessionId);
    if (previous !== void 0 && !previous.settled) return previous.done;
    const done = Promise.withResolvers();
    const reset = { done: done.promise, settled: false };
    this.resets.set(sessionId, reset);
    const calls = [...this.calls.get(sessionId) ?? []];
    for (const call of calls) call.controller.abort(new Error("PTC environment reset"));
    void Promise.allSettled([Promise.resolve().then(release), ...calls.map((call) => call.done)]).then((results) => {
      const failure = results.find((result) => result.status === "rejected");
      if (failure !== void 0) throw failure.reason;
      notify?.();
    }).then(() => {
      reset.settled = true;
      this.resets.delete(sessionId);
      done.resolve(void 0);
    }, (error) => {
      reset.settled = true;
      done.reject(error);
    });
    return reset.done;
  }
};

// packages/dsh-computer-use/entry.mjs
function createProgramTransport(ctx, tool, runtime) {
  const available = (agent, toolSet) => ctx.tools.executable("cua_run_code", agent, toolSet) !== void 0;
  const tools = new Proxy(ctx.tools, {
    get(target, key) {
      if (key === "schemas") return (agent, toolSet) => available(agent, toolSet) ? [(0, import_dsh_tools2.projectToolSchema)(tool, false)] : [];
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const context = new Proxy(ctx, {
    get(target, key) {
      if (key === "tools") return tools;
      if (key === "get") return (name) => name === "ptcRuntime" ? runtime : target.get(name);
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const pipeline = new import_pipeline3.ToolExecutionPipeline(context, {
    get: (name, agent, toolSet) => name === tool.name && available(agent, toolSet) ? tool : void 0
  });
  const definition = createRunCodeTool(context, pipeline, {
    maxSubCallsPerMinute: 1024,
    maxParallelSubCalls: 10
  }, new PtcCalls(context));
  const description = Object.getOwnPropertyDescriptor(definition, "description").get;
  const descriptors = Object.getOwnPropertyDescriptors(definition);
  descriptors.name = { ...descriptors.name, value: "cua_run_code" };
  descriptors.description = {
    enumerable: true,
    get: () => description.call(definition).replace("against the available tools", "for Computer Use").replace(
      "Call tools as `await tools.name(args)` per the declarations in the system prompt.",
      "Use the initialized `cua` API described in the system prompt. Only Computer Use is bound in this program."
    )
  };
  return Object.create(Object.getPrototypeOf(definition), descriptors);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createProgramTransport
});

  return module.exports;
}
