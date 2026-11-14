# 收集器通知

2026-11-14。主人先批准桌面铃铛方案，随后要求“app 通知也接入进来”。

## 已实现

- 桌面与原生 App 共用 `COLLECTORS.md` 的 `notify`，默认关闭。手机的收集器设置条目也用普通铃铛 / 斜线铃铛直接切换；不增加等级、弹窗或表单行。沿用桌面已经使用的“通知” / “Notifications”，不开新一轮文案。
- 只有成功入库的新增或实际更新记录产生一个通知事件。通知标题为收集器名称，正文为最多三条记录的标题与原文，经现有清理和脱敏。历史读取、重复采集和补全上下文不会通知。
- 桌面继续通过 DSH 认证的 HTTP 流接收，使用 DSH 的系统通知身份。
- 手机使用 Apple UserNotifications、APNs Token 注册和原生系统通知，系统来源为已经存在的 Dudu 名称与 App 图标。前台由 `UNUserNotificationCenterDelegate` 选择系统 banner/list/sound；没有重复的本地通知，也不伪装成后台常驻网络连接。
- 第一次明确在手机开启铃铛时请求系统通知权限；如果电脑端已开启，手机连接到已配置推送的电脑时可请求一次。全部关闭且手机从未允许通知时，普通启动不请求权限。拒绝手机权限不修改电脑已有的偏好。
- `notifications.state/register/unregister` 是经过原生配对鉴权的三个固定方法。调用方只能修改自己的配对身份，不能指定另一台设备、发送 URL、APNs topic 或私钥。它们不在内嵌设置页的白名单内。
- 注册保存在电脑端 `push-devices.json`，文件权限 0600，不属于 HTTP 连接或某个会话。锁屏/后台断开 HTTP 不删除 Token。更新同一个 Token 的配对不重复发送；旧发送请求的无效 Token 回执不会删除更新后的注册。
- 桌面撤销配对会立即停止后续推送并取消尚在发送的请求，持久化删除该注册；启动也会丢弃已撤销身份。手机移除可连接的电脑时请求注销；离线时电脑无法获知本地删除，电脑端撤销配对才是离线设备的权威停推操作。
- 点击通知会等待 App 恢复电脑列表，切换到仍已配对的来源电脑，通过插件提供的原有导航打开“信息”。不信任通知里的网络地址，不创建配对，不强行改选会话。
- APNs 仅连接固定 Apple HTTP/2 地址，topic 固定为 `com.harnessmobile.app`，JWT 使用 ES256 并在有效期内复用。超过 APNs 4 KB 限制的 payload 拒绝发送。失败记录固定诊断码，不记录 Token、密钥或内容；不添加持久通知队列、补发或定时重试。`apns-expiration: 0` 不要求 Apple 为离线手机保留旧通知。

## 开通条件

项目与分发包不包含 APNs 私钥。最初读取本机现有 App 的描述文件显示 `S3549488QR.*`，没有 `aps-environment`。主人授权配置并完成 Apple Developer 和 Xcode 登录后，已完成 Apple 侧开通、本机凭据保存与手机原位安装；普通电脑端热更新曾被保护机制拦住，主人随后明确要求“都更新吧”，已授权从独立进程执行强制更新，详见本机开通进度及实际回执。

1. 在 Xcode 登录属于现有签名团队 `S3549488QR` 的开发者账号，为原有 `com.harnessmobile.app` 开通 Push Notifications，并生成对应的显式 App ID 描述文件。不要换 bundle identifier 或团队。
2. 在该 Apple Developer 团队创建适用环境和该 topic 的 APNs `.p8` 密钥。密钥只留在电脑，不放进代码、App、插件分发包或页面。
3. 在该电脑插件私有目录 `$DSH_HOME/dudu/apns.json`（默认 `~/.dsh/dudu/apns.json`）写入：

   ```json
   {
     "teamId": "S3549488QR",
     "keyId": "<Apple 提供的 10 位 Key ID>",
     "privateKeyFile": "/absolute/private/path/AuthKey_<KEY_ID>.p8"
   }
   ```

   配置文件与私钥权限建议为 0600。适用环境由安装包和注册所带的 `environment` 决定；要使用该环境对应的签名密钥。私钥无效只会使 `notifications.state.configured` 为 false，不影响配对、采集和会话。
4. `native/project.yml` 是 entitlement 的配置源。`DUDU_APNS_ENVIRONMENT` 默认 `development`，适合当前 Xcode 本地开发安装；App 的 Info 值与签名 entitlement 共用这个设置。用于生产 APNs 的分发构建必须设置 `DUDU_APNS_ENVIRONMENT=production`，并使用对应的分发签名和 APNs 密钥，不能只在代码里按 Debug/Release 猜环境。
5. 用已有 `npm run desktop:update` 更新插件，`npm run native:install` 原位更新手机，再由用户允许系统通知。本机手机安装已完成；主人现已授权电脑端强制更新，独立执行器只调用既有 `npm run desktop:update -- --force`，状态与官方回执存入本次任务目录。实际通知送达尚未验证。

## 隐私政策文案待审核

现有 `docs/privacy.md` 说内容只在手机与电脑间传输；启用 APNs 后需说明这一新增的数据路径。以下是供主人审核的准确追加文案，尚未替换已展示的政策，也没有增加 App 说明段落：

> **通知。** 开启收集器通知后，你的电脑会将收集器名称和通知正文发送给 Apple，由 Apple 推送到你的 iPhone。推送密钥保存在你的电脑上，设备推送标识保存在配对的电脑上；取消配对会删除对应标识并停止推送。

> **Notifications.** When collector notifications are enabled, your computer sends the collector name and notification text to Apple for delivery to your iPhone. The push signing key stays on your computer, and the device push token is stored on the paired computer. Revoking the pairing removes that token and stops push delivery.

## 本次检查和边界

- `tests/native-notifications.test.ts`：配对身份鉴权、持久化、Token 交接和撤销、过期回执竞争、固定 APNs 目标和 ES256 签名、未配置时明确报告、原生铃铛沿用同一偏好。
- `tests/collector-notifications.test.ts`：保留已有实时通知、清理脱敏、桌面权限与流生命周期检查。
- 运行 lint、typecheck、手机源码编译以及插件打包。没有运行全量测试、e2e、浏览器、DSH 场景或模拟器。
- 初次 `npm run native:build` 在签名阶段被 Xcode 的 `No Accounts` 和现有描述文件缺少 Push Notifications / `aps-environment` 阻断，曾用 `CODE_SIGNING_ALLOWED=NO` 验证源码。主人完成 Xcode 登录后，正常签名构建及 `npm run native:install` 均通过；当前产物已是正常签名的 Build 106。
- 原始旧签名产物备份仍在 `.local/mobile-collector-notifications-2026-11-14/previous-signed-dsbot.app`。当前成品通过 `codesign --verify --strict`，实际签名、嵌入描述文件与 App 注册配置均为 `development`，沿用原团队和 bundle identifier，包含当前 iPhone。
- 尚未验证真实 APNs 送达、系统权限弹窗、通知点击、手机铃铛的渲染和触控尺寸。代码检查与编译不代表这些已通过验收。手机已安装，Desktop 当前运行版本尚未更新。

## Apple 参考

本次读取了 Apple 官方文档的 JSON 原文，存于 `.local/research/ios-notifications-2026-11-14/`：

- `registering-your-app-with-apns`
- `establishing-a-token-based-connection-to-apns`
- `sending-notification-requests-to-apns`
- `asking-permission-to-use-notifications`

文档入口：`https://developer.apple.com/documentation/usernotifications/`。

## 本机开通进度（2026-11-14）

- 主人完成 Apple Developer 网页登录后，确认仍为团队 `S3549488QR`，沿用现有显式 App ID `com.harnessmobile.app`，开启 Push Notifications。
- 创建 `Dudu Notifications Development` APNs 密钥，范围为 Sandbox、Topic Specific，仅包含 `com.harnessmobile.app`。密钥下载到 `~/.dsh/dudu/apns-keys/`，目录权限 0700；私钥与 `~/.dsh/dudu/apns.json` 权限均为 0600。直接调用插件的凭据加载器已成功读取；没有发送测试通知。
- 复用本机已有开发证书，为已登记的当前 iPhone 创建 `Dudu Development Push` 开发描述文件，包含 `S3549488QR.com.harnessmobile.app` 和 `aps-environment=development`。已核对描述文件中的证书 SHA-1 与本机可用签名身份一致，并安装到 Xcode 的描述文件目录，没有替换其他描述文件。描述文件到期日为 2027-11-14；其中开发证书自身到期日仍为 2027-03-06。
- 再运行 `npm run native:build`，自动签名仍因 Xcode 未登录账号失败，继续选用了原先不包含推送权限的通用描述文件。日志为 `.local/mobile-collector-notifications-2026-11-14/native-push-signed-build.log`；没有把该次结果当作可安装包。
- 主人完成 Xcode 登录并要求继续操作后，`npm run native:build` 正常通过，Xcode 自动创建并采用 `iOS Team Provisioning Profile: com.harnessmobile.app`（UUID `1164948a-a18e-4d72-b7b0-425d417c8e34`）。已核对成品的签名 entitlement、嵌入描述文件与 `DuduAPNSEnvironment` 全部为 `development`，保留 `S3549488QR.com.harnessmobile.app`。`codesign --verify --strict` 通过。
- 已用 `npm run native:install` 在 `chuchu的iPhone` 原位安装 Build 106，安装工具返回 `App installed`。没有清除 App 或配对数据，没有启动模拟器或运行界面场景。
- 已运行 `npm run desktop:update`，完成打包后被脚本的 DSH 内部任务保护拒绝，未安装或热重载插件。按 `AGENTS.md`，需主人明确要求现在强制更新，随后从当前任务分离执行 `-- --force`；此操作会结束当前任务及其他运行中的 Agent。更新回执目录为 `.local/desktop-updates/run-sC0u2W/`。
- 主人随后明确要求“都更新吧”。再次通过 `devicectl device info apps` 确认手机为 Dudu `0.1.0` / Build `106`。电脑端强制更新使用独立执行器，执行既有 `npm run desktop:update -- --force`；执行结果以 `.local/mobile-collector-notifications-2026-11-14/desktop-force-update-result.json` 及其中记录的官方 `result.json` 为准，没有把已启动视为已成功。
- 系统授权、真实 APNs 送达及通知点击仍未验证。隐私政策追加文案仍待主人审核。
- 最新回执：`.local/mobile-collector-notifications-2026-11-14/native-push-account-build.log`、`signed-push-build-summary.json`、`native-push-install.log` 和 `desktop-push-update.log`。
