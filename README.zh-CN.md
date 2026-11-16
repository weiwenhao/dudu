<div align="center">

<img src="docs/images/logo-wide.png" width="300" alt="Dudu">

### 基于 DSH 的多 Agent 高效协作助手

**同时跑很多个 Claude Code、Codex、Pi、DeepSeek 任务，一眼看出哪个在等你。**<br>
每个任务是一个 Issue，都在一块看板上，电脑和手机上都能看。

[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE) ![version](https://img.shields.io/badge/version-0.1.0%20beta-orange?style=flat-square) ![macOS](https://img.shields.io/badge/macOS-000000?style=flat-square&logo=apple&logoColor=white) ![Node.js](https://img.shields.io/badge/node-%E2%89%A5%2024-339933?style=flat-square&logo=node.js&logoColor=white) ![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.2.2--rc.1-4D6BFE?style=flat-square)

如果 Dudu 对你有用，欢迎在 GitHub 上点个 Star。

[功能](#功能) • [快速开始](#快速开始) • [文档](#文档) • [App Store][app-store] • [English](README.md) · **简体中文**

<img src="docs/images/hero.zh-CN.png" width="900" alt="Dudu 在 DSH Desktop 里：左边是各个事项的对话和打开的一段对话，右上是收件箱，右下是办公室">

</div>

Dudu 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的插件，另有手机 App。目前是 0.1.0 beta，界面和接口还会变化。

> [!NOTE]
> **DSH 是什么？** DeepSeek 开源的 Agent 应用，口号是「Everything is a Plugin」。Dudu 是装在它里面的插件，所以要先装 DSH Desktop。

## 功能

界面里，Issue 叫「事项」，Agent 叫「智能体」，收集器收来的东西放在「收件箱」，定时任务叫「任务」。

- **看板**：每个任务是一个 Issue，有状态、优先级和标签，可以看列表、看板（参照 Linear）或会话列表。每个会话会显示它的 Agent 是在工作、有未读回复，还是空闲。
- **Agent**：Claude Code、Codex、Pi 和 DeepSeek。Claude Code 和 Codex 用的是你电脑上装好的程序，沿用你的登录、设置、skills 和 MCP；Pi 用电脑上装好的 `pi`（1.4.0 或更新）。电脑上已有的 Claude Code、Codex 会话可以导入，或「接管」成 Issue。
- **终端**：Claude Code、Codex 的会话可以从它的 Issue 里复制接续命令，在终端里接着用。一个会话同一时间只在一个地方用，DSH 里或终端里。
- **手机 App**：同样的会话，带语音输入。
- **收件箱**：由 DSH 里的模型按你设的频率，通过你设置的收集器读飞书、Notion、Linear 等，所以每次收集都会花 token。每条记录可以新建成 Issue、发给某个 Agent，或忽略。
- **对话**：让 Dudu 新建 Issue，或用 `@` 把话发给某个 Issue 的 Agent。点页面右下角的蓝色小图标打开。
- **定时任务**：按计划运行一条提示词。
- **额度**：点右上角的「额度」图标，查看 Claude、ChatGPT 和 DeepSeek 还剩多少。
- **办公室**：每个进行中的 Issue 是一个小人：Agent 工作时在工位，会话睡着了在床上，其余在休息区。
- **仪表盘**：每个小组件都可以拖动、调整大小。

**手机 App。** 从左到右：会话列表、对话、对话里「+」弹出的菜单、任务。

<div align="center">
  <img src="docs/images/phone.zh-CN.png" alt="手机 App，从左到右：会话列表；对话；对话里点「+」弹出的菜单；任务" width="900">
</div>

**仪表盘。** 点右上角的「编辑版面」拖动、调整小组件。下图里，左边的看板用了看板布局，右边的小组件正在调整大小。

<div align="center">
  <img src="docs/images/dashboard.zh-CN.png" alt="仪表盘的编辑状态：左边的看板用了看板布局，右边的小组件正在调整大小，蓝框和「6×4」是它的新尺寸" width="900">
</div>

## 快速开始

需要：

- macOS 13 或更新（Apple 芯片），装好 [DSH Desktop](https://deepseek.com/harness)（在 0.2.2-rc.1 上测试过，见[兼容性审计（英文）](docs/dsh-0.2.2-compatibility.md)）并在里面配好模型
- Node.js 24 或更新版本和 Git
- 要用 Claude Code、Codex 或 Pi 的话，它们已装好并登录

### 1. 安装插件

```sh
git clone https://github.com/weiwenhao/dudu.git
cd dudu
npm install
npm run desktop:update       # 打包、装进 DSH Desktop 并让它重新加载
```

然后在 DSH 左侧栏打开「嘟嘟」（Dudu 的中文名）。`desktop:update` 要求 DSH Desktop 装在 `/Applications` 里并启动过一次，失败时日志在 `.local/desktop-updates/`。不用脚本时，运行 `npm run package:desktop`，再在 DSH Desktop 的「插件」里安装 `.local/release/dudu-<版本>.tgz`。

### 2. 创建 Issue

在「嘟嘟」页面点「新建事项」，填写标题，选一个项目（DSH 里的工作区，一个文件夹）和一个智能体，点「创建事项」。

### 3. 跟进

Agent 开始工作。这一轮做完或提了问题，它的会话会显示红点，直到你读过：点开回答，或自己改事项的状态。状态始终由你来改，Agent 不会动它。

### 4. 连接手机 App（可选）

从 [App Store][app-store] 安装（需要 iOS 18 或更新版本）。在「嘟嘟」页面点右上角的设置，进入「手机控制」，填写电脑名称，点「生成二维码」，用 App 扫描。内网地址只在手机和电脑处于同一个内网时能用。要在外面用，自己配一个 HTTPS 反向代理或隧道指向 3170 端口，然后在「连接地址」里点「添加地址」，选「公网地址」；App 会先试内网地址。电脑上的 DSH Desktop 和隧道要一直开着。详见[手机连接](docs/phone-connection.md)。

## 文档

| | |
| :-- | :-- |
| **[设计文档](docs/assistant.md)** | 产品、结构、界面、接口。很长，含决策记录 |
| **[手机连接](docs/phone-connection.md)** | 安装、配对 |
| **[Claude Code、Codex 和 Pi](docs/providers.md)** | 它们在 DSH 里怎么运行 |
| **[定时任务](docs/scheduled-tasks.md)** | |
| **[Issue 接口](docs/issues-api.md)** | |
| **[小组件](examples/dudu-widget)** | 为 Dudu 写一个小组件（英文） |
| **[AGENTS.md](AGENTS.md)**、**[native/AGENTS.md](native/AGENTS.md)** | 写给编码 Agent 的开发约定（英文）。其中的签名和测试审批流程是作者自己的工作方式 |
| **[GitHub Issues](https://github.com/weiwenhao/dudu/issues)** | Bug 和建议 |

## 开发

```sh
npm run typecheck
npm test               # 单元测试，很快
npm run test:e2e       # 端到端，较慢；需要 dsh 命令（或设 DUDU_E2E_DSH）和 Chrome
```

## 推荐站点

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
