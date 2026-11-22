package app.dudu.android

import app.dudu.android.data.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/** What is on 嘟嘟's settings pages and in what order (`data/SettingsPages.kt`): the layout rules, not how a page looks. */
class SettingsPagesTest {
    /** The Chinese itself as the words: only what a page holds is looked at here. */
    private object Plain : SettingsWords {
        override val inEnglish = false
        override fun w(key: String, vararg values: Any?, count: Int?) =
            Regex("\\{(\\d+)}").replace(key) { values.getOrNull(it.groupValues[1].toInt())?.toString() ?: it.value }
        override fun time(at: Long) = "t$at"
    }

    private fun list(vararg rows: JSONObject) = JSONArray(rows.toList())
    private fun rowIds(section: JSONObject) = section.rows("rows").map { it.getString("id") }
    private fun connector(id: String, state: JSONObject? = null, busy: Boolean? = null) =
        json("id" to id, "name" to id, "state" to state, "busy" to busy)

    @Test fun onlyAConnectorThatWorksIsConnectedAndTheOthersAreAvailableKeepingTheirWordsAndOneVerb() {
        val connectors = list(
            connector("plain"), connector("fine", json("status" to "connected")), connector("busy", json("status" to "connected"), busy = true),
            connector("slow", json("status" to "error", "message" to "timeout")), connector("auth", json("status" to "needs-auth")),
            connector("wait", json("status" to "waiting", "code" to "AB-12")), connector("login", json("status" to "needs-login", "login" to "gh auth login")),
            connector("gone", json("status" to "missing", "command" to "glab")), connector("odd", json("status" to "something-new")))
        val page = SettingsPages.page("connectors", null, json("connectors/catalog" to json("groups" to JSONArray()),
            "connectors/list" to json("connectors" to connectors)), Plain)
        val sections = page.rows("sections")
        // The add row, then 已连接, then 可用 right after it; and the page polls while one waits.
        assertEquals(listOf(null, "已连接", "可用"), sections.map { it.nullableString("header") })
        assertEquals(listOf("plain", "fine"), rowIds(sections[1]))
        assertEquals(listOf("busy", "slow", "auth", "wait", "login", "gone", "odd"), rowIds(sections[2]))
        assertEquals(1.5, page.getDouble("poll"), 0.0)
        // An error that timed out is not connected: it is in 可用 with its red words and its one verb (the first item of the long press).
        val slow = sections[2].rows("rows")[1]
        assertEquals("连接超时", slow.getString("detail"))
        assertEquals("bad", slow.getString("tone"))
        val verb = slow.rows("menu")[0].getJSONObject("act")
        assertEquals("verb", verb.getString("name"))
        assertEquals("retry", verb.getJSONObject("args").getString("verb"))
        assertEquals(listOf("重试", "断开"), slow.rows("menu").map { it.getString("title") })
        // The one that waits is amber, says where to authorize, and can be cancelled; one that only works has no verb at all.
        val waiting = sections[2].rows("rows")[3]
        assertEquals("请在电脑上授权", waiting.getString("detail"))
        assertEquals("warn", waiting.getString("tone"))
        assertEquals(listOf("取消", "断开"), waiting.rows("menu").map { it.getString("title") })
        assertEquals(listOf("断开"), sections[1].rows("rows")[0].rows("menu").map { it.getString("title") })
    }

    @Test fun theStatusesPageIsOneCardAndTheMenuOfAStatusFollowsTheRules() {
        fun status(id: String, category: String, default: Boolean = false) = json("id" to id, "name" to id, "category" to category, "isDefault" to default)
        val page = SettingsPages.page("statuses", null, json("issues/statuses" to json("statuses" to list(
            status("todo", "unstarted", default = true), status("later", "unstarted"), status("done", "completed"), status("canceled", "canceled")),
            "counts" to json("later" to 3))), Plain)
        val rows = page.rows("sections").single().rows("rows")
        assertEquals(listOf("group-backlog", "group-unstarted", "todo", "later", "group-started", "group-completed", "done", "group-canceled", "canceled"),
            rows.map { it.getString("id") })
        val todo = rows[2].rows("menu")
        assertEquals(listOf("编辑", "设为默认", "上移", "下移", "删除"), todo.map { it.getString("title") })
        // The default one cannot be made the default again, the first cannot move up, the last cannot move down.
        assertEquals(listOf(true, false, false, true, true), todo.map { it.optBoolean("enabled", true) })
        assertEquals("· 默认", rows[2].getString("tag"))
        // Deleting a status that holds issues says where they go; a category's only status cannot be deleted, and completed and canceled have no default.
        assertEquals("3 条事项", rows[3].getString("subtitle"))
        assertEquals("later · 将事项移至：todo", rows[3].rows("menu").last().getJSONObject("confirm").getString("message"))
        assertEquals(listOf("编辑", "上移", "下移"), rows[6].rows("menu").map { it.getString("title") })
    }

    @Test fun theAddConnectorPageHoldsWhatTheRecognizedTextNeeds() {
        fun fields(recognized: JSONObject?) = SettingsPages.customConnector(recognized, Plain).rows("sections").single().rows("rows").map { it.getString("id") }
        assertEquals(listOf("text", "name"), fields(null))
        assertEquals(listOf("text", "recognized", "name", "token"), fields(json("kind" to "remote", "auth" to "token", "name" to "Sentry")))
        assertEquals(listOf("text", "recognized", "name"), fields(json("kind" to "remote", "auth" to "oauth")))
        assertEquals(listOf("text", "recognized", "name", "env"), fields(json("kind" to "local", "name" to "glab")))
        // Several connectors in one text: no name, no token, no environment.
        assertEquals(listOf("text", "recognized"), fields(json("kind" to "local", "count" to 2)))
        assertEquals("2 个连接器", SettingsPages.customConnector(json("kind" to "local", "count" to 2), Plain)
            .rows("sections").single().rows("rows")[1].getString("detail"))
    }

    @Test fun anAnswerThatDidNotComeIsAPageThatCouldNotBeRead() {
        assertEquals("PROTOCOL_ERROR", assertThrows(ApiFailure::class.java) { SettingsPages.page("rules", null, json(), Plain) }.code)
        // A page that needs no answer (the add-connector one) does not mind.
        assertEquals("添加自定义连接器", SettingsPages.page("connectors", "add", json(), Plain).getString("title"))
    }
}
