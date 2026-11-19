# 手机嵌入页面加载性能调研

日期：2026-11-13。

范围：JS/HTML 启动、DSH 前端组合、WKWebView 生命周期、资源缓存和页面切换。
最初调研阶段没有修改 App 或插件实现，也没有构建、安装或运行页面场景。
主人随后要求提前加载页面，后续实现和检查记录见“预加载接入”。

## 建议

采用两个互补的改造：**在可复用的权限范围内保留 DSH 前端运行实例，通过内部路由切换页面；让同版本的静态资源可以经过鉴权后复用。**

缓存资源可以减少重复传输，保留运行实例可以减少重复解析、执行和初始化。只做其中一个，都没有覆盖当前完整的重复启动路径。

这不是立即把所有页面塞进同一个 WebView。设置、插件管理、会话洞察和第三方面板有不同权限；先复用相同权限与数据范围内的页面，再决定是否值得增加跨范围的路由协议。普通对话、导航和原生设置继续使用 SwiftUI。

## 已确认的证据

### 真机日志

来源：`.local/qa/webview-open-delay-2026-11-13/device-logs/timeline.jsonl`；
阶段摘录：同目录的 `opening-stages.json`。
本地时间为 2026-11-13，设备日志显示 App 0.1.0、build 103。

| 阶段 | 13:32:52 的 panel 页面 | 13:33:18 的插件页面 |
| --- | ---: | ---: |
| 原生获取页面身份、准备文档 `web.page.handle` | 128.83 ms | 243.56 ms |
| 导航开始至 `web.navigation.finish` | 17,623.22 ms | 19,352.92 ms |
| 导航完成至页面报告可用 | 805.77 ms | 5,335.30 ms |
| 点击打开流程开始至 `web.page.ready` | **18,669.60 ms** | **24,991.74 ms** |

页面身份准备只占很小一部分。主要等待发生在网页加载、启动及目标页面就绪阶段。
这个时间段没有记录到原生主线程停顿；这不能排除独立 WebContent 进程中的 JS 执行阻塞。

`didFinish` 的时间不能进一步区分资源排队、传输、重试、脚本解析与执行。
因此不能把 17–19 秒全部算成下载耗时，也还不能断定某个脚本占了多数时间。
日志没有记录 panel 的 target，不能据此确定它具体是哪一个插件。

### 当前实现

| 位置 | 实际行为 | 影响 |
| --- | --- | --- |
| `native/ios/Dudu/Views/EmbeddedPageView.swift` | 每个新 WebView 创建独立的 `.nonPersistent()` 数据存储；文档请求使用 `.reloadIgnoringLocalCacheData` | WebView 之间没有主动共用数据存储；文档请求绕过本地缓存 |
| `native/ios/Dudu/Core/EmbeddedPagePool.swift` | 按 page、target、sessionID 保留实例；最多保留 3 个已离开的页面，5 分钟后释放 | 能帮助短时间返回同一个页面，不能复用另一个页面的 DSH 运行实例 |
| `host/web-page-http.mjs` | HTML、JS、CSS 等资源统一 `Cache-Control: no-store` | 即使换成持久数据存储，这些响应仍不允许缓存 |
| `host/dsh-mobile-frontend.mjs` | 资源、模块图中的 URL 改写到每次生成的 `/ui/<page UUID>/` | 相同资源的完整 URL 每次不同；部分 JS 改写后的字节也不同 |
| `host/mobile-page-adapter.mjs` | DSH 启动后，才通过 layout、uiWorkspace 等服务定位目标页面 | 在当前路线中，打开一个功能也要先经过 DSH 前端启动 |
| `native/ios/Dudu/Resources/EmbeddedTransport.js` | 启动时固定 page、httpPageBase 等信息 | 不能仅靠复用 WKWebView 或改 SwiftUI 的 `.id` 实现跨页面导航 |

HTTP 资源已经支持 gzip；宿主也已有静态资源内存缓存。它们不等同于 WebKit 的资源缓存，更不等同于保留已启动的 JS。
`EmbeddedResourceCache` 服务于旧的模拟器私有协议路径，不能解决真机 HTTP 页面的缓存。

## DSH 的 JS/HTML 启动方式

本轮只读检查了已安装的 DSH **0.2.2-rc.2** 的 `app.asar`，未启动或修改它。
所需源码摘录保存在上述 QA 目录的 `research/` 中。

1. 手机使用已安装 DSH 的实际 HTML 入口和 client module graph，并移除了开发 HMR 入口。
2. HTML 注入模块队列、application combo 的 preload、bootstrap 脚本、模块图和手机适配器，再进入 DSH 前端入口。
3. application combo 主要注册插件 factory，模块主体在 materialization 时才执行；不是所有模块主体一开始就执行。
4. 当前 Web 入口为 manifest 中的插件建立 Loader entries，并等待初始化、检查和渲染；不是某一个功能专用的小入口。
5. DSH 已支持模块依赖、动态 chunk 和同 URL 请求合并。现有 combo 主要按 URL 长度分组，没有按手机当前功能裁剪启动图。
6. 在已检查的入口与模块契约中，没有找到可直接传入“只启动上下文页面”的现成选项。不能把私自删除 graph rows 当成已有的安全裁剪接口。

DSH 的 release 标识含版本与构建 commit；bootstrap 更换需要重新加载。
这也是不能把一份固定 DSH JS 打进 iPhone 安装包、长期拿它适配电脑上任意 DSH 版本的原因。

## 方案比较

| 方案 | 可以改善 | 本项目的限制 | 判断 |
| --- | --- | --- | --- |
| 扩大现有页面池、延长保留时间 | 返回同一个页面 | 不减少新页面的启动；保留多套 DSH 会增加内存和活动流 | 可作局部调整，不是主要方案 |
| 只换持久化 WKWebsiteDataStore | 保存允许缓存的网站数据 | `no-store` 和随机资源 URL 仍在；JS 仍需初始化 | 单独做不够 |
| 稳定的版本资源地址、鉴权校验与私有缓存 | 重用 JS/CSS 响应体 | 仍有初始化成本；需要调整资源地址和认证范围 | 必要组成 |
| 保留 DSH 运行实例、JS 内部导航 | 避免重复下载和初始化公共部分 | 要明确权限范围、切换清理、更新和内存释放 | 主要方向 |
| 给所有入口预启动完整页面 | 把某些等待提前 | 会同时运行多套前端，争用首屏资源与内存 | 不建议作为主要方案 |
| Service Worker | 安全来源上的资源复用 | App 支持普通局域网 HTTP；SW 需要 secure context，也不能免掉每个新文档的 JS 初始化 | 不作为通用基础 |
| 自定义 URL scheme 或 file 页面 | App 自己控制资源加载 | 改变当前真实 HTTP/HTTPS 页面契约，增加模块、资源与认证适配成本 | 本轮不推荐 |
| 全部改成原生页面 | 减少 Web 启动 | 需要持续重写 DSH 与第三方插件，不适合复杂插件界面复用 | 不适合作为整体替换 |

Apple 的 `WKURLSchemeHandler` 用于 WebKit 不处理的自定义 scheme，不是接管普通 HTTP/HTTPS 子资源的开关。
给原生 URLSession 增加缓存，也不能据此认定 WKWebView 的 HTTP 请求已经缓存。

## 推荐的改造细节

### 1. 先建立可比较的加载分段

在 document start 收集有界的 Resource Timing 和启动 marks，分别记录：

- 页面句柄、HTML 首字节、DOM 就绪和导航完成。
- 静态资源数量、响应体大小、耗时、失败与重试。
- 模块注册、Loader 初始化、DSH renderer、目标路由及数据就绪。

记录逻辑资源类别、hash、耗时与计数，不保存 cookie、配对凭据、会话正文或完整敏感 URL。
Resource Timing 的 `transferSize` 等字段须检查真机支持情况；单个零值不能单独作为缓存命中的证明。
脚本解析和执行耗时还需要 WebKit Timelines 的 JS 调用树，不能仅用 `responseEnd` 推算。

这些数据决定第一轮主要收益来自减少重复传输，还是减少 JS 初始化；不需要为调研预先改网络基础设施。

### 2. 静态资源与页面操作分开管理

保留 `/ui/` 下的 HTTP/HTTPS 和 page-session 认证。以下是待实现的协议设计，不是当前已有能力：

- **页面文档、RPC、长轮询与动态数据**仍绑定实际页面范围并使用 `no-store`。
- **纯 JS/CSS/字体/图片资源**由单独的、仅可读取冻结资源清单的页面会话授权；它没有 RPC、流、目录读取或通用转发能力。
- 这个资源范围可被同电脑、同设备的页面共用，使用稳定的 namespace；新建逻辑页面不再改写公共资源的地址。
- 资源路径以实际构建或内容版本区分。版本键覆盖 DSH release、具体模块 revision 和手机适配器内容；不能只依赖 App 版本号或 DSH 版本字符串。
- 资源授权 cookie 仍由原生通过既有配对认证取得，HttpOnly、路径受限，不把配对凭据交给 JS。namespace 本身不是凭据。
- 开始阶段使用 `Cache-Control: private, no-cache` 和准确的 ETag。每次使用先校验仍有效的资源会话，再返回 304 或新响应体。不要直接开启脱离校验的长期 immutable 缓存。

这种设计允许复用已下载响应体，同时保留服务器在资源重新校验时检查撤销和清单权限的机会。
它仍然有校验请求成本；大量无传输的请求也可能排队，后续要以实测确定是否需要更好的批次划分。

若要跨 App 重启保存资源，采用按已配对电脑分开的 `WKWebsiteDataStore(forIdentifier:)`，而不是每个页面新建存储。
网站数据存储也包含 cookie、localStorage 等，启用前要核查 DSH 的持久数据用途，并在删除电脑时清理对应存储；不要把“缓存代码”写成“持久保存所有页面状态”。

现有页面 UUID、cookie 路径和资源字节改写都需要配套调整。这是完整的资源认证与寻址改造，不能只改一个响应头。

### 3. 在允许的范围内保留 DSH 运行实例

由 App 的根级对象拥有运行实例，SwiftUI 页面只决定显示与目的地。
增加 JS 的异步导航入口，使用已经存在的 DSH `layout.selectPanel`、`uiWorkspace.openSession` 等服务；原生可以通过 `callAsyncJavaScript` 传结构化参数并等待完成。

先复用**相同 kind、相同权限和会话数据范围**内的路线。例如只读面板间切换 target，不应再为 target 创建一整套前端。
设置、插件管理与会话洞察继续隔离；设置内部类别可直接复用已有实例。跨会话的数据隔离没有证明以前，不合并不同会话的运行实例。

如果进一步实现跨范围复用，必须同时重构 transport 与 adapter：

1. 导航携带独立的 generation；每个请求与回调固定到发起它的范围，不能在完成时再读取一个全局“当前页面”。
2. 页面切换关闭旧流，清理旧页面的数据订阅、弹窗和状态；迟到响应不能覆盖新页面。
3. 操作权限仍由当前逻辑页面的独立句柄确定。旧句柄关闭；用于加载代码的资源会话不能执行旧页面 RPC。
4. 无法可靠拆卸的第三方插件或无法清理的 DSH 全局状态继续使用独立实例，不能以扩大权限范围换复用。

运行实例按电脑、DSH release/bootstrap 身份与权限范围管理，有数量与内存上限。
隐藏时暂停页面自己的观察和刷新；不能无限保留所有会话，也不能让每个暖页面持续长轮询。
电脑变更、撤销、版本不兼容和 WebContent 进程终止时丢弃实例，重新走当前版本的认证启动。
资源缓存按各资源 revision 更新；不能把一次普通模块变化直接等同于必须重启整个 App。

### 4. 将前端可见与业务数据就绪分开

当前原生白色加载层等到 adapter 的 `ready()` 才撤掉；插件页的测量中，导航完成后还有约 5.34 秒等待。
建议区分 DSH 容器可显示、目标路由可显示和业务数据就绪。

有实际目标页面及其现有加载状态时，使用 DSH 原来的加载、空态或错误界面，避免额外盖一层原生全屏等待。
不能只在 `didFinish` 或固定延时后隐藏加载层，也不能显示尚未定位到目标的桌面首页。

adapter 的通用 panel 就绪条件目前包含 500 ms 的 DOM 静止等待。已知页面优先改用对应服务或目标区域的就绪信号；第三方页面保留有界兜底。
这一步需要按既有 DSH 样式验收，不增加未经审核的提示文案。

### 5. 最后处理冷启动的 JS 体积与执行量

资源缓存不免除第一次获取；保留实例也不能保证进程被系统回收后的首次打开立即可用。
根据分段记录，决定是否值得把仅目标功能需要的依赖作为一组启动，其余功能在使用时加载。

裁剪必须基于 DSH 支持的组合接口或完整依赖分析，并保留 slot 注册、provider、样式与动态 chunk。
在当前入口没有现成选项的情况下，把这件事作为后续 DSH 前端集成工作，不能随意过滤模块名称。
也不应给现有 bootstrap 脚本全部加 `async`：队列、bootstrap 和入口有明确顺序。

## 实施顺序与验收

建议顺序：**加载分段 → 稳定且鉴权的静态资源缓存 → 同范围运行实例与内部导航 → 就绪信号 → 有数据依据的冷启动裁剪**。
缓存与运行实例复用共同构成最终方案；顺序上先做边界明确、可独立判断效果的部分。

需要分别比较：

| 场景 | 要证明的变化 |
| --- | --- |
| 清空资源后的第一次打开 | 明确传输、JS 启动和业务数据各占多少时间 |
| 立即返回同一个页面 | 使用同一运行实例，保留合理的页面位置与状态 |
| 同权限面板切换 | 没有新的完整 HTML 导航或第二次 DSH 启动 |
| 跨权限或跨会话切换 | 权限、旧流、数据和迟到响应不串页；静态资源可复用 |
| App 重启后打开 | 可复用的资源经过认证校验，不重复传送相同响应体 |
| DSH 或插件更新 | 新 revision 生效，bootstrap 不混用不同 release |
| 进程回收、撤销、换电脑 | 可靠关闭与重建，没有旧电脑数据或授权残留 |

同一运行实例的再次显示可把“数百毫秒内显示”作为开发目标；新路由还需要其真实数据请求的时间。
首次打开和跨 App 重启的具体时间现在没有足够数据承诺。
验收必须同时看时间、传输量、DSH 启动次数及内存，不能把提前预加载或单纯提前隐藏 spinner 算成启动成本消失。

本轮没有运行任何测试。实施后先做缓存版本键、资源清单授权及路由取消的针对性单元测试；
真机 WKWebView 的加载分段和页面交互检查需要主人另行要求。浏览器通过不能替代真机 WebKit 缓存与生命周期检查。

## 预加载接入（2026-11-13）

主人追加要求：“能不能预加载？不要我打开页面的时候才开始加载”。
现已先接入现有认证页面池的有界预加载；上文的稳定资源地址、跨页面共享运行实例等架构改造尚未实现。

- App 前台连接成功、原生恢复和首批会话及模型读取结束后，从实际导航目录挑选至多 3 个网页入口。优先插件管理和当前会话已注册的 context 页面，其余名额按目录顺序选侧边栏网页面板。没有目录时不猜测 DSH 路由，不加载其他会话，也不预开原生设置首页后的 DSH 设置。
- 串行启动实际 WKWebView，经过认证、HTML、模块与目标页面就绪，才准备下一页；不仅获取 `/web/open` 句柄。页面池及屏幕共用 `EmbeddedPageRoute` 和 location，点击同一页时复用正在进行或已完成的加载。
- 用 WebKit 公开的 inactiveSchedulingPolicy 保证离开窗口的页面仍可完成启动；准备好后使用 throttle。隐藏页面保留 DSH 原有事件流，未新增定时刷新页面、保活请求或模型调用。App 后台、断开、换电脑和内存警告会取消队列并释放未显示页面。
- 选中的有限页面在前台保留；其他已访问页面继续使用原来的 5 分钟保留期。当前屏幕接管后，取消预加载不能中断其页面身份请求或关闭该页。当前会话变化会清理尚未使用的旧会话预加载。
- 没有新增 App 文案或可见控件。失败不自动重复加载；用户实际打开时仍可走已有重试。

验证：`EmbeddedPagePoolTests` 的 3 项针对性测试在本地 Swift 包中通过，
使用实际 Navigation、Route、Pool 源码，HTTP 与 UI 边界用替身，不启动 App、DSH 或 WebView。
lint、TypeScript typecheck 和签名 iOS Release 编译通过。
最终构建及检查日志保存在 `.local/qa/webview-open-delay-2026-11-13/preload-*`。
没有运行全量测试、端到端、浏览器或模拟器页面场景。
随后按主人要求，使用 `npm run native:install -- --device …` 原位安装到实体 iPhone；
命令成功，设备应用元数据独立确认 **Dudu 0.1.0（103）**。
安装日志与回执在同目录的 `preload-install.log` 和 `preload-installed-app.json`。
实际离窗启动、点击接管、系统内存消耗及提速幅度仍需授权后的真机检查，不能由编译或纯逻辑测试推断。

## 官方资料

- [Apple：WKWebsiteDataStore.init(forIdentifier:)](https://developer.apple.com/documentation/webkit/wkwebsitedatastore/init(foridentifier:))：按 identifier 取得持久化数据存储，iOS 17 起可用；项目最低 iOS 18 可使用。
- [Apple：callAsyncJavaScript](https://developer.apple.com/documentation/webkit/wkwebview/callasyncjavascript(_:arguments:in:in:completionhandler:))：传入命名参数并等待异步 JS 执行结果。
- [Apple：WKURLSchemeHandler](https://developer.apple.com/documentation/webkit/wkurlschemehandler)：为 WebKit 不处理的 URL scheme 提供资源。
- [Apple：inactiveSchedulingPolicy](https://developer.apple.com/documentation/webkit/wkpreferences/inactiveschedulingpolicy-swift.property)：控制不在窗口中的 WebView 调度；none 正常运行、throttle 限制处理，默认 suspend。
- [RFC 9111：HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111.html)：第 2 节的缓存键，第 5.2.2 节的 no-store、no-cache 和 private。
- [W3C：Resource Timing](https://www.w3.org/TR/resource-timing/)：资源阶段时间及传输、编码与解码大小；实际字段以当前 WebKit 支持为准。
- [WebKit：Timelines Tab](https://webkit.org/web-inspector/timelines-tab/)：JS 执行调用树、资源、布局与绘制分析。
- [W3C：Service Workers](https://w3c.github.io/ServiceWorker/) 与 [Secure Contexts](https://www.w3.org/TR/secure-contexts/)：Service Worker 的安全上下文条件，普通局域网 HTTP 不等同于 localhost。
