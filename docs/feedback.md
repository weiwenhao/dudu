# 反馈（手机 App，2026-11-27）

主人的话：「增加一个反馈功能，可以把最近的日志，用户机型，和用户反馈内容一起发过来」；先画成一个页面，他改了：「反馈放在设置页不是放在这里，隐私条款下面放一个反馈弹窗呀」「只需要让用户填一个回信邮箱，其他的都不需要。你不需要显示出来我的邮箱，这都是我的隐私信息」。

## 界面

设置最后一张卡里，「隐私政策」下面一行「反馈」（App 已有的消息图标），点开是一个弹窗，画法同「新建事项」（左上圆形 ✕、右上圆形 ✓，读屏名「发送」，同样的输入框卡片）：

- 一个多行输入框，占位字「请描述遇到的问题」；一个单行邮箱输入框，占位字「回信邮箱」（邮箱键盘，不自动大写、不自动更正）。
- 界面上没有别的：不显示收件人、日志、机型，也没有说明文字；主人的邮箱不在界面、不在代码、不在日志里。
- 文字非空、邮箱合法（有 @，@ 后有点，无空格）之前 ✓ 是灰的；发送中 ✓ 换成转圈，输入框不可编辑，弹窗不能下滑关闭；成功后弹窗关闭，设置页出一条「已发送」；失败时屏幕最上面出一条提示条「发送失败」（主人 2026-11-27 选了「位置一」：屏幕最上面、弹窗上方；他看了连接失败那张后又说「太低了，可以高一点么」，现在在状态栏下面 6pt；约 1 秒就消失，没有右边的 ✕，输入框下面不放红字），已填的内容保留，再按 ✓ 就是重试。弹窗盖着时，页面自己的提示条会被弹窗的暗色盖住，所以这一条放在一个单独的窗口里（`TopToast`），不挡任何触摸。
- 手机（`FeedbackSheet`）和安卓（`ui/Feedback.kt`）同一个设计。桌面没有（没要求）。

新字（主人只审中文）：反馈 / Feedback，请描述遇到的问题 / Describe the problem，回信邮箱 / Reply email，发送失败 / Send failed，已发送 / Sent。

## 发出去什么、发到哪里

不用手机上的邮箱账号，也不把主人的邮箱放进 App：App 直接向表单服务 Web3Forms 发一个 JSON 请求，服务把每个字段转发到主人的邮箱（`POST https://api.web3forms.com/submit`，成功是 HTTP 200 且 `success: true`，别的都算失败，20 秒超时）。字段：`access_key`、`subject`（「Dudu 反馈 · iOS 0.3.0 (170)」）、`from_name`、`email`（回信邮箱，服务把它当回复地址）、`message`（用户写的字）、`app`、`device`（「iPhone18,1 · iOS 26.3」；安卓是厂商、型号、系统版本）、`language`、`logs`（最近的诊断日志：最新的、不超过 150 KB，整行截断，从旧到新，被截掉时第一行是 `(earlier lines left out)`）。

日志只有事件名、耗时、数量、状态码，没有地址、令牌和用户输入的文字（2026-11-27 扫过一份真实发出的 983 行：没有网址、IP、邮箱、令牌字样，也没有刚输入的文字）。

**access key 现在是空的**（手机 `Core/Feedback.swift` 的 `FeedbackChannel.accessKey`，安卓 `data/FeedbackChannel.kt` 的 `ACCESS_KEY`），要主人到 web3forms.com 用自己的邮箱申请，它会把 key 发到他的邮箱。没有 key 时不会发出任何请求，点发送就是「发送失败」。这个服务的 key 本来就是公开的（只能往这一个邮箱发信），但仓库是公开的，别人能拿去往他的邮箱发垃圾；免费版每月约 250 封、不支持附件（所以日志放在正文里）、没有域名限制（付费版才有）。以后换服务只改这一个文件里的地址、key 和字段。

## 隐私政策文案待审核

现有 `docs/privacy.md` 写着「不收集你的数据……界面诊断日志……都只保存在手机上，不会上传」，有了反馈就不准确了。以下是供主人审核的准确文案，尚未改 `privacy.md`；App Store 的隐私问卷也要相应加上「电子邮件地址」和「诊断数据」（用户主动发送、用于客服）。

> **反馈。** 只有你在「设置 › 反馈」里点发送时，App 才会把你写的内容、你填的回信邮箱、App 版本、手机型号和系统版本、语言，以及最近的界面诊断日志（记录点击耗时、请求耗时、错误等，不记录你输入的文字），通过表单服务 Web3Forms 转发到开发者的邮箱，只用于回复你和排查问题。不点发送，不会上传任何东西。

> **Feedback.** Only when you tap Send in Settings › Feedback does the app send what you wrote, the reply email you entered, the app version, the phone model and system version, the language, and the recent interface diagnostics log (tap and request timings, errors; not the text you type) to the developer's mailbox through the form service Web3Forms, used only to reply to you and to investigate problems. If you do not tap Send, nothing is uploaded.

另外两句要跟着改：第一段「不收集你的数据」→「除你主动发送的反馈外，不收集你的数据」；「手机上保存什么」里「不会上传」→「除非你在反馈里点发送，否则不会上传」（英文同）。

## 检查和边界

- 手机：4 条单元检查（邮箱合法性、日志按整行截断和顺序、请求的字段和成功判断、没有 key 不发）；模拟器里手指实测（弹窗、校验、发送到本机的假服务、失败保留文字并可重试），录屏看到「转圈 → 弹窗关闭 → 已发送」。安卓：见 `native/android/AGENTS.md`。
- 没有验证：真实发送到 Web3Forms（没有 key）、邮件到达、VoiceOver、英文排版、安卓真机。
