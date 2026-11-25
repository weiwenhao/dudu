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

    // After Muse's connectors (owner, 2026-11-23): one list; a first connection that goes on keeps its item's place with a spinner, not a row among the connected.
    @Test fun connectorsAreOneListWithTheirWordsAndTheCardTheyOffer() {
        val connectors = list(
            connector("plain"), connector("fine", json("status" to "connected")),
            connector("slow", json("status" to "error", "message" to "timeout")), connector("auth", json("status" to "needs-auth")),
            connector("wait", json("status" to "waiting", "code" to "AB-12")), connector("sentry", json("status" to "waiting", "fresh" to true)).put("fresh", true))
        val catalog = json("groups" to JSONArray(listOf(json("id" to "dev", "items" to JSONArray(listOf(json("id" to "gitlab", "name" to "GitLab", "line" to "x", "how" to "oauth")))))),
            "trying" to JSONArray(listOf(json("id" to "sentry", "name" to "Sentry", "group" to "dev", "how" to "oauth", "connector" to "sentry"))))
        val page = SettingsPages.page("connectors", null, json("connectors/catalog" to catalog, "connectors/list" to json("connectors" to connectors)), Plain)
        val sections = page.rows("sections")
        assertEquals(listOf(null, "已连接", "开发"), sections.map { it.nullableString("header") })
        assertEquals(listOf("plain", "fine", "slow", "auth", "wait"), rowIds(sections[1]))
        assertEquals(1.5, page.getDouble("poll"), 0.0)
        // One that works says 查看; one whose sign-in ran out says so in red and signs in again from its card; one that failed keeps its words and its one verb.
        val fine = sections[1].rows("rows")[1]
        assertEquals(listOf("查看", "link"), listOf(fine.getString("detail"), fine.getString("tone")))
        val auth = sections[1].rows("rows")[3]
        assertEquals(listOf("登录已过期", "alert", "重新登录", "sheet"), listOf(auth.getString("subtitle"), auth.getString("style"),
            auth.getJSONObject("button").getString("title"), auth.getJSONObject("button").getJSONObject("act").getString("name")))
        assertEquals(true, auth.getJSONObject("connect").getBoolean("reconnect"))
        val slow = sections[1].rows("rows")[2]
        assertEquals("连接超时", slow.getString("detail"))
        assertEquals(listOf("重试", "断开"), slow.rows("menu").map { it.getString("title") })
        // The catalog: 连接 opens the card; the item being tried has a spinner in its place.
        val dev = sections[2].rows("rows")
        assertEquals(listOf("gitlab", "sentry"), dev.map { it.getString("id") })
        assertEquals(listOf("link", "busy"), dev.map { it.getJSONObject("button").getString("style") })
        assertEquals("oauth", dev[0].getJSONObject("connect").getString("how"))
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
        assertEquals("添加连接器", SettingsPages.page("connectors", "add", json(), Plain).getString("title"))
    }
}
