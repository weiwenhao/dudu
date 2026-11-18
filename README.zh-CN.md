<div align="center">

<img src="docs/images/logo-wide.png" width="300" alt="Dudu">

### 基于 DSH 的多智能体高效协作助手

[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE) ![version](https://img.shields.io/badge/version-0.1.0%20beta-orange?style=flat-square) ![Node.js](https://img.shields.io/badge/node-%E2%89%A5%2024-339933?style=flat-square&logo=node.js&logoColor=white) ![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.2.2--rc.1-4D6BFE?style=flat-square)

[设计理念](#设计理念) • [功能](#功能) • [开发指南](#开发指南) • [English](README.md) · **简体中文**

</div>

Dudu 是基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 开发的多智能体协作工作台，可以在 DSH 的「添加插件」中输入 dsh-dudu 快速安装。

<div align="center">
    <img src="docs/images/hero.zh-CN.png" width="900" alt="Dudu 在 DSH Desktop 里：左边是各个事项的对话和打开的一段对话，右上是收件箱，右下是办公室">
</div>

Dudu 支持手机端管理，iOS 在 App Store 搜索 dudu，安卓通过 [GitHub Release](https://github.com/weiwenhao/dudu/releases) 中的 apk 进行安装。

<div align="center">
  <img src="docs/images/phone.zh-CN.png" alt="手机 App，从左到右：会话列表；对话；对话里点「+」弹出的菜单；任务" width="900">
</div>

工作台主页面采用了仪表盘的形式，可以自由组合布局，并且可以开发自己的小组件。

<div align="center">
  <img src="docs/images/dashboard.zh-CN.png" alt="仪表盘的编辑状态：左边的看板用了看板布局，右边的小组件正在调整大小，蓝框和「6×4」是它的新尺寸" width="900">
</div>

## 设计理念

Dudu 基于 [oar](https://github.com/botiverse/oar) 将多种智能体(TUI)聚合在一个 GUI 界面中，解决多智能体管理问题。并基于看板高效的管理任务状态，基于会话高效的管理智能体状态。

图片是我日常使用的工作台，我一般常驻打开的智能体会话有 30 多个，包括 Claude、Codex、DeepSeek 等，既有个人项目，也有工作项目。Dudu 解决的就是这种多智能体、多任务场景下的工作效率问题。其已经替代了我过去一直使用的 Herdr/Orca。

另一种流行的会话管理方式是 Bot，比如 DS bot, Grok bot，人类只需要和少量的 Bot 聊天就能完成大量的任务，但我片面的以为在工作中直接和智能体对话比通过 Bot 转发更准确，所以至少在当前版本 Dudu 并不是类似 Grok bot 类型的产品，但代价就是人类需要参与得更多。

一种个人智能体，比如 OpenClaw, Muse 在日常生活，规划，管理非常的方便，
基于 DSH 底座打造个人智能体非常便捷，所以**嘟嘟**它来了，这是一个和 Muse 类似的个人智能体，有着自己的记忆管理系统。嘟嘟可以操作会话看板、编写小组件、连接器、收集器、定时任务等所有功能。

## 功能

- 支持 DSH、Claude、Codex、Pi 四种 Agent，并深度集成到了 GUI 中。
- 可以方便地导入已有的 DSH、Claude、Codex 会话。
- 通过个人助理嘟嘟，用对话的方式管理所有功能。
- 不活跃的智能体会自动进入深度休眠，避免占用内存。
- 以 Issue 看板为核心，进行协作和会话管理。
- 会话像聊天软件一样管理，可以快速定位到已经完成工作的会话。
- 在手机上也能管理 DSH 会话，相当于 DSH 的手机端，同时支持 iOS 和安卓。
- 用收集器把你所有的信息收集起来，统一管理。
- 通过定时任务，可以派任意 Agent 去做任何事情，比如邮件管理、日常巡检。
- 可以快速查看 Claude、Codex、DeepSeek 的额度。
- 仪表盘上的每个小组件都可以拖动、调整大小，也可以让嘟嘟写自己的小组件。
- 还有一个可爱的办公室，无聊的时候可以看看你的 Agent 都在干什么。


## 数据目录

| 目录 | 内容 |
| :-- | :-- |
| `~/.dsh` | DSH 的数据目录，即 `DSH_HOME` |
| `~/.dsh/dudu/home` | 嘟嘟的家目录，也是嘟嘟会话的工作目录，放它的 Markdown 文件（`AGENTS.md`、`SOUL.md`、`USER.md`、`MEMORY.md` 等）和它写的小组件（`widgets/`），可以在设置里改位置 |
| `~/.dsh/dudu/assistant/` | 嘟嘟的设置和数据库（`settings.json`、`issues.db` 等） |

## 开发指南

欢迎在 [GitHub Issues](https://github.com/weiwenhao/dudu/issues) 反馈 Bug 和建议，也欢迎提交 Pull Request。改动较大时，建议先开一个 Issue 说说你的想法。

### 开发环境

需要 Node.js 24 或更新版本、Git 和 [DSH](https://deepseek.com/harness)。构建 iOS App 还需要 Xcode 和 [XcodeGen](https://github.com/yonaskolb/XcodeGen)，构建安卓 App 还需要 Android Studio。

```sh
git clone https://github.com/weiwenhao/dudu.git
cd dudu
npm install
```

### 运行

```sh
npm run desktop:update     # 打包并装进本机的 DSH Desktop，目前只支持 macOS
npm run native:install     # 构建 iOS App 并装到 iPhone
npm run android:install    # 构建安卓 App 并装进模拟器
```

构建 iOS App 前，把 `native/project.yml` 里的开发者团队和 Bundle ID 换成你自己的。

不用 `desktop:update` 时，运行 `npm run package:desktop`，再在 DSH 的「添加插件」里安装 `.local/release/` 下的 `dsh-dudu-<版本>.tgz`。

### 测试

```sh
npm run typecheck
npm test             # 单元测试
npm run test:e2e     # 端到端测试，较慢
```

### 开发小组件

直接让嘟嘟写。它会在家目录的 `widgets/` 下写一个 `.mjs` 文件，几秒后就能在「编辑版面」的「添加小组件」里看到，不用装插件，也不用克隆代码。写法见 [WIDGETS.md](host/dudu-plugin/WIDGETS.md)。

要发布给别人用的话，做成 DSH 插件，见[小组件模板](examples/dudu-widget/README.md)（英文）。

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
