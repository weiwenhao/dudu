# 原生 App 问题框（2026-11-20）

主人选择聊天入口 A，并在看过 Android 设计后要求实现两端。已选稿：

- iOS：`.local/designs/mobile-questions-2026-11-20/v4/` 的 A 文字入口和恢复的黑色主按钮。
- Android：`.local/designs/mobile-questions-2026-11-20/android-a/` 的入口、单选、多选和文字回答。

## 实现

聊天里只有蓝色“回答问题”、灰色题号和小箭头，不再显示旧的整块问题卡片。
问题第一次出现在前台的聊天里时，原生底部弹窗自动打开一次（主人 2026-11-21：“提问框没有默认弹出来啊，还要我自己去点开”，这改了 11-20 “不会自行打开”的约定）；
关闭后不会再自己弹出，要再打开就点“回答问题”。弹窗一题一页；选项、原有说明和直接输入处于同一白色圆角组，选择标记在右侧。
短问题作为居中标题，放不下的题目完整放进可滚动正文，标题用原来的 `header`，没有时用“回答问题”。
不增加额外的解释文案。

iOS 复用 `QuickSheetPage`、`SheetCloseButton`、`SheetFooter` 和 `SheetOutsideTapDismiss`，
根据该组件实测的标题、正文和底栏高度调整 detent，最高为屏高的 75%，长内容在里面滚动。
Android 复用 Material 的 `DuduSheet`、`SheetHeader`、`RadioButton`、`Checkbox` 和按钮；
保留其 24dp 把手和 52dp 标题栏，不引入 iOS 的玻璃关闭圆钮。短内容按内容收高，
长内容使用既有弹窗的高度上限，底栏留在滚动区外。

上一题为浅底描边胶囊，跳过是文字按钮，下一题 / 提交为实心主按钮，
提交立即在该按钮内部显示转圈并阻止重复操作。实际提交继续使用认证的 `question.answer`，
包含原始 call ID、题目 ID、按原始选项顺序整理的选择和自填文本；不改变 DSH 的前台等待、
继续后补答、桌面与手机竞争同一请求的处理。

答案、题号、已完成题目的集合、提交状态与请求作用域都由聊天入口持有，不属于弹窗子视图。
关闭、点击外面、下拉或系统返回只隐藏问题，不提交、不跳过、不停止智能体；
重新打开继续当前题。上一题保留其他答案，跳过只清空当前题，最后一题确认后才提交整组。
失败留在原来的草稿中，不自动重试。它们只保留在当前界面状态，不把待答问题写进磁盘会话缓存。

两端在问题弹窗打开期间暂停底下聊天的已读确认和语音采集。弹窗关闭或问题被另一端回答后解除遮挡；
不把弹窗后面更新的内容当成用户已经读到。诊断只记录开关、提交开始 / 成功 / 失败和题目数量，
不记录问题、答案、会话或电脑 ID。

新增中文只有已随 A 方案批准的“回答问题”；其英文仍待审，没有自行添加翻译。
其他按钮、提示与无障碍名称复用已有组件和文案，见 `native-localization-wording.md`。

## 检查与限制

本轮检查回执保存在 `.local/qa/mobile-questions-2026-11-20/`：

- `npm run native:build`，iOS 签名 Release 构建。
- Android `:app:assembleDebug`、`:app:lintDebug`。
- 仅 `QuestionDraftTest` 的四项纯逻辑单测：切题保留与提交顺序、单选 / 自填互斥、
  跳过当前题、禁止空答案或未确认题目提交。
- `tests/native-conversation.test.ts` 中仅
  `generic questions preserve option metadata and validate one complete answer batch`。
- 仓库 lint、typecheck 和 `git diff --check`。

没有运行全量单元测试、模拟器、浏览器、DSH 或端到端场景，没有安装手机或更新正式 Desktop。
代码与设计参数已经逐项对照；原生渲染、动态字体、键盘升降、滑动关闭、VoiceOver / TalkBack
以及真实模型到手机的全程交互尚未经界面验证。构建与纯逻辑检查不能代替这些验收。

## 后续安卓安装

主人随后要求“安装到安卓吧”。2026-11-20 已通过 USB 在连接的安卓真机上用
`adb install -r` 覆盖安装这次已检查的 APK，保留应用数据和配对信息；安装后
设备上的 APK SHA-256 与本地构建一致，系统启动结果为 `Status: ok`，进程在运行。
未进行自动答题或界面 / E2E 验证，也没有安装 iPhone 或更新 Desktop。
安装回执在 `.local/qa/mobile-questions-2026-11-20/android-install/result.json`。

## 旧版提问没有手机入口（2026-11-21）

主人再次反馈“向我提出问题”没有出现可操作的问题。只读核对 Desktop 的会话记录后，
01:45 和 01:48 的两次调用使用的是 legacy `ask_user_question` schema；其实际服务
请求不带 `wait`。插件原来只接收带 `wait.callId` 的问题，因此两次都没有进入手机的
待答列表。记录里的 `ASK_ABORTED` 与用户停止该轮同时发生，不是选项提交失败。

`createNativeQuestions` 现在为这类请求分配只在本次存活期间使用的不透明 ID，
手机仍经原来的 watch 和 `question.answer` 返回原始题目 ID、选项与答案，
直接完成捕获的那一个请求。它不改模型工具、不注入 `wait`、不伪造继续后的投影，
不把回答转成无关的新消息，也不恢复已停止的问题。桌面与手机仍只会有一份答案获胜，
父 Agent 的取消信号与原先的定时问题路径保持原样。

新增廉价回归覆盖同会话两次无 `wait` 的并发问题、跨会话拒绝和过期回答；
原问题桥接用例与手机 watch/回答契约用例也通过。检查记录见
`.local/qa/app-optimizations-2026-11-21/`。没有触发真实模型提问、更新 Desktop、
安装手机或运行界面/E2E；这项电脑端桥接修复需要后续更新插件才会进入运行版本。

## 自动打开（2026-11-21）

同一个问题（请求 ID）只自动打开一次，记在 `QuestionAutoOpen`（iOS `ConversationQuestionsView.swift`，安卓 `ConversationQuestions.kt`），不放进会被列表回收的行里。
只在这些条件都满足时才打开，不满足就等条件满足后再打开：聊天是最前面的页面、应用在前台、已连接、聊天自己没有别的弹窗或选择器
（iOS `ChatView.questionsMayOpen`，安卓 `Conversation.kt` 里传给 `Questions` 的 `autoOpen`）。问题所在的行出现在屏幕上时才会触发，所以在聊天里往上翻历史时来的问题，
会在滚到它的时候打开。打开、关闭、提交的其余规则不变，已读确认和语音采集在弹窗期间照旧暂停。
检查：iOS 模拟器里用夹具的 `-dudu-review-questions` 进入会话，不点任何东西，弹窗已经打开（`question.sheet.*` 存在）；向下拖关闭后 3 秒仍是关闭。
安卓只做了构建、单测和 lint，没有真实的待答问题可以看；iPhone 已装，没有在手机上看过。

