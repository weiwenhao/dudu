package app.dudu.android

import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import androidx.lifecycle.ViewModelProvider
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class HomeFlowTest {
    @get:Rule val compose = createEmptyComposeRule()
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private val context get() = instrumentation.targetContext
    private val origin get() = InstrumentationRegistry.getArguments().getString("fixtureOrigin")
        ?: error("Run through scripts/native-android.mjs --e2e")
    private lateinit var scenario: ActivityScenario<MainActivity>

    @Before fun start() {
        control("/fixture/reset", "POST")
        File(context.noBackupFilesDir, "dudu").deleteRecursively()
        scenario = ActivityScenario.launch(MainActivity::class.java)
        awaitTag("pairing-manual")
        screenshot("pairing")
        compose.onNodeWithTag("pairing-manual").performClick()
        awaitTag("pairing-link")
        compose.onNodeWithTag("pairing-link").performTextReplacement(
            "$origin/dsbot?pair=${"f".repeat(43)}&computer=android-e2e")
        compose.onNodeWithTag("connect").performScrollTo().performClick()
        awaitTag("row-issue:1")
    }

    @After fun stop() { scenario.close() }

    @Test fun scopesSwitchLocallyAndCachedHomeSurvivesRefreshFailureWithoutReading() {
        screenshot("home")
        assertEquals(0, requests("session.read"))
        assertEquals(0, requests("board.read"))
        val boardRequests = requests("board.list")
        compose.onNodeWithTag("scope-backlog").performClick()
        awaitTag("row-issue:8")
        compose.onAllNodesWithTag("row-assistant").assertCountEquals(0)
        awaitTag("pinned-shelf")
        compose.onNodeWithTag("scope-active").performClick()
        awaitTag("row-issue:1")
        assertEquals(boardRequests, requests("board.list"))
        compose.onNodeWithTag("open-drawer").performClick()
        awaitText("Fixture Mac")
        screenshot("sidebar")
        compose.onNodeWithText("Fixture Mac").performClick()
        awaitTag("computer-menu-android-e2e")
        compose.onNodeWithTag("computer-menu-android-e2e").performClick()
        compose.onNodeWithTag("edit-addresses").performClick()
        awaitTag("address-lan-0")
        screenshot("computer-addresses")
        compose.onNodeWithTag("address-lan-0").performTextReplacement("file:///not-an-address")
        compose.onNodeWithTag("save-addresses").performClick()
        awaitTag("page-error")
        compose.onNodeWithTag("address-lan-0").assertTextContains("file:///not-an-address")
        compose.onNodeWithTag("address-lan-0").performTextReplacement(origin)
        compose.onNodeWithTag("save-addresses").performClick()
        awaitTag("row-issue:1")
        control("/fixture/configure?flag=fail-home", "POST")
        scenario.recreate()
        scenario.onActivity { ViewModelProvider(it)[DuduViewModel::class.java].refresh() }
        awaitText("无法连接，请检查电脑和网络")
        awaitTag("row-issue:1")
        assertEquals(0, requests("session.read"))
        assertEquals(0, requests("board.read"))
    }

    @Test fun createRequiresProjectRetainsFailedDraftAndDeletionNeedsConfirmation() {
        compose.onNodeWithTag("new-issue").performClick()
        awaitEnabled("issue-title")
        compose.onAllNodesWithTag("agent-picker").assertCountEquals(0)
        compose.onNodeWithTag("issue-title").performTextInput("Android fixture issue")
        compose.onNodeWithTag("project-picker").performClick()
        compose.onNodeWithText("dudu").performClick()
        compose.onNodeWithTag("agent-picker").performClick()
        compose.onNodeWithText("ChatGPT").performClick()
        compose.onNodeWithTag("status-picker").performClick()
        compose.onNodeWithTag("status-picker-option-backlog").performClick()
        screenshot("new-issue")
        control("/fixture/configure?flag=fail-create", "POST")
        compose.onNodeWithTag("create-issue").performClick()
        awaitTag("panel-error")
        compose.onNodeWithTag("issue-title").assertTextContains("Android fixture issue")
        awaitEnabled("create-issue")
        compose.onNodeWithTag("create-issue").performClick()
        compose.waitUntil(5000) { compose.onAllNodesWithTag("bottom-sheet").fetchSemanticsNodes().isEmpty() }
        val created = control("/fixture/state").getJSONArray("issues").let { array ->
            (0 until array.length()).map(array::getJSONObject).single { it.getString("title") == "Android fixture issue" }
        }
        assertEquals("codex", created.getString("agent"))
        assertEquals("backlog", created.getString("status"))
        assertEquals("/fixture/dudu", created.getJSONObject("project").getString("path"))
        compose.onNodeWithTag("row-issue:1").performTouchInput { longClick() }
        awaitTag("delete-issue")
        screenshot("actions")
        compose.onNodeWithTag("issue-agent").assertIsNotEnabled()
        compose.onNodeWithTag("issue-project").assertIsNotEnabled()
        compose.onNodeWithTag("delete-issue").performScrollTo().performClick()
        awaitTag("confirm-delete")
        screenshot("delete-dialog")
        compose.onNodeWithText(context.getString(R.string.cancel)).performClick()
        compose.waitUntil(5000) { compose.onAllNodesWithTag("confirm-delete").fetchSemanticsNodes().isEmpty() }
        assertEquals(1, requests("issue.delete"))
        assertEquals(0, control("/fixture/state").getJSONArray("cleanedIssues").length())
        compose.onNodeWithTag("row-issue:1").performTouchInput { longClick() }
        awaitEnabled("delete-issue")
        compose.onNodeWithTag("delete-issue").performScrollTo().performClick()
        awaitEnabled("confirm-delete")
        compose.onNodeWithTag("confirm-delete").performClick()
        compose.waitUntil(5000) { compose.onAllNodesWithTag("row-issue:1").fetchSemanticsNodes().isEmpty() }
        assertEquals(3, requests("issue.delete"))
        assertEquals(1, control("/fixture/state").getJSONArray("cleanedIssues").getInt(0))
    }

    @Test fun failedSendKeepsDraftAndRetryUsesSameInputId() {
        compose.onNodeWithTag("row-issue:2").performClick()
        awaitEnabled("message-input")
        control("/fixture/configure?flag=fail-send", "POST")
        compose.onNodeWithTag("message-input").performTextInput("Continue the Android fixture task")
        compose.onNodeWithTag("send").performClick()
        awaitTag("send-error")
        compose.onNodeWithTag("message-input").assertTextContains("Continue the Android fixture task")
        awaitEnabled("send")
        compose.onNodeWithTag("send").performClick()
        compose.waitUntil(5000) { control("/fixture/state").getJSONArray("sendAttempts").length() == 2 }
        val result = control("/fixture/state")
        val attempts = result.getJSONArray("sendAttempts")
        assertEquals(attempts.getJSONObject(0).getString("requestId"), attempts.getJSONObject(1).getString("requestId"))
        assertEquals("fixture-2", attempts.getJSONObject(1).getString("id"))
        compose.onNodeWithTag("message-input").assert(
            SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.EditableText,
                androidx.compose.ui.text.AnnotatedString("")))
        compose.onAllNodesWithText("Continue the Android fixture task").assertCountEquals(1)
        control("/fixture/configure?flag=lose-send-reply", "POST")
        compose.onNodeWithTag("message-input").performTextInput("The reply was lost but the input was admitted")
        compose.onNodeWithTag("send").performClick()
        compose.waitUntil(5000) {
            control("/fixture/state").getJSONArray("sendAttempts").length() == 3 &&
                compose.onAllNodes(hasTestTag("message-input") and isEnabled()).fetchSemanticsNodes().isNotEmpty() &&
                compose.onAllNodesWithTag("send-error").fetchSemanticsNodes().isEmpty() &&
                compose.onAllNodesWithText("The reply was lost but the input was admitted").fetchSemanticsNodes().size == 1 &&
                compose.onNodeWithTag("message-input").fetchSemanticsNode().config[
                    androidx.compose.ui.semantics.SemanticsProperties.EditableText].text.isEmpty()
        }
        screenshot("conversation")
        compose.onNodeWithTag("message-input").performTextInput("/compact")
        compose.onNodeWithTag("send").performClick()
        awaitTag("send-error")
        compose.onNodeWithTag("message-input").assertTextContains("/compact")
    }

    @Test fun richHistoryQuestionQueueAndModelUseTheNativeContracts() {
        control("/fixture/configure?flag=rich", "POST")
        compose.onNodeWithTag("row-issue:2").performClick()
        awaitEnabled("composer-plus")
        compose.onNodeWithText("加载更早").performScrollTo().performClick()
        awaitText("Earlier fixture history.")
        compose.onNodeWithText("Bash").performScrollTo().performClick()
        awaitText("/fixture/dudu")
        screenshot("tool-details")
        compose.onNodeWithTag("page-back").performClick()
        compose.onNodeWithTag("composer-plus").performClick()
        awaitEnabled("model-controls")
        screenshot("composer-menu")
        compose.onNodeWithTag("model-controls").performClick()
        awaitEnabled("conversation-model-option-codex:gpt-5-mini")
        screenshot("models")
        compose.onNodeWithTag("conversation-model-option-codex:gpt-5-mini").performClick()
        compose.waitUntil(5000) { requests("session.configure") == 1 }
        compose.waitUntil(5000) { compose.onAllNodesWithTag("conversation-model-option-codex:gpt-5-mini").fetchSemanticsNodes().isEmpty() }
        compose.onNodeWithContentDescription("插话发送").performClick()
        compose.waitUntil(5000) { requests("session.queue.update") == 1 }
        compose.onNodeWithText("Proceed").performScrollTo().performClick()
        compose.onNodeWithText("提交").performScrollTo().performClick()
        compose.waitUntil(5000) { requests("question.answer") == 1 }
        compose.waitUntil(5000) { compose.onAllNodesWithText("Fixture decision").fetchSemanticsNodes().isEmpty() }
        screenshot("rich-conversation")
        val all = control("/fixture/state").getJSONArray("requests")
        val rows = (0 until all.length()).map(all::getJSONObject)
        assertEquals("codex:gpt-5-mini", rows.single { it.getString("method") == "session.configure" }
            .getJSONObject("params").getString("modelId"))
        assertEquals("steer", rows.single { it.getString("method") == "session.queue.update" }
            .getJSONObject("params").getString("action"))
    }

    @Test fun taskConflictPreservesDraftAndActionsWriteRealHistory() {
        openDrawer("nav-tasks")
        awaitTag("new-task")
        compose.onNodeWithTag("new-task").performClick()
        awaitEnabled("task-title")
        compose.onNodeWithTag("task-title").performTextInput("Android scheduled fixture")
        compose.onNodeWithTag("task-prompt").performTextInput("Use the approved design.")
        awaitEnabled("save-task")
        compose.onNodeWithTag("save-task").performClick()
        compose.waitUntil(5000) { control("/fixture/state").getJSONArray("tasks").length() == 1 }
        val task = control("/fixture/state").getJSONArray("tasks").getJSONObject(0)
        val id = task.getString("id")
        awaitTag("task-$id")
        compose.onNodeWithTag("task-$id").performClick()
        awaitEnabled("edit-task")
        screenshot("task-details")
        compose.onNodeWithTag("edit-task").performClick()
        compose.onNodeWithTag("task-title").performTextReplacement("Keep this conflicted draft")
        control("/fixture/configure?flag=task-conflict", "POST")
        compose.onNodeWithTag("save-task").performClick()
        awaitTag("page-error")
        compose.onNodeWithTag("task-title").assertTextContains("Keep this conflicted draft")
        assertEquals("Android scheduled fixture", control("/fixture/state").getJSONArray("tasks").getJSONObject(0).getString("title"))
        compose.onNodeWithTag("page-retry").performClick()
        awaitEnabled("save-task")
        compose.onNodeWithTag("task-title").assertTextContains("Keep this conflicted draft")
        compose.onNodeWithTag("save-task").performClick()
        awaitTag("page-error")
        assertEquals("Android scheduled fixture", control("/fixture/state").getJSONArray("tasks").getJSONObject(0).getString("title"))
        compose.onNodeWithText("取消").performClick()
        awaitEnabled("edit-task")
        compose.onNodeWithTag("edit-task").performClick()
        compose.onNodeWithTag("task-title").performTextReplacement("Android updated fixture")
        compose.onNodeWithTag("save-task").performClick()
        awaitEnabled("edit-task")
        compose.onNodeWithTag("task-run").performClick()
        compose.waitUntil(5000) { requests("tasks.run") == 1 && requests("tasks.history") >= 3 }
        compose.onNodeWithTag("task-detail-list").performScrollToNode(hasText("已投递"))
        compose.onNodeWithText("已投递").assertExists()
        assertEquals("Android updated fixture", control("/fixture/state").getJSONArray("tasks").getJSONObject(0).getString("title"))
        screenshot("task-history")
    }

    @Test fun collectorCreatesLinkedIssueAndSettingsFailureRetainsEdits() {
        openDrawer("nav-collector")
        awaitTag("record-1")
        compose.onNodeWithTag("record-1").performClick()
        awaitText("Collected source content.")
        screenshot("record-details")
        compose.onNodeWithTag("record-create").performClick()
        awaitEnabled("create-issue")
        compose.onNodeWithTag("create-issue").performClick()
        compose.waitUntil(5000) { requests("issue.create") == 1 && compose.onAllNodesWithTag("bottom-sheet").fetchSemanticsNodes().isEmpty() }
        val made = control("/fixture/state").getJSONArray("issues").let { rows ->
            (0 until rows.length()).map(rows::getJSONObject).single { it.getString("title") == "Fixture collected record" }
        }
        assertEquals("connector", made.getString("source"))
        compose.onNodeWithTag("page-back").performClick()
        compose.onNodeWithTag("page-back").performClick()
        openDrawer("nav-settings")
        awaitText("规则")
        compose.onNodeWithText("规则").performClick()
        awaitText("ASSIGN.md")
        compose.onNodeWithText("ASSIGN.md").performClick()
        awaitEnabled("settings-text")
        compose.onNodeWithTag("settings-text").performTextReplacement("Keep explicit projects and assignments.")
        control("/fixture/configure?flag=fail-settings", "POST")
        compose.onNodeWithText("保存").performClick()
        awaitTag("page-error")
        compose.onNodeWithTag("settings-text").assertTextContains("Keep explicit projects and assignments.")
        awaitEnabled("settings-text")
        compose.onNodeWithText("保存").performClick()
        compose.waitUntil(5000) { control("/fixture/state").getJSONObject("rules").getString("ASSIGN.md") == "Keep explicit projects and assignments." }
        screenshot("settings-rules")
    }

    @Test fun quickTodoReadDoesNotReplaceWatchAndChildReturnsToParent() {
        compose.onNodeWithTag("row-assistant").performClick()
        awaitEnabled("quick-todo")
        compose.onNodeWithTag("quick-todo").performClick()
        awaitTag("assistant-todos")
        compose.onNodeWithText("ios 开发").performScrollTo().performClick()
        compose.waitUntil(5000) { requests("assistant.reply.read") == 1 }
        assertEquals(1, requests("session.watch"))
        screenshot("assistant-todos")
        compose.onNodeWithText("打开会话").performScrollTo().performClick()
        awaitEnabled("message-input")
        compose.waitUntil(5000) { requests("session.watch") == 2 }
        compose.onNodeWithTag("conversation-back").performClick()
        awaitEnabled("quick-todo")
        scenario.onActivity { activity -> ViewModelProvider(activity)[DuduViewModel::class.java]
            .navigate(Route("activity", target = "team")) }
        awaitText("Fixture researcher")
        compose.onNodeWithText("Fixture researcher").performClick()
        awaitTag("conversation-back")
        compose.waitUntil(5000) { requests("session.watch") == 4 }
        compose.onAllNodesWithTag("message-input").assertCountEquals(0)
        compose.onNodeWithTag("conversation-back").performClick()
        awaitText("Fixture researcher")
        compose.waitUntil(5000) { requests("session.watch") == 5 }
        val rows = control("/fixture/state").getJSONArray("requests")
        val watched = (0 until rows.length()).map(rows::getJSONObject).filter { it.getString("method") == "session.watch" }
        assertEquals("fixture-assistant", watched.last().getJSONObject("params").getString("id"))
    }

    @Test fun scopedWebViewLoadsRpcWithoutExposingPairingOrLeavingPageScope() {
        scenario.onActivity { activity -> ViewModelProvider(activity)[DuduViewModel::class.java]
            .navigate(Route("web", "Fixture embedded page", params = app.dudu.android.data.json("page" to "plugins"))) }
        val result = AtomicReference("")
        fun findWeb(view: android.view.View): android.webkit.WebView? {
            if (view is android.webkit.WebView) return view
            if (view is android.view.ViewGroup) for (index in 0 until view.childCount) {
                findWeb(view.getChildAt(index))?.let { return it }
            }
            return null
        }
        compose.waitUntil(10000) {
            scenario.onActivity { activity -> findWeb(activity.window.decorView)?.evaluateJavascript(
                "JSON.stringify(window.fixtureResult||{})") { value -> result.set(value) } }
            result.get().contains("Scoped page ready")
        }
        assertTrue(result.get().contains("403"))
        assertTrue(result.get().contains("\\\"cookie\\\":\\\"\\\""))
        val state = control("/fixture/state")
        assertEquals(0, state.getInt("outsideReads"))
        assertTrue(state.getJSONArray("pageReads").toString().contains("web.invoke"))
        screenshot("embedded-page")
        compose.onNodeWithTag("page-back").performClick()
        awaitTag("open-drawer")
        compose.waitUntil(5000) { control("/fixture/state").getJSONArray("pageReads").toString().contains("web.close") }
    }

    private fun openDrawer(tag: String) {
        compose.onNodeWithTag("open-drawer").performClick()
        awaitTag(tag)
        compose.onNodeWithTag(tag).performClick()
    }

    private fun awaitText(text: String) = compose.waitUntil(10000) {
        compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
    }

    private fun awaitTag(tag: String) {
        try {
            compose.waitUntil(10000) {
                compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty()
            }
        } catch (failure: Throwable) {
            screenshot("missing-${tag.replace(':', '-')}")
            throw failure
        }
    }

    private fun awaitEnabled(tag: String) {
        awaitTag(tag)
        compose.waitUntil(10000) {
            compose.onAllNodes(hasTestTag(tag) and isEnabled()).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun requests(method: String): Int {
        val rows = control("/fixture/state").getJSONArray("requests")
        return (0 until rows.length()).count { rows.getJSONObject(it).getString("method") == method }
    }

    private fun control(path: String, method: String = "GET"): JSONObject {
        val connection = URL(origin + path).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 3000
        connection.readTimeout = 3000
        return try { connection.inputStream.bufferedReader().use { JSONObject(it.readText()) } }
        finally { connection.disconnect() }
    }

    private fun screenshot(name: String) {
        compose.waitForIdle()
        instrumentation.waitForIdleSync()
        val drawn = java.util.concurrent.CountDownLatch(1)
        scenario.onActivity { activity -> activity.window.decorView.postOnAnimation {
            activity.window.decorView.postOnAnimation { drawn.countDown() }
        } }
        check(drawn.await(3, java.util.concurrent.TimeUnit.SECONDS)) { "No rendered frame for $name" }
        val bitmap = instrumentation.uiAutomation.takeScreenshot() ?: return
        val output = File(context.getExternalFilesDir(null), "review").apply { mkdirs() }
        File(output, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
        instrumentation.uiAutomation.executeShellCommand("mkdir -p /sdcard/Download/dudu-android-review")
            .use { descriptor -> android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).readBytes() }
        instrumentation.uiAutomation.executeShellCommand(
            "cp ${File(output, "$name.png").absolutePath} /sdcard/Download/dudu-android-review/$name.png"
        ).use { descriptor -> android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).readBytes() }
    }
}
