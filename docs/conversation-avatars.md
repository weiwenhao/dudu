# 会话头像统一 B-1（2026-11-16）

主人在审阅完整圆形及方形桌面稿后选择“双字方形版（B-1）”，并要求手机及看板列表全部统一。
批准稿为
`.local/designs/desktop-avatar-b2-full-conversation-2026-11-16/02-B-1-full-desktop-conversation.png`，
其取字、色板和尺寸源自
`.local/designs/conversation-avatar-four-full-lists-2026-11-16/preview.mjs` 的 B-1。

## 使用范围

- Desktop 会话模式的普通条目、置顶条目及窄窗口头像栏复用 `ConversationAvatar`。
- Desktop 普通事项列表的左侧头像使用同一组件。
- 原生手机主页与置顶条目复用 `BoardConversationAvatar`。
- 嘟嘟保留原品牌 logo；用于说明供应商的 Claude、Codex 等小标识继续显示原 logo。
  原卡片看板、Agent、收件箱来源等不同含义的图标不另加或改成事项头像。

## 规格

头像用事项自身标题取字，不包含父标题或事项编号。中文取开头最多两字；英文或数字的首词不超过
三个字符时保留原词，较长首词取前两位并大写，对应批准稿的“收集 / DE / UI / IOS / M2”。
其他标题保留开头两个 Unicode 码点。空标题不改用事项编号。

完整标题用 Unicode 码点的 `hash = hash * 31 + codePoint`、UInt32 溢出规则对 12 取余，选取
十二组浅色背景及对应文字色；手机复用 `ConnectorAvatar` 的色板，Desktop 用 `styles.css` 的
`--tone-0` 到 `--tone-11`（含深色），安卓用 `avatarTones`，三端同一张表、同一个顺序。
标题相同则三端配色相同，重命名后随标题更新；无需增加接口、配置或颜色持久化。

原来只有七组（蓝、绿、琥珀、玫红、紫、青、灰）。2026-11-18 主人看到手机一屏十行里有五个玫红
（七组按标题哈希，必然重复，十行平均只有 5.5 种颜色），说“加到 12 种吧”，在原来七组后面加了
天蓝 `#E0F2FB/#0B6A94`、橙 `#FDE9DC/#A4410B`、黄绿 `#EDF5D6/#4F6B0A`、洋红 `#FBE6F5/#A0198A`、
咖啡 `#F3EBE3/#6B4F3A`（深色另有一组）。前七组的序号不变，但除数从 7 变成 12，所以大多数标题的颜色
都变了。连接器头像用同一张表。对比图在 `.local/designs/avatar-tones-2026-11-18/boards/tones.png`
（用真算法画的，不是 App 截图）。洋红与玫红都偏红：十行里仍可能出现两三个偏红的头像。

圆角为头像边长的四分之一并取整，不画描边。字号为边长的 0.37 倍，三字符缩为 0.32 倍，
字重 medium/500，文字中心下移 0.015 倍边长。Desktop 保持原有普通 40px、置顶及事项列表
32px；手机保留普通 48pt、置顶 40pt，不改行高或图文间距。

事项头像的未读红点和工作环共用右上角 `(size - 2, 2)` 锚点，大小、红色及工作环动画保持原实现。
嘟嘟及其他 Agent 的圆形状态锚点保留。手机红点继续常驻局部坐标，只切换显隐，随条目侧滑的同一
事务合成；不新增动画、定时器或主线程网络/磁盘工作。忙碌遮罩跟随头像的圆角。

## 验证边界

本次只改展示组件与标题取字，不改变真正的事项编号、排序、置顶存储、已读回执或会话状态规则。
检查包含客户端构建、原生 Release 编译、lint、typecheck 与源码/批准稿对照。
没有新增外观测试，没有获准或运行浏览器、模拟器、真实 DSH 或 UI/E2E 场景，
不能用编译成功代替界面、状态角标及侧滑的目视验收。
现有 `tests/e2e/desktop-conversations.e2e.test.ts` 可在主人再次要求界面验证时运行；
手机使用当前主页 fixture 在模拟器或真机目视确认。
日志与本次检查记录在 `.local/qa/conversation-avatar-b1-2026-11-16/`。

本轮上述构建、lint、typecheck、差异空白检查及原生严格签名检查均通过。
直接运行生产取字函数，对照批准稿样例及空白/短标题等共 19 组输入，Swift 与 JavaScript
结果一致。原生产物仍为 `com.harnessmobile.app` / 0.1.0 / 122，未改变签名团队或构建号；
构建仅报告既有的 `EmbeddedPageSession.swift:233` 不可达分支 warning。
检查回执为该目录的 `result.json`，本轮没有安装手机或热更正在运行的 Desktop。

## 后续安装交付

主人随后明确要求“强制更新安装到手机”。手机通过 `npm run native:install` 原位更新，
并由物理 iPhone 的应用清单回读确认 `com.harnessmobile.app` / 0.1.0 / 123；
严格签名检查通过，团队仍为 `S3549488QR`。未卸载应用，未启动界面或进行 UI/E2E 验证。
安装日志与设备回读位于上述检查目录的 `delivery/`，不覆盖实施阶段的检查回执。

Desktop 的 `npm run desktop:update -- --force` 随后在独立进程中完成，
官方回执 `.local/desktop-updates/run-TlkqDY/result.json` 确认 `mode: hot`，
运行版本为 `0.1.0-beta`、源码指纹为
`54f548518e85a505ff377344f7baf5cdfb3efa4f9bf8a8f2263e41dd2b4a47d0`，
端口为 3170。DSH 保持打开；没有运行界面或端到端验证。
交付目录的 `desktop-update.json` 保留启动、完成及官方运行回执。
