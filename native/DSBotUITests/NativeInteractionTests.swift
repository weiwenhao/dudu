import XCTest

final class NativeInteractionTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        #if !targetEnvironment(simulator)
        throw XCTSkip("These interaction tests require the simulator review fixture.")
        #endif
        launchReviewApp()
    }

    private func launchReviewApp(additionalArguments: [String] = []) {
        app = XCUIApplication()
        #if targetEnvironment(simulator)
        // The blur's paused animators keep XCUITest waiting for the app to go idle; screenshots cover it.
        app.launchArguments = ["-dsbot-ui-review", "-dsbot-review-no-blur"] + additionalArguments
        #endif
        app.launch()
    }

    private func relaunchReviewApp(additionalArguments: [String] = []) {
        app.terminate()
        launchReviewApp(additionalArguments: additionalArguments)
    }

    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// A page (web, files, automations) shows only a back button; the sidebar belongs to the conversation.
    private func leavePageIfShown() {
        let back = app.buttons["page.back"]
        for _ in 0..<2 where back.exists {
            back.tap()
        }
        XCTAssertTrue(waitForDisappearance(back), "Back should return to the conversation.")
    }

    @discardableResult
    private func openSidebar() -> XCUIElement {
        leavePageIfShown()
        let toggle = app.buttons["sidebar.toggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 30))
        toggle.tap()
        XCTAssertTrue(app.buttons["computers.open"].waitForExistence(timeout: 5))
        return toggle
    }

    private func waitForDisappearance(_ element: XCUIElement, timeout: TimeInterval = 5) -> Bool {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"),
            object: element
        )
        return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
    }

    private func waitForHittable(_ element: XCUIElement, timeout: TimeInterval = 5) -> Bool {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == true AND hittable == true"),
            object: element
        )
        return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
    }

    private func isVisibleInConversation(_ element: XCUIElement) -> Bool {
        guard element.exists else { return false }
        let top = app.buttons["sidebar.toggle"].frame.maxY
        let bottom = app.buttons["composer.plus"].frame.minY
        let appFrame = app.frame
        let viewport = CGRect(x: appFrame.minX, y: top, width: appFrame.width, height: max(0, bottom - top))
        let frame = element.frame
        let visible = frame.intersection(viewport)
        return frame.height > 0 && !visible.isNull && visible.width > 0 && visible.height >= min(16, frame.height)
    }

    private var chatHistory: XCUIElement {
        app.scrollViews["chat.history"]
    }

    private func waitForVisibleInConversation(_ element: XCUIElement, timeout: TimeInterval = 5) -> Bool {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate { [self] _, _ in isVisibleInConversation(element) },
            object: nil
        )
        return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
    }

    private func waitForSelection(
        _ selected: Bool,
        on element: XCUIElement,
        timeout: TimeInterval = 5
    ) -> Bool {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "selected == %@", NSNumber(value: selected)),
            object: element
        )
        return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
    }

    private func waitForLabel(_ element: XCUIElement, containing text: String, timeout: TimeInterval = 10) -> Bool {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label CONTAINS %@", text),
            object: element
        )
        return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
    }

    private func staticText(containing value: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", value)).firstMatch
    }

    private func tapCenter(_ element: XCUIElement) {
        XCTAssertTrue(element.waitForExistence(timeout: 5))
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    }

    /// Conversation views (trace, context, team) live in the "..." menu at the top right.
    private func selectMode(_ mode: String) {
        leavePageIfShown()
        if app.buttons["computers.open"].exists {
            app.buttons["sidebar.toggle"].tap()
            XCTAssertTrue(waitForDisappearance(app.buttons["computers.open"]))
        }
        let menu = app.buttons["conversation.menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 5), "Expected the conversation menu")
        menu.tap()
        let choice = app.buttons[mode].firstMatch
        XCTAssertTrue(choice.waitForExistence(timeout: 5), "Expected menu mode: \(mode)")
        choice.tap()
    }

    private func assertConversation(
        title: String,
        sessionID: String,
        messageID: String,
        body: String
    ) {
        let sidebar = openSidebar()
        let session = app.buttons["session.select.\(sessionID)"]
        XCTAssertTrue(session.waitForExistence(timeout: 5), "Expected session: \(sessionID)")
        XCTAssertTrue(session.label.contains(title), "Expected session title: \(title)")
        sidebar.tap()
        XCTAssertTrue(waitForDisappearance(app.buttons["computers.open"]))

        let message = chatHistory.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", body)).firstMatch
        let messageVisible = waitForVisibleInConversation(message)
        if !messageVisible { capture("conversation-message-missing-\(messageID)") }
        XCTAssertTrue(messageVisible, "Expected visible message: \(messageID). \(app.debugDescription)")
    }

    func testNativeNavigationAndPairingEntryPreserveExistingComputer() throws {
        let sidebar = app.buttons["sidebar.toggle"]
        XCTAssertTrue(sidebar.waitForExistence(timeout: 30), "The simulator fixture should restore into the native shell.")
        XCTAssertEqual(app.webViews.count, 0, "The installed app must render natively.")
        capture("native-conversation")
        sidebar.tap()
        let computers = app.buttons["computers.open"]
        XCTAssertTrue(computers.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["library.skills"].exists)
        for id in ["plugins", "schedules", "insight"] {
            XCTAssertTrue(app.buttons["library.\(id)"].exists, "The sidebar lists DSH's entry \(id).")
        }
        XCTAssertFalse(app.buttons["library.files"].exists, "Resource management is not available on the phone.")
        capture("native-sidebar")
        computers.tap()
        let addComputer = app.buttons["computers.add"]
        XCTAssertTrue(addComputer.waitForExistence(timeout: 5))
        capture("native-computers")
        addComputer.tap()
        XCTAssertTrue(app.buttons["pairing.scan"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["pairing.manual"].exists)
        capture("native-add-computer")
    }

    func testComputerSwipeDeleteRemovesSelectedComputerAndLastRemovalShowsGuide() throws {
        _ = openSidebar()
        app.buttons["computers.open"].tap()

        let local = app.buttons["computer.row.review-local"]
        let secondary = app.buttons["computer.row.review-secondary"]
        XCTAssertTrue(local.waitForExistence(timeout: 10))
        XCTAssertTrue(secondary.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["computers.edit"].exists)

        secondary.swipeLeft()
        let deleteSecondary = app.buttons["computer.delete.review-secondary"]
        XCTAssertTrue(deleteSecondary.waitForExistence(timeout: 5))
        capture("computer-swipe-delete-visible")
        deleteSecondary.tap()
        XCTAssertTrue(waitForDisappearance(secondary), "The delete action must remove that row.")
        XCTAssertTrue(local.exists, "Deleting an inactive computer must preserve the active one.")

        local.swipeLeft()
        let deleteLocal = app.buttons["computer.delete.review-local"]
        XCTAssertTrue(deleteLocal.waitForExistence(timeout: 5))
        deleteLocal.tap()
        XCTAssertTrue(waitForDisappearance(local), "The last saved computer must be removable.")

        XCTAssertTrue(
            app.descendants(matching: .any)["connection.guide"].waitForExistence(timeout: 5),
            "Removing the final computer should return to the connection guide."
        )
        capture("connection-guide-after-last-computer-removal")
    }

    func testComputerListScrollsVerticallyAndSwipeDeleteCanClose() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-many-computers"])
        _ = openSidebar()
        app.buttons["computers.open"].tap()

        let list = app.scrollViews["computers.list"]
        XCTAssertTrue(list.waitForExistence(timeout: 5))
        let first = app.buttons["computer.row.review-local"]
        XCTAssertTrue(first.waitForExistence(timeout: 5))
        first.swipeLeft()
        let delete = app.buttons["computer.delete.review-local"]
        XCTAssertTrue(delete.waitForExistence(timeout: 5))
        first.swipeRight()
        XCTAssertTrue(waitForDisappearance(delete))
        capture("computers-before-vertical-scroll")

        let last = app.buttons["computer.row.review-extra-20"]
        for _ in 0..<8 {
            if last.exists && last.isHittable { break }
            list.swipeUp()
        }
        capture("computers-after-vertical-scroll")
        XCTAssertTrue(waitForHittable(last), "Horizontal row gestures must not block vertical scrolling.")
        capture("computers-scroll-to-last")
        last.swipeLeft()
        XCTAssertTrue(app.buttons["computer.delete.review-extra-20"].waitForExistence(timeout: 5))
        capture("computers-last-delete-visible")
    }

    func testSidebarClosesWithToggleAndBackdrop() throws {
        let toggle = openSidebar()
        toggle.tap()
        XCTAssertTrue(waitForDisappearance(app.buttons["computers.open"]))

        _ = openSidebar()
        let backdrop = app.buttons["sidebar.backdrop"]
        XCTAssertTrue(backdrop.waitForExistence(timeout: 5))
        
        // Tap in the right side of screen where backdrop exists
        // Use coordinates relative to screen to avoid backdrop frame issues
        backdrop.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.5)).tap()
        
        XCTAssertTrue(waitForDisappearance(backdrop))
        XCTAssertTrue(waitForDisappearance(app.buttons["computers.open"]))
    }

    func testGlassNavigationControlsAlignAndDrawersPushTheConversation() throws {
        let sidebar = app.buttons["sidebar.toggle"]
        XCTAssertTrue(sidebar.waitForExistence(timeout: 30))
        let viewMenu = app.buttons["conversation.menu"]
        XCTAssertTrue(viewMenu.exists)
        XCTAssertFalse(app.buttons["session.new.toolbar"].exists)
        XCTAssertFalse(app.buttons["tools.toggle"].exists)
        let leftFrame = sidebar.frame
        let newSessionFrame = viewMenu.frame
        let screen = app.frame

        XCTAssertEqual(leftFrame.midY, newSessionFrame.midY, accuracy: 1)
        XCTAssertGreaterThanOrEqual(leftFrame.height, 44)
        XCTAssertGreaterThanOrEqual(newSessionFrame.height, 44)
        XCTAssertEqual(leftFrame.minX - screen.minX, 20, accuracy: 1)
        XCTAssertEqual(screen.maxX - newSessionFrame.maxX, 20, accuracy: 1)
        XCTAssertFalse(app.buttons["conversation.title"].exists)

        let firstMessage = staticText(containing: "我会按这几个地方逐项检查")
        let plusButton = app.buttons["composer.plus"]
        let voiceButton = app.buttons["composer.voice"]
        let composerInput = app.descendants(matching: .any)["composer.text"].firstMatch
        XCTAssertTrue(firstMessage.waitForExistence(timeout: 5))
        XCTAssertTrue(plusButton.waitForExistence(timeout: 5))
        XCTAssertTrue(voiceButton.exists)
        XCTAssertTrue(composerInput.exists)
        XCTAssertFalse(app.buttons["composer.keyboard"].exists, "Text mode shows the voice toggle, not the keyboard toggle.")
        capture("layout-before-sidebar")
        print("LAYOUT app=\(screen) menu=\(leftFrame) compose=\(newSessionFrame) message=\(firstMessage.frame) voice=\(voiceButton.frame)")
        XCTAssertGreaterThanOrEqual(
            firstMessage.frame.minY,
            max(leftFrame.maxY, newSessionFrame.maxY) + 8,
            "The first chat message must start below the floating header controls."
        )
        XCTAssertEqual(
            screen.maxY - plusButton.frame.maxY,
            DSBotLayoutReference.composerBottomDistance,
            accuracy: 2,
            "The composer floats as far above the bottom edge of the screen as it is from the sides."
        )
        XCTAssertEqual(
            plusButton.frame.minX - screen.minX,
            screen.maxY - plusButton.frame.maxY,
            accuracy: 2
        )
        XCTAssertEqual(
            screen.maxX - voiceButton.frame.maxX,
            plusButton.frame.minX - screen.minX,
            accuracy: 2
        )
        XCTAssertEqual(plusButton.frame.height, 44, accuracy: 1)
        XCTAssertEqual(plusButton.frame.midY, voiceButton.frame.midY, accuracy: 1)
        XCTAssertEqual(composerInput.frame.midY, voiceButton.frame.midY, accuracy: 2)
        XCTAssertEqual(leftFrame.height, 44, accuracy: 1, "Toolbar buttons are 44pt glass circles.")
        XCTAssertEqual(
            leftFrame.minY - screen.minY,
            DSBotLayoutReference.toolbarTop,
            accuracy: 1,
            "Toolbar buttons sit flush with the top safe area, like the Muse reference."
        )

        capture("muse-glass-conversation")

        sidebar.tap()
        XCTAssertTrue(app.buttons["settings.open"].waitForExistence(timeout: 5))
        let pushedLeftFrame = sidebar.frame
        XCTAssertGreaterThan(pushedLeftFrame.minX - leftFrame.minX, screen.width * 0.65)
        XCTAssertLessThan(pushedLeftFrame.minX - leftFrame.minX, screen.width * 0.85)
        XCTAssertTrue(sidebar.isHittable, "The original menu control must stay usable on the visible chat edge.")
        capture("muse-push-sidebar")
        sidebar.tap()
        XCTAssertTrue(waitForDisappearance(app.buttons["settings.open"]))
        XCTAssertEqual(sidebar.frame.minX, leftFrame.minX, accuracy: 1)
        capture("native-conversation-after-sidebar-toggle")
    }

    func testSidebarDragAndSettingsSheetReturnToTheSameConversation() throws {
        let sidebarLeft = app.buttons["sidebar.toggle"].frame.minX
        _ = openSidebar()
        let backdrop = app.buttons["sidebar.backdrop"]
        XCTAssertTrue(backdrop.waitForExistence(timeout: 5))
        backdrop.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.35))
            .press(
                forDuration: 0.05,
                thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.35))
            )
        XCTAssertTrue(waitForDisappearance(app.buttons["settings.open"]))
        XCTAssertEqual(app.buttons["sidebar.toggle"].frame.minX, sidebarLeft, accuracy: 1)
        capture("native-conversation-after-sidebar-drag")
        tapCenter(app.descendants(matching: .any)["composer.text"].firstMatch)
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        chatHistory.swipeDown()
        XCTAssertTrue(waitForDisappearance(app.keyboards.firstMatch))

        _ = openSidebar()
        app.buttons["settings.open"].tap()
        let close = app.buttons["settings.close"]
        XCTAssertTrue(close.waitForExistence(timeout: 5))
        XCTAssertLessThan(close.frame.midX, app.frame.width * 0.25)
        XCTAssertFalse(app.buttons["settings.open"].isHittable)
        XCTAssertTrue(app.buttons["settings.dsh.models"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["settings.model"].exists, "Model and permission are chosen in the + sheet.")
        XCTAssertFalse(app.buttons["settings.permission"].exists)
        capture("muse-grouped-settings")
        close.tap()
        XCTAssertTrue(waitForDisappearance(close))
        XCTAssertTrue(app.buttons["settings.open"].isHittable)
        app.buttons["sidebar.toggle"].tap()
        XCTAssertTrue(waitForDisappearance(app.buttons["settings.open"]))
        XCTAssertTrue(
            waitForVisibleInConversation(staticText(containing: "我会按这几个地方逐项检查"))
        )
    }

    func testSidebarSearchFiltersRecentSessions() throws {
        _ = openSidebar()
        app.buttons["sidebar.search"].tap()
        let search = app.textFields["search.query"]
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("dsbot")

        XCTAssertTrue(app.buttons["search.result.review-chat"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["search.result.review-second"].exists)
        XCTAssertFalse(app.buttons["search.result.review-notes"].exists)
        capture("native-search-title-results")
    }

    func testSearchFindsMessageContentAndKeepsResultsWhenReopeningSidebar() throws {
        _ = openSidebar()
        app.buttons["sidebar.search"].tap()
        let query = app.textFields["search.query"]
        XCTAssertTrue(query.waitForExistence(timeout: 5))
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        query.typeText("长按说话")
        let hit = app.buttons["search.result.review-chat"]
        XCTAssertTrue(hit.waitForExistence(timeout: 10))
        XCTAssertTrue(hit.label.contains("长按说话"))
        XCTAssertFalse(app.buttons["search.result.review-second"].exists)
        XCTAssertGreaterThan(query.frame.width, app.frame.width * 0.6)
        capture("native-search-content-results")

        hit.tap()
        XCTAssertTrue(app.buttons["sidebar.toggle"].waitForExistence(timeout: 5))
        app.buttons["sidebar.toggle"].tap()
        XCTAssertTrue(hit.waitForExistence(timeout: 5))
        XCTAssertEqual(query.value as? String, "长按说话")
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        capture("native-search-restored-results")

        app.buttons["search.clear"].tap()
        XCTAssertTrue(waitForDisappearance(hit))
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        app.buttons["search.back"].tap()
        XCTAssertTrue(app.buttons["sidebar.search"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.textFields["search.query"].exists)
        XCTAssertTrue(app.buttons["computers.open"].exists)
    }

    func testSettingsCloseRemainsReachableWhileScrollingInLandscape() throws {
        _ = openSidebar()
        app.buttons["settings.open"].tap()
        let close = app.buttons["settings.close"]
        XCTAssertTrue(close.waitForExistence(timeout: 5))

        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        XCTAssertTrue(waitForHittable(close))
        let closePosition = close.frame.origin
        let content = app.scrollViews.firstMatch
        XCTAssertTrue(content.waitForExistence(timeout: 5))
        content.swipeUp()
        XCTAssertTrue(close.isHittable)
        XCTAssertLessThanOrEqual(abs(close.frame.minY - closePosition.y), 1)
        XCTAssertLessThanOrEqual(close.frame.maxX, app.frame.maxX + 1)
        capture("muse-settings-landscape")

        close.tap()
        XCTAssertTrue(waitForDisappearance(close))
        XCTAssertTrue(app.buttons["settings.open"].isHittable)
    }

    func testWorkspaceGroupsFoldAndTheViewOptionsFollowDSH() throws {
        _ = openSidebar()
        // The list is grouped by workspace, as DSH's is, so the heading says so.
        let heading = app.staticTexts["工作区"]
        let optionsButton = app.buttons["sidebar.sort"]
        let firstSession = app.buttons["session.select.review-chat"]
        let timestamp = app.descendants(matching: .any)["session.time.review-chat"]
        let settings = app.buttons["settings.open"]
        XCTAssertTrue(heading.waitForExistence(timeout: 5))
        XCTAssertTrue(waitForHittable(optionsButton))
        XCTAssertTrue(firstSession.waitForExistence(timeout: 5))
        XCTAssertTrue(timestamp.waitForExistence(timeout: 5))
        XCTAssertTrue(settings.waitForExistence(timeout: 5))

        XCTAssertGreaterThan(optionsButton.frame.minX, heading.frame.maxX)
        let actionColumnCenters = [optionsButton.frame.midX, timestamp.frame.midX, settings.frame.midX]
        XCTAssertLessThanOrEqual(
            (actionColumnCenters.max() ?? 0) - (actionColumnCenters.min() ?? 0),
            1.0,
            "The options menu, row timestamps, and settings should share the same action column."
        )

        // Each workspace is a header with its own menu; tapping the name folds it away and back.
        let project = app.buttons["sidebar.group.mobile"]
        XCTAssertTrue(project.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["sidebar.group.menu.mobile"].exists)
        XCTAssertFalse(app.buttons["sidebar.group.new.mobile"].exists, "A workspace header has no new-session button.")
        project.tap()
        XCTAssertTrue(waitForDisappearance(firstSession))
        project.tap()
        XCTAssertTrue(firstSession.waitForExistence(timeout: 5))

        // DSH's options, in its words: how the list is grouped and which archived conversations show.
        optionsButton.tap()
        for title in [
            "按工作区", "单列表",
            "隐藏已归档", "全部对话（显示已归档）", "仅显示已归档",
        ] {
            XCTAssertTrue(app.buttons[title].waitForExistence(timeout: 5), "Missing view option: \(title)")
        }
        XCTAssertFalse(app.buttons["按工作区树"].exists, "A phone shows one level of workspaces.")
        XCTAssertFalse(app.buttons["手动排序"].exists, "The phone keeps one order: newest first.")
        XCTAssertFalse(app.buttons["最近更新"].exists)
        app.buttons["单列表"].tap()
        XCTAssertTrue(waitForDisappearance(project))
        XCTAssertTrue(firstSession.waitForExistence(timeout: 5))
        settings.tap()
        let close = app.buttons["settings.close"]
        XCTAssertTrue(close.waitForExistence(timeout: 5))
        capture("native-sidebar-footer-settings")
        close.tap()
        XCTAssertTrue(waitForDisappearance(close))
    }

    func testAPinnedConversationShowsAPinWhereItsTimeWas() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-sidebar-rich"])
        _ = openSidebar()
        // The rich fixture pins 接口设计与实现 (review-fourth); every other row keeps its time.
        let pin = app.descendants(matching: .any)["session.pin.review-fourth"]
        let time = app.descendants(matching: .any)["session.time.review-chat"]
        XCTAssertTrue(pin.waitForExistence(timeout: 5))
        XCTAssertTrue(time.waitForExistence(timeout: 5))
        XCTAssertEqual(pin.label, "已置顶")
        XCTAssertFalse(app.descendants(matching: .any)["session.time.review-fourth"].exists, "The pin replaces the time.")
        XCTAssertFalse(app.descendants(matching: .any)["session.pin.review-chat"].exists)
        XCTAssertLessThanOrEqual(abs(pin.frame.midX - time.frame.midX), 1.0, "The pin sits in the time's column.")
    }

    func testLibraryHidesRightPanelButtonAndReturnsToChat() throws {
        let sidebar = app.buttons["sidebar.toggle"]
        XCTAssertTrue(sidebar.waitForExistence(timeout: 30))
        sidebar.tap()
        let plugins = app.buttons["library.plugins"]
        XCTAssertTrue(plugins.waitForExistence(timeout: 5))
        plugins.tap()
        XCTAssertFalse(app.buttons["tools.toggle"].exists)
        // On the plugin page the toolbar's right button adds a plugin instead of opening a menu.
        XCTAssertTrue(app.buttons["plugins.add"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["conversation.menu"].exists)
        // A page is one level down: a back button, and none of the conversation's controls.
        XCTAssertTrue(app.buttons["page.back"].exists)
        XCTAssertFalse(app.buttons["sidebar.toggle"].exists)
        let pluginPage = app.webViews.firstMatch
        XCTAssertTrue(pluginPage.waitForExistence(timeout: 10))
        XCTAssertTrue(pluginPage.staticTexts["插件"].waitForExistence(timeout: 10))
        let dsbotPlugin = pluginPage.buttons["dsbot"]
        XCTAssertTrue(dsbotPlugin.waitForExistence(timeout: 10))
        dsbotPlugin.tap()
        XCTAssertTrue(pluginPage.staticTexts["手机连接"].waitForExistence(timeout: 5))
        let returnToPlugins = pluginPage.buttons["返回插件"]
        XCTAssertTrue(returnToPlugins.waitForExistence(timeout: 5))
        returnToPlugins.tap()
        XCTAssertTrue(pluginPage.buttons["dsbot"].waitForExistence(timeout: 5))

        app.buttons["page.back"].tap()
        XCTAssertTrue(waitForDisappearance(app.webViews.firstMatch, timeout: 10))
        XCTAssertEqual(app.webViews.count, 0, "Returning to chat should release the embedded page.")
        XCTAssertTrue(app.buttons["composer.plus"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["chat.message.review-answer"].waitForExistence(timeout: 5))
        capture("native-library-return")
    }

    func testProductionHostPluginDocumentRendersThroughWebKitBridge() throws {
        let fixtureURL = try XCTUnwrap(
            Bundle(for: NativeInteractionTests.self).url(forResource: "HostPluginPage", withExtension: "json"),
            "Run npm run native:review-pages before generating the simulator project."
        )
        let fixture = try Data(contentsOf: fixtureURL)
        app.terminate()
        app.launchEnvironment["DSBOT_HOST_PAGE_REVIEW"] = fixture.base64EncodedString()
        app.launch()
        _ = openSidebar()
        let plugins = app.buttons["library.plugins"]
        XCTAssertTrue(plugins.waitForExistence(timeout: 5))
        plugins.tap()

        let page = app.webViews.firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 10))
        XCTAssertTrue(page.staticTexts["Actual host plugin"].waitForExistence(timeout: 10))
        XCTAssertTrue(page.staticTexts["Production page resource check"].exists)
        XCTAssertFalse(app.buttons["embedded.retry"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["embedded.loading"].exists)
        capture("production-host-plugin-page")
    }

    func testCompletedTurnStartsCollapsedAndItsThinkingCanBeReopened() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-process"])
        let header = app.buttons["chat.process.header"]
        XCTAssertTrue(header.waitForExistence(timeout: 10))
        XCTAssertTrue(header.label.hasPrefix("已完成，用时"), "Turn disclosure reads like DSH: \(header.label)")
        XCTAssertFalse(app.buttons["chat.process.group"].exists, "A finished turn starts collapsed.")
        header.tap()
        let group = app.buttons["chat.process.group"]
        XCTAssertTrue(group.waitForExistence(timeout: 5))
        let thought = app.buttons["chat.process.thought"]
        XCTAssertTrue(thought.waitForExistence(timeout: 5))
        XCTAssertTrue(thought.label.contains("Earlier assistant progress stays available here."))
        capture("native-expanded-process")
        header.tap()
        XCTAssertTrue(waitForDisappearance(group))
        capture("native-collapsed-process")
    }

    func testSettingsListsDSHSectionsFromThePluginInsteadOfLoadingThePage() throws {
        _ = openSidebar()
        let settingsButton = app.buttons["settings.open"]
        XCTAssertTrue(settingsButton.waitForExistence(timeout: 5))
        settingsButton.tap()

        // The list is a plugin answer, so it is there before DSH's settings page has loaded.
        for id in ["general", "account", "models", "agent-presets", "plugins", "archived-sessions", "notion-sync"] {
            XCTAssertTrue(app.buttons["settings.dsh.\(id)"].waitForExistence(timeout: 5), "Missing settings section: \(id)")
        }
        XCTAssertFalse(app.buttons["settings.model"].exists)
        XCTAssertFalse(app.buttons["settings.permission"].exists)
        XCTAssertFalse(app.buttons["settings.dsh.general"].exists, "General settings are the desktop's, not the phone's.")
        XCTAssertFalse(app.buttons["settings.reconnect"].exists, "Reconnecting lives on the computers page.")
        XCTAssertFalse(app.descendants(matching: .any)["settings.dsh.loading"].exists)
        capture("native-settings")

        // A section: a back button and its title on one bar, and no close button on top of it.
        app.buttons["settings.dsh.models"].tap()
        XCTAssertTrue(app.buttons["settings.dsh.back"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["settings.close"].exists)
        capture("native-settings-section")
        app.buttons["settings.dsh.back"].tap()
        XCTAssertTrue(app.buttons["settings.close"].waitForExistence(timeout: 5))

        app.buttons["settings.computers"].tap()
        XCTAssertTrue(app.buttons["computers.reconnect"].waitForExistence(timeout: 5))
    }

    func testSecondaryComputerRestoresNameAndLoadsFreshConversation() throws {
        _ = openSidebar()
        let secondSession = app.buttons["session.select.review-second"]
        XCTAssertTrue(secondSession.waitForExistence(timeout: 5))
        secondSession.tap()
        assertConversation(
            title: "检查连接与配对",
            sessionID: "review-second",
            messageID: "review-content-review-second",
            body: "这是“检查连接与配对”的会话内容。"
        )

        _ = openSidebar()
        app.buttons["computers.open"].tap()
        let secondary = app.buttons["computer.row.review-secondary"]
        XCTAssertTrue(secondary.waitForExistence(timeout: 5))
        XCTAssertTrue(secondary.label.contains("工作电脑"))
        secondary.tap()

        assertConversation(
            title: "优化手机上的对话体验",
            sessionID: "review-chat",
            messageID: "review-answer",
            body: "我会按这几个地方逐项检查"
        )
        XCTAssertFalse(app.descendants(matching: .any)["chat.message.review-content-review-second"].exists)

        _ = openSidebar()
        app.buttons["settings.open"].tap()
        let activeComputer = app.buttons["settings.computers"]
        XCTAssertTrue(activeComputer.waitForExistence(timeout: 5))
        XCTAssertTrue(activeComputer.isHittable)
        XCTAssertTrue(activeComputer.label.contains("工作电脑"))
        capture("native-settings-secondary-computer")
        app.buttons["settings.close"].tap()
    }

    func testDraftSurvivesLibraryAndConversationModeNavigation() throws {
        let input = app.descendants(matching: .any)["composer.text"].firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        input.typeText("keep this draft")

        _ = openSidebar()
        XCTAssertTrue(waitForDisappearance(app.keyboards.firstMatch), "Opening the sidebar dismisses the keyboard.")
        app.buttons["library.plugins"].tap()
        let pluginPage = app.webViews.firstMatch
        XCTAssertTrue(pluginPage.waitForExistence(timeout: 10))
        XCTAssertTrue(pluginPage.staticTexts["插件"].waitForExistence(timeout: 10))
        XCTAssertTrue(pluginPage.buttons["dsbot"].waitForExistence(timeout: 10))
        capture("native-library-plugins")

        _ = openSidebar()
        app.buttons["session.select.review-chat"].tap()
        XCTAssertTrue(waitForDisappearance(app.webViews.firstMatch, timeout: 10))
        XCTAssertEqual(app.webViews.count, 0, "The conversation remains native after leaving the plugin page.")
        XCTAssertTrue(app.buttons["composer.plus"].waitForExistence(timeout: 5))
        XCTAssertTrue(waitForVisibleInConversation(staticText(containing: "我会按这几个地方逐项检查")))
        let restoredAfterLibrary = app.descendants(matching: .any)["composer.text"].firstMatch
        XCTAssertTrue(restoredAfterLibrary.waitForExistence(timeout: 5))
        XCTAssertEqual(restoredAfterLibrary.value as? String, "keep this draft")

        selectMode("轨迹")
        let tracePage = app.webViews.firstMatch
        XCTAssertTrue(tracePage.waitForExistence(timeout: 10))
        XCTAssertTrue(tracePage.staticTexts["已完成"].waitForExistence(timeout: 10))
        capture("native-library-trace")

        selectMode("对话")
        XCTAssertTrue(waitForDisappearance(app.webViews.firstMatch, timeout: 10))
        XCTAssertEqual(app.webViews.count, 0, "Switching back to conversation should restore the native chat.")
        XCTAssertTrue(app.buttons["composer.plus"].waitForExistence(timeout: 5))
        XCTAssertTrue(waitForVisibleInConversation(staticText(containing: "我会按这几个地方逐项检查")))

        let embeddedModes: [(mode: String, content: String, capture: String)] = [
            ("上下文", "当前项目", "native-library-context"),
            ("编队", "暂无编队", "native-library-team")
        ]
        for item in embeddedModes {
            selectMode(item.mode)
            let embeddedPage = app.webViews.firstMatch
            XCTAssertTrue(embeddedPage.waitForExistence(timeout: 10))
            XCTAssertTrue(embeddedPage.staticTexts[item.content].waitForExistence(timeout: 10))
            capture(item.capture)
        }

        selectMode("对话")
        XCTAssertTrue(waitForDisappearance(app.webViews.firstMatch, timeout: 10))
        XCTAssertEqual(app.webViews.count, 0)
        XCTAssertTrue(waitForVisibleInConversation(staticText(containing: "我会按这几个地方逐项检查")))
        let restoredAfterMode = app.descendants(matching: .any)["composer.text"].firstMatch
        XCTAssertTrue(restoredAfterMode.waitForExistence(timeout: 5))
        XCTAssertEqual(restoredAfterMode.value as? String, "keep this draft")
        capture("native-draft-restored")
    }

    func testRepeatedSessionSelectionsChangeTitleAndMessageContent() throws {
        assertConversation(
            title: "优化手机上的对话体验",
            sessionID: "review-chat",
            messageID: "review-answer",
            body: "我会按这几个地方逐项检查"
        )
        let cases: [(id: String, title: String, messageID: String, body: String)] = [
            ("review-second", "检查连接与配对", "review-content-review-second", "这是“检查连接与配对”的会话内容。"),
            ("review-notes", "整理本周的项目进展", "review-content-review-notes", "这是“整理本周的项目进展”的会话内容。"),
            ("review-fourth", "接口设计与实现", "review-content-review-fourth", "这是“接口设计与实现”的会话内容。"),
            ("review-fifth", "阅读资料与工作记录", "review-content-review-fifth", "这是“阅读资料与工作记录”的会话内容。"),
            ("review-chat", "优化手机上的对话体验", "review-answer", "我会按这几个地方逐项检查")
        ]
        var previousBody = "我会按这几个地方逐项检查"

        for _ in 0..<2 {
            for item in cases {
                _ = openSidebar()
                let session = app.buttons["session.select.\(item.id)"]
                XCTAssertTrue(session.waitForExistence(timeout: 5))
                session.tap()

                assertConversation(
                    title: item.title,
                    sessionID: item.id,
                    messageID: item.messageID,
                    body: item.body
                )
                XCTAssertTrue(waitForDisappearance(staticText(containing: previousBody)))
                previousBody = item.body
            }
        }
        capture("native-repeated-session-switch")
    }

    func testFirstLaunchShowsEmptyPairingEntry() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-unpaired"])
        XCTAssertTrue(app.descendants(matching: .any)["connection.guide"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["pairing.scan"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["pairing.manual"].exists)
        XCTAssertFalse(app.buttons["sidebar.toggle"].exists)
        XCTAssertFalse(app.buttons["composer.plus"].exists)
        capture("native-first-launch-pairing")
    }

    func testFailedConnectionShowsGuideAndCanSwitchSavedComputer() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-disconnected"])
        let computers = app.buttons["connection.computers"]
        XCTAssertTrue(computers.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["connection.retry"].exists)
        XCTAssertFalse(app.buttons["pairing.scan"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["connection.failure"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["sidebar.toggle"].exists)
        XCTAssertFalse(app.buttons["composer.plus"].exists)
        capture("connection-failed-guide")

        computers.tap()
        let otherComputer = app.buttons["computer.row.review-secondary"]
        XCTAssertTrue(otherComputer.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["computer.row.review-local"].exists)
        otherComputer.tap()
        XCTAssertTrue(app.buttons["sidebar.toggle"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["connection.computers"].exists)
    }

    func testAuthenticationFailureGuidesManualPairingAndRecovers() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-auth-failed"])
        let failure = app.descendants(matching: .any)["connection.failure"]
        XCTAssertTrue(failure.waitForExistence(timeout: 10))
        XCTAssertTrue(failure.label.contains("配对已失效"))
        XCTAssertFalse(app.buttons["connection.retry"].exists)
        XCTAssertEqual(app.buttons["pairing.scan"].label, "重新扫码配对")
        XCTAssertFalse(app.buttons["sidebar.toggle"].exists)
        capture("connection-expired-guide")

        app.buttons["pairing.manual"].tap()
        let link = app.textFields["pairing.link"].exists
            ? app.textFields["pairing.link"] : app.textViews["pairing.link"]
        XCTAssertTrue(link.waitForExistence(timeout: 5))
        capture("connection-manual-entry")
        link.tap()
        link.typeText(
            "https://desktop.example.invalid/dsbot?pair="
                + String(repeating: "C", count: 43) + "&computer=review-desktop&name=ReviewMac"
        )
        app.buttons["完成"].firstMatch.tap()
        let connect = app.buttons["pairing.connect"]
        if !connect.isHittable { app.scrollViews.firstMatch.swipeUp() }
        XCTAssertTrue(waitForHittable(connect))
        connect.tap()
        XCTAssertTrue(app.buttons["sidebar.toggle"].waitForExistence(timeout: 10))
        _ = openSidebar()
        app.buttons["computers.open"].tap()
        XCTAssertTrue(app.buttons["computer.row.review-local"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["computer.row.review-local"].label.contains("ReviewMac"))
        XCTAssertTrue(app.buttons["computer.row.review-secondary"].exists)
        capture("connection-pairing-recovered")
    }

    func testStartupShowsHomeUntilPairingIsRejected() throws {
        relaunchReviewApp(additionalArguments: [
            "-dsbot-review-auth-failed", "-dsbot-review-startup-transition"
        ])
        XCTAssertTrue(app.buttons["sidebar.toggle"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["composer.plus"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["connection.guide"].exists)
        capture("startup-home-restoring")

        XCTAssertTrue(app.descendants(matching: .any)["connection.failure"].waitForExistence(timeout: 30))
        capture("startup-guide-rejected")
        XCTAssertFalse(app.buttons["sidebar.toggle"].exists)
        XCTAssertTrue(app.buttons["connection.computers"].exists)
    }

    func testRetryFromGuideReturnsToConversation() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-retry"])
        let retry = app.buttons["connection.retry"]
        XCTAssertTrue(retry.waitForExistence(timeout: 10))
        XCTAssertTrue(waitForHittable(retry))
        retry.tap()
        XCTAssertTrue(app.buttons["sidebar.toggle"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["connection.computers"].exists)
    }

    func testConnectingSavedComputerKeepsHomeVisible() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-connecting"])
        XCTAssertTrue(app.buttons["sidebar.toggle"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["composer.plus"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["connection.guide"].exists)
        capture("connection-restoring-home")
        XCTAssertTrue(app.descendants(matching: .any)["chat.message.review-answer"].waitForExistence(timeout: 30))
        XCTAssertFalse(app.descendants(matching: .any)["connection.guide"].exists)
        capture("connection-restored-home")
    }

    func testReturningFromBackgroundKeepsConversationVisible() throws {
        let message = app.descendants(matching: .any)["chat.message.review-answer"]
        XCTAssertTrue(message.waitForExistence(timeout: 15))
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(app.buttons["sidebar.toggle"].waitForExistence(timeout: 5))
        XCTAssertTrue(message.exists)
        XCTAssertFalse(app.descendants(matching: .any)["connection.guide"].exists)
        capture("connection-resumed-home")
    }

    func testLostConnectionKeepsTheConversationScreen() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-drop-session"])
        _ = openSidebar()
        app.buttons["session.select.review-second"].tap()
        XCTAssertTrue(app.buttons["sidebar.toggle"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["composer.plus"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["connection.guide"].exists)
        capture("connection-lost-conversation")
    }

    func testColdLaunchRestoresTheLastConversationBeforeConnecting() throws {
        let cacheArguments = ["-dsbot-review-cache-id", UUID().uuidString]
        relaunchReviewApp(additionalArguments: cacheArguments)
        _ = openSidebar()
        if !app.buttons["session.select.review-second"].exists {
            app.buttons["sidebar.group.mobile"].tap()
        }
        app.buttons["session.select.review-second"].tap()
        XCTAssertTrue(waitForVisibleInConversation(staticText(containing: "会话内容。")))
        XCUIDevice.shared.press(.home)
        app.terminate()
        launchReviewApp(additionalArguments: cacheArguments + ["-dsbot-review-connecting"])
        XCTAssertTrue(waitForVisibleInConversation(staticText(containing: "会话内容。"), timeout: 5))
        XCTAssertFalse(staticText(containing: "探索未至之境").exists)
        XCTAssertFalse(staticText(containing: "正在连接…").exists)
        capture("native-cached-cold-launch")
    }

    func testDelayedCachedHistoryAppearsWithoutWaitingForTheConnectionOrASwipe() throws {
        let cacheArguments = ["-dsbot-review-cache-id", UUID().uuidString, "-dsbot-review-long-history"]
        relaunchReviewApp(additionalArguments: cacheArguments)
        let ending = staticText(containing: "长对话检查完成。")
        XCTAssertTrue(waitForVisibleInConversation(ending, timeout: 10))
        XCUIDevice.shared.press(.home)
        app.terminate()
        launchReviewApp(additionalArguments: cacheArguments + ["-dsbot-review-delayed-cache", "-dsbot-review-connecting"])
        XCTAssertTrue(waitForVisibleInConversation(ending, timeout: 8))
        XCTAssertFalse(staticText(containing: "正在连接…").exists)
        XCTAssertFalse(app.buttons["chat.latest"].exists)
        capture("native-delayed-cached-history")
    }

    func testCachedLongHistoryCanRefreshToShorterContentWithoutAWhiteScreen() throws {
        let cacheArguments = ["-dsbot-review-cache-id", UUID().uuidString, "-dsbot-review-long-history"]
        relaunchReviewApp(additionalArguments: cacheArguments)
        let ending = staticText(containing: "长对话检查完成。")
        XCTAssertTrue(waitForVisibleInConversation(ending, timeout: 10))
        XCUIDevice.shared.press(.home)
        app.terminate()
        launchReviewApp(additionalArguments: cacheArguments + ["-dsbot-review-shortened-history"])
        XCTAssertTrue(waitForVisibleInConversation(ending, timeout: 10))
        XCTAssertFalse(app.buttons["chat.latest"].exists)
        capture("native-cached-history-shortened")
    }

    func testHeavyHistoryAppearsOnColdLaunchAndAfterSwitchingSessionsWithoutSwiping() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-heavy-history"])
        let latestMessage = chatHistory.otherElements["transcript:turn:turn-40"].staticTexts
            .matching(NSPredicate(format: "label CONTAINS %@", "再确认一次。")).firstMatch
        let latestVisible = waitForVisibleInConversation(latestMessage, timeout: 10)
        if !latestVisible { capture("native-heavy-history-not-visible") }
        XCTAssertTrue(latestVisible, "Restored history must show its final answer before the user touches the scroll view. \(app.debugDescription)")
        let earlyMessage = app.descendants(matching: .any)["chat.message.review-heavy-0"].firstMatch
        XCTAssertFalse(isVisibleInConversation(earlyMessage))
        XCTAssertFalse(app.buttons["chat.latest"].exists)
        capture("native-heavy-history-cold-launch")

        _ = openSidebar()
        if !app.buttons["session.select.review-second"].exists {
            app.buttons["sidebar.group.mobile"].tap()
        }
        app.buttons["session.select.review-second"].tap()
        XCTAssertTrue(waitForVisibleInConversation(staticText(containing: "会话内容。")))
        _ = openSidebar()
        app.buttons["session.select.review-heavy"].tap()
        XCTAssertTrue(
            waitForVisibleInConversation(latestMessage, timeout: 10),
            "Switching from short content to a tall history must settle without a swipe."
        )
        XCTAssertFalse(isVisibleInConversation(earlyMessage))
        XCTAssertFalse(app.buttons["chat.latest"].exists)
        capture("native-heavy-history-session-restored")
    }

    func testCachedHistoryRefreshesWithNewTurnsAndRemainsVisibleAfterSmallDrag() throws {
        let arguments = ["-dsbot-review-cache-id", UUID().uuidString, "-dsbot-review-heavy-history"]
        relaunchReviewApp(additionalArguments: arguments + ["-dsbot-review-heavy-cache-prefix"])
        XCTAssertTrue(waitForVisibleInConversation(staticText(containing: "再确认一次。"), timeout: 10))
        XCUIDevice.shared.press(.home)
        app.terminate()
        launchReviewApp(additionalArguments: arguments)
        let lastAnswer = chatHistory.otherElements["transcript:turn:turn-40"].staticTexts
            .matching(NSPredicate(format: "label CONTAINS %@", "再确认一次。")).firstMatch
        XCTAssertTrue(waitForVisibleInConversation(lastAnswer, timeout: 10))
        let history = chatHistory
        history.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
            .press(forDuration: 0.05, thenDragTo: history.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.65)))
        let visibleText = history.staticTexts.allElementsBoundByIndex.contains { isVisibleInConversation($0) }
        XCTAssertTrue(visibleText, "New turns must leave real message content in the viewport after a small drag.")
        capture("native-cache-refresh-new-turns")
    }

    func testLongHistoryLatestMarkerAndReadingPositionSurviveKeyboardOpening() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-long-history"])
        let endingText = staticText(containing: "长对话检查完成。")
        XCTAssertTrue(endingText.waitForExistence(timeout: 10))
        XCTAssertTrue(
            waitForVisibleInConversation(endingText, timeout: 10),
            "The final sentence must be visible after Markdown finishes laying out."
        )
        let earlyMessage = chatHistory.otherElements["transcript:user:review-long-54"]
        XCTAssertFalse(isVisibleInConversation(earlyMessage), "The initial view should be at the end of the long conversation.")
        XCTAssertFalse(app.buttons["chat.latest"].exists)
        capture("native-long-history-latest")

        let history = chatHistory
        XCTAssertTrue(history.waitForExistence(timeout: 5))
        for _ in 0..<12 where !isVisibleInConversation(earlyMessage) {
            history.swipeDown()
        }
        XCTAssertTrue(waitForVisibleInConversation(earlyMessage), "The long-history fixture should scroll back to an earlier message.")
        let readingTop = app.buttons["sidebar.toggle"].frame.maxY + 80
        if earlyMessage.frame.minY > readingTop + 80 {
            let start = history.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
            start.press(
                forDuration: 0.05,
                thenDragTo: start.withOffset(CGVector(dx: 0, dy: readingTop - earlyMessage.frame.minY)),
                withVelocity: .slow,
                thenHoldForDuration: 0.2
            )
        }
        XCTAssertTrue(waitForVisibleInConversation(earlyMessage))
        XCTAssertTrue(app.buttons["chat.latest"].waitForExistence(timeout: 5))
        XCTAssertFalse(isVisibleInConversation(endingText))
        let readingPosition = earlyMessage.frame.minY
        let readingViewport = history.frame

        app.descendants(matching: .any)["composer.text"].firstMatch.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        let readingVisible = waitForVisibleInConversation(earlyMessage)
        if !readingVisible { capture("native-reading-keyboard-position-failed") }
        XCTAssertTrue(readingVisible, "Reading marker: \(earlyMessage.frame), previous: \(readingPosition), viewport: \(history.frame), previous viewport: \(readingViewport).")
        XCTAssertLessThanOrEqual(abs(earlyMessage.frame.minY - readingPosition), 8)
        XCTAssertTrue(app.buttons["chat.latest"].exists)
        XCTAssertFalse(isVisibleInConversation(endingText), "Opening the keyboard must not jump the reader back to the latest message.")
        capture("native-long-history-keyboard-reading")

        app.buttons["composer.voice"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(waitForDisappearance(app.keyboards.firstMatch))
        XCTAssertTrue(waitForVisibleInConversation(earlyMessage))
        XCTAssertEqual(earlyMessage.frame.minY, readingPosition, accuracy: 8)
        XCTAssertTrue(app.buttons["chat.latest"].exists)
        XCTAssertFalse(isVisibleInConversation(endingText))
        app.buttons["composer.keyboard"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertEqual(earlyMessage.frame.minY, readingPosition, accuracy: 8)

        app.buttons["chat.latest"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(waitForVisibleInConversation(endingText, timeout: 10))
        XCTAssertTrue(waitForDisappearance(app.buttons["chat.latest"]))
        capture("native-long-history-jump-to-latest")
    }

    func testOrdinaryHistoryDragsFollowTheFingerAndRemainStillAfterRelease() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-long-history"])
        XCTAssertTrue(waitForVisibleInConversation(staticText(containing: "长对话检查完成。"), timeout: 10))
        let history = chatHistory
        for iteration in 0..<6 {
            let top = app.buttons["sidebar.toggle"].frame.maxY + 24
            let bottom = app.buttons["composer.plus"].frame.minY - 24
            let candidates = history.descendants(matching: .any).matching(
                NSPredicate(format: "identifier BEGINSWITH %@", "transcript:user:review-long-")
            ).allElementsBoundByIndex
            let visible = try XCTUnwrap(candidates.first {
                $0.frame.minY > top && $0.frame.maxY < bottom && $0.frame.height > 0
            })
            let marker = app.descendants(matching: .any)[visible.identifier].firstMatch
            let before = marker.frame.minY
            let start = history.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45))
            start.press(
                forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: 180)),
                withVelocity: .slow, thenHoldForDuration: 0.2
            )
            XCTAssertEqual(marker.frame.minY - before, 180, accuracy: 18,
                           "Ordinary dragging must not be cancelled by a layout correction.")
            XCTAssertTrue(app.buttons["chat.latest"].waitForExistence(timeout: 3))
            let settled = marker.frame.minY
            for _ in 0..<6 {
                Thread.sleep(forTimeInterval: 0.08)
                XCTAssertEqual(marker.frame.minY, settled, accuracy: 2,
                               "Static history must stay still after the finger is released.")
            }
            capture("native-ordinary-history-drag-\(iteration)")
        }
    }

    func testJumpFromTheStartOfHeavyHistoryReachesTheActualLastMessage() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-heavy-history", "-dsbot-review-history-start"])
        let first = staticText(containing: "第 1 个问题")
        XCTAssertTrue(waitForVisibleInConversation(first, timeout: 15))
        let ending = chatHistory.otherElements["transcript:turn:turn-40"].staticTexts
            .matching(NSPredicate(format: "label CONTAINS %@", "再确认一次。")).firstMatch
        XCTAssertFalse(isVisibleInConversation(ending))
        capture("native-heavy-history-start")
        tapCenter(app.buttons["chat.latest"])
        XCTAssertTrue(waitForVisibleInConversation(ending, timeout: 5))
        XCTAssertFalse(isVisibleInConversation(first))
        XCTAssertTrue(waitForDisappearance(app.buttons["chat.latest"]))
        capture("native-heavy-history-full-jump")
    }

    func testHeavyHistoryLatestRemainsAboveTheKeyboardAfterJumping() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-heavy-history", "-dsbot-review-goal"])
        let ending = chatHistory.otherElements["transcript:turn:turn-40"].staticTexts
            .matching(NSPredicate(format: "label CONTAINS %@", "再确认一次。")).firstMatch
        let latest = app.buttons["chat.latest"]
        XCTAssertTrue(waitForVisibleInConversation(ending, timeout: 15))
        for _ in 0..<3 {
            chatHistory.swipeDown()
        }
        XCTAssertTrue(latest.waitForExistence(timeout: 5))
        capture("native-heavy-history-before-jump")
        tapCenter(latest)
        XCTAssertTrue(waitForDisappearance(latest))
        let landed = waitForVisibleInConversation(ending)
        capture("native-heavy-history-after-jump")
        XCTAssertTrue(landed, "The jump must end at the latest message.")
        for iteration in 0..<3 {
            tapCenter(app.descendants(matching: .any)["composer.text"].firstMatch)
            XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
            let visible = waitForVisibleInConversation(ending)
            if !visible { capture("native-heavy-history-keyboard-failed-\(iteration)") }
            XCTAssertTrue(visible, "History: \(chatHistory.frame), goal: \(app.buttons["goal.banner"].frame).")
            XCTAssertLessThan(app.buttons["goal.banner"].frame.minY - ending.frame.maxY, 100)
            tapCenter(app.buttons["composer.voice"])
            XCTAssertTrue(waitForDisappearance(app.keyboards.firstMatch))
            tapCenter(app.buttons["composer.keyboard"])
            XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
            XCTAssertTrue(waitForVisibleInConversation(ending))
        }
        capture("native-heavy-history-keyboard")
    }

    func testKeyboardDismissalAtLatestDoesNotLeaveAGapAndCanFocusAgain() throws {
        relaunchReviewApp(additionalArguments: [
            "-dsbot-review-rich", "-dsbot-review-running", "-dsbot-review-streaming-fast"
        ])
        let input = app.descendants(matching: .any)["composer.text"].firstMatch
        let running = chatHistory.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH %@", "running:")).firstMatch
        XCTAssertTrue(waitForVisibleInConversation(running, timeout: 15))
        for iteration in 0..<3 {
            input.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: iteration.isMultiple(of: 2) ? 0.15 : 0.85)).tap()
            XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 4))
            let replyVisibleWithKeyboard = waitForVisibleInConversation(running)
            if !replyVisibleWithKeyboard { capture("native-keyboard-focus-reply-position-failed-\(iteration)") }
            XCTAssertTrue(replyVisibleWithKeyboard, "Status: \(running.frame), viewport: \(chatHistory.frame), composer: \(app.buttons["composer.plus"].frame).")
            let history = chatHistory
            let start = history.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45))
            start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: 220)),
                        withVelocity: .slow, thenHoldForDuration: 0.1)
            let keyboardDismissed = waitForDisappearance(app.keyboards.firstMatch, timeout: 5)
            if !keyboardDismissed { capture("native-keyboard-dismissal-failed-\(iteration)") }
            XCTAssertTrue(keyboardDismissed)
            let replyVisible = waitForVisibleInConversation(running)
            if !replyVisible { capture("native-keyboard-reply-position-failed-\(iteration)") }
            XCTAssertTrue(replyVisible, "Dismissing the keyboard at the end must keep the live reply in view.")
            XCTAssertFalse(app.buttons["chat.latest"].exists)
            let bottomGap = app.buttons["composer.plus"].frame.minY - running.frame.maxY
            if bottomGap >= 80 { capture("native-keyboard-bottom-gap-\(iteration)") }
            XCTAssertLessThan(bottomGap, 80,
                              "The keyboard must not leave an empty keyboard-sized gap below the reply.")
        }
        capture("native-fast-stream-keyboard-dismissal")
    }

    func testFastStreamingKeepsTheRunningStatusVisibleThroughoutUpdates() throws {
        relaunchReviewApp(additionalArguments: [
            "-dsbot-review-rich", "-dsbot-review-running", "-dsbot-review-streaming-fast"
        ])
        let running = chatHistory.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH %@", "running:")).firstMatch
        let statusVisible = waitForVisibleInConversation(running, timeout: 15)
        if !statusVisible { capture("native-fast-stream-initial-status-missing") }
        XCTAssertTrue(statusVisible, app.debugDescription)
        let initialBottomGap = app.buttons["composer.plus"].frame.minY - running.frame.maxY
        for sample in 0..<24 {
            Thread.sleep(forTimeInterval: 0.25)
            if !isVisibleInConversation(running) {
                capture("native-streaming-position-jumped-\(sample)")
                XCTFail(
                    "Streaming must keep the running status visible. Status: \(running.frame), " +
                    "toolbar: \(app.buttons["sidebar.toggle"].frame), composer: \(app.buttons["composer.plus"].frame)."
                )
                return
            }
            XCTAssertEqual(
                app.buttons["composer.plus"].frame.minY - running.frame.maxY, initialBottomGap, accuracy: 4,
                "Streaming must preserve the reply's position relative to the composer."
            )
            XCTAssertFalse(app.buttons["chat.latest"].exists)
        }
        capture("native-fast-stream-stable")
    }

    func testMultilineComposerCapsItsHeightAndShrinksWithoutLosingKeyboardFocus() throws {
        let input = app.descendants(matching: .any)["composer.text"].firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        input.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        let text = (1...8).map { "Draft line \($0)" }.joined(separator: "\n")
        input.typeText(text)
        XCTAssertEqual(input.value as? String, text)
        XCTAssertGreaterThan(input.frame.height, 100)
        XCTAssertLessThanOrEqual(input.frame.height, 123)
        XCTAssertLessThan(input.frame.maxY, app.keyboards.firstMatch.frame.minY)
        input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: text.count))
        XCTAssertTrue((input.value as? String ?? "").isEmpty)
        XCTAssertLessThanOrEqual(input.frame.height, 46)
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        input.typeText("continue")
        XCTAssertEqual(input.value as? String, "continue")
        XCTAssertTrue(app.buttons["composer.send"].exists)
        capture("native-multiline-composer-shrunk")
    }

    func testUserMessageLongPressCopiesTextWithoutTheOldFooter() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-message-actions"])
        let text = "测试复制和选择，保留换行。\n这是第二行。"
        let message = staticText(containing: "测试复制和选择")
        XCTAssertTrue(waitForVisibleInConversation(message, timeout: 10))
        XCTAssertFalse(app.buttons["复制"].exists)
        message.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 1.2)
        let copy = app.buttons["message.copy"]
        XCTAssertTrue(copy.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["message.select"].exists)
        capture("native-user-message-menu")
        copy.tap()
        XCTAssertTrue(waitForDisappearance(copy))

        let input = app.descendants(matching: .any)["composer.text"].firstMatch
        input.tap()
        input.press(forDuration: 1.2)
        let paste = app.menuItems.matching(NSPredicate(format: "label IN %@", ["Paste", "粘贴"])).firstMatch
        XCTAssertTrue(paste.waitForExistence(timeout: 5))
        paste.tap()
        XCTAssertEqual(input.value as? String, text)
    }

    func testAssistantMessageLongPressOpensNativeTextSelection() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-message-actions"])
        let message = staticText(containing: "和选择文字")
        XCTAssertTrue(waitForVisibleInConversation(message, timeout: 10))
        XCTAssertFalse(app.buttons["复制"].exists)
        message.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 1.2)
        let select = app.buttons["message.select"]
        XCTAssertTrue(select.waitForExistence(timeout: 5))
        capture("native-assistant-message-menu")
        select.tap()

        let selection = app.textViews["message.selection.text"]
        XCTAssertTrue(selection.waitForExistence(timeout: 5))
        XCTAssertEqual(selection.value as? String, "支持 **复制** 和选择文字。\n\n- 保留换行\n- 保留代码 `value`")
        selection.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.04)).press(forDuration: 1.2)
        let copy = app.menuItems.matching(NSPredicate(format: "label IN %@", ["Copy", "复制", "拷贝"])).firstMatch
        XCTAssertTrue(copy.waitForExistence(timeout: 5))
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        capture("native-message-text-selection")
        app.buttons["message.selection.close"].tap()
        XCTAssertTrue(waitForDisappearance(selection))
        XCTAssertTrue(waitForVisibleInConversation(message))
    }

    func testConversationTimesAreCenteredAboveMessageGroups() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-message-actions"])
        let first = app.staticTexts["chat.timestamp.user:review-menu-question"]
        let second = app.staticTexts["chat.timestamp.user:review-menu-question-2"]
        XCTAssertTrue(first.waitForExistence(timeout: 10))
        XCTAssertTrue(second.waitForExistence(timeout: 5))
        let timestamps = app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH %@", "chat.timestamp."))
        XCTAssertEqual(timestamps.count, 2)
        XCTAssertEqual(first.frame.midX, app.frame.midX, accuracy: 2)
        XCTAssertEqual(second.frame.midX, app.frame.midX, accuracy: 2)
        XCTAssertLessThan(first.frame.maxY, staticText(containing: "测试复制和选择").frame.minY)
        XCTAssertLessThan(second.frame.maxY, app.staticTexts["继续。"].frame.minY)
        XCTAssertFalse(app.buttons["复制"].exists)
        capture("native-message-time-groups")
    }

    func testBottomWithGoalAndPendingReplyHidesLatestAfterDragging() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-rich", "-dsbot-review-running",
                                                "-dsbot-review-goal", "-dsbot-review-awaiting-reply"])
        XCTAssertTrue(app.buttons["composer.stop"].waitForExistence(timeout: 10))
        XCTAssertTrue(waitForVisibleInConversation(staticText(containing: "这些方案你能在你电脑上测试吗?")))
        let latest = app.buttons["chat.latest"]
        XCTAssertTrue(waitForDisappearance(latest))
        let history = chatHistory
        XCTAssertTrue(history.waitForExistence(timeout: 5))
        history.swipeDown()
        capture("native-goal-pending-reply-after-drag")
        XCTAssertTrue(waitForDisappearance(latest))
        history.swipeUp()
        XCTAssertTrue(waitForDisappearance(latest))
        XCTAssertTrue(app.buttons["composer.stop"].exists)
    }

    func testStreamingReplyHidesLatestAtTheEndAndResumesAfterScrollingBack() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-rich", "-dsbot-review-running", "-dsbot-review-streaming"])
        let stop = app.buttons["composer.stop"]
        let latest = app.buttons["chat.latest"]
        let runningStatus = app.descendants(matching: .any)["chat.running"].firstMatch
        XCTAssertTrue(stop.waitForExistence(timeout: 10))
        XCTAssertTrue(waitForVisibleInConversation(staticText(containing: "流式输出第 3 段"), timeout: 10))
        XCTAssertTrue(waitForVisibleInConversation(runningStatus))
        let initialReplyHeight = chatHistory.otherElements["transcript:turn:turn-2"].frame.height
        XCTAssertFalse(latest.exists)
        capture("native-streaming-at-end")

        let history = chatHistory
        history.swipeUp()
        XCTAssertFalse(latest.exists, "Dragging against the bottom during a reply must not leave the latest button visible.")
        history.swipeDown()
        XCTAssertTrue(latest.waitForExistence(timeout: 5))
        XCTAssertTrue(stop.exists)
        let readingAnchor = staticText(containing: "这些方案你能在你电脑上测试吗?")
        XCTAssertTrue(waitForVisibleInConversation(readingAnchor))
        let readingPosition = readingAnchor.frame.minY
        for _ in 0..<6 {
            Thread.sleep(forTimeInterval: 0.5)
            XCTAssertTrue(latest.exists)
            XCTAssertEqual(readingAnchor.frame.minY, readingPosition, accuracy: 8)
        }
        capture("native-streaming-reading-history")

        for _ in 0..<8 where latest.exists {
            history.swipeUp()
        }
        XCTAssertTrue(waitForDisappearance(latest))
        XCTAssertTrue(waitForVisibleInConversation(runningStatus))
        XCTAssertGreaterThan(chatHistory.otherElements["transcript:turn:turn-2"].frame.height, initialReplyHeight + 100)
        XCTAssertTrue(waitForVisibleInConversation(runningStatus))
        XCTAssertFalse(latest.exists, "The reply must keep following new output after manually reaching the bottom.")
        capture("native-streaming-returned-to-end")

        history.swipeDown()
        XCTAssertTrue(latest.waitForExistence(timeout: 5))
        latest.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(waitForDisappearance(latest))
        XCTAssertTrue(stop.exists)
    }

    func testRunningTurnOffersSendForADraftAndStopWhenEmpty() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-rich", "-dsbot-review-running"])
        let stop = app.buttons["composer.stop"]
        XCTAssertTrue(stop.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["chat.latest"].exists)
        let input = app.descendants(matching: .any)["composer.text"].firstMatch
        input.tap()
        let draft = "Follow up while running"
        input.typeText(draft)
        let send = app.buttons["composer.send"]
        XCTAssertTrue(send.waitForExistence(timeout: 5))
        XCTAssertTrue(send.isEnabled)
        XCTAssertFalse(stop.exists)
        capture("native-send-while-running")
        input.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: draft.count))
        XCTAssertTrue(stop.waitForExistence(timeout: 5))
        XCTAssertFalse(send.exists)
        input.typeText("  ")
        XCTAssertTrue(stop.exists)
        XCTAssertFalse(send.exists)
        stop.tap()
        XCTAssertTrue(waitForDisappearance(stop, timeout: 10))
    }

    func testRunningTurnSendsAFollowUpAndReturnsToStop() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-running"])
        let stop = app.buttons["composer.stop"]
        XCTAssertTrue(stop.waitForExistence(timeout: 10))
        let input = app.descendants(matching: .any)["composer.text"].firstMatch
        input.tap()
        let text = "Follow up without stopping"
        input.typeText(text)
        let send = app.buttons["composer.send"]
        XCTAssertTrue(send.waitForExistence(timeout: 5))
        send.tap()
        XCTAssertTrue(staticText(containing: text).waitForExistence(timeout: 10))
        XCTAssertTrue(stop.waitForExistence(timeout: 10))
        XCTAssertFalse(send.exists)
        XCTAssertTrue(app.descendants(matching: .any)["chat.running"].exists)
        capture("native-follow-up-while-running")
    }

    func testConversationImageIsASeparateThumbnailAndOpensFullScreen() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-chat-image"])
        let image = app.buttons["chat.image.review-question.0"]
        XCTAssertTrue(image.waitForExistence(timeout: 10))
        for _ in 0..<4 where !isVisibleInConversation(image) {
            chatHistory.swipeDown()
        }
        XCTAssertTrue(waitForVisibleInConversation(image))
        XCTAssertTrue(image.isEnabled)
        XCTAssertLessThanOrEqual(image.frame.width, 260)
        XCTAssertGreaterThan(image.frame.height, 150)
        capture("native-conversation-image")
        image.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let close = app.buttons["photo.preview.close"]
        XCTAssertTrue(close.waitForExistence(timeout: 5))
        capture("native-conversation-image-preview")
        close.tap()
        XCTAssertTrue(waitForDisappearance(close))
    }

    func testVoiceAndKeyboardModesToggleRepeatedlyWithComposerControlsAccessible() throws {
        let voiceToggle = app.buttons["composer.voice"]
        XCTAssertTrue(voiceToggle.waitForExistence(timeout: 30))
        XCTAssertGreaterThanOrEqual(voiceToggle.frame.width, 38)
        XCTAssertGreaterThanOrEqual(voiceToggle.frame.height, 42)

        for _ in 0..<2 {
            tapCenter(voiceToggle)
            let hold = app.buttons["composer.hold"]
            XCTAssertTrue(hold.waitForExistence(timeout: 5))
            XCTAssertFalse(app.descendants(matching: .any)["composer.text"].exists)
            let keyboardToggle = app.buttons["composer.keyboard"]
            XCTAssertTrue(keyboardToggle.exists)
            XCTAssertGreaterThanOrEqual(keyboardToggle.frame.width, 38)
            XCTAssertGreaterThanOrEqual(keyboardToggle.frame.height, 42)
            XCTAssertEqual(hold.frame.midY, keyboardToggle.frame.midY, accuracy: 1)
            capture("native-hold-to-talk-bar")

            tapCenter(keyboardToggle)
            XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
            XCTAssertTrue(app.descendants(matching: .any)["composer.text"].firstMatch.waitForExistence(timeout: 5))
            XCTAssertFalse(app.buttons["composer.hold"].exists)
        }

        let input = app.descendants(matching: .any)["composer.text"].firstMatch
        input.typeText("draft")
        XCTAssertTrue(app.buttons["composer.send"].waitForExistence(timeout: 5), "A draft replaces the voice toggle with send.")
        XCTAssertFalse(app.buttons["composer.voice"].exists)
        capture("native-keyboard")

        app.buttons["composer.plus"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let modelMenu = app.buttons["composer.menu.model"]
        XCTAssertTrue(modelMenu.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["composer.menu.permission"].exists)
        XCTAssertTrue(app.buttons["composer.photos"].exists)
        capture("native-composer-menu")
        modelMenu.tap()
        let reasonerChoice = app.buttons["composer.model.deepseek-reasoner"]
        XCTAssertTrue(reasonerChoice.waitForExistence(timeout: 5))
        XCTAssertEqual(reasonerChoice.label, "DeepSeek · 深度思考")
        XCTAssertTrue(app.buttons["composer.model.deepseek"].exists)
        capture("native-composer-model-options")
        reasonerChoice.tap()
        XCTAssertTrue(waitForDisappearance(reasonerChoice), "Choosing a model closes the sheet.")

        app.buttons["composer.plus"].tap()
        app.buttons["composer.menu.model"].tap()
        let selectedReasoner = app.buttons["composer.model.deepseek-reasoner"]
        XCTAssertTrue(selectedReasoner.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["composer.model.deepseek"].exists)
        capture("native-composer-model-selected")
        app.buttons["composer.sheet.back"].tap()
        XCTAssertTrue(app.buttons["composer.menu.permission"].waitForExistence(timeout: 5))
        app.buttons["composer.menu.permission"].tap()
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'composer.permission.'")).firstMatch
                .waitForExistence(timeout: 5)
        )
        capture("native-composer-permission-options")
    }

    func testPressingHoldToTalkReplacesComposerWithGlowAndCancelTurnsRed() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-voice-press"])
        let overlay = app.descendants(matching: .any)["voice.overlay.recording"]
        XCTAssertTrue(overlay.waitForExistence(timeout: 10))
        XCTAssertGreaterThanOrEqual(overlay.frame.height, 300)
        capture("native-voice-press")

        relaunchReviewApp(additionalArguments: ["-dsbot-review-voice-cancel"])
        let cancel = app.descendants(matching: .any)["voice.overlay.cancel"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 10))
        capture("native-voice-cancel")
    }

    @discardableResult
    private func enterHoldToTalk() -> XCUIElement {
        let toggle = app.buttons["composer.voice"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 30))
        tapCenter(toggle)
        let hold = app.buttons["composer.hold"]
        let enteredVoiceMode = hold.waitForExistence(timeout: 5)
        if !enteredVoiceMode {
            capture("native-voice-mode-toggle-failed")
        }
        XCTAssertTrue(enteredVoiceMode)
        return hold
    }

    func testVoiceHoldSendsRecognizedTranscript() throws {
        let voice = enterHoldToTalk()
        voice.press(forDuration: 0.5)

        let overlay = app.descendants(matching: .any)["voice.overlay.recording"]
        XCTAssertTrue(waitForDisappearance(overlay, timeout: 5))
        XCTAssertTrue(app.staticTexts["继续优化手机界面"].waitForExistence(timeout: 5))
        capture("native-voice-sent")
    }

    func testVoiceHoldWithSmallUpwardDriftStillSends() throws {
        let voice = enterHoldToTalk()
        let start = voice.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        start.press(
            forDuration: 0.4,
            thenDragTo: start.withOffset(CGVector(dx: 0, dy: -100)),
            withVelocity: .slow,
            thenHoldForDuration: 0.1
        )
        XCTAssertTrue(app.staticTexts["继续优化手机界面"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["message.copy"].exists)
        XCTAssertTrue(waitForDisappearance(app.descendants(matching: .any)["voice.overlay.recording"]))
    }

    func testVoiceHoldWithSlowCaptureInLongConversationStillSends() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-heavy-history", "-dsbot-review-delayed-speech"])
        let voice = enterHoldToTalk()
        voice.press(forDuration: 1.2)
        XCTAssertTrue(app.staticTexts["继续优化手机界面"].waitForExistence(timeout: 5))
        XCTAssertTrue(waitForDisappearance(app.descendants(matching: .any)["voice.overlay.recording"]))
    }

    func testVoiceHoldAboveScrolledMessagesDoesNotOpenTheirContextMenu() throws {
        try assertVoiceHoldAboveScrolledMessages(at: CGVector(dx: 0.1, dy: 0.5))
    }

    func testVoiceHoldNearBarEdgeDoesNotOpenMessageContextMenu() throws {
        try assertVoiceHoldAboveScrolledMessages(at: CGVector(dx: 0.98, dy: 0.98))
    }

    private func assertVoiceHoldAboveScrolledMessages(at point: CGVector) throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-long-history", "-dsbot-review-delayed-speech"])
        let voice = enterHoldToTalk()
        chatHistory.swipeDown(velocity: .slow)
        XCTAssertTrue(app.buttons["chat.latest"].waitForExistence(timeout: 5))
        voice.coordinate(withNormalizedOffset: point).press(forDuration: 1.2)
        capture("native-voice-hold-above-history")
        XCTAssertFalse(app.buttons["message.copy"].exists, "The hold surface must consume the press above the transcript.")
        XCTAssertFalse(app.buttons["message.select"].exists)
        let latest = app.buttons["chat.latest"]
        if latest.exists { tapCenter(latest) }
        XCTAssertTrue(app.staticTexts["继续优化手机界面"].waitForExistence(timeout: 5))
        capture("native-voice-sent-above-history")
    }

    func testVoiceSwipeUpCancelsWithoutSending() throws {
        let voice = enterHoldToTalk()
        let start = voice.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let target = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.55))
        start.press(
            forDuration: 0.4,
            thenDragTo: target,
            withVelocity: .slow,
            thenHoldForDuration: 0.1
        )

        XCTAssertTrue(app.buttons["composer.hold"].waitForExistence(timeout: 5))
        XCTAssertTrue(waitForDisappearance(
            app.descendants(matching: .any)["voice.overlay.recording"],
            timeout: 5
        ))
        XCTAssertFalse(app.staticTexts["继续优化手机界面"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["voice.overlay.recording"].exists)
    }

    func testSilentVoiceRecognitionFinishesWithoutBannerOrMessage() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-silent"])
        let voice = enterHoldToTalk()
        voice.press(forDuration: 0.5)

        let overlay = app.descendants(matching: .any)["voice.overlay.recording"]
        XCTAssertTrue(waitForDisappearance(overlay, timeout: 5))
        XCTAssertFalse(app.staticTexts["继续优化手机界面"].exists)
        XCTAssertFalse(app.buttons["关闭提示"].exists)
    }

    // MARK: Conversation menu and edge swipe

    func testConversationMenuListsDSHViewsWithoutResourcesAndOpensWebPages() throws {
        let menu = app.buttons["conversation.menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 30))
        menu.tap()
        // The views DSH registers, including one a third-party plugin adds.
        for title in ["对话", "轨迹", "上下文", "编队", "笔记"] {
            XCTAssertTrue(app.buttons[title].firstMatch.waitForExistence(timeout: 5), "Missing menu item: \(title)")
        }
        XCTAssertFalse(app.buttons["resources.open"].exists)
        XCTAssertFalse(app.buttons["工作区文件"].exists)
        XCTAssertFalse(app.buttons["新建终端"].exists)
        capture("native-conversation-menu")
        app.buttons["编队"].tap()
        let page = app.webViews.firstMatch
        XCTAssertTrue(page.waitForExistence(timeout: 10))
        XCTAssertTrue(page.staticTexts["暂无编队"].waitForExistence(timeout: 10))
        _ = openSidebar()
        XCTAssertFalse(app.buttons["library.mode.编队"].exists, "The sidebar no longer carries the view rows.")
    }

    func testSwipingFromTheLeftEdgeOpensTheSidebarButMidScreenDragsDoNot() throws {
        XCTAssertTrue(app.buttons["sidebar.toggle"].waitForExistence(timeout: 30))
        func point(_ x: CGFloat) -> XCUICoordinate {
            app.coordinate(withNormalizedOffset: CGVector(dx: x, dy: 0.45))
        }

        point(0.4).press(forDuration: 0.05, thenDragTo: point(0.9))
        XCTAssertFalse(app.buttons["computers.open"].exists, "A drag that starts inside the chat is not a drawer gesture.")

        point(0.005).press(forDuration: 0.05, thenDragTo: point(0.12), withVelocity: .slow, thenHoldForDuration: 0.3)
        XCTAssertTrue(waitForDisappearance(app.buttons["computers.open"]), "A short pull from the edge springs back.")

        point(0.005).press(forDuration: 0.05, thenDragTo: point(0.8))
        XCTAssertTrue(app.buttons["computers.open"].waitForExistence(timeout: 5), "Pulling from the edge opens the sidebar.")
        XCTAssertTrue(app.buttons["sidebar.backdrop"].waitForExistence(timeout: 5))
        capture("native-edge-swipe-sidebar")
    }

    // MARK: DSH commands from the "+" sheet

    func testSheetOffersDSHCommandsAndCompactRunsWithoutFurtherPrompts() throws {
        let plus = app.buttons["composer.plus"]
        XCTAssertTrue(plus.waitForExistence(timeout: 30))
        plus.tap()
        for identifier in ["composer.photos", "composer.files", "composer.goal", "composer.plan", "composer.compact",
                           "composer.menu.permission", "composer.menu.model"] {
            XCTAssertTrue(app.buttons[identifier].waitForExistence(timeout: 5), "Missing sheet entry: \(identifier)")
        }
        capture("native-sheet-commands")

        let compact = app.buttons["composer.compact"]
        compact.tap()
        XCTAssertTrue(waitForDisappearance(compact), "Compact closes the sheet and runs straight away.")
        let row = app.buttons["chat.command.header"]
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        XCTAssertTrue(row.label.contains("已压缩 14 条历史记录"), "Compaction row: \(row.label)")
        XCTAssertFalse(staticText(containing: "对话摘要").exists, "The summary stays folded until the row is tapped.")
        capture("native-compact-row")

        // Like DSH, the row opens to show what the compaction kept.
        row.tap()
        XCTAssertTrue(staticText(containing: "整理手机端的输入区").waitForExistence(timeout: 5))
        capture("native-compact-row-open")
        row.tap()
        XCTAssertTrue(waitForDisappearance(staticText(containing: "整理手机端的输入区")))
    }

    func testOlderDesktopPluginExplainsThatCommandsNeedAnUpdate() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-commands-unsupported"])
        let plus = app.buttons["composer.plus"]
        XCTAssertTrue(plus.waitForExistence(timeout: 30))
        let composerY = plus.frame.minY
        plus.tap()
        let compact = app.buttons["composer.compact"]
        XCTAssertTrue(compact.waitForExistence(timeout: 5))
        compact.tap()
        XCTAssertTrue(staticText(containing: "请先在电脑上更新 Dudu 插件").waitForExistence(timeout: 10))
        let feedback = app.descendants(matching: .any)["feedback.toast"].firstMatch
        XCTAssertTrue(feedback.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(feedback.frame.minY, app.buttons["sidebar.toggle"].frame.maxY)
        XCTAssertGreaterThan(app.staticTexts["feedback.message"].frame.height, 24)
        XCTAssertEqual(plus.frame.minY, composerY, accuracy: 1)
        XCTAssertFalse(app.descendants(matching: .any)["composer.compacting"].exists)
        capture("native-command-needs-update")
        app.buttons["feedback.dismiss"].tap()
        XCTAssertTrue(waitForDisappearance(feedback))
        plus.tap()
        XCTAssertTrue(app.buttons["composer.compact"].waitForExistence(timeout: 5))
    }

    func testCompactionProgressOnlyAppearsInTheConversation() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-slow-compact"])
        app.buttons["composer.plus"].tap()
        app.buttons["composer.compact"].tap()
        let progress = app.descendants(matching: .any)["chat.command.command:review-compact-running"].firstMatch
        XCTAssertTrue(progress.waitForExistence(timeout: 2))
        XCTAssertTrue(progress.label.contains("正在压缩"))
        XCTAssertFalse(app.descendants(matching: .any)["composer.compacting"].exists)
        XCTAssertFalse(app.buttons["chat.command.header"].exists)
        capture("native-compaction-single-progress")
        let row = app.buttons["chat.command.header"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        XCTAssertTrue(row.label.contains("已压缩"))
    }

    func testGoalIsSetFromTheSheetAndManagedFromTheBannerAboveTheComposer() throws {
        let plus = app.buttons["composer.plus"]
        XCTAssertTrue(plus.waitForExistence(timeout: 30))
        plus.tap()
        let goalRow = app.buttons["composer.goal"]
        XCTAssertTrue(goalRow.waitForExistence(timeout: 5))
        goalRow.tap()

        let token = app.buttons["composer.goal.token"]
        XCTAssertTrue(token.waitForExistence(timeout: 5), "The composer shows the /目标 token.")
        let input = app.descendants(matching: .any)["composer.text"].firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        capture("native-goal-mode")
        input.typeText("keep mobile and desktop in sync")
        app.buttons["composer.send"].tap()

        // The goal has a row of its own above the composer.
        let banner = app.buttons["goal.banner"]
        XCTAssertTrue(banner.waitForExistence(timeout: 10))
        XCTAssertTrue(banner.label.contains("进行中的目标"), "Banner: \(banner.label)")
        XCTAssertTrue(banner.label.contains("keep mobile and desktop in sync"))
        XCTAssertTrue(waitForDisappearance(token), "The token clears once the goal is set.")
        XCTAssertLessThan(banner.frame.maxY, app.buttons["composer.plus"].frame.minY, "The goal sits above the composer.")
        XCTAssertFalse(app.buttons["context.goal"].exists, "It is not a chip beside project and mode.")
        capture("native-goal-banner")

        app.buttons["goal.menu"].tap()
        let pause = app.buttons["暂停目标"]
        XCTAssertTrue(pause.waitForExistence(timeout: 5))
        pause.tap()
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "identifier == 'goal.banner' AND label CONTAINS '已暂停的目标'"))
                .firstMatch.waitForExistence(timeout: 10)
        )
        capture("native-goal-paused")

        app.buttons["goal.menu"].tap()
        let clear = app.buttons["清除目标"]
        XCTAssertTrue(clear.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["恢复目标"].exists)
        XCTAssertTrue(app.buttons["编辑目标"].exists)
        clear.tap()
        XCTAssertTrue(waitForDisappearance(banner, timeout: 10))
    }

    func testOperationFeedbackDoesNotMoveTheTasksGoalOrComposer() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-goal", "-dsbot-review-tasks", "-dsbot-review-tasks-open"])
        let goal = app.buttons["goal.banner"]
        let tasks = app.descendants(matching: .any)["tasks.panel"].firstMatch
        let plus = app.buttons["composer.plus"]
        XCTAssertTrue(goal.waitForExistence(timeout: 20))
        XCTAssertTrue(tasks.waitForExistence(timeout: 5))
        let goalY = goal.frame.minY
        let tasksY = tasks.frame.minY
        let composerY = plus.frame.minY

        app.buttons["goal.menu"].tap()
        app.buttons["暂停目标"].tap()
        let feedback = app.descendants(matching: .any)["feedback.toast"].firstMatch
        XCTAssertTrue(feedback.exists || feedback.waitForExistence(timeout: 5))
        let feedbackFrame = feedback.frame
        XCTAssertEqual(app.staticTexts["feedback.message"].label, "目标已暂停")
        capture("native-operation-feedback-success")
        XCTAssertGreaterThan(feedbackFrame.minY, app.buttons["sidebar.toggle"].frame.maxY)
        XCTAssertLessThan(feedbackFrame.maxY, tasks.frame.minY)
        XCTAssertEqual(goal.frame.minY, goalY, accuracy: 1)
        XCTAssertEqual(tasks.frame.minY, tasksY, accuracy: 1)
        XCTAssertEqual(plus.frame.minY, composerY, accuracy: 1)
        XCTAssertTrue(waitForDisappearance(feedback, timeout: 6))
        XCTAssertTrue(goal.label.contains("已暂停的目标"))
        XCTAssertEqual(plus.frame.minY, composerY, accuracy: 1)

        app.buttons["goal.menu"].tap()
        app.buttons["恢复目标"].tap()
        XCTAssertTrue(feedback.exists || feedback.waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["feedback.message"].label, "目标已继续")
        app.buttons["feedback.dismiss"].tap()
        XCTAssertTrue(waitForDisappearance(feedback))
        XCTAssertTrue(goal.label.contains("进行中的目标"))
    }

    func testEditingGoalUsesASheetAndPreservesTheMessageDraft() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-goal"])
        let banner = app.buttons["goal.banner"]
        XCTAssertTrue(banner.waitForExistence(timeout: 10))
        let originalBanner = banner.label
        let input = app.descendants(matching: .any)["composer.text"].firstMatch
        input.tap()
        input.typeText("保留这段聊天草稿")
        app.buttons["goal.menu"].tap()
        app.buttons["编辑目标"].tap()
        let editor = app.textViews["goal.editor.text"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        let originalObjective = try XCTUnwrap(editor.value as? String)
        XCTAssertFalse(originalObjective.isEmpty)
        XCTAssertTrue(originalBanner.contains(originalObjective))
        editor.typeText("\n取消的修改")
        app.buttons["goal.editor.cancel"].tap()
        XCTAssertTrue(waitForDisappearance(editor))
        XCTAssertEqual(banner.label, originalBanner)
        XCTAssertEqual(input.value as? String, "保留这段聊天草稿")
        XCTAssertFalse(app.buttons["composer.goal.token"].exists)

        app.buttons["composer.plus"].tap()
        app.buttons["composer.goal"].tap()
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        XCTAssertEqual(editor.value as? String, originalObjective)
        editor.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.8)).tap()
        editor.typeText("\n统一在弹层中编辑目标")
        capture("native-goal-editor")
        app.buttons["goal.editor.save"].tap()
        XCTAssertTrue(waitForDisappearance(editor, timeout: 10))
        XCTAssertTrue(app.buttons.matching(
            NSPredicate(format: "identifier == 'goal.banner' AND label CONTAINS '统一在弹层中编辑目标'")
        ).firstMatch.waitForExistence(timeout: 10))
        XCTAssertEqual(input.value as? String, "保留这段聊天草稿")
        XCTAssertFalse(app.buttons["composer.goal.token"].exists)
    }

    func testGoalExpansionKeepsTheLatestMessageAndComposerInPlace() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-goal", "-dsbot-review-long-history"])
        let ending = staticText(containing: "长对话检查完成。")
        XCTAssertTrue(waitForVisibleInConversation(ending, timeout: 10))
        let endingY = ending.frame.minY
        let goal = app.buttons["goal.banner"]
        let goalFrame = goal.frame
        let composerFrame = app.buttons["composer.plus"].frame

        goal.tap()
        XCTAssertGreaterThan(goal.frame.height, goalFrame.height + 20)
        XCTAssertEqual(goal.frame.maxY, goalFrame.maxY, accuracy: 1)
        XCTAssertEqual(ending.frame.minY, endingY, accuracy: 2)
        XCTAssertEqual(app.buttons["composer.plus"].frame, composerFrame)
        XCTAssertFalse(app.buttons["chat.latest"].exists)
        capture("native-goal-expanded-at-latest")

        goal.tap()
        XCTAssertEqual(goal.frame, goalFrame)
        XCTAssertEqual(ending.frame.minY, endingY, accuracy: 2)
        XCTAssertEqual(app.buttons["composer.plus"].frame, composerFrame)
        XCTAssertFalse(app.buttons["chat.latest"].exists)
    }

    func testGoalAndTaskExpansionPreserveTheReadingPositionAndRemainSeparated() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-goal", "-dsbot-review-tasks", "-dsbot-review-long-history"])
        XCTAssertTrue(waitForVisibleInConversation(staticText(containing: "长对话检查完成。"), timeout: 10))
        let history = chatHistory
        let earlierMessage = chatHistory.otherElements["transcript:user:review-long-54"]
        for _ in 0..<12 where !isVisibleInConversation(earlierMessage) {
            history.swipeDown()
        }
        XCTAssertTrue(waitForVisibleInConversation(earlierMessage))
        let readingY = earlierMessage.frame.minY
        let composerFrame = app.buttons["composer.plus"].frame
        let goal = app.buttons["goal.banner"]
        let goalFrame = goal.frame
        let panel = app.descendants(matching: .any)["tasks.panel"]
        let latest = app.buttons["chat.latest"]
        XCTAssertTrue(latest.waitForExistence(timeout: 5))

        goal.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertGreaterThan(goal.frame.height, goalFrame.height + 20)
        XCTAssertEqual(goal.frame.maxY, goalFrame.maxY, accuracy: 1)
        XCTAssertEqual(earlierMessage.frame.minY, readingY, accuracy: 2)
        XCTAssertLessThanOrEqual(panel.frame.maxY, goal.frame.minY)
        XCTAssertLessThanOrEqual(latest.frame.maxY, panel.frame.minY)
        XCTAssertEqual(app.buttons["composer.plus"].frame, composerFrame)

        app.buttons["tasks.toggle"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.scrollViews["tasks.list"].waitForExistence(timeout: 5))
        XCTAssertEqual(earlierMessage.frame.minY, readingY, accuracy: 2)
        XCTAssertLessThanOrEqual(panel.frame.maxY, goal.frame.minY)
        XCTAssertLessThanOrEqual(latest.frame.maxY, panel.frame.minY)
        XCTAssertEqual(app.buttons["composer.plus"].frame, composerFrame)
        capture("native-goal-and-tasks-expanded-while-reading")

        goal.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let collapsed = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in abs(goal.frame.minY - goalFrame.minY) <= 1 },
            object: nil
        )
        XCTAssertEqual(XCTWaiter.wait(for: [collapsed], timeout: 3), .completed)
        XCTAssertEqual(goal.frame.minY, goalFrame.minY, accuracy: 1)
        XCTAssertEqual(goal.frame.maxY, goalFrame.maxY, accuracy: 1)
        XCTAssertEqual(earlierMessage.frame.minY, readingY, accuracy: 2)
        XCTAssertLessThanOrEqual(panel.frame.maxY, goal.frame.minY)
        XCTAssertLessThanOrEqual(latest.frame.maxY, panel.frame.minY)
        app.buttons["tasks.toggle"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(waitForDisappearance(app.scrollViews["tasks.list"]))
        XCTAssertEqual(earlierMessage.frame.minY, readingY, accuracy: 2)
        XCTAssertEqual(app.buttons["composer.plus"].frame, composerFrame)
    }

    func testTheTaskListIsFoldedToItsCountsAndOpensToTheItems() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-tasks", "-dsbot-review-goal", "-dsbot-review-long-history"])
        let panel = app.descendants(matching: .any)["tasks.panel"]
        XCTAssertTrue(panel.waitForExistence(timeout: 20))
        let ending = staticText(containing: "长对话检查完成。")
        XCTAssertTrue(waitForVisibleInConversation(ending, timeout: 10))
        let endingY = ending.frame.minY
        let goal = app.buttons["goal.banner"]
        let goalFrame = goal.frame
        let composerFrame = app.buttons["composer.plus"].frame
        let toggle = app.buttons["tasks.toggle"]
        XCTAssertTrue(toggle.exists)
        // DSH's own words and counts, folded until opened.
        XCTAssertTrue(toggle.label.contains("任务"))
        XCTAssertTrue(toggle.label.contains("1 已完成"))
        XCTAssertTrue(toggle.label.contains("1 进行中"))
        XCTAssertTrue(toggle.label.contains("2 待处理"))
        XCTAssertFalse(app.descendants(matching: .any)["tasks.item.0"].exists)
        XCTAssertLessThan(panel.frame.maxY, app.buttons["composer.plus"].frame.minY, "The list sits above the composer.")
        capture("native-tasks-folded")

        toggle.tap()
        XCTAssertTrue(app.descendants(matching: .any)["tasks.item.0"].waitForExistence(timeout: 5))
        let lastItem = app.descendants(matching: .any)["tasks.item.3"]
        XCTAssertTrue(lastItem.exists)
        XCTAssertTrue(waitForVisibleInConversation(lastItem))
        XCTAssertTrue(app.scrollViews["tasks.list"].frame.contains(lastItem.frame))
        XCTAssertLessThanOrEqual(panel.frame.maxY - lastItem.frame.maxY, 24)
        XCTAssertTrue(goal.exists)
        XCTAssertGreaterThanOrEqual(goal.frame.minY - panel.frame.maxY, 0)
        XCTAssertLessThanOrEqual(goal.frame.minY - panel.frame.maxY, 12)
        XCTAssertFalse(app.buttons["chat.latest"].exists)
        XCTAssertEqual(ending.frame.minY, endingY, accuracy: 2)
        XCTAssertEqual(goal.frame, goalFrame)
        XCTAssertEqual(app.buttons["composer.plus"].frame, composerFrame)
        capture("native-tasks-open")
        toggle.tap()
        XCTAssertTrue(waitForDisappearance(app.descendants(matching: .any)["tasks.item.0"]))
        XCTAssertEqual(ending.frame.minY, endingY, accuracy: 2)
        XCTAssertEqual(goal.frame, goalFrame)
        XCTAssertEqual(app.buttons["composer.plus"].frame, composerFrame)
    }

    func testTaskExpansionPreservesTheReadingPositionAndKeepsLatestAboveThePanel() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-tasks", "-dsbot-review-goal", "-dsbot-review-long-history"])
        XCTAssertTrue(waitForVisibleInConversation(staticText(containing: "长对话检查完成。"), timeout: 10))
        let history = chatHistory
        let earlierMessage = chatHistory.otherElements["transcript:user:review-long-54"]
        for _ in 0..<12 where !isVisibleInConversation(earlierMessage) {
            history.swipeDown()
        }
        XCTAssertTrue(waitForVisibleInConversation(earlierMessage))
        let latest = app.buttons["chat.latest"]
        XCTAssertTrue(latest.waitForExistence(timeout: 5))
        let readingY = earlierMessage.frame.minY
        let toggle = app.buttons["tasks.toggle"]
        toggle.tap()
        let list = app.scrollViews["tasks.list"]
        XCTAssertTrue(list.waitForExistence(timeout: 5))
        XCTAssertEqual(earlierMessage.frame.minY, readingY, accuracy: 2)
        XCTAssertTrue(latest.exists)
        XCTAssertLessThanOrEqual(latest.frame.maxY, app.descendants(matching: .any)["tasks.panel"].frame.minY)
        capture("native-tasks-reading-expanded")
        toggle.tap()
        XCTAssertTrue(waitForDisappearance(list))
        XCTAssertEqual(earlierMessage.frame.minY, readingY, accuracy: 2)
        XCTAssertTrue(latest.exists)
    }

    func testLongTaskListScrollsInsideItsPanelAboveTheGoalAndComposer() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-tasks", "-dsbot-review-many-tasks",
                                                "-dsbot-review-tasks-open", "-dsbot-review-goal"])
        let panel = app.descendants(matching: .any)["tasks.panel"]
        XCTAssertTrue(panel.waitForExistence(timeout: 20))
        let list = app.scrollViews["tasks.list"]
        XCTAssertTrue(list.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(list.frame.height, 200)
        XCTAssertLessThanOrEqual(list.frame.height, 232)
        XCTAssertLessThanOrEqual(panel.frame.maxY, app.buttons["goal.banner"].frame.minY)
        let firstItem = app.descendants(matching: .any)["tasks.item.0"]
        XCTAssertTrue(list.frame.contains(firstItem.frame))
        let history = app.descendants(matching: .any)["chat.message.review-question"]
        let historyFrame = history.frame
        let lastItem = app.descendants(matching: .any)["tasks.item.19"]
        for _ in 0..<8 where !list.frame.contains(lastItem.frame) {
            list.swipeUp()
        }
        XCTAssertTrue(list.frame.contains(lastItem.frame))
        XCTAssertFalse(list.frame.intersects(firstItem.frame))
        XCTAssertLessThanOrEqual(list.frame.maxY - lastItem.frame.maxY, 24)
        XCTAssertEqual(history.frame, historyFrame)
        XCTAssertFalse(app.buttons["chat.latest"].exists)
        capture("native-tasks-long-list")
        app.buttons["tasks.toggle"].tap()
        XCTAssertTrue(waitForDisappearance(list))
        XCTAssertLessThanOrEqual(panel.frame.height, 48)
    }

    func testPlanModeImmediatelyUpdatesTheCheckedMenuWithoutAComposerBanner() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-goal", "-dsbot-review-deferred-plan-snapshot"])
        let plus = app.buttons["composer.plus"]
        XCTAssertTrue(plus.waitForExistence(timeout: 30))
        plus.tap()
        let planRow = app.buttons["composer.plan"]
        XCTAssertTrue(planRow.waitForExistence(timeout: 5))
        XCTAssertFalse(planRow.isSelected)
        planRow.tap()
        XCTAssertTrue(waitForDisappearance(planRow))
        XCTAssertFalse(app.descendants(matching: .any)["plan.banner"].exists)
        let goal = app.buttons["goal.banner"]
        XCTAssertTrue(goal.exists)
        XCTAssertFalse(app.buttons["composer.plan.chip"].exists)

        plus.tap()
        XCTAssertTrue(planRow.waitForExistence(timeout: 3))
        XCTAssertTrue(waitForSelection(true, on: planRow, timeout: 3))
        XCTAssertTrue(planRow.label.contains("退出计划模式"))
        capture("native-plan-mode-checked-menu")
        planRow.tap()
        XCTAssertTrue(waitForDisappearance(planRow))
        plus.tap()
        XCTAssertTrue(planRow.waitForExistence(timeout: 3))
        XCTAssertTrue(waitForSelection(false, on: planRow, timeout: 3))
        XCTAssertTrue(planRow.label.hasPrefix("计划，"))
        capture("native-plan-mode-disabled-menu")
    }

    func testPlanReviewCardOffersFullTextRevisionAndApproval() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-plan-review"])
        let card = app.descendants(matching: .any)["plan.review"]
        XCTAssertTrue(card.waitForExistence(timeout: 10))
        let approve = app.buttons["plan.approve"]
        XCTAssertTrue(approve.exists)
        XCTAssertTrue(app.buttons["plan.revise"].exists)
        XCTAssertGreaterThanOrEqual(approve.frame.height, 44, "Plan buttons stay easy to hit.")
        capture("native-plan-review")

        let full = app.buttons["plan.full"]
        XCTAssertTrue(waitForVisibleInConversation(full))
        tapCenter(full)
        let close = app.buttons["plan.full.close"]
        XCTAssertTrue(close.waitForExistence(timeout: 5))
        capture("native-plan-full")
        close.tap()
        XCTAssertTrue(waitForDisappearance(close))

        tapCenter(approve)
        XCTAssertTrue(waitForDisappearance(card, timeout: 10), "Approving removes the review card.")
    }

    func testPlanReviewReviseDeclinesThePlanAndFocusesTheComposer() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-plan-review"])
        let revise = app.buttons["plan.revise"]
        XCTAssertTrue(revise.waitForExistence(timeout: 10))
        tapCenter(revise)
        XCTAssertTrue(waitForDisappearance(app.descendants(matching: .any)["plan.review"], timeout: 10))
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "The user can say what to change right away.")
    }

    // MARK: Transcript

    func testParityQuestionsAcceptSingleMultipleAndTextAnswersWithoutReplacingDraft() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-parity", "-dsbot-review-questions"])
        let first = app.buttons["question.option.color.黑色"]
        XCTAssertTrue(first.waitForExistence(timeout: 10))
        tapCenter(first)
        tapCenter(app.buttons["question.submit"])
        tapCenter(app.buttons["question.option.targets.iOS"])
        tapCenter(app.buttons["question.option.targets.Mac"])
        tapCenter(app.buttons["question.submit"])
        let answer = app.descendants(matching: .any)["question.custom.name"].firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 5))
        tapCenter(answer)
        answer.typeText("report")
        tapCenter(app.buttons["question.submit"])
        XCTAssertTrue(waitForDisappearance(app.descendants(matching: .any)["chat.questions.parity-questions"]))
    }

    func testParityFileChangesOpenNativeDiffAndQueuedImagesPreview() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-parity", "-dsbot-review-queue-image"])
        let changes = app.descendants(matching: .any)["changes.toggle"].firstMatch
        XCTAssertTrue(changes.waitForExistence(timeout: 10))
        tapCenter(changes)
        let file = app.buttons["changes.file.0"]
        XCTAssertTrue(file.waitForExistence(timeout: 5))
        tapCenter(file)
        XCTAssertTrue(staticText(containing: "+新内容").waitForExistence(timeout: 5))
        XCTAssertTrue(staticText(containing: "-旧内容").exists)
        app.buttons["changes.diff.close"].tap()
        app.buttons["files.browser.close"].tap()
        let image = app.buttons["queue.image.queue:parity:0"]
        XCTAssertTrue(image.waitForExistence(timeout: 5))
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: image)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 5), .completed)
        tapCenter(image)
        XCTAssertTrue(app.buttons["photo.preview.close"].waitForExistence(timeout: 5))
        app.buttons["photo.preview.close"].tap()
        XCTAssertTrue(app.buttons["chat.file.parity-file"].exists)
    }

    func testLongDiffStartsAtTheLeadingEdgeAndKeepsLinesReadable() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-parity", "-dsbot-review-long-diff"])
        let changes = app.buttons["changes.toggle"]
        XCTAssertTrue(changes.waitForExistence(timeout: 10))
        XCTAssertTrue(staticText(containing: "已编辑 1 个文件").waitForExistence(timeout: 5))
        tapCenter(changes)
        tapCenter(app.buttons["changes.file.0"])
        let hunk = app.staticTexts["changes.diff.hunk.0"]
        let firstLine = app.staticTexts["changes.diff.line.0.0"]
        XCTAssertTrue(hunk.waitForExistence(timeout: 5))
        XCTAssertTrue(firstLine.exists)
        XCTAssertEqual(hunk.frame.minX, app.frame.minX + 16, accuracy: 2)
        XCTAssertLessThan(hunk.frame.height, 30)
        XCTAssertGreaterThan(firstLine.frame.width, app.frame.width * 2)
        XCTAssertGreaterThanOrEqual(firstLine.frame.minX, app.frame.minX + 16)
        XCTAssertLessThan(firstLine.frame.minX, app.frame.minX + app.frame.width / 4)
        capture("native-long-diff-leading-edge")
        let scroll = app.scrollViews["changes.diff"]
        let addition = staticText(containing: "+新内容")
        for _ in 0..<4 where !addition.isHittable { scroll.swipeUp() }
        XCTAssertTrue(addition.isHittable)
        XCTAssertGreaterThanOrEqual(addition.frame.minX, app.frame.minX)
        XCTAssertLessThan(addition.frame.minX, app.frame.midX)
        tapCenter(app.buttons["changes.diff.close"])
        XCTAssertTrue(waitForDisappearance(app.buttons["changes.diff.close"]))
        tapCenter(app.buttons["files.browser.close"])
        XCTAssertTrue(app.buttons["changes.toggle"].exists)
    }

    func testManyFilesStayCompactAndSearchOpensTheRecordedDiff() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-parity", "-dsbot-review-many-files"])
        let changes = app.buttons["changes.toggle"]
        XCTAssertTrue(changes.waitForExistence(timeout: 10))
        XCTAssertTrue(waitForLabel(changes, containing: "18"))
        XCTAssertTrue(app.buttons["files.presented.all"].exists)
        XCTAssertFalse(app.buttons["files.produced.all"].exists)
        XCTAssertFalse(app.buttons["chat.file.produced-0"].exists)
        XCTAssertTrue(app.buttons["chat.file.presented-2"].exists)
        XCTAssertFalse(app.buttons["chat.file.presented-3"].exists)
        capture("files-compact-conversation")
        tapCenter(changes)
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        capture("files-changes-browser")
        search.tap()
        search.typeText("module-17")
        let result = app.buttons["changes.file.17"]
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        XCTAssertGreaterThanOrEqual(result.frame.height, 44)
        XCTAssertFalse(app.buttons["changes.file.0"].exists)
        tapCenter(result)
        XCTAssertTrue(staticText(containing: "+new-17").waitForExistence(timeout: 5))
        XCTAssertTrue(staticText(containing: "-old-17").exists)
        capture("files-filtered-diff")
        tapCenter(app.buttons["changes.diff.close"])
        XCTAssertTrue(result.waitForExistence(timeout: 5))
        tapCenter(app.buttons["files.browser.close"])
        XCTAssertTrue(app.buttons["files.presented.all"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["chat.file.presented-3"].exists)
    }

    func testDeliveredFileBrowserFindsFilesBeyondTheInlinePreview() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-parity", "-dsbot-review-many-files"])
        let all = app.buttons["files.presented.all"]
        XCTAssertTrue(all.waitForExistence(timeout: 10))
        tapCenter(all)
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        capture("files-delivered-browser")
        search.tap()
        search.typeText("report-7")
        let browser = app.collectionViews["files.browser"]
        let file = browser.buttons["chat.file.presented-7"]
        XCTAssertTrue(file.waitForExistence(timeout: 5))
        XCTAssertFalse(browser.buttons["chat.file.presented-0"].exists)
        tapCenter(file)
        let content = app.descendants(matching: .any).matching(
            NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", "已验证", "已验证")
        ).firstMatch
        XCTAssertTrue(content.waitForExistence(timeout: 10))
    }

    func testUnavailableChangesDoNotAddAGeneratedFilesEntry() throws {
        relaunchReviewApp(additionalArguments: [
            "-dsbot-review-parity", "-dsbot-review-many-files", "-dsbot-review-changes-unavailable"
        ])
        XCTAssertTrue(app.buttons["重试"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["files.produced.all"].exists)
        XCTAssertFalse(app.buttons["chat.file.produced-19"].exists)
        XCTAssertTrue(app.buttons["files.presented.all"].exists)
        XCTAssertTrue(app.buttons["chat.file.presented-0"].exists)
    }

    func testParityOlderHistoryToolDetailsAndSessionPerformance() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-parity"])
        let older = app.buttons["chat.history.older"]
        XCTAssertTrue(chatHistory.waitForExistence(timeout: 10))
        for _ in 0..<4 where !isVisibleInConversation(older) { chatHistory.swipeDown() }
        XCTAssertTrue(older.exists)
        tapCenter(older)
        XCTAssertTrue(waitForDisappearance(older))
        chatHistory.swipeDown()
        XCTAssertTrue(staticText(containing: "更早的回复").waitForExistence(timeout: 5))
        tapCenter(app.buttons["chat.performance"])
        XCTAssertTrue(staticText(containing: "首 token 平均").waitForExistence(timeout: 5))
        XCTAssertTrue(staticText(containing: "输出速度").exists)
        app.buttons["完成"].tap()
        for _ in 0..<4 where !isVisibleInConversation(app.buttons["chat.process.header"]) {
            chatHistory.swipeUp()
        }
        tapCenter(app.buttons["chat.process.header"])
        let tool = app.buttons["chat.process.call"].firstMatch
        XCTAssertTrue(tool.waitForExistence(timeout: 5))
        tapCenter(tool)
        XCTAssertTrue(staticText(containing: "file_path").waitForExistence(timeout: 5))
        let output = app.textViews["tool.text.output"]
        XCTAssertTrue(output.waitForExistence(timeout: 5))
        XCTAssertTrue((output.value as? String)?.contains("完整工具输出") == true)
        let more = app.buttons["tool.more.output"]
        XCTAssertTrue(more.waitForExistence(timeout: 5))
        more.tap()
        let finished = waitForDisappearance(more)
        if !finished { capture("tool-pagination-incomplete") }
        XCTAssertTrue(finished, app.debugDescription)
    }

    func testParityMessageForkOpensTheReturnedConversation() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-parity"])
        let message = app.descendants(matching: .any)["chat.message.parity-answer"].firstMatch
        XCTAssertTrue(message.waitForExistence(timeout: 10))
        message.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(forDuration: 0.8)
        let fork = app.buttons["message.fork"]
        XCTAssertTrue(fork.waitForExistence(timeout: 5))
        fork.tap()
        let switched = waitForDisappearance(message)
        if !switched { capture("message-fork-incomplete") }
        XCTAssertTrue(switched, app.debugDescription)
        XCTAssertTrue(staticText(containing: "探索未至之境").waitForExistence(timeout: 5))
    }

    func testParityDeliveredFileOpensInTheSystemPreview() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-parity"])
        let file = app.buttons["chat.file.parity-file"]
        XCTAssertTrue(file.waitForExistence(timeout: 10))
        tapCenter(file)
        let content = app.descendants(matching: .any).matching(
            NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", "已验证", "已验证")
        ).firstMatch
        XCTAssertTrue(content.waitForExistence(timeout: 10))
        capture("conversation-generated-file-preview")
    }

    func testParityRetryDetailsAndDetailedPerformanceMode() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-parity"])
        tapCenter(app.descendants(matching: .any)["chat.notice.retry-parity"].firstMatch)
        XCTAssertTrue(staticText(containing: "HTTP 502").waitForExistence(timeout: 5))
        tapCenter(app.buttons["chat.performance"])
        app.segmentedControls.buttons["详细"].tap()
        app.buttons["完成"].tap()
        let usage = app.buttons["chat.performance.turn"]
        XCTAssertTrue(usage.waitForExistence(timeout: 5))
        tapCenter(usage)
        XCTAssertTrue(staticText(containing: "TTFT").waitForExistence(timeout: 5))
        app.buttons["完成"].tap()
        tapCenter(app.buttons["chat.performance"])
        app.segmentedControls.buttons["简洁"].tap()
        app.buttons["完成"].tap()
        XCTAssertTrue(waitForDisappearance(usage))
    }

    func testRichTranscriptShowsTurnDisclosureWithoutCustomUsageFooter() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-rich"])
        let header = app.buttons["chat.process.header"]
        XCTAssertTrue(header.waitForExistence(timeout: 10))
        XCTAssertTrue(header.label.hasPrefix("已完成，用时"), "Turn disclosure: \(header.label)")
        let command = app.buttons["chat.command.header"]
        XCTAssertTrue(command.waitForExistence(timeout: 5))
        XCTAssertTrue(command.label.contains("已压缩 348 条历史记录（约 192127 tokens）"), "Command row: \(command.label)")
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "用量 ")).firstMatch.exists)
        capture("native-transcript-rich-collapsed")

        header.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let group = app.buttons.matching(identifier: "chat.process.group").firstMatch
        XCTAssertTrue(group.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["chat.process.thought"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["chat.process.call"].firstMatch.exists)
        capture("native-transcript-rich-expanded")
    }

    func testQueuedMessageCanBeEditedRemovedAndSteeredWithoutReplacingDraft() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-queue", "-dsbot-review-running"])
        let menu = app.buttons["queue.menu.queued-desktop"]
        XCTAssertTrue(menu.waitForExistence(timeout: 10))
        let draft = app.descendants(matching: .any)["composer.text"].firstMatch
        draft.tap()
        draft.typeText("Keep this draft")
        menu.tap()
        app.buttons["queue.edit.queued-desktop"].tap()
        let editor = app.textViews["queue.editor.text"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.tap()
        editor.typeText(" updated")
        app.buttons["queue.editor.save"].tap()
        XCTAssertTrue(waitForDisappearance(editor))
        XCTAssertTrue(app.staticTexts["queue.text.queued-desktop"].label.contains("updated"))
        XCTAssertEqual(draft.value as? String, "Keep this draft")
        capture("native-queued-message")
        app.buttons["queue.steer.queued-desktop"].tap()
        XCTAssertTrue(waitForDisappearance(app.buttons["queue.steer.queued-desktop"]))
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "updated")).firstMatch.exists)
    }

    func testSendingWhileRunningAddsToSharedQueueAndQueueExpansionKeepsHistoryPosition() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-queue", "-dsbot-review-running", "-dsbot-review-goal"])
        let input = app.descendants(matching: .any)["composer.text"].firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        input.tap()
        input.typeText("Phone follow up")
        app.buttons["composer.send"].tap()
        XCTAssertTrue(waitForDisappearance(app.keyboards.firstMatch))
        let toggle = app.buttons["queue.toggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        let composerFrame = app.buttons["composer.plus"].frame
        toggle.tap()
        XCTAssertTrue(app.staticTexts["queue.text.queued-phone"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["composer.plus"].frame, composerFrame)
        capture("native-queued-messages-expanded")
        app.buttons["queue.menu.queued-phone"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        app.buttons["queue.remove.queued-phone"].tap()
        XCTAssertTrue(waitForDisappearance(toggle))
        XCTAssertTrue(app.staticTexts["queue.text.queued-desktop"].exists)
    }

    // MARK: Project, mode, model, permissions and attachments

    func testBlankConversationShowsTheGreetingAndTheProjectAndModeChips() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-blank-session"])
        XCTAssertTrue(app.descendants(matching: .any)["chat.empty"].waitForExistence(timeout: 20))
        for identifier in ["context.project", "context.mode"] {
            XCTAssertTrue(app.buttons[identifier].waitForExistence(timeout: 5), "Missing chip: \(identifier)")
        }
        XCTAssertFalse(app.buttons["context.model"].exists)
        XCTAssertFalse(app.staticTexts["预览版"].exists)
        capture("native-blank-conversation")
    }

    func testProjectChipMovesTheNewConversationToAnotherRegisteredProject() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-blank-session"])
        let project = app.buttons["context.project"]
        XCTAssertTrue(project.waitForExistence(timeout: 20))
        XCTAssertTrue(project.label.contains("dsbot"))
        project.tap()
        let other = app.buttons["context.project.notes"]
        XCTAssertTrue(other.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["context.project.add"].exists, "Adding a project stays on the desktop.")
        capture("native-project-picker")
        other.tap()
        XCTAssertTrue(waitForLabel(app.buttons["context.project"], containing: "日常"))
    }

    func testModeCanBeChosenOnlyBeforeTheFirstMessage() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-blank-session"])
        let mode = app.buttons["context.mode"]
        XCTAssertTrue(mode.waitForExistence(timeout: 20))
        XCTAssertTrue(mode.label.contains("标准模式"))
        mode.tap()
        let minimal = app.buttons["context.mode.minimal"]
        XCTAssertTrue(minimal.waitForExistence(timeout: 5))
        capture("native-mode-picker")
        minimal.tap()
        XCTAssertTrue(waitForLabel(app.buttons["context.mode"], containing: "极简模式"))

        // Once the conversation has begun, project and mode are fixed, so they are not shown at all.
        relaunchReviewApp()
        XCTAssertTrue(app.buttons["composer.plus"].waitForExistence(timeout: 20))
        XCTAssertFalse(app.buttons["context.mode"].exists)
        XCTAssertFalse(app.buttons["context.project"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["context.chips"].exists)
    }

    func testModelChipOpensTheModelAndItsReasoningLevelsTogether() throws {
        let chip = app.buttons["context.model"]
        XCTAssertTrue(chip.waitForExistence(timeout: 30))
        XCTAssertTrue(chip.label.contains("High"))
        chip.tap()
        XCTAssertTrue(app.buttons["composer.model.deepseek"].waitForExistence(timeout: 5))
        let max = app.buttons["composer.effort.max"]
        XCTAssertTrue(max.waitForExistence(timeout: 5))
        capture("native-model-and-effort")
        max.tap()
        XCTAssertTrue(waitForSelection(true, on: max), "Choosing a level marks it without closing the sheet.")
    }

    func testReasoningLevelIsAlsoReachableFromThePlusSheet() throws {
        let plus = app.buttons["composer.plus"]
        XCTAssertTrue(plus.waitForExistence(timeout: 30))
        plus.tap()
        let effort = app.buttons["composer.menu.effort"]
        XCTAssertTrue(effort.waitForExistence(timeout: 5))
        effort.tap()
        XCTAssertTrue(app.buttons["composer.effort.high"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["composer.effort.max"].exists)
    }

    func testPermissionNamesAreChineseAndFullAccessAsksFirst() throws {
        let plus = app.buttons["composer.plus"]
        XCTAssertTrue(plus.waitForExistence(timeout: 30))
        plus.tap()
        app.buttons["composer.menu.permission"].tap()
        let full = app.buttons["composer.permission.danger-full-access"]
        XCTAssertTrue(full.waitForExistence(timeout: 5))
        XCTAssertEqual(full.label, "完全权限")
        full.tap()
        let alert = app.alerts["确认启用完全权限？"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        capture("native-permission-confirm")
        alert.buttons["取消"].tap()
        XCTAssertTrue(waitForDisappearance(alert))
        XCTAssertTrue(full.exists, "Cancelling leaves the list open and the preset unchanged.")
    }

    func testPhotoAttachmentsShowAPreviewWithARemoveBadge() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-photo-tiles"])
        let preview = app.buttons["photo.preview.review-photo-1"]
        XCTAssertTrue(preview.waitForExistence(timeout: 20))
        XCTAssertGreaterThanOrEqual(preview.frame.width, 70, "A real thumbnail, not a chip.")
        capture("native-photo-tiles")
        app.buttons["photo.remove.review-photo-1"].tap()
        XCTAssertTrue(waitForDisappearance(preview))
        XCTAssertTrue(app.buttons["photo.preview.review-photo-2"].exists)
    }

    func testComposerStaysAboveTheKeyboardAfterChoosingTheGoalCommand() throws {
        let plus = app.buttons["composer.plus"]
        XCTAssertTrue(plus.waitForExistence(timeout: 30))
        plus.tap()
        let goal = app.buttons["composer.goal"]
        XCTAssertTrue(goal.waitForExistence(timeout: 5))
        goal.tap()
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 10))
        if app.buttons["Continue"].exists { app.buttons["Continue"].tap() }
        let input = app.descendants(matching: .any)["composer.text"].firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        input.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        input.typeText("keyboard check")
        XCTAssertEqual(input.value as? String, "keyboard check")
        // Give SwiftUI's own keyboard handling and the safeguard time to settle.
        Thread.sleep(forTimeInterval: 1.2)
        XCTAssertLessThanOrEqual(input.frame.maxY, keyboard.frame.minY + 1, "The input must not sit behind the keyboard.")
        capture("native-goal-with-keyboard")
    }

    func testRunningTurnShowsLiveStatusAndGoalTrigger() throws {
        relaunchReviewApp(additionalArguments: ["-dsbot-review-rich", "-dsbot-review-running", "-dsbot-review-goal"])
        let running = app.descendants(matching: .any)["chat.running"]
        XCTAssertTrue(running.waitForExistence(timeout: 10))
        let trigger = app.descendants(matching: .any)["chat.trigger.rich-goal-trigger"].firstMatch
        for _ in 0..<4 where !isVisibleInConversation(trigger) {
            chatHistory.swipeDown()
        }
        XCTAssertTrue(waitForVisibleInConversation(trigger))
        XCTAssertNil(trigger.label.range(of: "[0-9]{2}:[0-9]{2}", options: .regularExpression))
        XCTAssertTrue(app.staticTexts["chat.timestamp.trigger:rich-goal-trigger"].exists)
        XCTAssertTrue(app.buttons["goal.banner"].waitForExistence(timeout: 5))
        capture("native-transcript-running")
    }
}


/// Measured positions from the reference screenshots, in points on an iPhone Air.
private enum DSBotLayoutReference {
    /// The conversation runs to the bottom of the screen, so this is measured from the screen's edge.
    static let composerBottomDistance: CGFloat = 32
    static let toolbarTop: CGFloat = 68
}
