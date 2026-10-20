import XCTest

final class FullPageInteractionTests: XCTestCase {
    private var app: XCUIApplication!
    private let pageTimeout: TimeInterval = 90

    override func setUpWithError() throws {
        continueAfterFailure = false
        guard ProcessInfo.processInfo.environment["DSBOT_REAL_PAGE_REVIEW"] == "1" else {
            throw XCTSkip("Set DSBOT_REAL_PAGE_REVIEW=1 to run private real-frontend review tests.")
        }
        #if !targetEnvironment(simulator)
        throw XCTSkip("Real frontend review tests require the simulator Documents capture.")
        #endif

        app = XCUIApplication()
        app.launchArguments = ["-dsbot-ui-review", "-dsbot-review-real-pages", "-dsbot-review-no-blur"]
        app.launchEnvironment["DSBOT_REAL_PAGE_REVIEW"] = "1"
        if let reviewOrigin = ProcessInfo.processInfo.environment["DSBOT_HTTP_PAGE_REVIEW_ORIGIN"] {
            app.launchEnvironment["DSBOT_HTTP_PAGE_REVIEW_ORIGIN"] = reviewOrigin
        }
        app.launch()
    }

    override func tearDownWithError() throws {
        if (testRun?.failureCount ?? 0) > 0, let app {
            attachAccessibilityTree("real-page-app-accessibility-on-failure", from: app)
        }
        try super.tearDownWithError()
    }

    func testPluginConfigurationDetailSavesAndRestoresLocally() throws {
        guard openSidebar() else { return }
        let plugins = app.buttons["library.plugins"]
        guard require(plugins, "The native plugin entry was not available.") else { return }
        plugins.tap()

        guard let webView = waitForPage("plugins") else { return }
        let subagentButtons = app.buttons.matching(
            NSPredicate(format: "label CONTAINS %@", "子智能体")
        )
        guard let subagents = firstElement(
            subagentButtons,
            message: "The real plugin page did not expose the subagent configuration."
        ), tapWhenHittable(
            subagents,
            in: webView,
            message: "The subagent configuration card could not be scrolled into view."
        ) else { return }

        guard require(
            textField(in: app, contains: "最大递归深度"),
            "The subagent detail did not expose its maximum-depth number input."
        ), require(
            textField(in: app, contains: "子智能体并行数量上限"),
            "The subagent detail did not expose its concurrency-limit number input."
        ) else { return }

        let depth = textField(in: app, contains: "最大递归深度")
        let before = accessibilityValue(depth)
        guard tapWhenHittable(
            depth,
            in: webView,
            message: "The maximum-depth input could not be scrolled into view."
        ) else { return }
        depth.typeText("2")
        let savedValue = accessibilityValue(depth)
        XCTAssertNotEqual(savedValue, before, "Typing must change the depth input.")
        guard let numericDepth = Int(savedValue), numericDepth >= 0, numericDepth <= 10_000 else {
            XCTFail("The depth edit must remain a valid number.")
            return
        }
        let finishEditing = app.toolbars.buttons["完成"]
        if finishEditing.exists && finishEditing.isHittable { finishEditing.tap() }
        guard require(app.buttons["保存"], "The subagent detail did not expose Save."),
              require(app.buttons["返回插件"], "The subagent detail did not expose its accessible back control.")
        else { return }
        attachScreenshot("plugins-detail")
        let save = app.buttons["保存"]
        XCTAssertTrue(save.isEnabled, "A valid edited depth must enable Save.")
        guard tapWhenHittable(save, in: webView, message: "The plugin Save control was not reachable.") else {
            return
        }
        let saved = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "enabled == false"),
            object: save
        )
        guard XCTWaiter.wait(for: [saved], timeout: 15) == .completed else {
            XCTFail("The plugin save did not finish before leaving its form.")
            return
        }

        let back = app.buttons["返回插件"]
        guard require(back, "Saving did not return to the plugin list.", timeout: pageTimeout) else { return }
        guard tapWhenHittable(back, in: webView, message: "The plugin back control was not reachable.") else {
            return
        }
        guard let reopenedSubagents = firstElement(
            subagentButtons,
            message: "The plugin list did not return after saving."
        ), tapWhenHittable(
            reopenedSubagents,
            in: webView,
            message: "The subagent configuration could not be reopened."
        ) else { return }

        let restoredDepth = textField(in: app, contains: "最大递归深度")
        guard require(restoredDepth, "The subagent configuration did not reopen.") else { return }
        guard scrollUntilHittable(
            restoredDepth,
            in: webView,
            message: "The saved subagent preference could not be scrolled into view."
        ) else { return }
        XCTAssertEqual(
            accessibilityValue(restoredDepth),
            savedValue,
            "The local review actor did not preserve the subagent preference after reopening."
        )
        attachScreenshot("plugins-detail-saved")

        let returnToPlugins = app.buttons["返回插件"]
        guard require(returnToPlugins, "The reopened detail did not expose its back control.") else { return }
        guard tapWhenHittable(
            returnToPlugins,
            in: webView,
            message: "The plugin back control could not be scrolled into view."
        ) else { return }
    }

    func testTraceSearchOpensAnEventAndClosesItsDetails() throws {
        guard selectMode("轨迹"), let webView = waitForPage("trace") else { return }
        let search = webView.searchFields["搜索轨迹"]
        guard require(search, "The real trace toolbar did not expose its search field.") else { return }

        let probe = "dsbot-ui-review-no-match"
        guard tapWhenHittable(search, in: webView, message: "The trace search field was not reachable.") else {
            return
        }
        search.typeText(probe)
        guard requireValue(search, equals: probe, message: "Trace search did not accept text.") else { return }
        search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: probe.count))
        guard requireValue(
            search,
            oneOf: ["", "搜索"],
            message: "Trace search did not clear to an empty value or its placeholder."
        ) else { return }
        let finishEditing = app.toolbars.buttons["完成"]
        if finishEditing.exists && finishEditing.isHittable { finishEditing.tap() }

        attachScreenshot("trace-search-cleared")
        attachAccessibilityTree("trace-webview-accessibility-before-row-probe", from: webView)
        let events = webView.staticTexts.matching(
            NSPredicate(format: "label == %@", "bash")
        )
        guard require(events.firstMatch, "The captured trace did not expose its tool event.") else { return }
        var event = events.allElementsBoundByAccessibilityElement.first(where: \.isHittable)
        for _ in 0..<12 where event == nil {
            webView.swipeDown()
            event = events.allElementsBoundByAccessibilityElement.first(where: \.isHittable)
        }
        guard let event else {
            XCTFail("The trace tool event could not be scrolled into view.")
            return
        }
        // WKWebView's accessibility row frame is offset from its rendered row here;
        // tap the visibly rendered first tool row instead of the stale AX coordinate.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.30, dy: 0.382)).tap()

        let detailClose = app.buttons["关闭详情"]
        guard require(detailClose, "Opening a trace event did not show the event detail panel.") else { return }
        guard scrollUntilHittable(
            detailClose,
            in: webView,
            message: "The trace detail close control was not reachable."
        ) else { return }
        attachScreenshot("trace-detail")
        detailClose.tap()
        guard requireDisappearance(
            detailClose,
            "The trace event detail panel did not close."
        ) else { return }
    }

    func testContextDNAAndMapControlsExpandTheBrowser() throws {
        guard selectMode("上下文"), let webView = waitForPage("context") else { return }
        let contextDescription = app.otherElements.matching(
            NSPredicate(format: "label CONTAINS %@", "逐条展示模型读取上下文的每一项")
        ).firstMatch
        guard require(
            contextDescription,
            "The context browser did not expose the description that scopes its DNA mode control."
        ) else { return }
        let dna = contextDescription.buttons["DNA 模式"]
        guard require(dna, "The context browser did not expose its scoped DNA mode control."),
              tapWhenHittable(
                dna,
                in: webView,
                message: "The context browser DNA control could not be scrolled into view."
              ) else { return }

        let search = app.textFields["过滤上下文条目…"]
        guard require(
            search,
            "Enabling DNA mode did not reveal the context item filter."
        ) else { return }

        let mapQuery = app.switches.matching(
            NSPredicate(format: "label CONTAINS %@", "切换矩形树图")
        )
        guard let map = firstElement(
            mapQuery,
            message: "The context browser did not expose its block map control."
        ), scrollUntilHittable(
            map,
            in: webView,
            message: "The context block map control could not be scrolled into view."
        ) else { return }
        let before = accessibilityValue(map)
        map.tap()
        guard waitForValueChange(map, from: before) else {
            XCTFail("The context block map did not update its pressed state.")
            return
        }
        XCTAssertNotEqual(
            accessibilityValue(map),
            before,
            "The context block map must visibly toggle."
        )
        XCTAssertFalse(
            app.buttons["历史数据加载失败，点击重试"].exists,
            "The context page must show its real history, not a failed detail request."
        )
        let historyStep = app.staticTexts.matching(NSPredicate(
            format: "label MATCHES %@", "第 [0-9]+ 轮.*共 [0-9]+ 步.*"
        )).firstMatch
        guard require(
            historyStep,
            "The context history must render a real request step from the captured session.",
            timeout: pageTimeout
        ) else { return }
        attachAccessibilityTree("context-webview-history", from: webView)
        attachScreenshot("context-dna-map")
    }

    func testTeamMemberAndTaskDetailsAreInteractive() throws {
        guard selectMode("编队"), let webView = waitForPage("team") else { return }
        guard require(
            visibleElement(in: webView, label: "团队成员"),
            "The real team page did not expose its member section."
        ), require(
            visibleElement(in: webView, label: "任务"),
            "The real team page did not expose its shared task section."
        ) else { return }

        let memberCard = webView.buttons.matching(
            NSPredicate(format: "label BEGINSWITH %@", "选中成员 ")
        ).firstMatch
        guard require(memberCard, "The real team page did not expose a labeled teammate card."),
              tapWhenHittable(
            memberCard,
            in: webView,
            message: "A teammate card could not be scrolled into view."
        ) else { return }
        guard require(
            webView.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "取消选中成员 ")).firstMatch,
            "Selecting the team member did not change its selected state."
        ) else { return }

        let taskHeading = visibleElement(in: webView, label: "任务")
        guard require(taskHeading, "The team page did not expose its task section heading.") else { return }
        let taskCard = webView.buttons.matching(
            NSPredicate(format: "label BEGINSWITH %@", "展开任务 ")
        ).firstMatch
        guard require(taskCard, "The team task section did not expose an accessible task card."),
              scrollUntilHittable(
            taskCard,
            in: webView,
            message: "A team task card could not be scrolled into view."
        ) else { return }
        taskCard.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: taskCard.frame.width * 0.45, dy: 16)).tap()
        let collapse = app.buttons.matching(
            NSPredicate(format: "label BEGINSWITH %@", "收起任务 ")
        ).firstMatch
        guard require(
            collapse,
            "Expanding the team task did not reveal its accessible collapse control."
        ) else { return }
        attachScreenshot("team-member-task-details")
        collapse.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: collapse.frame.width * 0.45, dy: 16)).tap()
        guard requireDisappearance(collapse, "The team task did not collapse on the second tap.") else { return }
    }

    func testGeneralSettingsTogglePersistsAcrossReopenInLocalReviewActor() throws {
        guard openSettings() else { return }
        guard let firstValue = openGeneralSettingsAndToggle() else { return }

        app.buttons["settings.dsh.back"].tap()
        let firstGeneral = app.buttons["settings.dsh.general"]
        guard require(firstGeneral, "Returning from General did not restore the settings categories.") else {
            return
        }
        guard tapWhenHittable(
            firstGeneral,
            in: app,
            message: "The General settings entry could not be scrolled into view."
        ) else { return }
        guard let sameSheetValue = waitForDeveloperToolsSwitch() else { return }
        XCTAssertEqual(
            accessibilityValue(sameSheetValue),
            firstValue,
            "The local review actor did not retain the changed value after revisiting General."
        )
        attachScreenshot("settings-general-persisted")

        app.buttons["settings.close"].tap()
        guard openSettings() else { return }
        let reopenedGeneral = app.buttons["settings.dsh.general"]
        guard require(reopenedGeneral, "Reopening settings did not restore the General category.") else {
            return
        }
        guard tapWhenHittable(
            reopenedGeneral,
            in: app,
            message: "The reopened General settings entry could not be scrolled into view."
        ) else { return }
        guard let reopenedValue = waitForDeveloperToolsSwitch() else { return }
        XCTAssertEqual(
            accessibilityValue(reopenedValue),
            firstValue,
            "The local review actor did not preserve the General setting after reopening the settings page."
        )
        guard tapWhenHittable(
            reopenedValue,
            in: app.webViews.firstMatch,
            message: "The General switch could not be restored after its persistence check."
        ), waitForValueChange(reopenedValue, from: firstValue) else {
            XCTFail("Restore the coding-view setting so later trajectory tests keep their tab.")
            return
        }
        app.buttons["settings.close"].tap()
    }

    func testSettingsAccountModelsAndPresetDetailsUseTheRealForms() throws {
        guard openSettings() else { return }
        let account = app.buttons["settings.dsh.account"]
        guard require(account, "The account category was missing.") else { return }
        account.tap()
        let accountLink = app.links.matching(
            NSPredicate(format: "label CONTAINS %@", "更多账号信息")
        ).firstMatch
        guard require(
            accountLink,
            "The real account profile did not load.",
            timeout: pageTimeout
        ) else { return }
        attachScreenshot("settings-account")
        app.buttons["settings.dsh.back"].tap()

        let models = app.buttons["settings.dsh.models"]
        guard require(models, "The models category was missing.") else { return }
        models.tap()
        XCTAssertFalse(
            app.webViews.firstMatch.buttons["通用设置"].exists,
            "A selected settings form must not reintroduce the desktop category rail."
        )
        let editProvider = app.webViews.firstMatch.buttons.matching(
            NSPredicate(format: "label BEGINSWITH %@", "编辑 ")
        ).firstMatch
        guard require(
            editProvider,
            "The real provider list did not expose its editor.",
            timeout: pageTimeout
        ), tapWhenHittable(
            editProvider,
            in: app.webViews.firstMatch,
            message: "The provider editor was not reachable."
        ), require(app.buttons["取消"], "The model editor did not expose Cancel.") else { return }
        XCTAssertFalse(
            app.webViews.firstMatch.staticTexts["模型"].exists,
            "The provider form must not repeat the native navigation title."
        )
        attachScreenshot("settings-provider-editor")
        app.buttons["取消"].tap()
        app.buttons["settings.dsh.back"].tap()

        let presets = app.buttons["settings.dsh.agent-presets"]
        guard require(presets, "The agent preset category was missing.") else { return }
        guard tapWhenHittable(presets, in: app, message: "The preset category was not reachable.") else {
            return
        }
        let modeDescription = app.webViews.firstMatch.buttons.matching(
            NSPredicate(format: "label BEGINSWITH %@", "模式说明:")
        ).firstMatch
        guard require(
            modeDescription,
            "The real preset list did not load.",
            timeout: pageTimeout
        ), tapWhenHittable(
            modeDescription,
            in: app.webViews.firstMatch,
            message: "The preset description was not reachable."
        ), require(
            app.staticTexts["工作方式"],
            "The preset description dialog did not open."
        ) else { return }
        attachScreenshot("settings-preset-description")
        app.buttons["settings.close"].tap()
    }

    func testBuiltinInventorySearchExpandsDetailsAndReturnsToNativeSettings() throws {
        guard openSettings() else { return }
        attachScreenshot("settings-native-categories")
        let inventory = app.buttons["settings.dsh.plugins"]
        guard require(inventory, "The built-in plugin inventory category was missing."),
              tapWhenHittable(inventory, in: app, message: "The inventory category was not reachable.")
        else { return }

        let webView = app.webViews.firstMatch
        let search = webView.descendants(matching: .any).matching(NSPredicate(
            format: "(elementType == %d OR elementType == %d) AND label == %@",
            XCUIElement.ElementType.textField.rawValue,
            XCUIElement.ElementType.searchField.rawValue,
            "搜索插件"
        )).firstMatch
        guard require(search, "The real plugin inventory did not expose search.", timeout: pageTimeout),
              tapWhenHittable(search, in: webView, message: "The inventory search was not reachable.")
        else { return }
        XCTAssertFalse(
            webView.staticTexts["内置插件"].exists,
            "The inventory must not repeat the native navigation title."
        )
        search.typeText("dsbot")
        guard requireValue(search, equals: "dsbot", message: "The inventory did not accept the search query.")
        else { return }
        let finishEditing = app.toolbars.buttons["完成"]
        if finishEditing.exists && finishEditing.isHittable { finishEditing.tap() }

        let plugin = webView.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "dsbot")).firstMatch
        guard require(plugin, "The inventory search did not return the actual dsbot plugin."),
              tapWhenHittable(plugin, in: webView, message: "The matching plugin could not be expanded."),
              require(webView.staticTexts["完整名称"], "The plugin card did not expand its actual module details."),
              require(webView.staticTexts["运行中"], "The expanded card did not show the computer's runtime state.")
        else { return }
        XCTAssertGreaterThan(plugin.frame.width, webView.frame.width * 0.8)
        attachScreenshot("settings-builtin-plugin-expanded")

        let back = app.buttons["settings.dsh.back"]
        guard require(back, "The native settings back control was missing.") else { return }
        back.tap()
        guard require(app.buttons["settings.dsh.general"], "Back did not restore the native settings categories."),
              require(app.buttons["settings.dsh.market"], "Back lost the plugin market settings entry.")
        else { return }
        guard tapWhenHittable(
            app.buttons["settings.dsh.general"],
            in: app,
            message: "The hidden inventory must not intercept the native settings categories."
        ), require(
            app.switches.matching(NSPredicate(format: "label CONTAINS %@", "显示代码工作视图")).firstMatch,
            "The native category did not open its general settings form.",
            timeout: pageTimeout
        ) else { return }
        app.buttons["settings.dsh.back"].tap()
        guard require(
            app.buttons["settings.dsh.general"],
            "Returning from general settings did not restore the native categories."
        ) else { return }
        attachScreenshot("settings-native-categories-returned")
        app.buttons["settings.close"].tap()
    }

    func testThirdPartyMarketCatalogSearchAndInstalledTabLoadRealData() throws {
        guard openSettings() else { return }
        let market = app.buttons["settings.dsh.market"]
        guard require(market, "The plugin market category was missing."),
              tapWhenHittable(market, in: app, message: "The plugin market category was not reachable.")
        else { return }
        let webView = app.webViews.firstMatch
        let searchFields = webView.descendants(matching: .any).matching(NSPredicate(
            format: "(elementType == %d OR elementType == %d)",
            XCUIElement.ElementType.textField.rawValue, XCUIElement.ElementType.searchField.rawValue
        ))
        let search = searchFields.firstMatch
        guard require(search, "The real market catalog did not load its search field.", timeout: pageTimeout)
        else { return }
        XCTAssertFalse(webView.staticTexts["插件目录加载失败"].exists)
        guard tapWhenHittable(search, in: webView, message: "The market search was not reachable.") else { return }
        search.typeText("dsh-context")
        guard requireValue(search, equals: "dsh-context", message: "The market search did not accept text.") else { return }
        let contextPlugin = webView.links.matching(NSPredicate(format: "label CONTAINS %@", "dsh-context")).firstMatch
        guard require(contextPlugin, "The catalog search did not return the real context plugin.") else { return }
        let finishEditing = app.toolbars.buttons["完成"]
        if finishEditing.exists && finishEditing.isHittable { finishEditing.tap() }
        attachScreenshot("market-catalog-search")
        let installed = webView.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "已安装")).firstMatch
        guard require(installed, "The market Installed tab was missing."),
              tapWhenHittable(installed, in: webView, message: "The Installed tab was not reachable.")
        else { return }
        guard require(webView.staticTexts["dsbot"], "The Installed tab did not show the computer's dsbot plugin.")
        else { return }
        attachScreenshot("market-installed")
        app.buttons["settings.close"].tap()
    }

    private func openGeneralSettingsAndToggle() -> String? {
        let general = app.buttons["settings.dsh.general"]
        guard require(general, "The real DSH settings categories did not expose General.") else { return nil }
        guard tapWhenHittable(
            general,
            in: app,
            message: "The General settings entry could not be scrolled into view."
        ) else { return nil }

        guard let toggle = waitForDeveloperToolsSwitch() else { return nil }
        let webView = app.webViews.firstMatch
        guard scrollUntilHittable(
            toggle,
            in: webView,
            message: "The General settings switch could not be scrolled into view."
        ) else { return nil }
        let initialValue = accessibilityValue(toggle)
        attachScreenshot("settings-general-before-toggle")
        toggle.tap()
        guard waitForValueChange(toggle, from: initialValue) else {
            XCTFail("The real General settings switch did not change value.")
            return nil
        }
        attachScreenshot("settings-general-toggle")
        return accessibilityValue(toggle)
    }

    private func waitForDeveloperToolsSwitch() -> XCUIElement? {
        guard require(
            app.webViews.firstMatch,
            "The real General settings page did not appear.",
            timeout: pageTimeout
        ) else {
            return nil
        }
        let toggle = switchControl(in: app, contains: "显示代码工作视图")
        guard require(
            toggle,
            "The real General settings form did not expose the coding-view switch.",
            timeout: pageTimeout
        ) else { return nil }
        XCTAssertFalse(
            app.webViews.firstMatch.buttons["通用设置"].exists,
            "General settings must use the full mobile width without a second category rail."
        )
        return toggle
    }

    private func openSettings() -> Bool {
        guard openSidebar() else { return false }
        let settings = app.buttons["settings.open"]
        guard require(settings, "The native settings entry was not available.") else { return false }
        settings.tap()
        return require(
            app.buttons["settings.dsh.general"],
            "The settings sheet did not expose its real DSH category list.",
            timeout: pageTimeout
        ) && waitUntilPageIsReady(app.webViews.firstMatch, page: "settings")
    }

    @discardableResult
    private func openSidebar() -> Bool {
        if app.buttons["computers.open"].exists { return true }
        // A page shows only a back button; the sidebar belongs to the conversation.
        let back = app.buttons["page.back"]
        if back.exists { back.tap() }
        let toggle = app.buttons["sidebar.toggle"]
        guard require(toggle, "The native app shell was not available.") else { return false }
        toggle.tap()
        return require(app.buttons["computers.open"], "The native sidebar did not open.")
    }

    /// Trace, context and team open from the "..." menu at the top right of the conversation.
    private func selectMode(_ mode: String) -> Bool {
        let back = app.buttons["page.back"]
        if back.exists { back.tap() }
        if app.buttons["computers.open"].exists {
            app.buttons["sidebar.toggle"].tap()
            guard requireDisappearance(app.buttons["computers.open"], "The native sidebar did not close.") else {
                return false
            }
        }
        let menu = app.buttons["conversation.menu"]
        guard require(menu, "The conversation menu was not available.") else { return false }
        menu.tap()
        let choice = app.buttons[mode].firstMatch
        guard require(choice, "The native \(mode) route was not available.") else { return false }
        choice.tap()
        return true
    }

    private func waitForPage(_ page: String) -> XCUIElement? {
        let webView = app.webViews.firstMatch
        guard require(
            webView,
            "The real DSH \(page) WebView did not appear.",
            timeout: pageTimeout
        ), waitUntilPageIsReady(webView, page: page) else {
            return nil
        }
        return webView
    }

    private func waitUntilPageIsReady(_ webView: XCUIElement, page: String) -> Bool {
        let loading = app.activityIndicators.matching(NSPredicate(
            format: "identifier == %@ OR identifier == %@",
            "embedded.loading", "embedded.\(page)"
        )).firstMatch
        guard requireDisappearance(
            loading,
            "The real DSH \(page) page did not finish loading.",
            timeout: pageTimeout
        ) else { return false }

        let retry = app.buttons["embedded.retry"]
        if retry.exists {
            XCTFail("The real DSH \(page) page presented its retry state.")
            return false
        }
        return true
    }

    private func labeledElement(in webView: XCUIElement, contains label: String) -> XCUIElement {
        webView.descendants(matching: .any).matching(
            NSPredicate(format: "label CONTAINS %@", label)
        ).firstMatch
    }

    private func textField(in webView: XCUIElement, contains label: String) -> XCUIElement {
        webView.textFields.matching(NSPredicate(format: "label CONTAINS %@", label)).firstMatch
    }

    private func switchControl(in webView: XCUIElement, contains label: String) -> XCUIElement {
        webView.switches.matching(NSPredicate(format: "label CONTAINS %@", label)).firstMatch
    }

    private func visibleElement(in webView: XCUIElement, label: String) -> XCUIElement {
        webView.descendants(matching: .any).matching(
            NSPredicate(format: "label == %@", label)
        ).firstMatch
    }

    private func accessibilityValue(_ element: XCUIElement) -> String {
        guard let value = element.value else { return "<nil>" }
        return String(describing: value)
    }

    private func waitForValueChange(_ element: XCUIElement, from value: String) -> Bool {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                guard let current = element.value else { return value != "<nil>" }
                return String(describing: current) != value
            },
            object: nil
        )
        return XCTWaiter.wait(for: [expectation], timeout: 10) == .completed
    }

    private func requireValue(
        _ element: XCUIElement,
        equals expected: String,
        message: String,
        timeout: TimeInterval = 10
    ) -> Bool {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                (element.value as? String) == expected
            },
            object: nil
        )
        guard XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed else {
            XCTFail(message)
            return false
        }
        return true
    }

    private func requireValue(
        _ element: XCUIElement,
        oneOf expectedValues: [String],
        message: String,
        timeout: TimeInterval = 10
    ) -> Bool {
        let expected = Set(expectedValues)
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                guard let value = element.value as? String else { return false }
                return expected.contains(value)
            },
            object: nil
        )
        guard XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed else {
            XCTFail(message)
            return false
        }
        return true
    }

    private func firstElement(
        _ query: XCUIElementQuery,
        message: String,
        timeout: TimeInterval = 10
    ) -> XCUIElement? {
        guard require(query.firstMatch, message, timeout: timeout) else { return nil }
        return query.firstMatch
    }

    private func tapWhenHittable(
        _ element: XCUIElement,
        in container: XCUIElement,
        message: String,
        maxSwipes: Int = 12
    ) -> Bool {
        guard scrollUntilHittable(
            element,
            in: container,
            message: message,
            maxSwipes: maxSwipes
        ) else { return false }
        element.tap()
        return true
    }

    private func scrollUntilHittable(
        _ element: XCUIElement,
        in container: XCUIElement,
        message: String,
        maxSwipes: Int = 12
    ) -> Bool {
        if element.isHittable { return true }

        for _ in 0..<maxSwipes {
            let itemFrame = element.frame
            let viewport = container.frame
            if itemFrame.isEmpty {
                container.swipeUp()
            } else if itemFrame.maxY <= viewport.minY {
                container.swipeDown()
            } else if itemFrame.minY >= viewport.maxY {
                container.swipeUp()
            } else if itemFrame.midY > viewport.midY {
                container.swipeUp()
            } else {
                container.swipeDown()
            }
            if element.isHittable { return true }
        }

        XCTFail(message)
        return false
    }

    private func attachScreenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func attachAccessibilityTree(_ name: String, from element: XCUIElement) {
        let tree = String(decoding: element.debugDescription.utf8.prefix(32 * 1_024), as: UTF8.self)
        let attachment = XCTAttachment(string: tree)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func require(
        _ element: XCUIElement,
        _ message: String,
        timeout: TimeInterval = 10
    ) -> Bool {
        guard element.waitForExistence(timeout: timeout) else {
            XCTFail(message)
            return false
        }
        return true
    }

    private func requireDisappearance(
        _ element: XCUIElement,
        _ message: String,
        timeout: TimeInterval = 10
    ) -> Bool {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"),
            object: element
        )
        guard XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed else {
            XCTFail(message)
            return false
        }
        return true
    }
}
