# iOS / Android 页面与弹窗对照

本页保留 2026-11-17 被所有者退回版本的历史截图。左侧为 iOS，右侧为 Android；均来自当时实际运行的 App，仅同宽缩放并排展示。它们没有反映后续修正，不是当前 APK 的验收证据。

所有者指出的事项菜单、删除确认及其他自定义界面差异均属于待修正的问题，不能以平台原生风格解释。当前修正以最新 SwiftUI 源码与所有者参考图为准，构建和源码比较不代表视觉验收。

这些历史截图使用本地一次性数据，未连接生产 DSH、未调用模型。个别示例数据与选中项不同。当时顺序复用了现有 iOS 模拟器和 Android AVD，未新建模拟器；本次收尾没有重新运行它们。

最新改动和检查见 `android-ui-parity.md` 与 `.local/qa/android/ui-parity-2026-11-17/source-correction-verification.json`。旧 `verification.json` 仅对应这些历史截图；旧图和编译通过都不能说明当前布局、触摸与返回交互已经验收。

## 入口与设置

### 首次连接

![首次连接：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/01-pairing.png)

### 手动配对

![手动配对：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/02-pairing-manual.png)

### 看板首页

![看板首页：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/03-home.png)

### 范围选择

![范围选择：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/04-scope-menu.png)

### 侧边栏

iOS 截图多出“文件”入口，是审阅数据为打开项目文件页提供的临时导航项；Android 截图使用常规导航清单。该入口差异不属于产品界面改动。

![侧边栏：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/05-sidebar.png)

### 设置首页

![设置首页：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/06-settings.png)

### 关于与版本信息

![关于与版本信息：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/08-about.png)

## 嘟嘟设置

### 通用

![通用：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/20-settings-general-.png)

### 状态列表

![状态列表：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/21-settings-statuses-.png)

### 编辑状态

![编辑状态：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/22-settings-statuses-edit-in_progress.png)

### 新建状态

![新建状态：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/23-settings-statuses-add-started.png)

### 连接器

![连接器：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/24-settings-connectors-.png)

### 连接器详情

![连接器详情：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/25-settings-connectors-connector-fixture-mail.png)

### 添加连接器

![添加连接器：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/26-settings-connectors-add.png)

### 收集器

![收集器：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/27-settings-collectors-.png)

### 编辑收集器

![编辑收集器：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/28-settings-collectors-edit-fixture-collector.png)

### 添加收集器

![添加收集器：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/29-settings-collectors-add.png)

### 规则

![规则：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/30-settings-rules-.png)

### 规则编辑

![规则编辑：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/31-settings-rules-edit-ASSIGN.md.png)

### 记忆

![记忆：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/32-settings-memory-.png)

### 编辑记忆

![编辑记忆：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/33-settings-memory-edit-1.png)

### 技能

![技能：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/34-settings-skills-.png)

### 技能详情

![技能详情：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/35-settings-skills-skill-project-review.png)

## 电脑连接

### 电脑列表

![电脑列表：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/40-computers.png)

### 连接详情

![连接详情：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/42-addresses.png)

### 地址编辑

![地址编辑：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/43-address-editor.png)

## 事项

### 新建事项

![新建事项：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/45-new-issue.png)

### 选择项目

![选择项目：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/46-project-picker.png)

### 选择智能体

![选择智能体：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/47-agent-picker.png)

### 选择状态

![选择状态：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/48-status-picker.png)

### 选择优先级

![选择优先级：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/49-priority-picker.png)

### 截止日期

历史截图中的截止日期入口不同；本次已改为预设与日历选择页，尚未重拍。

![截止日期：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/50-due-date.png)

### 标签选择

![标签选择：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/50b-label-picker.png)

### 更多创建操作

![更多创建操作：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/51-creation-more.png)

### 新建项目

![新建项目：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/52-new-project.png)

### 新建标签

历史截图的标签创建流程不一致；本次已与 iOS 一样从标签搜索进入颜色选择页，尚未重拍。

![新建标签：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/53-new-label.png)

### 标签颜色

历史截图中 Android 使用下拉菜单选择颜色；本次已改为独立颜色选择页，尚未重拍。

![标签颜色：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/53b-label-color.png)

### 事项操作菜单

所有者已拒绝这张 Android 操作菜单；本次已重做为靠近事项行的分组菜单，尚未重拍。

![事项操作菜单：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/54-issue-actions.png)

### 事项详情

历史截图把属性编辑混入详情；本次详情已改为标题、摘要和描述，属性在独立选择页修改，尚未重拍。

![事项详情：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/55-issue-detail.png)

### 删除事项确认

所有者已拒绝 Android 标题上方的大图标；本次已移除，保留紧凑标题与等宽圆角按钮，尚未重拍。

![删除事项确认：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/57-delete-issue.png)

### 子事项

![子事项：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/58-subissues.png)

## 收集的信息

### 收件箱

![收件箱：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/60-inbox.png)

### 收件记录详情

![收件记录详情：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/61-inbox-detail.png)

## 定时任务

### 任务列表

![任务列表：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/65-tasks.png)

### 任务左滑操作

![任务左滑操作：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/65b-task-swipe.png)

### 任务详情

![任务详情：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/66-task-detail.png)

### 任务编辑

![任务编辑：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/67-task-edit.png)

### 规则类型

![规则类型：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/68-task-rule.png)

### 运行时间

保留各平台原生的日期/时间选择器。

![运行时间：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/68b-task-time.png)

### 运行日期

保留各平台原生的日期/时间选择器。

![运行日期：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/68c-task-date.png)

### 新建任务

![新建任务：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/69-task-new.png)

### 任务供应商

![任务供应商：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/70-task-provider.png)

## 对话与输入

### 会话搜索与管理

历史截图错误地把内容搜索和管理列表放在同页；本次已拆为独立内容搜索页，尚未重拍。

![会话搜索与管理：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/71-sessions.png)

### 新会话

![新会话：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/72-session-new.png)

### 新会话工作区

![新会话工作区：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/73-new-session-workspace.png)

### 新会话供应商

![新会话供应商：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/74-new-session-model.png)

### 嘟嘟对话

![嘟嘟对话：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/75-conversation.png)

### 会话菜单

![会话菜单：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/76-conversation-menu.png)

### 输入区添加菜单

![输入区添加菜单：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/77-composer.png)

### 模型与思考等级

![模型与思考等级：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/78-models.png)

### 权限选择

权限使用独立选择页；切换高权限选项保留现有 App 的二次确认。

![权限选择：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/78b-permissions.png)

### 目标编辑

目标在普通智能体会话的输入框内编辑；嘟嘟自己的输入菜单不显示目标和计划。

![目标编辑：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/79-goal.png)

### 执行压缩后

压缩从输入区直接执行，不再有多余的确认框。

![执行压缩后：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/80-compact.png)

### 待办浮层

![待办浮层：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/81-quick-todo.png)

### 收件箱浮层

![收件箱浮层：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/82-quick-inbox.png)

### 任务浮层

![任务浮层：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/83-quick-tasks.png)

## 团队、工作与文件

### 智能体团队

![智能体团队：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/84-team.png)

### 展开已完成成员

![展开已完成成员：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/85-team-finished.png)

### 后台任务

![后台任务：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/86-jobs.png)

### 后台任务输出

![后台任务输出：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/87-job-output.png)

### 本会话定时任务

![本会话定时任务：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/88-session-tasks.png)

### 本会话任务详情

复用同一任务详情组件；两端打开了不同的示例任务。

![本会话任务详情：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/89-session-task-detail.png)

### 项目文件

![项目文件：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/90-files.png)

### 项目文件预览

![项目文件预览：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/91-file-preview.png)

### 已编辑文件

![已编辑文件：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/92-changes.png)

### 文件差异

![文件差异：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/93-diff.png)

### 工具详情

![工具详情：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/94-tool.png)

### 系统照片选择

系统界面保留平台原样。iOS 27 模拟器停在系统相册加载页，未验证完成选图；Android 使用系统文件/照片来源。

![系统照片选择：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/95-photo-picker.png)

### 全部交付文件

![全部交付文件：左 iOS，右 Android](../.local/qa/android/ui-parity-2026-11-17/comparison/96-delivered-files.png)

## 平台附加状态

以下也是旧版本截图，其中额外菜单等差异已列入修正；没有补画 iOS 对照图，也未重拍当前 APK。

### Android 语言选择

iOS 使用系统的 App 语言设置；Android 自 2026-11-21 起也用系统设置（安卓 13 以上在系统里给嘟嘟单独选语言），App 内不再提供语言选择。

![Android 语言选择](../.local/qa/android/ui-parity-2026-11-17/android/07-language.png)

### Android 电脑操作菜单

历史截图中的额外菜单。本次已改为信息按钮直接打开详情、左滑删除，尚未重拍。

![Android 电脑操作菜单](../.local/qa/android/ui-parity-2026-11-17/android/41-computer-menu.png)

### Android 添加连接地址

使用同一地址验证协议；Android 通过菜单添加地址类型。

![Android 添加连接地址](../.local/qa/android/ui-parity-2026-11-17/android/44-address-add.png)

### Android 新建事项的待发送图片

沿用现有 76dp 图片块、预览与移除入口。

![Android 新建事项的待发送图片](../.local/qa/android/ui-parity-2026-11-17/android/45b-issue-photos.png)

### Android 重命名事项

复用 Material 文字编辑弹窗；与已分配 Agent 的锁定规则无关。

![Android 重命名事项](../.local/qa/android/ui-parity-2026-11-17/android/56-issue-rename.png)

### Android 定时任务模型选择

历史截图的菜单式模型选择。本次已改为编辑器内独立选择页，仍使用供应商实际目录，尚未重拍。

![Android 定时任务模型选择](../.local/qa/android/ui-parity-2026-11-17/android/70b-task-model.png)

## 验收范围与待确认项

- 本清单保留历史画面用于定位差异；当前源码修正尚未重新截图，不构成当前版本的视觉验收。
- iOS 系统照片选择器在这台 iOS 27 模拟器上停在系统加载页，截图保留了实际状态；这张图只能证明系统页面已打开，不能证明相册选图完成。Android 的照片来源同样保留系统界面。
- 相册、相机、文件提供器、系统语音、键盘和真机边距仍需设备验收；本轮没有向手机安装。
- 嵌入的第三方 DSH 网页使用原页面与已认证的页面会话，不作为另一套 native 页面重绘。
- Android 后台推送、生产签名和真实供应商运行不在本轮界面修正的验收范围。
- 曾出现一次 Compose 列表索引异常；侧边栏改为一次发布会话与工作区，并在测量前固定分组结构。修正后的两条相关流程通过，未做压力测试；记录保留在验证回执中。
- `native/android/wording-pending.json` 与 `wording-sources.json` 中的十条英文仍待所有者逐字审阅；已沿用的中文和现有译文不作重新命名。
