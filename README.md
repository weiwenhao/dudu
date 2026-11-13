<div align="center">

<img src="docs/images/logo-wide.png" width="300" alt="Dudu">

### An efficient multi-agent collaboration assistant built on DSH

[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE) ![version](https://img.shields.io/badge/version-0.1.0%20beta-orange?style=flat-square) ![macOS](https://img.shields.io/badge/macOS-000000?style=flat-square&logo=apple&logoColor=white) ![Node.js](https://img.shields.io/badge/node-%E2%89%A5%2024-339933?style=flat-square&logo=node.js&logoColor=white) ![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.2.2--rc.1-4D6BFE?style=flat-square)

If Dudu is useful to you, a star on GitHub helps others find it.

[Overview](#overview) • [Features](#features) • [Quick start](#quick-start) • [Usage](#usage) • [Security](#security) • [Docs and resources](#docs-and-resources) • [App Store][app-store] • **English** · [简体中文](README.zh-CN.md)

<img src="docs/images/hero.png" width="900" alt="Dudu inside DSH Desktop (Chinese interface): the Issues widget on the left, the Office on the top right and the Collector on the bottom right; the small blue icon at the bottom right opens the chat">

</div>

Dudu is a plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH), with a companion mobile app. It manages the work you hand to Claude Code, Codex and DeepSeek as Issues. It is at 0.1.0 beta, so the interface and APIs will still change.

> [!NOTE]
> **What is DSH?**<br>
> DeepSeek Harness is an open-source agent app from DeepSeek. Its own tagline is "Everything is a Plugin". Dudu is one of the plugins that run inside it.

## Overview

When you run several agents at once, each session stands alone, and progress and questions can only be read by opening the sessions one by one. Dudu puts them on one board:

- One piece of work is one Issue, handed to one Agent. The Issue and its activity log stay even when the session is closed or replaced.
- The board groups Issues by the Agent's state, and the Issues whose Agent is waiting for you come first.
- You decide. Dudu never turns collected information into an Issue on its own and never changes an Issue's status on its own. You pick the Agent; when you ask Dudu in chat to create an Issue, it picks one by the assignment rules you wrote in Settings.

Terms used here:

- **Issue**: a piece of work to hand to an Agent.
- **Agent**: Claude Code, Codex, or DeepSeek (DSH's own). The interface shows Codex as ChatGPT.
- **Session**: the session an Agent uses to work on an Issue. You can also see it in DSH's sidebar.
- **Project**: a DSH workspace, which is a folder. An Issue needs a project before it can be handed to an Agent, and the Agent works in that folder.
- **Dudu**: the "Dudu" entry in DSH's sidebar opens Dudu's page (the dashboard). The small blue icon at the bottom right of that page (called "Pet" in Settings) opens your chat with Dudu. There is only one chat.

The desktop interface follows DSH's language setting, and this README uses the English one.

Dudu runs inside DSH Desktop on your computer:

- Issues, collected information and scheduled tasks are stored on your computer in SQLite and files, by default in `~/.dsh/dudu/`. What is sent to a model goes to the model provider you configured.
- Claude Code and Codex are connected to DSH through [OAR](https://www.npmjs.com/package/@botiverse/oar), a library that drives command-line agents. DeepSeek uses DSH's own sessions.
- The mobile app connects straight to your computer over authenticated HTTP/HTTPS and gets live updates by long polling. Dudu has no cloud service of its own.

## Features

- **Issues and board**: status, priority, project, labels, sub-issues and due date, much like Linear's issues.
- **Several agents**: hand each Issue to Claude Code, Codex or DeepSeek. Claude Code and Codex keep their sessions themselves, so you can also continue them in a terminal with `claude --resume` or `codex resume`.
- **Session import and takeover**: search the Claude Code and Codex sessions already on your computer from the Sessions icon at the top right, import them into DSH, or "Take over" a session so that Dudu creates an Issue for it.
- **Collector**: reads outside services such as Lark, Notion and Linear on a schedule through connectors. You handle what it brings back one item at a time.
- **Office**: each Issue that is in Todo, In Progress or In Review and has an Agent is a small person in the office, and where they sit shows the Agent's state: at a desk when working, in the lounge when waiting for you or idle, in bed when in deep sleep (the process has shut down).
- **Chat**: type `@` to send a message to the Agent of an Issue, and its reply shows up in the chat. Dudu has its own memory, rules and skills, managed in Settings.
- **Scheduled tasks**: run a prompt on a schedule: daily, weekly, monthly, at a fixed interval, once, or with a custom cron expression. Claude Code, Codex, DeepSeek or Dudu itself can run it, and when Dudu runs it the result shows up in the chat. The interface calls them "Tasks".
- **Quota**: click the quota icon at the top right to see your Claude and ChatGPT (Codex) subscription quota and your DeepSeek balance. It looks only when you click, and a source it cannot read is not shown.
- **Draggable dashboard**: the Issues, Collector and Office widgets can be dragged and resized.
- **Mobile app**: the board, chat, Collector, tasks and quota, with voice input and sending images and files.

## Quick start

### Requirements

- macOS 13 or later, Apple silicon.
- DSH Desktop (tested on 0.2.2-rc.1, see the [compatibility audit](docs/dsh-0.2.2-compatibility.md)), downloadable from the [DSH site](https://deepseek.com/harness).
- Node.js 24 or later and Git (`npm install` builds the OAR adapter).
- Claude Code or Codex installed and signed in, if you want to use them.

> [!IMPORTANT]
> Set up a model in DSH first: Dudu's chat and the DeepSeek Agent use it.

### 1. Install the plugin

```sh
git clone https://github.com/weiwenhao/dudu.git
cd dudu
npm install
npm run desktop:update       # package, install into DSH Desktop and reload it
```

`desktop:update` works on macOS only, and needs DSH Desktop installed in `/Applications` and started at least once. If it fails, the log is in `.local/desktop-updates/`. Without the script, run `npm run package:desktop` and install the resulting `.local/release/dudu-<version>.tgz` from DSH Desktop's Plugins page.

Then open "Dudu" in DSH's left sidebar.

### 2. Create your first Issue

On the Dudu page click "New issue", enter a title, pick a project and an Agent, and click "Create issue". The Agent starts working and its state shows on the board.

### 3. Connect the mobile app (optional)

Install the app from the [App Store][app-store] (iOS 18 or later; its interface is currently in Chinese). Then:

1. On the Dudu page click the settings icon at the top right and open "Phone control".
2. Enter a computer name. The first connection address is generated from your computer's current LAN IP.
3. Next to that address click "Generate QR code" and scan it with the app.

When you connect over a LAN address, the phone and the computer must be on the same network. See [connecting the app](docs/phone-connection.md) (Chinese).

## Usage

### Issues board

The Issues widget opens on the Active tab, which shows Issues that are Todo, In Progress or In Review. There are also Backlog and All issues tabs, and the layout can be a list or a board.

Statuses default to Backlog, Todo, In Progress, In Review, Done and Canceled. You change them by hand, and they do not follow what the Agent is doing. Right-click an Issue to change its status, priority, labels and due date, hand it to an Agent, or copy its ID.

Issues are grouped by Agent state by default:

- **Needs you**: the Agent asked a question, failed, stopped or finished a turn.
- **Working**: the Agent is working on it.
- **Idle**: the Agent is neither working nor waiting for you.
- **Unassigned**: not handed to an Agent yet.

The widgets can be dragged and resized: click "Edit layout" at the top right, and at the bottom "Add widget" brings a widget back and "Restore default" returns to the default layout. In the screenshot below (Chinese interface) the Issues widget on the left uses the board layout, and the Collector widget on the right is being resized: the blue frame and "6×4" are its new size, 6 columns by 4 rows.

<div align="center">
  <img src="docs/images/dashboard.png" alt="The dashboard in edit mode (Chinese interface): the Issues widget on the left uses the board layout, the Collector widget on the right is being resized, and the blue frame and 6×4 show its new size" width="900">
</div>

### Collecting information

1. In Settings add a connector, which says how to reach a service. The built-in catalog has Lark (listed as 飞书), Google Calendar and Drive, Notion, Linear, Atlassian and more, and you can add your own.
2. Create a collector that reads through that connector, and set what to read and how often. Every read calls a model.
3. What it brings back appears in the Collector widget. Handle each item: share it to an Issue's session (it goes to that Issue's Agent), create an Issue from it, mark it Handled, ignore it, or delete it.

### Mobile app

The app opens on the board, and its sidebar lists the chat with Dudu, the board, the collector and tasks. The screenshot shows, from left to right: the board; the chat; the menu that opens from "+" in the chat; tasks.

<div align="center">
  <img src="docs/images/phone.png" alt="The mobile app, from left to right: the board; the chat; the menu that opens from + in the chat; tasks" width="900">
</div>

## Security

- A pairing code is generated only when you click "Generate QR code". It is valid for 10 minutes, and each phone can be revoked separately. Installing the plugin or saving a connection address never generates one.
- The app can only reach pages and endpoints that the Dudu plugin itself serves, and only after pairing: there are no anonymous pages, no way to fetch arbitrary URLs through it, and no way to call arbitrary DSH functions. The pairing credential travels only in the `Authorization` header, never in page scripts or URLs.
- A LAN address uses plain HTTP, so the traffic is not encrypted. Over a TLS reverse proxy or tunnel (HTTPS) the relay server can see the decrypted traffic, so this is not end-to-end encryption.
- These run with full access by default (they can read and write any file and run any command): Dudu's chat, collection and scheduled tasks, and Issues handed to Codex or DeepSeek. Issues handed to Claude Code use Claude's own permission settings. DSH shows no approval prompts for agents: an action Claude Code needs to confirm is refused, and Codex does not ask.

## Development

```sh
npm run typecheck
npm test               # unit tests, fast
npm run test:e2e       # end to end, slower; needs the dsh command (or set DUDU_E2E_DSH) and Chrome
```

<details>
<summary>Directory layout</summary>

| Path | What it holds |
| --- | --- |
| `host/dudu-plugin/` | The DSH plugin entry and the React interface of Dudu's page (`ui/`, shadcn/ui + Tailwind) |
| `host/assistant/` | Dudu's core library: Issues, collectors, connectors, assignment, scheduled tasks, dashboard layout, chat |
| `host/providers/` | Claude Code and Codex integration (through OAR), quota reading, reading existing sessions |
| `host/native-*.mjs` | The interface the mobile app uses: authenticated HTTP API, page sessions, event long polling |
| `native/` | The mobile app's iOS project (SwiftUI, generated from `native/project.yml` with XcodeGen) |
| `packages/oar-adapter/` | Adapter and patches for OAR |
| `tests/` | Unit tests; `tests/e2e/` holds the end-to-end tests that run in a real DSH |
| `App.tsx`, `index.ts`, `src/`, `host/plugin/`, `plugins/`, `assets/`, `app.json`, `eas.json` | The old Expo prototype, kept for reference. It is not used at run time, but `npm install` and `npm run typecheck` still process part of it |

</details>

## Docs and resources

| Topic | Doc |
| --- | --- |
| Design document: product, structure, interface, APIs (long, includes the decision history; Chinese) | [docs/assistant.md](docs/assistant.md) |
| Connecting the mobile app: install, pair (Chinese) | [docs/phone-connection.md](docs/phone-connection.md) |
| Claude Code and Codex inside DSH (Chinese) | [docs/providers.md](docs/providers.md) |
| Scheduled tasks (Chinese) | [docs/scheduled-tasks.md](docs/scheduled-tasks.md) |
| Issue API (Chinese) | [docs/issues-api.md](docs/issues-api.md) |
| Writing a widget for Dudu | [examples/dudu-widget](examples/dudu-widget) |
| Development conventions (written for coding agents; the signing and test-approval steps are the author's own workflow) | [AGENTS.md](AGENTS.md), [native/AGENTS.md](native/AGENTS.md) |

Related links:

- [DeepSeek Harness site](https://deepseek.com/harness): download DSH Desktop.
- [DeepSeek Harness source](https://github.com/deepseek-ai/deepseek-harness).
- [OAR](https://www.npmjs.com/package/@botiverse/oar): what Dudu uses to connect Claude Code and Codex.

## Getting help

For bugs and ideas, open an issue on [GitHub Issues](https://github.com/weiwenhao/dudu/issues).

## Friend links

<table>
<tr>
<td width="200" align="center"><a href="https://linux.do/"><img src="docs/images/friend-linuxdo.png" height="56" alt="LINUX DO"></a></td>
<td><b><a href="https://linux.do/">LINUX DO</a></b>: "Where possible begins."</td>
</tr>
<tr>
<td width="200" align="center"><a href="https://www.v2ex.com/"><img src="docs/images/friend-v2ex.png" height="56" alt="V2EX"></a></td>
<td><b><a href="https://www.v2ex.com/">V2EX</a></b>: a community of creative workers, talking about programming, design, hardware, games and more.</td>
</tr>
</table>

## License

[MIT](LICENSE)

[app-store]: https://apps.apple.com/app/idXXXXXXXXXX
