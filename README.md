<div align="center">

<img src="docs/images/logo-wide.png" width="300" alt="Dudu">

### An efficient multi-agent collaboration assistant built on DSH

[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE) ![version](https://img.shields.io/badge/version-0.2.0-orange?style=flat-square) ![Node.js](https://img.shields.io/badge/node-%E2%89%A5%2024-339933?style=flat-square&logo=node.js&logoColor=white) ![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-%E2%89%A5%200.2.1--alpha.3-4D6BFE?style=flat-square)

[Features](#features) • [Design philosophy](#design-philosophy) • [Development guide](#development-guide) • **English** · [简体中文](README.zh-CN.md)

</div>

Dudu is a multi-agent collaboration workspace built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). To install it, enter dsh-dudu in DSH's "Add plugin".

<div align="center">
    <img src="docs/images/hero.en.png" width="900" alt="Dudu inside DSH Desktop: the conversations of the issues on the left with one of them open, the Inbox on the top right and the Office below it">
</div>

Dudu can be managed from your phone too: on iOS, search for dudu in the App Store or join the [TestFlight beta](https://testflight.apple.com/join/TNUPd6n7); on Android, install the apk from [GitHub Release](https://github.com/weiwenhao/dudu/releases).

<div align="center">
  <img src="docs/images/phone.en.png" alt="The mobile app, from left to right: the conversation list; the chat; the inbox; tasks" width="900">
</div>

The workspace's home page is a dashboard: you can arrange its layout freely and develop widgets of your own.

<div align="center">
  <img src="docs/images/dashboard.en.png" alt="The dashboard in edit mode: the Issues widget on the left uses the board layout, the widget on the right is being resized, and the blue frame and 6×4 show its new size" width="900">
</div>

## Features

- Built as a plugin on the DSH foundation, it makes use of everything DSH offers and extends DSH to multiple agents, deeply integrated into the GUI.
- Supports the Claude, Codex, Antigravity, Pi, Grok, Kimi, OpenCode, CodeBuddy, Devin, Factory, Qwen and Qoder TUI agents, and you can resume a session in its TUI at any time.
- Easily import the DSH, Claude and Codex sessions you already have.
- Manage every feature by talking to Dudu, the personal assistant.
- Inactive agents automatically **go into deep sleep, so they do not take up memory**.
- Collaboration and session management are built around the Issue board.
- Manage session status like a chat app: simple, efficient and intuitive.
- The phone app was built for Dudu, but at heart it is simply the mobile client of DSH.
- Collectors gather all your information into the inbox, where you manage and distribute it in one place.
- With scheduled tasks you can send any agent (Pi, DSH, Claude Code, Dudu and so on) to do anything, such as managing email or daily inspections.
- Check your Claude, Codex and DeepSeek quota at a glance, at the top right of the dashboard.
- Every widget on the dashboard can be dragged and resized, and you can ask Dudu to write widgets of your own.
- There is also a cute office: when you are bored, see what your agents are up to.

## Design philosophy

Built on [OAR](https://github.com/botiverse/oar), Dudu brings many kinds of agents (TUIs) together in one GUI, which solves the problem of managing multiple agents. **It manages task status efficiently with a board, and agent status efficiently with sessions.**

The first picture is the workspace I use every day. I usually keep more than 30 agent sessions open, including Claude, Codex and DeepSeek, for personal projects as well as company projects. Dudu solves the problem of working efficiently in exactly this kind of multi-agent, multi-task setting. It has replaced Herdr/Orca, which I had always used before, since the very first version.

Dudu is not a Grok Bot type of product. In a Bot type of product, a person only needs to chat with a few Bots to get a large number of tasks done, but I believe that in real work, talking directly to the agent doing the task is more accurate than having a Bot relay it. Of course, my own use of AI has always been one version behind, so Dudu may gradually add a Bot mode in later versions.

Personal agents such as OpenClaw, Hermes and Muse have long been very popular, and the DSH foundation makes it very easy to create one, so I also created the personal agent **Dudu**. It is a personal agent similar to Muse, with a memory management system of its own. Dudu can operate every feature: the session board, writing widgets, connectors, collectors, scheduled tasks and so on. In the future it will take on more work to lighten my workload.

## Data directories

| Directory | Contents |
| :-- | :-- |
| `~/.dsh` | DSH's data directory, i.e. `DSH_HOME` |
| `~/.dsh/dudu/home` | The assistant's home directory, also the working directory of its sessions: its Markdown files (`AGENTS.md`, `SOUL.md`, `USER.md`, `MEMORY.md` and so on) and the widgets it writes (`widgets/`). The location can be changed in Settings |
| `~/.dsh/dudu/assistant/` | The assistant's settings and databases (`settings.json`, `issues.db` and so on) |

## Development guide

Bug reports and suggestions are welcome in [GitHub Issues](https://github.com/weiwenhao/dudu/issues), and so are pull requests. For a larger change, please open an Issue first to talk about your idea.

### Development environment

You need Node.js 24 or later, Git and [DSH](https://deepseek.com/harness). Building the iOS app also needs Xcode and [XcodeGen](https://github.com/yonaskolb/XcodeGen); building the Android app also needs Android Studio.

```sh
git clone https://github.com/weiwenhao/dudu.git
cd dudu
npm install
```

### Run

```sh
npm run desktop:update     # package and install into the DSH Desktop on this computer; macOS only for now
npm run native:install     # build the iOS app and install it on an iPhone
npm run android:install    # build the Android app and install it on an emulator
```

Before building the iOS app, replace the developer team and the bundle ID in `native/ios/project.yml` with your own.

Without `desktop:update`, run `npm run package:desktop`, then install `dsh-dudu-<version>.tgz` from `.local/release/` in DSH's "Add plugin".

### Test

```sh
npm run typecheck
npm test             # unit tests
npm run test:e2e     # end-to-end tests, slower
```

### Developing widgets

Just ask Dudu to write one. It writes an `.mjs` file under `widgets/` in its home directory, and a few seconds later the widget shows up under "Add widget" in "Edit layout": no plugin to install, no code to clone. See [WIDGETS.md](host/dudu-plugin/WIDGETS.md) for how to write one.

To publish a widget for others to use, make it a DSH plugin: see the [widget template](examples/dudu-widget/README.md).

## Recommended communities

<table>
<tr>
<td width="200" align="center"><a href="https://linux.do/"><img src="docs/images/friend-linuxdo.png" height="56" alt="LINUX DO"></a></td>
<td><b><a href="https://linux.do/">LINUX DO</a></b>: "Where possible begins." Its culture is sincerity, friendliness, unity and professionalism.</td>
</tr>
<tr>
<td width="200" align="center"><a href="https://www.v2ex.com/"><img src="docs/images/friend-v2ex.png" height="56" alt="V2EX"></a></td>
<td><b><a href="https://www.v2ex.com/">V2EX</a></b>: a community of creative workers, talking about programming, design, hardware, games and more.</td>
</tr>
</table>
