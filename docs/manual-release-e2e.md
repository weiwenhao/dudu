# 发布前手动 E2E

每次发布前，在同一个候选提交上验收 DSH Web 和 iOS 模拟器。先核对插件包及 App 版本、build 和来源提交，再走基础流程及本版改动对应的回归。若修复改变了被验收的代码，用新的候选构建重走受影响的用例。发版前记录失败和阻塞项，由发布负责人处理。

## DSH Web

1. 用 `npm run package:desktop` 生成候选包。用 Desktop 自带的 `dsh` CLI 和独立的 `DSH_HOME`、`HOME` 跑 `dsh web`。可复用 `tests/e2e/harness.mjs` 的 `startDudu({ launchBrowser: false })` 搭建隔离服务，用 `DUDU_E2E_TGZ` 指向候选包。用 `desktopPackageIdentity` 核对运行环境安装的包和候选包目录。
2. 用 `ego-browser skill` 查看本机用法。在 ego 的任务页打开隔离 Web，按页面的可访问名称点击操作。用 `authorizeBrowserOrigin` 换取隔离站点的 cookie，可通过一次性的回环入口交给 ego。DSH 原始登录 URL 留在进程内存中。验收后关闭任务页并停止隔离服务。
3. 从嘟嘟看板进入搜索，输入已知关键词，切到会话和筛选项目，打开有会话的结果，再取消搜索回到看板。确认结果、右侧会话及导航都对。搜索改动涉及截断时，放入 101 条命中，让只有最旧一条属于另一个项目。确认无筛选只返回首批 100 条，项目选项仍出现，筛选后只剩第 101 条。
4. 打开测试会话，发送一条可辨认的消息，确认回应和会话记录。让一轮保持运行，排队一条新消息，再让这一轮正常完成。核对排队项消失，后一条在同一会话被接收一次。
5. 单独检查停止。若修复涉及 Antigravity 恢复阶段，用已登录的测试环境，或用 ACP 测试进程挂起一次 `session/resume`。排队后点停止，核对界面显示「已停止」、挂起的进程退出、被取消的输入未到达 `session/prompt`。DSH `0.2.2-rc.5` 在此时保留已排队输入。再发送一条新消息启动下一轮，核对保留的输入在同一原生会话被接收一次。

## iOS 模拟器

1. 构建当前提交的 Debug 模拟器 App，通过 `xcrun simctl install` 安装到测试模拟器。用 `simctl launch` 启动 App，用 Maestro 流程或临时的 XCUITest 按可访问标识驱动。用程序采集截图或日志作为证据。基础流程每版都跑，本版相关分支在同一个构建上追加。
2. 从 `board.search` 进入 `search.query`，输入测试词，选择 `search.range.sessions`，用 `search.filter.project` 筛到目标项目。打开命中行，用 `page.back` 返回，确认关键词及筛选结果保留。点 `search.cancel` 回到看板。
3. 用可控故障触发断线。短暂失败期间看板可继续阅读，持续失败会显示 `board.connection.pending`。恢复同一电脑后确认提示消失、看板或会话继续加载。在离线 DEBUG fixture 上，`-dudu-review-drop-session` 可在打开 `review-second` 后触发并保持断线。恢复用例优先用已经配对的测试环境。配对码由机主在 DSH 生成。
4. 打开包含已知图片的会话，在不发送新消息的情况下观察图片完成加载，并确认能打开预览。若变更涉及电脑连接，额外用已经配对的测试环境核对可达性。缺少配对环境时记录模拟了什么和需要现场补验的步骤。

以下命令运行三个可复用的离线流程。`$simulator` 是测试模拟器的 UDID。流程通过 DEBUG fixture 打开两条不同项目的测试会话。

```sh
(
set -e
: "${simulator:?请设置测试模拟器的 UDID}"
xcrun simctl bootstatus "$simulator" -b
xcodegen generate --spec native/ios/project.yml --project native/ios
xcodebuild -project native/ios/Dudu.xcodeproj -scheme Dudu \
  -configuration Debug -sdk iphonesimulator -destination "id=$simulator" \
  -derivedDataPath .local/native-ios CODE_SIGNING_ALLOWED=NO build
xcrun simctl install "$simulator" .local/native-ios/Build/Products/Debug-iphonesimulator/Dudu.app

app=com.harnessmobile.app
data_dir="$(xcrun simctl get_app_container "$simulator" "$app" data)"
fixture="$data_dir/tmp/dudu-release-review.json"
evidence=".local/manual-e2e/ios-$(git rev-parse --short HEAD)"
mkdir -p "$data_dir/tmp" "$evidence"
cp docs/manual-e2e/ios-fixture.json "$fixture"

run_simulator_flow() {
  flow="$1"
  shift
  xcrun simctl terminate "$simulator" "$app" 2>/dev/null || true
  xcrun simctl launch "$simulator" "$app" -dudu-ui-review \
    -dudu-review-board "$fixture" -dudu-review-search "$fixture" \
    -AppleLanguages '(zh-Hans)' -AppleLocale zh_CN "$@" &&
    maestro --device "$simulator" test --debug-output "$evidence" \
      --test-output-dir "$evidence" "docs/manual-e2e/ios-$flow.yaml"
}

run_simulator_flow search
run_simulator_flow reconnect -dudu-review-drop-session
run_simulator_flow image -dudu-review-chat-image
)
```

## 验收记录

在发布分支的 `docs/manual-e2e/<version>.md` 记录候选提交、日期、插件与 DSH 版本、iOS 版本及 build。逐项记下操作、预期、实测、证据和结果（通过、失败或待补验）。注明用了哪些测试替身，以及定向自动检查、全量套件和 CI 的实际状态。截图和日志可放在 `.local/manual-e2e/<version>-<commit>/`，提交到仓库的记录只包含脱敏后的内容。

[0.3.0 验收记录](manual-e2e/0.3.0.md)
