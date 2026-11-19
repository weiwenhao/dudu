# iPhone 中英文支持

2026-11-14。本轮接入简体中文和英语，沿用现有界面，没有增加语言选择器或修改布局。原生资源有 606 个界面键和 6 条系统权限说明；手机接口与内嵌页面有 158 个键。共用文案去重后为 726 个界面键。新增英文和系统权限提示的逐句清单见 [native-localization-wording.md](native-localization-wording.md)，发布前仍需主人审阅。

## 原生界面

`native/ios/Dudu/Resources/Localizable.xcstrings` 存放原生固定文案；`InfoPlist.xcstrings` 存放相机、本地网络、麦克风、语音识别和照片权限提示。`project.yml` 和 `Info.plist` 声明支持的语言，保留原来的 bundle identifier、签名团队及开发版本号。

`Core/Localization.swift` 从 `Bundle.main.preferredLocalizations` 解析 iOS 为 Dudu 选择的语言。因此可跟随系统，也可以使用 iOS 为单个 App 设置的语言；没有另存一份与系统冲突的语言偏好。语言在本次进程内保持稳定，切换由系统重启 App 生效。

- `L10n.text` 读取明确选择的语言资源包。参数在模板上只替换一次，用户内容里的 `{0}`、`$&` 等字符不会再被解释。
- `L10n.plural` 保留整数参数，使用 String Catalog 的英文 `one` / `other`。资源包选择和日期、数量格式的 locale 分开处理，避免把格式 locale 当成语言包选择。
- 展示日期、星期、时间和列表使用当前界面语言；定时任务的机器日期仍使用原来的 `yyyy-MM-dd`，任务时区也保持原值。
- 内置权限标签和用量窗口在展示时本地化。自定义名称保持原文；从磁盘恢复的权限标签重新按当前界面语言呈现。
- 设置左滑操作的图标按操作 ID 和参数选择，不再按中文或翻译后的标题决定。
- 语音识别语言保持原配置，不因界面切到英文而自动改变。

会话内容、用户输入、事项与项目名称、自定义状态名称、规则正文、记忆正文、技能正文和 Agent 输出均不翻译。缓存中的对话也不做改写或清理。

## 手机接口

原生 HTTP 请求发送 `Accept-Language`。`host/native-locale.mjs` 仅接受中英文，限制头部长度和候选项，按有效的 `q` 值选择语言。旧手机没有发送语言时仍使用中文。

`AsyncLocalStorage` 保存每一次请求的语言，不在共享连接或 Desktop 的全局语言变量上来回切换。`nativeText` 只接收代码明确标识的固定 UI 文案，不递归翻译响应对象。模块级标签表在读取时解析语言，避免插件启动时就固定成某一种语言。服务端译文在 `host/native-strings.mjs`。

原有 API 请求体、动作标识、鉴权、审批和资源访问策略不变；未增加通用 RPC 转发或新的传输方式。用户保存的名称、Prompt 和其他数据仍按原值写入。

导航快照可以附带有界的 `titles.zh` / `titles.en`。Desktop 的上报器只读取 DSH 已注册词典里能明确对应的标题，不切换 Desktop 语言。插件在 `navigation.get` 时生成当前手机的展示标题，保存的原始快照不变。第三方插件没有译文、旧版 DSH 没有可读词典或标题无法明确对应时，保留原来的插件标题。

## 内嵌页面

`/web/open` 从通过配对验证的请求中取得语言，并把它冻结在独立页面连接上。后续页面 RPC、允许的 Dudu 设置动作和已认证页面的错误提示使用该页面的语言，后续请求头不能改变页面语言。页面 Cookie、来源校验、资源清单和动作 allowlist 保持原规则。

DSH 页面仍加载电脑上已安装的 DSH 前端。启动队列在 `dsh-client-locale` 初始化时：

1. 使用 DSH 现有的原生 `__DSH_LOCALE__` 启动接口提供本页语言。
2. 仅为语言模块屏蔽 `configForms.get('locale')` 的 Desktop 配置宿主；其他模块和配置 namespace 正常使用原来的服务。
3. 继续使用 DSH 自己的 `LocaleRuntime`、词典和控件。页面内语言变化只保留在此页面，不写 Desktop 的语言偏好。

以上接口已与这台电脑安装版的语言模块源码做离线验证。旧手机的 Dudu 设置网页也接收明确的页面语言，不再只取 `navigator.language`。

## 本轮检查与边界

检查记录保留在 `.local/qa/bilingual-2026-11-14/`。19 个与语言协商、数据保留、请求隔离、导航和页面加载协议直接相关的单元用例通过；页面错误语言修正后，另外复查了其中两个鉴权用例。没有运行全量测试。

- 原生 Release 构建；原生测试目标使用 `build-for-testing` 编译，不安装、不在设备运行。
- lint、TypeScript 检查、桌面页面构建和插件打包；打包脚本在独立临时目录校验插件入口可导入。
- 中英文并发请求、同一配对连接的独立页面、参数原文和自定义状态保留，以及页面语言不触及 Desktop 偏好。
- 对安装版 DSH `LocaleRuntime` 的离线初始化与切换检查，无真实 DSH 进程或浏览器。
- 用编译后的 String Catalog 检查语言资源选择和整数单复数参数；用独立 Swift 进程检查模板替换保留用户原文。
- 静态核对全部 606 个原生界面键的中英文资源及参数占位符；没有缺失译文或占位符不一致。

以上为授权前的实现检查，当时没有安装到手机、更新 Desktop、启动模拟器、打开浏览器或运行真实 DSH 场景。后续经主人授权完成的模拟器检查见下一节。编译和接口测试不能代替目视验收。

## 模拟器验收（2026-11-14）

主人本轮明确要求“那你虚拟机验收一下”。在现有 `dudu-iPhone-Air-iOS27` 模拟器（iOS 27.0，420pt 宽）构建并安装 Debug App，通过 `-AppleLanguages` / `-AppleLocale` 分别启动英文和简体中文进程。使用现有 `-dudu-ui-review`，电脑、会话和事项均为内存样例，不连接主人的 DSH，不生成配对码，不调用模型。

实际打开并查看了以下界面：

| 界面 | 检查内容 | 结果 |
| --- | --- | --- |
| 连接引导，中英文 | 标题、说明和两个配对入口 | 英文标题自然换行，按钮和说明没有观察到截断或重叠 |
| 看板和侧栏，中英文 | 分组、折叠数量、相对时间、范围选择、导航标题 | 固定标签跟随语言；事项、会话、电脑和工作区名称保留原文 |
| 新建事项，中英文 | 输入框与键盘、状态、优先级、项目搜索、智能体选择与返回 | 选择和返回正常；英文属性按原布局换行，未挤出操作入口 |
| 会话和嘟嘟 | 普通会话、嘟嘟的标题与快捷入口、附件及模型菜单 | 英文显示 `Dudu` / `Message`，中文显示“嘟嘟”/“发消息”；消息正文保持原文 |
| 设置 | 中英文首页和通用页、英文状态配置 | 标签、分组、日期与数量显示正常；较长的英文行未观察到重叠 |
| 内置权限，中英文 | 选项、选中后的摘要、完整权限确认弹窗 | 当前 DSH 的三个内置 ID 显示对应译名；长英文确认正文完整，取消及点击遮罩关闭正常 |
| DSH 内嵌页面 | 中英文插件页、上下文页 | 在实际 WKWebView 中完成启动并显示本页语言，没有白屏或脚本异常 |

最初附件菜单中的中文权限名来自历史样例的 `ask` 标识，它不在当前 DSH 的内置权限中。随后从本地 DSH 页面快照读取 `permissionPresets/catalog` 的真实 ID（`read-only`、`workspace-write`、`danger-full-access`），分别核对两个语言的选项及选中后的摘要。自定义名称继续保留原文，没有为样例名称扩大翻译规则。

原生设置描述由当前 `createNativeSettings` 在对应 `withNativeLocale` 中生成；导航同样经过当前 `createNavigationStore`。内嵌页面用当前前端适配器重新生成带明确语言的文档，前端与模块资源取本地保存的真实 DSH 快照，在模拟器的现有离线私有 scheme 中加载。这验证了 WKWebView 渲染及语言初始化，不能视为真实配对、HTTP Cookie、电脑请求延迟、保存操作或全部第三方页面的端到端验收。快照缺少的 `dynamicCordisRunner/syncInspectManifest`、`session/create` 等 RPC 保留为离线检查限制。

模拟器构建、`npm run lint` 和 `npm run typecheck` 通过。临时 Maestro 流程只用于本次授权的导航、选择、返回、关闭与截图，未增加仓库 UI 测试，未运行全量测试。检查开始和结束对源文件做了 SHA256 对比；本次未发现需要修改产品代码的语言或排版问题，只更新本节验收记录。截图、临时流程、日志与结果清单在 `.local/qa/localization-simulator-2026-11-14/`。

仍未覆盖物理 iPhone、iOS 18–26 的实际显示、超大辅助字体、相机/麦克风等系统权限授权页，以及真实电脑与网络路径。没有安装到手机、更新或重启 Desktop。英文逐句用词仍待主人审阅，模拟器验收不代替文案批准。

实现参考 Apple 的 String Catalog 和 Bundle 本地化接口：

- [Localizing and varying text with a String Catalog](https://developer.apple.com/documentation/xcode/localizing-and-varying-text-with-a-string-catalog)
- [Bundle.preferredLocalizations](https://developer.apple.com/documentation/foundation/bundle/preferredlocalizations)
