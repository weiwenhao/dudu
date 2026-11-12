<div align="center">

<img src="docs/images/logo-wide.png" width="300" alt="Dudu">

### 基于 Issue 的多 Agent 高效协作助手

Dudu 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的插件，另有配套的 iPhone App。它用 Issue 管理交给 Claude Code、Codex 和 DeepSeek 的工作。Dudu 处于早期阶段，界面和接口还会变化。

[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE) ![macOS · iOS](https://img.shields.io/badge/macOS%20%C2%B7%20iOS-000000?style=flat-square&logo=apple&logoColor=white) ![Node.js](https://img.shields.io/badge/node-%E2%89%A5%2022.18-339933?style=flat-square&logo=node.js&logoColor=white) ![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.2.2--rc.1-4D6BFE?style=flat-square)

**[快速开始](#快速开始)** &nbsp;·&nbsp; **[功能](#功能)** &nbsp;·&nbsp; **[文档](#文档)**

<br>

<img src="docs/images/hero.png" width="900" alt="桌面端截图">

<sub>桌面端（在 DSH 里）：左侧是看板，右侧上方是办公室，下方是信息收集器；右下角的「嘟嘟」（Dudu 的中文名）是对话入口。</sub>

<img src="docs/images/phone.png" width="900" alt="iPhone App 截图">

<sub>iPhone App，从左到右：看板；对话；对话里点「+」弹出的菜单；定时任务。</sub>

</div>

<br>

## 为什么用 Dudu

同时使用几个 Agent 时，每个会话各自独立，进度和问题只能逐个打开查看。Dudu 把它们集中到一个看板上：

- **以 Issue 为中心**：一件事对应一个 Issue，交给一个 Agent 处理。会话关闭或更换后，Issue 和它的记录仍然保留。
- **需要你的排在最前**：看板按 Agent 的状态分组，Agent 提出问题、出错、停止或完成一轮回答时，对应的 Issue 进入「需要你」。
- **决定权在你**：Dudu 只保存收集到的信息，不会自己创建 Issue；Issue 的状态、交给哪个 Agent，都由你决定。

## 概念

- **Issue**：一件要办的事，交给一个 Agent 处理。界面里叫「事项」。
- **Agent**：处理 Issue 的 Claude Code、Codex 或 DSH 自带的 DeepSeek。界面里叫「智能体」。
- **会话**：Agent 的会话，也就是 DSH 侧栏里的会话。
- **对话**：你和 Dudu 本身的聊天，只有一个。桌面端从「嘟嘟」打开。
- **项目**：DSH 里的项目，也就是工作区文件夹。每个 Issue 属于一个项目。

界面文字跟随 DSH 的语言设置，本文引用的是中文界面。信息收集器在界面里叫「信息」，定时任务叫「任务」。

## 快速开始

环境要求：

- macOS。
- DSH Desktop 0.2.2-rc.1（测试过的版本，见[兼容说明](docs/dsh-0.2.2-compatibility.md)），可从 [DSH 主页](https://deepseek.com/harness)下载。
- Node.js 22.18 或更新版本。
- 要用 Claude Code 或 Codex，需要它们已安装并登录。

**1. 安装插件**

```sh
git clone https://github.com/weiwenhao/dudu.git
cd dudu
npm install
npm run package:desktop      # 打出 .local/release/dudu-<版本>.tgz，在 DSH Desktop 的「插件」里安装
npm run desktop:update       # 或者：在 macOS 上一步完成打包、安装进 DSH Desktop 并让它重新加载
```

装好后，在 DSH 左侧栏打开「嘟嘟」。

**2. 创建第一个 Issue**

在「嘟嘟」页面点「新建事项」，选择项目和 Agent，写下要做的事。Agent 开始执行，状态显示在看板上。

**3. 安装 iPhone App 并配对（可选）**

需要 Xcode 27 或更新版本（iOS SDK 27）、XcodeGen，一台已与这台 Mac 配对的 iPhone，以及能为它签名的 Apple 开发者账号；最低支持 iOS 18。目前没有 TestFlight 和 App Store 版本，需要自行编译。

先把 `native/project.yml` 里的 `DEVELOPMENT_TEAM` 和 `PRODUCT_BUNDLE_IDENTIFIER` 改成你自己的，再运行：

```sh
npm run native:build         # 构建 iPhone App
npm run native:install       # 覆盖安装到 iPhone；连着多台设备时加 -- --device <设备标识>
```

在「嘟嘟」页面点右上角的设置，进入「手机控制」，填写电脑名称，点「生成二维码」，用 iPhone App 扫描。第一个连接地址由电脑当前的局域网 IP 自动生成。连接方式见[手机连接](docs/phone-connection.md)。

## 功能

看板、信息收集器和办公室是仪表盘上的三个小组件，可以拖动，也可以调整大小。

### Issue 和看板

Issue 有状态、优先级、所属项目、标签、子 Issue 和截止日期，用法和 Linear、GitHub 的 Issue 相近。状态默认有待规划、待办、处理中、待审核、已完成和已取消，由你手动修改，不随 Agent 的运行变化。支持列表和看板两种视图；右键可以修改状态、优先级、标签和截止日期，把 Issue 交给 Agent，或复制编号。

看板默认按 Agent 的状态分成四组：「需要你」（轮到你处理）、「工作中」、「空闲中」（Agent 没在做事，也没在等你）和「未分配」（还没有交给 Agent）。

Issue 由本机的 Claude Code、Codex 或 DSH 自带的 DeepSeek 处理，用的是它们自己的会话。Claude Code 和 Codex 的会话也可以在终端里继续：`claude --resume`、`codex resume`。

### 信息收集器

读取你连接的服务里的内容，放进信息收集器，由你逐条处理：忽略、转给某个 Issue，或新建 Issue。先在设置里连接一个服务（内置目录有飞书、Google 日历和云端硬盘、Notion、Linear、Atlassian 等，也可以添加自定义连接器），再建一个收集器，设定读什么、多久读一次。每次读取会启动一个模型会话。

### 办公室

每个 Agent 是办公室里的一个小人，位置对应它的状态：工作中的坐在工位上；等你处理的和空闲的在休息区；进入深度睡眠（进程已关闭）的躺在床上。

### 对话

和 Dudu 的对话只有一个，一直延续，使用 DSH 里配置的模型。桌面端从右下角的「嘟嘟」打开，iPhone App 里在侧栏中。输入 `@` 选一个 Issue，再写一句话，这句话会发给这个 Issue 的 Agent，回复也出现在这个对话里。过长的回复会折叠，点「展开」查看全文。

### 定时任务

按计划自动运行任务：每天、每周、每月、固定间隔、仅一次，或自定义 cron。执行者可以是 Claude Code、Codex、DeepSeek，也可以是 Dudu 自己；Dudu 自己执行的任务，结果显示在对话里。

### 额度

点右上角的额度图标，查看 Claude、ChatGPT（Codex）的订阅额度和 DeepSeek 的账户余额。只在点击时查询，读取不到的来源不显示。

### iPhone App

用 SwiftUI 开发，DSH 自己的设置页以网页形式在 App 里打开。首页是看板，点一行打开这个 Issue 的会话；另有对话、信息收集器、定时任务和额度，支持语音输入，可以发送图片和文件。

## 整体结构

<p align="center"><img src="docs/images/architecture.svg" width="900" alt="整体结构图"></p>

- Issue、收集到的信息和定时任务保存在本机的 SQLite 和文件中。
- Claude Code 和 Codex 通过 [OAR](https://www.npmjs.com/package/@botiverse/oar)（控制命令行 Agent 的库）接入 DSH；DeepSeek 使用 DSH 自带的会话。
- iPhone App 经带鉴权的 HTTP/HTTPS 直连电脑，实时更新使用 HTTP 长轮询。Dudu 没有自己的云端服务。
- 工具和技能使用 DSH 已有的，Dudu 不另外实现。

## 安全

- 配对码只能手动生成，10 分钟有效，每台手机可以单独撤销。安装插件和保存连接地址都不会自动生成配对码。
- 页面和接口都需要先配对：没有匿名页面，不转发任意 URL，也不转发任意的 DSH 调用。配对凭据只放在 `Authorization` 请求头里，不出现在网页脚本和 URL 中。
- 局域网地址使用 HTTP，传输不加密。通过 TLS 反向代理或隧道（HTTPS）连接时，中转服务器能看到解密后的流量，这不是端到端加密。
- Dudu 启动的 Agent 默认拥有完全访问权限；OAR 没有审批通道，不会逐项询问。
- 数据保存在本机。发给模型的内容，发往你自己配置的模型提供方。

## 文档

| 内容 | 文档 |
| --- | --- |
| 整体设计：产品、架构、界面、接口 | [docs/assistant.md](docs/assistant.md) |
| 连接手机、安装 App、配对 | [docs/phone-connection.md](docs/phone-connection.md) |
| 在 DSH 里使用 Claude Code 和 Codex | [docs/providers.md](docs/providers.md) |
| 定时任务 | [docs/scheduled-tasks.md](docs/scheduled-tasks.md) |
| Issue 接口 | [docs/issues-api.md](docs/issues-api.md) |
| 为 Dudu 编写小组件 | [examples/dudu-widget](examples/dudu-widget) |

## 开发与贡献

```sh
npm run typecheck
npm test               # 单元测试，很快；只保留关键用例：数据安全、鉴权、进程间约定、状态和分配规则
npm run test:e2e       # 端到端：把插件装进一个独立的 dsh web，用 Chrome 驱动；较慢，需要本机装有 DSH 和 Chrome
npm run native:build   # 构建 iPhone App，检查它能否编译
```

界面外观（尺寸、间距、文字、动画）不写自动化测试，由人工检查。

开始之前请阅读 [AGENTS.md](AGENTS.md) 和 [native/AGENTS.md](native/AGENTS.md)，里面写了开发约定。

<details>
<summary>目录</summary>

| 位置 | 用途 |
| --- | --- |
| `host/dudu-plugin/` | DSH 插件入口，以及 Dudu 页面的 React 界面（`ui/`，shadcn/ui + Tailwind） |
| `host/assistant/` | Dudu 的核心库：Issue、收集器、连接器、分配、定时任务、仪表盘版面、对话 |
| `host/providers/` | 接入 Claude Code、Codex（基于 OAR）、读取额度、读取已有会话 |
| `host/native-*.mjs` | iPhone App 用的接口：鉴权 HTTP API、页面会话、事件长轮询 |
| `native/` | iPhone App（SwiftUI，工程由 `native/project.yml` 经 XcodeGen 生成） |
| `packages/oar-adapter/` | 对 OAR 的适配和补丁 |
| `examples/dudu-widget/` | 小组件模板 |
| `scripts/` | 打包、安装、构建脚本 |
| `desktop/` | 发布包里的安装脚本和说明 |
| `docs/` | 设计和说明 |
| `tests/` | 单元测试；`tests/e2e/` 是真实 DSH 里的端到端测试 |
| `App.tsx`、`src/`、`host/plugin/`、`plugins/`、`assets/`、`app.json`、`eas.json` | 旧的 Expo 原型，仅作参考，不在运行链路里 |

</details>

## 社区

使用交流和问题讨论：[LINUX DO](https://linux.do/)、[V2EX](https://www.v2ex.com/)。Bug、建议和较大改动的想法，请在 GitHub 上提 Issue。

## 许可证

[MIT](LICENSE)
