# 嘟嘟（Dudu）

DeepSeek Harness（DSH）里的助手：把信息收进来，把事一直推到做完，需要你的时候才找你。
电脑上是一个 DSH 插件，手机上是一个原生 iPhone App。

> 状态：个人项目，持续开发中，功能和接口还会变。尚未选定开源协议，见文末「许可证」。

## 它做什么

- **收集**：连接器（一段 Prompt，或 DSH 里已连上的 MCP 服务）加收集器（收集什么、多久一次），把外面的信息读成一条条记录，放在「信息收集器」里等你读。嘟嘟只收集，不替你判断，也不会自己建事项。
- **事项（Issue）**：结构照 Linear：状态、优先级、项目、标签、子事项、截止日期；有列表和看板，默认按智能体的状态分组（工作中、需要你、空闲中）。事项的状态由你手动改。
- **智能体**：把事项交给 Claude Code、ChatGPT（Codex）或 DeepSeek 去做，每个事项一个长期会话。事项是核心，会话只是载体，可以关掉、更换、恢复。
- **和嘟嘟说话**：嘟嘟只有一个对话（电脑上收成右下角的宠物）。像群聊一样用 `@事项编号` 把话带给那个事项的智能体，它的回复回到对话里；输入框上方有「待办」「信息」「任务」三个快捷项。
- **任务**：按规则定时执行的任务，嘟嘟自己也可以做任务的执行者，结果回到对话里。
- **额度**：Claude、ChatGPT、DeepSeek 的订阅额度，点一下就看。
- **仪表盘**：电脑上的首屏是一张可以自己摆的小组件网格：Issues、信息收集器、办公室（每个在做的事项是办公室里坐在工位上的一个人），也可以自己写小组件。
- **手机 App**：SwiftUI 原生，首页是看板，点一行进这个事项的会话，另有信息收集器、任务、额度、对话、语音和图片。通过配对认证的 HTTP/HTTPS 连接你的电脑，不用 WebSocket。

## 怎么搭起来

```
iPhone App（SwiftUI）
   │  HTTP / HTTPS，配对认证，长轮询
   ▼
DSH Desktop ── dudu 插件（端口 3170）
                 ├─ 嘟嘟的库（SQLite：事项、记录、任务、版面……）  host/assistant/
                 ├─ 供应商（经 OAR 接 Claude Code、Codex）         host/providers/
                 ├─ 手机接口和页面（/dsbot/api/v1、/dsbot/ui/）    host/native-*.mjs
                 └─ 嘟嘟的界面（React，编成 dist/client.js）       host/dudu-plugin/ui/
```

嘟嘟用的是 DSH 已有的工具、技能、智能体和 MCP，自己不另造一套；记忆系统也独立于 DSH 的其他插件。

## 快速开始

环境：

- macOS（桌面更新脚本按 macOS 写）、DSH Desktop 0.2.x（在 0.2.2-rc.1 上验证，见 [docs/dsh-0.2.2-compatibility.md](docs/dsh-0.2.2-compatibility.md)）、Node.js 22.18 或更新。
- 手机 App 另需 Xcode 27.2 或更新（SDK 27+）、XcodeGen，和一个能给你的手机签名的 Apple 开发者账号；App 最低支持 iOS 18。

```sh
npm install

# 电脑端：打出 .local/release/dudu-<版本>.tgz，在 DSH Desktop 的「插件」里安装
npm run package:desktop
# macOS 上开发时可以一步到位：打包、装进 DSH Desktop 并热重载
npm run desktop:update

# 手机端：构建 iPhone App，覆盖安装到已配对的手机
npm run native:build
npm run native:install
```

配对：在 DSH 里打开嘟嘟页面，进右上角设置的「手机控制」，填好电脑的连接地址，手动点「生成二维码」，再用手机上的 Dudu 扫码。安装插件和保存地址都不会自动生成配对码。连接方式、鉴权范围、更新脚本的细节见 [docs/phone-connection.md](docs/phone-connection.md)。

## 目录

| 位置 | 用途 |
| --- | --- |
| `host/dudu-plugin/` | DSH 插件入口，和嘟嘟页面的 React 界面（`ui/`，shadcn/ui + Tailwind） |
| `host/assistant/` | 嘟嘟的库：事项、收集器、连接器、分配、任务、仪表盘版面、对话 |
| `host/providers/` | 供应商（Claude Code、Codex，基于 OAR）、额度读取、读已有会话 |
| `host/native-*.mjs` | 手机接口：鉴权 HTTP API、页面会话、事件长轮询 |
| `native/` | iPhone App（SwiftUI，项目由 `native/project.yml` 经 XcodeGen 生成） |
| `packages/oar-adapter/` | 对 OAR 的适配和补丁 |
| `examples/dudu-widget/` | 给嘟嘟写小组件的模板 |
| `docs/` | 设计和说明 |
| `tests/` | 单元测试；`tests/e2e/` 是真实 DSH 里的端到端测试 |
| `App.tsx`、`src/`、`host/plugin/` | 旧的 Expo 原型，只留作参考，不在运行链路里 |

## 开发和测试

```sh
npm run typecheck
npm test               # 单元测试，毫秒级；测试只留关键的（数据安全、鉴权、进程间约定、几条复杂规则）
npm run test:e2e       # 端到端：把插件装进一个独立的 dsh web，用 Chrome 驱动，较慢，需要本机装有 DSH 和 Chrome
npm run native:build   # iPhone App 的检查
```

界面看起来对不对（尺寸、间距、字样、动画）不写测试，靠人看。

## 文档

- [docs/assistant.md](docs/assistant.md)：设计文档，产品、架构、界面、接口都在里面。
- [docs/phone-connection.md](docs/phone-connection.md)：手机连接、安装、配对，和 App 的行为。
- [docs/providers.md](docs/providers.md)：供应商，怎么在 DSH 里用 Claude Code 和 Codex。
- [docs/scheduled-tasks.md](docs/scheduled-tasks.md)：任务。
- [docs/issues-api.md](docs/issues-api.md)：事项的接口。
- [docs/dsh-0.2.2-compatibility.md](docs/dsh-0.2.2-compatibility.md)、[docs/dsh-session-control.md](docs/dsh-session-control.md)：DSH 的兼容和会话控制。
- [docs/native-mobile-fixes.md](docs/native-mobile-fixes.md)：手机端遇到的问题和怎么修的。
- [AGENTS.md](AGENTS.md)、[native/AGENTS.md](native/AGENTS.md)：给写代码的 agent 的约定。

## 几条取舍

- 事项是核心，会话只是载体。
- 嘟嘟只收集，不替你处理收集来的信息；事项的状态只由你改，智能体的状态跟着会话的实际情况走。
- 不推送，不通知。手机和电脑看同一份事项。
- 通用：不预设任何人的工具、日历或任务系统。
- 手机和电脑之间只有带鉴权的 HTTP/HTTPS：页面和接口都要先配对，没有匿名页面，也不转发任意 URL 或任意 DSH 调用。

## 贡献

动手之前请先读 [AGENTS.md](AGENTS.md) 和 [native/AGENTS.md](native/AGENTS.md)：界面要复用现有的组件和样式，不另起一套；界面上的字要作者看过；测试只留关键的；手机端的对话滚动有一串不能碰的约束。想改的东西比较大，建议先开 issue 说一声。

## 许可证

尚未选定开源协议。根目录的 `LICENSE` 是项目创建时 Expo 模板带来的 MIT 文本（版权人是 Expo），并不是本项目的协议，确定后会替换。
第三方素材和协议见 [licenses/](licenses/)、[服务图标的来源](host/dudu-plugin/ui/connectors/icons/NOTICE.md) 和 [办公室场景的来源](host/dudu-plugin/ui/widgets/office/marvis/SOURCE.md)。

## 致谢

DSH（[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，MIT）、OAR、shadcn/ui、Radix、Tailwind CSS、gridstack、Lucide、swift-markdown-ui；办公室场景取自 [winterBI/marvis-office](https://github.com/winterBI/marvis-office)。
