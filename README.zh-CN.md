<div align="center">

<img src="docs/images/logo-wide.png" width="300" alt="Dudu">

### 基于 DSH 的多智能体高效协作助手

[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE) ![version](https://img.shields.io/badge/version-0.1.0%20beta-orange?style=flat-square) ![macOS](https://img.shields.io/badge/macOS-000000?style=flat-square&logo=apple&logoColor=white) ![Node.js](https://img.shields.io/badge/node-%E2%89%A5%2024-339933?style=flat-square&logo=node.js&logoColor=white) ![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.2.2--rc.1-4D6BFE?style=flat-square)

[设计理念](#设计理念) • [功能](#功能) • [贡献指南](#贡献指南) • [App Store][app-store] • [English](README.md) · **简体中文**

</div>

Dudu 是基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）开发的多智能体协作工作台。在 DSH 的「插件」页面点「添加插件」，填入 `dsh-dudu` 即可安装。

<div align="center">
    <img src="docs/images/hero.zh-CN.png" width="900" alt="Dudu 在 DSH Desktop 里：左边是各个事项的对话和打开的一段对话，右上是收件箱，右下是办公室">
</div>

Dudu 也支持在手机上管理：iOS 在 App Store 搜索 Dudu 安装，安卓到 [GitHub Releases](https://github.com/weiwenhao/dudu/releases) 下载 apk 安装。配对方式见[手机连接](docs/phone-connection.md)。

<div align="center">
  <img src="docs/images/phone.zh-CN.png" alt="手机 App，从左到右：会话列表；对话；对话里点「+」弹出的菜单；任务" width="900">
</div>

工作台的主页面是一个仪表盘，可以自由组合布局，也可以[开发自己的小组件](examples/dudu-widget)。

<div align="center">
  <img src="docs/images/dashboard.zh-CN.png" alt="仪表盘的编辑状态：左边的看板用了看板布局，右边的小组件正在调整大小，蓝框和「6×4」是它的新尺寸" width="900">
</div>

## 设计理念

上面第一张图是我日常工作台的样子（数据为模拟）。我常驻打开的智能体会话有 30 多个，用的有 Claude、Codex、DeepSeek 等，既有个人项目，也有工作项目。Dudu 解决的，就是这种多 Agent、多任务场景下的效率问题。

Dudu 把多个 TUI 里的所有会话聚合到一个 GUI 界面中，解决多 Agent 的管理问题：用看板管理任务状态，用会话管理 Agent 状态，从而高效地管理多个任务和多个 Agent。它直接替代了我过去一直在用的 Herdr/Orca。

> 另一种会话管理方案是 Bot：人只需要和少数几个 Bot 聊天，就能完成大量任务。我日常还没有用这种工作流，觉得它在手机上会很方便；但在电脑上，直接在对应的 Issue 里对话，比通过 Bot 转发更准确、更高效。

基于 DSH 可以非常方便地打造个人智能体，所以我也把类似 Muse 的个人助理**嘟嘟**集成了进来。嘟嘟可以操作 Issue、连接器、收集器、定时任务等功能。日常创建 Issue 或定时任务，我都是直接让嘟嘟代劳，不用手动填表单、写提示词。

## 功能

- **多种 Agent**：支持 DSH、Claude Code、Codex 和 Pi，并深度集成到了图形界面中。Claude Code、Codex 和 Pi 运行的是你电脑上已安装的程序。
- **导入会话**：已有的 DSH、Claude Code、Codex 会话可以导入，也可以接管成 Issue。
- **Issue 看板**：基于 Issue 看板协作和管理会话。每个任务是一个 Issue，有状态、优先级和标签，可以看列表或看板。
- **会话列表**：像聊天软件一样管理会话，最近有回复的排在前面，未读的会有提示，很快就能找到刚做完活的会话。
- **深度休眠**：不活跃的 Agent 会进入深度休眠，关闭它的进程来释放内存，下次打开时再启动。
- **个人助理嘟嘟**：直接对话就能新建和管理 Issue、连接器、收集器、定时任务，也能把消息转给某个 Issue 的 Agent，不用自己填表单、写提示词。
- **收件箱**：用收集器把飞书、Notion、Linear 等处的信息收集起来，每条记录可以新建成 Issue、发给某个 Agent，或者忽略。收集由 DSH 里的模型按你设的频率读取，会消耗 token。
- **定时任务**：按计划（每天、每周、间隔、cron 等）让任意 Agent 执行一段提示词，比如邮件整理、日常巡检。
- **手机端**：在手机上管理 DSH 里的会话，相当于 DSH 的手机端，支持 iOS 和安卓。
- **额度**：快速查看 Claude、Codex 和 DeepSeek 的剩余额度。
- **仪表盘**：每个小组件都可以拖动、调整大小，也可以[开发自己的小组件](examples/dudu-widget)加进来。
- **办公室**：每个进行中的 Issue 是一个小人，Agent 工作时在工位，深度休眠时在床上，无聊时可以看看它们在忙什么。


## 贡献指南

欢迎在 [GitHub Issues](https://github.com/weiwenhao/dudu/issues) 反馈 Bug 和建议，也欢迎提交 Pull Request。改动较大时，建议先开一个 Issue 说说你的想法。

### 准备环境

- macOS 13 或更新（Apple 芯片），已安装并启动过一次的 [DSH Desktop](https://deepseek.com/harness)（装在 `/Applications` 里），并在里面配好模型
- Node.js 24 或更新版本和 Git
- 要测试 Claude Code、Codex 或 Pi，需要它们已安装并登录
- 构建 iOS App：Xcode（带 iOS 27 SDK 或更新）和 [XcodeGen](https://github.com/yonaskolb/XcodeGen)
- 构建安卓 App：Android Studio（自带 JDK 21）和 Android SDK

```sh
git clone https://github.com/weiwenhao/dudu.git
cd dudu
npm install
```

### 项目结构

| 目录 | 内容 |
| :-- | :-- |
| `host/dudu-plugin/` | DSH 插件本体：入口 `index.mjs`，面板界面（React）在 `ui/`，小组件接口是 `widget*.mjs` |
| `host/assistant/` | Issue、收件箱、收集器、定时任务、仪表盘布局和嘟嘟 |
| `host/providers/` | Claude Code、Codex、Pi 的接入（通过 OAR）和额度读取；`native/` 读取它们自己的会话记录 |
| `host/native-*.mjs` | 手机 App 使用的接口（`/dsbot/api/v1/`） |
| `packages/oar-adapter/` | OAR 的兼容补丁 |
| `native/`、`native-android/` | iOS App（SwiftUI）、安卓 App（Kotlin、Jetpack Compose） |
| `examples/dudu-widget/` | 小组件模板 |
| `tests/` | 单元测试；`tests/e2e/` 是端到端测试 |
| `docs/` | 设计和说明文档 |

根目录的 Expo / React Native 文件（`App.tsx`、`src/` 等）是早期的原型，现在的手机 App 在 `native/` 里。

### 在 DSH Desktop 里运行

```sh
npm run desktop:update
```

它会打包插件、装进 DSH Desktop、请求热重载，并检查运行中的版本和服务是否就绪。热重载失败时 Desktop 保持打开并报告原因；确实要重启时加 `-- --restart`（会走 DSH 自己的退出确认）。DSH Desktop 不在 `/Applications` 里时用 `-- --app <路径>`。日志和配置备份在 `.local/desktop-updates/`。

请在普通终端里运行：热重载会断开 DSH 里正在运行的 Claude Code、Codex 会话，所以在 DSH 的会话里运行会被拒绝，确实要运行时加 `-- --force`。

不用脚本时，运行 `npm run package:desktop`，再在 DSH Desktop 的「插件」里安装 `.local/release/dsh-dudu-<版本>.tgz`。面板界面（`host/dudu-plugin/ui/`）由这两个命令一并编译；单独编译用 `npm run client:build`。

### iOS App

```sh
npm run native:build       # 构建
npm run native:install     # 构建并安装到已配对的 iPhone
```

`native:install` 需要一台已配对、可连接的真机；连了不止一台时用 `-- --device <标识>` 指定。`native/project.yml` 里的 `DEVELOPMENT_TEAM` 和 `PRODUCT_BUNDLE_IDENTIFIER` 是作者自己的，构建前换成你的（提交 PR 时不要带上这两处改动）。`npm run native:test` 在真机上运行 `native/DSBotTests` 里的单元测试。

### 安卓 App

```sh
npm run android:build      # 构建 debug APK，并运行单元测试和 lint
npm run android:install    # 装进正在运行的模拟器
```

`android:install` 只会选择正在运行的模拟器，不会选择真机；同时开着多个时用 `ANDROID_SERIAL=emulator-5554` 指定。默认使用 Android Studio 自带的 JDK 和 `~/Library/Android/sdk`，可用 `JAVA_HOME`、`ANDROID_HOME` 覆盖。APK 在 `native-android/app/build/outputs/apk/debug/app-debug.apk`。`npm run android:test` 只跑单元测试，`npm run android:e2e` 在模拟器里对隔离的测试环境跑关键界面流程。

### 测试

```sh
npm run typecheck
npm test                   # 单元测试，很快
npm run test:e2e           # 端到端，较慢
```

提交前至少运行 `npm run typecheck` 和与改动相关的单元测试。

- 单个单元测试文件：`node --experimental-strip-types --test tests/文件名.test.ts`
- 端到端测试会先打包插件，再让每个测试文件在自己的 `DSH_HOME` 里启动一个真实的 `dsh web`，用已安装的 Chrome 操作界面。只有模型是假的，不会碰你自己的 DSH。它需要 `dsh` 命令（或用 `DUDU_E2E_DSH` 指向另一个 DSH，比如 Desktop 自带的 CLI）和 Chrome；只跑指定文件：`npm run test:e2e -- tests/e2e/issues.e2e.test.ts`。
- 新增测试要精简：只为「坏了、又没有更便宜的办法发现」的东西写，比如数据安全、安全和隐私、进程之间的约定、复杂的纯逻辑、每个主要功能的一条端到端流程，以及真的造成过麻烦的回归。不写外观和交互细节（尺寸、间距、颜色、文案）的测试，也不写要等真实计时器的测试。

### 开发约定

- **界面**：改界面前先看现有的设计和相近的控件，复用已有的组件、尺寸、颜色和交互，不要用通用控件样式代替；默认不加说明性的副标题或帮助段落。
- **界面文字**：桌面在 `host/dudu-plugin/ui/strings.js`，iOS 在 `native/DSBot/Resources/Localizable.xcstrings`，中英文成对写。新增或修改界面文字，措辞需要维护者确认。
- **Agent 接入**：Claude Code、Codex、Pi 统一通过 `@botiverse/oar`（OAR）接入，不要手写驱动或协议。兼容补丁在 `packages/oar-adapter/`，改补丁，不要改生成的文件。设计见 [providers.md](docs/providers.md)。
- **手机接口**：只用带鉴权的 HTTP/HTTPS 和 HTTP 长轮询，不加 WebSocket、匿名页面、任意 HTTP 转发或通用的 DSH RPC 代理。配对码只由用户在 DSH 里手动生成，测试时不要生成或注入真实的配对链接。
- 更多约定在 [AGENTS.md](AGENTS.md) 和 [native/AGENTS.md](native/AGENTS.md)（写给编码 Agent，英文）。其中的签名和测试审批流程是作者自己的工作方式。

更多文档：[设计文档](docs/assistant.md)（很长，含决策记录）、[手机连接](docs/phone-connection.md)、[定时任务](docs/scheduled-tasks.md)、[Issue 接口](docs/issues-api.md)、[安卓 App](docs/android.md)、[小组件模板](examples/dudu-widget)（英文）。

## 社区推荐

<table>
<tr>
<td width="200" align="center"><a href="https://linux.do/"><img src="docs/images/friend-linuxdo.png" height="56" alt="LINUX DO"></a></td>
<td><b><a href="https://linux.do/">LINUX DO</a></b>：「新的理想型社区」，社区文化是真诚、友善、团结、专业。</td>
</tr>
<tr>
<td width="200" align="center"><a href="https://www.v2ex.com/"><img src="docs/images/friend-v2ex.png" height="56" alt="V2EX"></a></td>
<td><b><a href="https://www.v2ex.com/">V2EX</a></b>：创意工作者的社区，讨论编程、设计、硬件、游戏等话题。</td>
</tr>
</table>

[app-store]: https://apps.apple.com/app/idXXXXXXXXXX
