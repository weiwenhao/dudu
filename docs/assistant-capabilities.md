# Dudu operation coverage

Owner direction, 2026-11-19: “人类能做的每一个操作，嘟嘟都要有”.

The interactive assistant's tools now include a discoverable directory of product
operations. `dudu_capabilities({query})` finds operations;
`dudu_capabilities({operation})` returns the exact argument schema;
`dudu_execute({operation, arguments})` invokes that registered operation.
There is no caller-selected URL, RPC endpoint, service name or filesystem store.

The directory lives in `host/assistant/home/capabilities.mjs`. Existing short tools
remain available. Issue, inbox, settings, task and dashboard actions are checked
against their interface contracts in `tests/assistant-capabilities.test.ts`, so a
new interface operation without an assistant entry fails that coverage check.

| Operation family | Shared implementation and scope |
| --- | --- |
| `issues/*` | The issue command service and its assignment, title, workflow, cleanup and forwarding hooks. Includes labels, links, statuses, subissues, notes, search, export and deletion previews. Existing source/session identity restrictions remain. |
| `issues/attachment-upload`, `issues/attachment` | Stage a real attachment from the current conversation, or upload a local file through the UI upload handler under the session's actual full-access preset. Read only issue-owned references, with bounded text output. Staging does not send or start work. |
| `inbox/*` | The same inbox API as the interface: list, read, handle, delete, restore, forward, associate, complete context and edit. A formal forward preserves source IDs, URLs and context; association and handled state follow successful delivery. Editing title/text updates FTS transactionally and retains deduplication and owner marks. |
| `assistant/*`, `rules/*`, `memory/*`, `skills/*` | Existing settings, folder, rule editor, memory and skill services. Rule edits require the original text and project folder; forgetting retains its preview and later-turn confirmation. Default permission changes require the exact current owner's explicit access grant. |
| `connectors/*`, `collectors/*` | The existing connection, sign-in and collection services, including notification preferences. Short register/update/remove tools use those same services, rather than writing only the registry and leaving connection state, published tools or credentials behind. Collection still only collects. |
| `tasks/*` | Existing task service, real provider/model choices, revisions, history and delivery semantics. A Dudu scheduled run cannot manage other tasks through either the short tools or directory. |
| `dashboard/*` | The existing layout engine, widget declarations, validation and undo. Widget source reads use the bounded local-widget reader. |
| `home/*` | Shared phone/Desktop pins, incoming-message order and read/unread service. Reading or listing content does not acknowledge it automatically. |
| `projects/*`, `providers/*` | Existing workspace and harness configuration services: inspect, add, rename/remove a workspace registration, detect, enable/disable and select executable paths. Removing a registration does not delete its directory. |
| `sessions/*` | Catalog/search/read/import/takeover and existing session controls: create, rename, model/reasoning, access, queue edits, send/steer/stop, archive, DSH sidebar pins, fork, commands, questions, team and background jobs. Presets and questions come from current host data. Assigned-session access retains its rule limits; other sessions require an explicit current owner grant. |
| `quota/*`, `overview/*`, `dispatch/*` | Existing read services and the quota refresh floor. |
| `phone/state`, `phone/save`, `phone/revoke` | Existing connection settings and device revocation. Pairing secrets continue to be generated manually by the owner in DSH. |

Interactive Dudu also inherits the tools actually supplied to its standard DSH
scope, including future host capabilities, instead of a second hand-written list.
DSH still owns the current session's permissions and approvals. Computer Use
retains its explicit switch and dedicated entry; private `cua` and generic
`run_code` transports are not direct model tools. Unattended tasks keep their
previous native-tool scope.

Capability is not authorization to act autonomously. External records, worker
messages and transcripts are material, never owner instructions. Issue workflow
remains manual. This change does not reintroduce automatic collector processing,
issue creation, worker reviews or progress messages. Service sign-in, manual
pairing and OS consent retain their existing human steps.

`providers/foreground` is the interface's long-poll notification transport, not a
separate owner action. The directory reads current foreground and background state
through `sessions/activity`, `sessions/team` and `sessions/jobs` instead of giving
a model an unbounded wait.

Validation on 2026-11-19 uses targeted unit/contract checks for directory coverage,
formal inbox forwarding and failed delivery, source-preserving edits, permission
and task fences, issue-owned attachments, and native session request shapes.
No model, real DSH, browser, simulator or physical-device interaction was run for
this change. A suitable owner-authorized E2E check is an isolated DSH conversation
that forwards a fixture inbox record, edits its title, and verifies the same
association and handling state in the inbox interface.

The 38 focused assistant tests passed, including inherited host capabilities and
the private Computer Use transport boundary. Repository lint and typecheck, the
Desktop package's external import check, the iOS build, and Android debug assembly,
lint and the focused quota unit tests passed. No Desktop hot update or phone
installation was performed.

The same turn also changes quota presentation on Desktop, iOS and Android: zero
wallets are omitted, while negative and sub-cent balances remain. Each currency
keeps its own total; balances are not converted, added across currencies or
reinterpreted as gifted credit. Existing cached readings use this display rule
without a data migration.
