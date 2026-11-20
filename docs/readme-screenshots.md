# README 的六张图怎么重拍

`README.md` 引用 `docs/images/` 下六张图：`hero.en.png`、`hero.zh-CN.png`（顶部大图）、`dashboard.en.png`、`dashboard.zh-CN.png`（仪表盘）、`phone.en.png`、`phone.zh-CN.png`（手机）。界面改动之后要让这几张图跟上，做法是重新跑一遍下面这套流水线，而不是手改 PNG。六张图最近一次由这套流水线生成是 2026-11-20。

这套流水线是真实浏览器自动化加真实模拟器自动化：隔离的 `dsh web`、无头 Chrome、iOS 模拟器。按本仓库的规矩，这些都只在主人那句话里明确提出"重新截图"时才跑一次，不能自己顺手跑；也绝不对着主人自己正在用的 DSH 跑。

流水线本身是 scratch：Desktop/仪表盘部分在 `.local/e2e-hero/`，构图脚本在 `.local/designs/readme-hero-exact-2026-11-17/`，手机部分的素材在 `.local/designs/readme-phone-new-2026-11-17/`、驱动模拟器的 XCUITest 工程在 `.local/ui-touch/`。这些目录都不进 git（`.local/**` 被 eslint 和 `.gitignore` 排除），每次重拍都是在上一次的文件上继续改，不是从零重写。

## Desktop：hero 和 dashboard

两张 hero 和两张 dashboard 共用同一套机制：一个英文实例、一个中文实例，各自是一个隔离的 `dsh web`，装着当前这棵树打包出来的插件，跑一段写死台词的假对话，截图，然后原地切换"步骤脚本"再截一次仪表盘，而不是重开两个实例。

**起两个实例**（`.local/e2e-hero/hero-owner.mjs`，2026-11-20 已更新为中英合一版本，`hero-owner-en.mjs` 是更早的纯英文版，已被取代，不要再用）：

```
DUDU_E2E_DSH="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  node .local/e2e-hero/hero-owner.mjs .local/e2e-hero/run-<date>-en en > run-<date>-en.log
DUDU_E2E_DSH="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  node .local/e2e-hero/hero-owner.mjs .local/e2e-hero/run-<date>-zh zh > run-<date>-zh.log
```

`hero-owner.mjs` 内部用 `.local/e2e-hero/harness.mjs`（`tests/e2e/harness.mjs` 的一份拷贝，逻辑保持同步：按 `host/dudu-plugin/package.json` 的版本号打包，装进临时 `dsh-dudu-<version>.tgz`，这个名字跟着 npm 包名走，包名换了这里也得换），起一个隔离的 `dsh web`，再用 `.local/e2e-hero/hero-data-en.mjs` / `hero-data-zh.mjs` 里写死的会话、Office、收件箱数据把场景摆成和主人截图一样的样子（同样的布局、同样的会话顺序和状态、同样的收件箱编号、同样的 Office 人员分布），模型部分用 `.local/e2e-hero/mock-model.mjs` 的脚本回复代替真实模型。日志只打印 `[en]`/`[zh]` 前缀的进度行；**绝不能把 `dsh web` 的登录地址打到终端或日志里**（它带 token）——两份保留下来的日志（`run-1120-en.log` 等）里确认过没有这一行。

数据摆好之后进程常驻等待：`touch <run文件夹>/run.flag` 会重新跑一遍当前的"步骤脚本"（页面微调 + 截图），`touch <run文件夹>/quit.flag` 才会真正退出。步骤脚本就是 `.local/e2e-hero/hero-steps2.mjs`，但这个文件名是个"当前激活哪一份"的占位：

- `hero-steps2.hero.mjs` 是拍 hero 图用的步骤（关闭侧栏、宠物关掉等等）
- `hero-steps-dashboard.mjs` 是拍仪表盘用的步骤（等仪表盘的编辑布局按钮出现，而不是等某个 CSS 选择器，因为只有会话视图的仪表盘才有 `[data-issues-layout="board"]`；把事项分散到不同状态列，不然全挤在一列）

拍完 hero 之后，把 `hero-steps-dashboard.mjs` 复制成 `hero-steps2.mjs` 再 `touch run.flag`，就会在同一个还活着的实例里接着拍仪表盘，不用重开。`.local/e2e-hero/watch-1120.sh`（2026-11-20 最新一份，逻辑和更早的 `watch-1118e.sh`完全一样，只是把其中的 run 文件夹名换掉）就是把这一串动作自动化：等两个实例都打出 `waiting` 行 → 把 dashboard 步骤复制过去、两边都 `touch run.flag` → 等两边都生成 `dashboard-edit-raw.png` → 两边都 `touch quit.flag` → 把 hero 步骤文件换回去。跑完之后记得把 `hero-steps2.mjs` 的内容换回 `hero-steps2.hero.mjs`，免得下次忘了是哪一份。

截图落在各自 run 文件夹下的 `shot-<timestamp>.png`（hero）和 `dashboard-edit-raw.png`（仪表盘），原图分辨率是视口 1920×1050、设备像素比 2（也就是 3840×2100）。

**构图**（`.local/designs/readme-hero-exact-2026-11-17/`，依赖旁边 `../readme-2026-11-11/compose.py` 里的拼接逻辑）：这一步把隔离浏览器拍出来的"裸"窗口，换上主人自己电脑截图（`original.webp`，2000×1094）里真实的窗口左上角（红绿灯和三个图标），再套上和 hero 一样的圆角、细描边、软阴影，这样成品看起来像主人自己电脑上的真实窗口，而不是通用浏览器 chrome。

- `python3 compose_en.py <raw-shot.png>` → `out/hero.en.png`
- `python3 compose_lang.py <raw-shot.png>` → `out/hero.zh-CN.png`
- `python3 compose_any.py <raw-shot.png> <输出文件名>` → `out/<输出文件名>`（通用版本，仪表盘的两张图用这个：`compose_any.py dashboard-edit-raw.png dashboard.en.png`）

`compose_en.py`/`compose_lang.py` 和 `compose_any.py` 的拼接逻辑完全一样，只是前两个把输出文件名写死了；新的一律用 `compose_any.py` 就够。构图完成后把 `out/` 下对应的六个文件之一复制到 `docs/images/`。

## 手机：三张图

**先确认当前的 scheme 名字**：2026-11-19 原生工程从 `native/` 平铺结构改成了 `native/ios/` + `native/android/`（见 `native/ios/AGENTS.md`），iOS 工程的 spec 是 `native/ios/project.yml`，里面 `name: Dudu`、scheme 也叫 `Dudu`（旧的是 `native/DSBotNative.xcodeproj`、scheme `dsbot`）。`npm run native:build`/`native:install`（`scripts/native-ios.mjs`）是给**真机**用的（`-destination generic/platform=iOS` + `devicectl`），这套流水线要的是**模拟器**构建，不走这两个命令。

生成工程、为模拟器构建（把 `<UDID>` 换成实际启动的模拟器，之前用的是 `dudu-iPhone-Air-iOS27` 这台）：

```
npx xcodegen generate --spec native/ios/project.yml --project native/ios
xcodebuild -project native/ios -scheme Dudu -configuration Debug \
  -destination "platform=iOS Simulator,id=<UDID>" \
  -derivedDataPath .local/native-sim-readme-new build
```

产物应该在 `.local/native-sim-readme-new/Build/Products/Debug-iphonesimulator/Dudu.app`（旧工程叫 `dsbot.app`；新工程 `native/ios/project.yml` 里 `targets.Dudu.settings.base.PRODUCT_NAME: Dudu`，所以产物文件名确实是 `Dudu.app`，这点是从配置里读出来的，不是猜的）。Bundle id 没有变，还是 `com.harnessmobile.app`（同一个文件里 `PRODUCT_BUNDLE_IDENTIFIER` 确认过），这个很关键，因为 TouchRunner 的测试是按 bundle id 认 app 的，不是按产物路径。**没有核实过的是**：改名之后这整条 `xcodegen generate` + `xcodebuild ... build` 命令本身还没有被真正跑过一次（11-20 那次重拍手机图没有新的构建日志，大概率是复用了改名前就已经装好的模拟器 app），第一次跑的时候留意一下有没有报错。

装进已经启动的模拟器：

```
xcrun simctl install <UDID> .local/native-sim-readme-new/Build/Products/Debug-iphonesimulator/Dudu.app
```

（这条也是按旧流程的说法补全的，日志里这一步本身没有输出留档，但 TouchRunner 的测试源码里 `XCUIApplication(bundleIdentifier: "com.harnessmobile.app")` 只是连接一个"已经装好"的 app、不负责安装，所以单独的安装步骤是必须的。）

**驱动模拟器截图**：`.local/ui-touch/` 是一个独立的 scratch XCUITest 工程（`TouchRunner.xcodeproj`，scheme `Touch`），通过真实触摸操作驱动"已安装"的 Dudu app，不需要 Accessibility 权限。README 用的几个场景在 `.local/ui-touch/Tests/`（`ReadmeNewTests` 之类），跑法：

```
xcodebuild test -project .local/ui-touch/TouchRunner.xcodeproj -scheme Touch \
  -destination "platform=iOS Simulator,id=<UDID>" \
  -derivedDataPath .local/ui-touch/DerivedData \
  -only-testing:TouchUITests/ReadmeNewTests/testBoardEn \
  -only-testing:TouchUITests/ReadmeNewTests/testBoardZh \
  ...（其余 testChatXx / testPlusXx / testTasksXx 场景同理）
```

测试用 app 的启动参数指定假数据，app 这边认的参数名是 `-dudu-ui-review`/`-dudu-review-board` 这些（见 `native/ios/Dudu/Core/SimulatorReviewFixture.swift`）——但 `.local/ui-touch/Tests/ReadmeNewTests.swift` 这份 2026-11-17 写的测试代码本身**还没跟着改名更新**，里面硬编码的还是改名前的 `-dsbot-ui-review`/`-dsbot-review-board` 等字符串：照原样跑，app 认不出这些参数，假数据根本不会被加载，截图会是真实空数据而不是摆好的场景，而且不会报错，很容易白跑一次都没发现。跑之前先把这个文件里的 `-dsbot-` 批量替换成 `-dudu-`。JSON 素材在 `.local/designs/readme-phone-new-2026-11-17/`（`board-en.json`、`board-zh.json`、`chat-en.json`、`tasks-en.json` 等）。截图写到 `.local/ui-touch/` 或素材目录下的 `shot-<lang>-<场景>.png`，再用 `.local/designs/readme-phone-new-2026-11-17/compose_phone_new.py` 把几张拼成最终的 `phone.en.png` / `phone.zh-CN.png`，复制进 `docs/images/`。

## 踩过的坑（都来自实际改过的脚本/日志，不是空泛提醒）

- **JSON 里的状态字段要用 app 真实认的状态 id**：手机的看板 tab 是按 `in_progress`、`todo`、`in_review`、`backlog` 这些 id 过滤的（`native/.../Board.swift` 的 `BoardTab.includes`），素材 JSON 一度写成了别的字符串（比如 `"started"`），导致某个 tab 只剩一行；而且这些 JSON 是紧凑格式（`"statusType":"started"`，冒号后没有空格），第一次用 `sed` 改字段时因为多写了个空格没匹配上，改了等于没改。
- **DEBUG 专用的权限假数据要跟产品默认值一致**：`SimulatorReviewFixture.swift`（DEBUG-only）一度让"+"菜单弹出"操作前询问"，和产品实际默认的"完全权限"不一致，截图里会露馅，改成跟默认值一样后要重新装包、重新跑一次对应的 UI 测试。
- **仪表盘假数据不能把所有事项堆在一个状态**：hero 的假数据一度把 13 个事项全设成"进行中"，仪表盘的看板因此只有一列；拍仪表盘前的步骤脚本要先把几个事项挪到别的状态（backlog/todo/in_review/done 各挑几个），再等仪表盘渲染。
- **仪表盘卡片现在显示"最新一条消息"预览**：卡片变更之后，假数据里每个事项要有脚本写好的回复，这样卡片上才有内容可看，而不是空白；步骤脚本会等每张卡片都读到预览文字才截图，日志里能看到 `[xx] previews …` 这一行确认过。
- **脚本回复别用 Markdown 加粗**：仪表盘/会话列表按原文渲染这段文字，加粗符号 `**…**` 会原样显示出来，很难看，假数据里的脚本回复要写纯文本。
- **数据库字段改名会让旧版流水线悄悄失效**：`ignored_at` 列改成 `deleted_at` 之后，`.local/e2e-hero/hero-owner.mjs` 里原来写死 `ignored_at` 的地方得跟着改，不然收件箱的"隐藏某条"那一步会静默失败而不是报错。
- **打包文件名跟着 npm 包名走**：`dsh-dudu-<version>.tgz` 这个前缀是现在的 npm 包名；如果这个仓库以后又换了包名（已经换过一次，从 `dudu` 到 `dsh-dudu`），`.local/e2e-hero/harness.mjs` 这份拷贝要跟着 `tests/e2e/harness.mjs` 的改动同步，不然会装错文件。
- **手机测试代码里的启动参数名会跟着原生工程改名掉队**：2026-11-19 app 把 `-dsbot-*` 系列启动参数全改成了 `-dudu-*`，但 `.local/ui-touch/Tests/ReadmeNewTests.swift` 这份 2026-11-17 写的 scratch 测试代码没有跟着改，照原样跑不会报错，只会让假数据静默加载失败，截图拍出来的是空数据——每次重拍前先确认测试代码里的启动参数名和 app 当前实际认的一致，不要假设旧脚本还对得上。
