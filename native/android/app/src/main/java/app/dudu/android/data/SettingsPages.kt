package app.dudu.android.data

import org.json.JSONArray
import org.json.JSONObject

/**
 * The words and the time format of a settings page, in the phone's language: the app's own dictionary (`ui/Wording.kt`) for code that draws nothing, so that a page can be laid out
 * and tested off the screen. `w` is the dictionary's `w`: `{0}`, `{1}` are replaced by the values (once, never inside a value) and `count` picks the singular form of an English template.
 */
interface SettingsWords {
    val inEnglish: Boolean
    fun w(key: String, vararg values: Any?, count: Int? = null): String
    /** A moment as the settings say it: the month, the day and the time on a 24-hour clock. */
    fun time(at: Long): String
}

/**
 * 嘟嘟's settings pages are laid out here, in the app, not by the computer (owner, 2026-11-21: 「整个嘟嘟设置，包括打开里面的都可以写死，包括里面的条目，从 api 获取的是值，而不是布局」). The
 * plugin sends values (`settings.data`: the raw answers of the desktop interface's actions, by action name) and this builds the page that `SettingsScreen` draws, in the shape of a phone
 * that declared `settings.rich`: a long-press `menu` on a row, the 状态 page as one card of category strips and status tiles, the status form's tile, progress icons and colour dots.
 * `host/native-settings.mjs` keeps the same layouts for a phone that does not lay them out, and for this app while its computer's plugin is older than `settings.data`.
 *
 * A page is { title, sections: [{ header?, footer?, rows }], save?, preview?, poll? }; a row is what `Settings.kt` reads (kind, title, subtitle, detail, tone, to, menu, button, act…).
 * Every word goes through `w` with the Chinese itself as the key (a plain string literal), so that `scripts/sync-android-words.mjs` finds it for the dictionary.
 */
object SettingsPages {
    /** The page of a section (and of a target inside it) from the raw answers. An answer that is not there is a page that could not be read. */
    fun page(section: String, target: String?, data: JSONObject, words: SettingsWords): JSONObject {
        val layout = SettingsLayout(words, data)
        return when (section) {
            "general" -> layout.general()
            "statuses" -> layout.statuses(target)
            "connectors" -> layout.connectors(target)
            "collectors" -> layout.collectors(target)
            "rules" -> layout.rules(target)
            "memory" -> layout.memory(target)
            "skills" -> layout.skills(target)
            else -> throw ApiFailure("UPSTREAM_ERROR")
        }
    }

    /** The add-connector page: empty, or with what the computer made of the text typed so far (`connectors/recognize`'s answer). */
    fun customConnector(recognized: JSONObject?, words: SettingsWords): JSONObject = SettingsLayout(words, JSONObject()).customConnector(recognized)

    /**
     * What 已连接 holds: a connector that works. Its state is connected (or it has none) and it is not busy; any other (it waits for an authorization, needs a login or a command, failed
     * or timed out, or says something this app does not know) has never got there and is listed among the available ones (owner, 2026-11-21: 「都没连接好，从来都没连接过，放在已连接里面干什么」).
     */
    fun isConnected(connector: JSONObject): Boolean {
        val status = connector.optJSONObject("state")?.str("status")?.takeIf { it.isNotEmpty() }
        return !connector.flag("busy") && (status == null || status == "connected")
    }
}

// --- helpers -----------------------------------------------------------------------------------------------------------------------------------

/** A JSON object without the entries that have no value (the plugin's JavaScript leaves an `undefined` out); a JSON null is `JSONObject.NULL`. */
private fun obj(vararg entries: Pair<String, Any?>): JSONObject = JSONObject().also { result ->
    entries.forEach { (key, value) -> if (value != null) result.put(key, value) }
}
private fun arr(items: Iterable<Any?>): JSONArray = JSONArray().also { array -> items.forEach { if (it != null) array.put(it) } }

/** A string (a number or a boolean as its text), or nothing when the key is not there or is null. */
private fun JSONObject.str(key: String): String? = if (isNull(key)) null else opt(key)?.let { if (it is String) it else it.toString() }
/** What JavaScript calls truthy: not null, not false, not 0, not an empty string. */
private fun JSONObject.flag(key: String): Boolean = when (val value = if (isNull(key)) null else opt(key)) {
    null -> false
    is Boolean -> value
    is Number -> value.toDouble().let { it != 0.0 && !it.isNaN() }
    is String -> value.isNotEmpty()
    else -> true
}
/** The raw value of a key, or nothing for a missing key and a JSON null. */
private fun JSONObject.raw(key: String): Any? = if (isNull(key)) null else opt(key)
private fun JSONObject.number(key: String): Double? = (raw(key) as? Number)?.toDouble()?.takeIf { it.isFinite() }

/** A row of kind `text`, the plain one. */
private fun row(vararg fields: Pair<String, Any?>) = obj("kind" to "text", *fields)
private fun link(title: String, to: JSONObject, vararg fields: Pair<String, Any?>) = row("title" to title, "to" to to, *fields)
private fun go(section: String, target: String) = obj("section" to section, "target" to target)
private fun act(name: String, args: JSONObject? = null) = obj("name" to name, "args" to args)
private fun confirm(title: String, message: String?, button: String) = obj("title" to title, "message" to message, "button" to button)
private fun field(id: String, title: String, value: String, vararg more: Pair<String, Any?>) =
    obj("id" to id, "kind" to "field", "key" to id, "title" to title, "value" to value, *more)
/** An item of a row's long-press menu (a glyph is a Lucide name that `settingsMenuGlyph` knows). */
private fun item(title: String, glyph: String, act: JSONObject? = null, to: JSONObject? = null, role: String? = null, confirm: JSONObject? = null, enabled: Boolean? = null) =
    obj("title" to title, "glyph" to glyph, "act" to act, "to" to to, "role" to role, "confirm" to confirm, "enabled" to enabled)
/** What a row offers to do: its long-press menu, every item (the ones that cannot be done now are shown grey), or nothing. */
private fun menu(vararg items: JSONObject?): Array<Pair<String, Any?>> =
    items.filterNotNull().let { shown -> if (shown.isEmpty()) emptyArray() else arrayOf<Pair<String, Any?>>("menu" to arr(shown)) }

private fun joined(vararg parts: String?) = parts.filter { !it.isNullOrEmpty() }.joinToString(" · ")
private fun firstLine(value: String?) = value.orEmpty().split('\n').map { it.trim() }.firstOrNull { it.isNotEmpty() }.orEmpty()
private fun baseName(command: String?) = command.orEmpty().split(Regex("[\\\\/]")).lastOrNull { it.isNotEmpty() }.orEmpty()

private val CATEGORIES = listOf("backlog", "unstarted", "started", "completed", "canceled")
private val STATUS_TYPES = mapOf("backlog" to "backlog", "unstarted" to "todo", "started" to "in_progress", "completed" to "done", "canceled" to "canceled")
/** How far a started status is filled: the number the computer keeps and its id in the form. */
private val PROGRESS = listOf("0" to 0.0, "0.25" to 0.25, "0.5" to 0.5, "0.75" to 0.75, "1" to 1.0)
private val COLORS = listOf("#95a2b3", "#61666b", "#eb5757", "#f2994a", "#f2c94c", "#4cb782", "#26b5ce", "#5e6ad2", "#8f6bde")
private const val COLOR_DEFAULT = "#95a2b3"
private val PRESETS = listOf("5m", "15m", "30m", "1h", "6h", "0 9 * * *", "0 9 * * 1-5", "0 9-18 * * 1-5")
private val RULE_FILES = listOf("TRIAGE.md", "ASSIGN.md")
private val GROUP_ORDER = listOf("here", "work", "projects", "dev", "web")
private const val CONNECTOR_POLL_SECONDS = 1.5

private class Model(val provider: String, val id: String, val name: String?, val group: String, val reasoning: JSONObject?)

// --- the layouts -------------------------------------------------------------------------------------------------------------------------------

internal class SettingsLayout(private val words: SettingsWords, private val data: JSONObject) {
    private fun w(key: String, vararg values: Any?, count: Int? = null): String = words.w(key, *values, count = count)

    /** The computer's answer to one action of the desktop interface. One that did not come is a page that could not be read. */
    private fun answer(action: String): JSONObject = data.optJSONObject(action) ?: throw ApiFailure("PROTOCOL_ERROR")

    private fun categoryName(category: String) = when (category) {
        "backlog" -> w("待规划")
        "unstarted" -> w("未开始")
        "started" -> w("已开始")
        "completed" -> w("已完成")
        "canceled" -> w("已取消")
        else -> category
    }

    private fun statusName(status: JSONObject): String {
        val id = status.str("id").orEmpty()
        val given = status.str("name")?.takeIf { it.isNotEmpty() }
        return given ?: when (id) {
            "backlog" -> w("待规划")
            "todo" -> w("待办")
            "in_progress" -> w("处理中")
            "in_review" -> w("待审核")
            "done" -> w("已完成")
            "canceled" -> w("已取消")
            else -> id
        }
    }

    private fun verbWord(verb: String) = when (verb) {
        "authorize" -> w("授权")
        "cancel" -> w("取消")
        else -> w("重试")
    }
    private fun verbGlyph(verb: String) = when (verb) {
        "authorize" -> "key-round"
        "cancel" -> "x"
        else -> "rotate-cw"
    }

    private fun ruleTitle(file: String) = if (file == "TRIAGE.md") w("影响、工作量和截止") else w("任务分配")

    private fun groupName(id: String) = when (id) {
        "here" -> w("这台电脑")
        "work" -> w("办公")
        "projects" -> w("项目")
        "dev" -> w("开发")
        "web" -> w("网页")
        else -> id
    }

    private fun presetWords(preset: String) = when (preset) {
        "5m" -> w("每 5 分钟")
        "15m" -> w("每 15 分钟")
        "30m" -> w("每 30 分钟")
        "1h" -> w("每小时")
        "6h" -> w("每 6 小时")
        "0 9 * * *" -> w("每天 09:00")
        "0 9 * * 1-5" -> w("周一至周五 09:00")
        else -> w("周一至周五 9 至 18 点每小时")
    }

    private fun describeFrequency(value: String?): String {
        val one = value.orEmpty().trim()
        if (one.isEmpty()) return w("每 30 分钟")
        if (one in PRESETS) return presetWords(one)
        val every = Regex("^(\\d{1,4})\\s*([mhd])$", RegexOption.IGNORE_CASE).find(one) ?: return one
        val n = every.groupValues[1].toInt()
        return when (every.groupValues[2].lowercase()) {
            "m" -> w("每 {0} 分钟", n, count = n)
            "h" -> if (n == 1) w("每小时") else w("每 {0} 小时", n, count = n)
            else -> if (n == 1) w("每天") else w("每 {0} 天", n, count = n)
        }
    }

    private fun aboutLine(about: JSONObject?): String {
        if (about == null) return ""
        val tools = (about.raw("tools") as? Number)?.toInt()?.let { w("{0} 个工具", it, count = it) } ?: ""
        return when (about.str("kind")) {
            "remote" -> joined(about.str("host"), tools)
            "local" -> joined(about.str("command")?.takeIf { it.isNotEmpty() }?.let { w("本机 · {0}", baseName(it)) }, tools)
            "cli" -> about.str("command")?.takeIf { it.isNotEmpty() }?.let { w("命令行 · {0}", it) } ?: ""
            "sentence" -> firstLine(about.str("text"))
            else -> ""
        }
    }

    /** What a connector's state says in a row: the words by it, the tone, the one thing to do about it. */
    private class Shown(val line: String, val tone: String? = null, val words: String? = null, val verb: String? = null)

    private fun describeState(state: JSONObject?, line: String): Shown {
        if (state == null) return Shown(line)
        return when (state.str("status")) {
            "needs-auth" -> Shown(line, "warn", w("需要授权"), "authorize")
            // The browser is the computer's, not the phone's: the words say where to go, in the warning colour.
            "waiting" -> Shown(state.str("code")?.takeIf { it.isNotEmpty() } ?: line, "warn", w("请在电脑上授权"), "cancel")
            "needs-login" -> Shown(state.str("login")?.takeIf { it.isNotEmpty() }?.let { w("在终端运行 {0}，再点重试", it) } ?: line, "warn", w("需要登录"), "retry")
            "missing" -> Shown(state.str("command")?.takeIf { it.isNotEmpty() }?.let { command ->
                w("没找到 {0}{1}", command, state.str("install")?.takeIf { it.isNotEmpty() }?.let { w("：{0}", it) } ?: "")
            } ?: line, "bad", w("没装"), "retry")
            "error" -> Shown(line, "bad", if (state.str("message") == "timeout") w("连接超时") else state.str("message").orEmpty().take(120), "retry")
            else -> Shown(line)
        }
    }

    // --- 常规 -----------------------------------------------------------------------------------------------------------------------------------

    private fun modelsOf(conversation: JSONObject): List<Model> {
        val groups = conversation.rows("groups")
        fun label(group: JSONObject) = group.str("name")?.takeIf { it.isNotEmpty() } ?: group.str("id").orEmpty()
        return groups.flatMap { group ->
            val name = label(group)
            val shown = if (groups.count { label(it) == name } > 1) "$name · ${group.str("id").orEmpty()}" else name
            group.rows("models").map { Model(group.str("id").orEmpty(), it.str("id").orEmpty(), it.str("name"), shown, it.optJSONObject("reasoning")) }
        }
    }

    private fun pair(provider: String, id: String) = JSONArray().put(provider).put(id).toString()

    fun general(): JSONObject {
        val state = answer("assistant/state")
        val conversation = answer("assistant/conversation-settings")
        val settings = answer("assistant/settings")
        val models = modelsOf(conversation)
        val chosen = conversation.optJSONObject("model")
        val current = chosen?.let { selected -> models.firstOrNull { it.provider == selected.str("provider") && it.id == selected.str("model") } }
        val reasoning = current?.reasoning
        val efforts = reasoning?.rows("efforts").orEmpty()
        val folder = state.str("projectFolder")
        val effort = chosen?.str("reasoningEffort")
        val several = conversation.rows("groups").size > 1
        return obj("title" to w("常规"), "sections" to arr(listOf(
            obj("header" to w("项目文件夹"), "rows" to arr(listOf(row(
                "id" to "folder", "title" to (folder ?: w("项目文件夹没能打开。")), "mono" to !folder.isNullOrEmpty(),
                "detail" to if (state.flag("isDefault")) w("默认") else null, "tone" to if (folder.isNullOrEmpty()) "bad" else null)))),
            obj("header" to w("嘟嘟 · 默认"), "rows" to arr(listOf(
                obj("id" to "model", "kind" to "choice", "title" to w("模型"), "selected" to (current?.let { pair(it.provider, it.id) } ?: ""),
                    "act" to act("conversation", obj("field" to "model")),
                    "options" to arr(models.map { model -> obj("id" to pair(model.provider, model.id), "title" to model.name, "subtitle" to if (several) model.group else null) })),
                if (efforts.isEmpty() || reasoning == null) null else {
                    val default = reasoning.str("defaultEffort")?.takeIf { it.isNotEmpty() }
                    obj("id" to "effort", "kind" to "choice", "title" to w("推理等级"), "selected" to (effort ?: default ?: ""),
                        "act" to act("conversation", obj("field" to "effort")),
                        "options" to arr(listOfNotNull(if (default == null) obj("id" to "", "title" to w("默认")) else null) +
                            efforts.map { obj("id" to it.str("id"), "title" to it.str("name")) }))
                },
                obj("id" to "permission", "kind" to "choice", "title" to w("访问模式"),
                    "selected" to (conversation.optJSONObject("settings")?.str("permission") ?: ""), "act" to act("conversation", obj("field" to "permission")),
                    "options" to arr(conversation.rows("permissions").map { obj("id" to it.str("value"), "title" to it.str("name")) })))),
            ),
            obj("header" to w("事项"), "rows" to arr(listOf(
                row("id" to "tidy", "title" to w("最近一次整理"),
                    "subtitle" to (state.optJSONObject("lastIssueTidy")?.let { tidy -> tidy.number("at")?.let { words.time(it.toLong()) } ?: "" } ?: w("还没有整理过"))),
                obj("id" to "deepSleep", "kind" to "switch", "title" to w("深度睡眠"),
                    "on" to (settings.optJSONObject("settings")?.let { !(it.has("deepSleep") && it.opt("deepSleep") == false) } ?: true),
                    "act" to act("deepSleep")))))
        )))
    }

    // --- 状态 -----------------------------------------------------------------------------------------------------------------------------------

    /**
     * The 状态 form as the owner drew it: a tile that follows the colour and progress, the name and description beside their titles, the progress of a started status as five icons, the
     * colour as dots.
     */
    private fun statusForm(status: JSONObject?, category: String): List<JSONObject> {
        val type = status?.str("type") ?: STATUS_TYPES[category]
        val color = status?.str("color") ?: COLOR_DEFAULT
        val progress: Pair<String, Double>? = if (category != "started") null else
            PROGRESS.firstOrNull { it.second == status?.number("iconProgress") } ?: if (type == "in_review") PROGRESS[3] else PROGRESS[2]
        fun shown(value: Double?) = obj("type" to type, "color" to color, "progress" to value)
        return listOfNotNull(
            obj("rows" to arr(listOf(obj("id" to "preview", "kind" to "statusPreview", "title" to (status?.let(::statusName) ?: ""), "status" to shown(progress?.second),
                "colorKey" to "color", "progressKey" to if (progress == null) null else "progress")))),
            obj("rows" to arr(listOf(
                field("name", w("名称"), status?.let(::statusName) ?: "", "inline" to true, "placeholder" to w("名称")),
                field("description", w("描述"), status?.str("description") ?: "", "inline" to true, "placeholder" to w("描述"), "multiline" to true)))),
            if (progress == null) null else obj("header" to w("完成度"), "rows" to arr(listOf(
                obj("id" to "progress", "kind" to "choice", "style" to "icons", "key" to "progress", "colorKey" to "color", "title" to w("完成度"), "selected" to progress.first,
                    "options" to arr(PROGRESS.map { (id, value) -> obj("id" to id, "title" to "${(value * 100).toInt()}%", "status" to shown(value)) }))))),
            obj("header" to w("颜色"), "rows" to arr(listOf(obj("id" to "color", "kind" to "choice", "style" to "swatches", "key" to "color", "title" to w("颜色"), "selected" to color,
                "options" to arr(COLORS.map { obj("id" to it, "title" to it, "color" to it) }))))),
        )
    }

    fun statuses(target: String?): JSONObject {
        val known = answer("issues/statuses")
        val all = known.rows("statuses").filter { !it.flag("archived") }
        val kind = target.orEmpty().substringBefore(':')
        val subject = if (target.orEmpty().contains(':')) target.orEmpty().substringAfter(':') else ""
        if (kind == "edit" || kind == "add") {
            val status = if (kind == "edit") all.firstOrNull { it.str("id") == subject } else null
            val category = status?.str("category") ?: subject
            return obj("title" to (status?.let(::statusName) ?: w("在{0}中添加状态", categoryName(category))),
                "save" to obj("title" to if (status != null) w("保存") else w("创建"),
                    "act" to act("save", if (kind == "edit") obj("id" to status?.raw("id")) else obj("category" to category))),
                "sections" to arr(statusForm(status, category)))
        }
        fun edit(status: JSONObject) = go("statuses", "edit:${status.str("id")}")
        val counts = known.optJSONObject("counts")
        fun count(status: JSONObject) = status.str("id")?.let { counts?.optInt(it, 0) } ?: 0
        /** What a status row offers: the owner's menu, 编辑 / 设为默认 / 上移 / 下移 / 删除. */
        fun actions(status: JSONObject, index: Int, entries: List<JSONObject>): Array<Pair<String, Any?>> {
            val id = status.raw("id")
            val moving = entries.firstOrNull { it.str("id") != status.str("id") }
            return menu(
                item(w("编辑"), "pencil", to = edit(status)),
                if (status.str("category") in listOf("completed", "canceled")) null
                else item(w("设为默认"), "check", act("default", obj("id" to id)), enabled = !status.flag("isDefault")),
                item(w("上移"), "arrow-up", act("move", obj("id" to id, "direction" to -1)), enabled = index > 0),
                item(w("下移"), "arrow-down", act("move", obj("id" to id, "direction" to 1)), enabled = index < entries.size - 1),
                if (entries.size > 1) item(w("删除"), "trash", act("remove", obj("id" to id)), role = "destructive",
                    confirm = confirm(w("将要删除"), joined(statusName(status), if (count(status) > 0 && moving != null) w("将事项移至：{0}", statusName(moving)) else ""), w("删除"))) else null,
            )
        }
        // One card, a strip for each category with its "+", a tile and the name for each status.
        val rows = CATEGORIES.flatMap { category ->
            val entries = all.filter { it.str("category") == category }
            listOf(obj("id" to "group-$category", "kind" to "group", "title" to categoryName(category),
                "add" to obj("title" to w("在{0}中添加状态", categoryName(category)), "to" to go("statuses", "add:$category")))) +
                entries.mapIndexed { index, status ->
                    link(statusName(status), edit(status), "id" to status.raw("id"),
                        "tag" to if (status.flag("isDefault")) w(" · 默认").trim() else null,
                        "subtitle" to if (count(status) > 0) w("{0} 条事项", count(status), count = count(status)) else null,
                        "status" to obj("type" to (status.str("type") ?: STATUS_TYPES[category]), "color" to status.str("color")?.takeIf { it.isNotEmpty() },
                            "progress" to PROGRESS.firstOrNull { it.second == status.number("iconProgress") }?.second),
                        *actions(status, index, entries))
                }
        }
        return obj("title" to w("状态"), "sections" to arr(listOf(obj("rows" to arr(rows)))))
    }

    // --- 连接器 ---------------------------------------------------------------------------------------------------------------------------------

    fun customConnector(recognized: JSONObject?): JSONObject {
        val kind = recognized?.str("kind")
        val count = recognized?.number("count")?.toInt() ?: 0
        val several = count > 1
        val auth = recognized?.str("auth")
        val how = if (kind == "remote") when (auth) {
            "oauth" -> w("在浏览器里授权")
            "none" -> w("不用登录")
            "token" -> w("需要令牌")
            else -> null
        } else when (kind) {
            "local" -> w("一条命令")
            "sentence" -> w("就是这句话")
            else -> null
        }
        return obj("title" to w("添加自定义连接器"), "save" to obj("title" to w("保存"), "act" to act("add")),
            "preview" to obj("key" to "text", "act" to act("recognize")), "sections" to arr(listOf(obj("rows" to arr(listOfNotNull(
                field("text", w("粘贴地址或命令，或者写一句话说怎么读"), "", "placeholder" to w("粘贴地址或命令，或者写一句话说怎么读"), "multiline" to true, "mono" to true),
                if (kind.isNullOrEmpty()) null else row("id" to "recognized",
                    "title" to when (kind) { "remote" -> w("远程"); "local" -> w("本地"); "sentence" -> w("命令行"); else -> null },
                    "detail" to if (several) w("{0} 个连接器", count, count = count) else how),
                if (several) null else field("name", w("名称"), recognized?.str("name") ?: "", "placeholder" to w("名称")),
                if (kind == "remote" && auth == "token" && !several) field("token", w("令牌"), "", "placeholder" to w("令牌"), "secret" to true) else null,
                if (kind == "local" && !several) obj("id" to "env", "kind" to "environment", "title" to w("添加环境变量")) else null,
            ))))))
    }

    fun connectors(target: String?): JSONObject {
        if (target == "add") return customConnector(null)
        val kind = target.orEmpty().substringBefore(':')
        val subject = if (target.orEmpty().contains(':')) target.orEmpty().substringAfter(':') else ""
        val detail = target.orEmpty().startsWith("connector:")
        val catalog = if (detail) JSONObject() else answer("connectors/catalog")
        val connected = answer("connectors/list").rows("connectors")
        if (kind == "connector") {
            val connector = connected.firstOrNull { it.str("id") == subject } ?: return obj("title" to w("连接器"), "sections" to arr(emptyList()))
            val status = connector.optJSONObject("state")?.str("status")
            val shown = describeState(connector.optJSONObject("state"), aboutLine(connector.optJSONObject("about")))
            val custom = connector.flag("custom")
            val name = connector.str("name").orEmpty()
            // What the person can do is one card each: the connector, then 取消 / 授权 / 重试 when there is one, then 断开. A waiting one says where the page is.
            return obj("title" to name,
                "save" to if (custom) obj("title" to w("保存"), "act" to act("update", obj("id" to connector.raw("id")))) else null,
                "poll" to if (status == "waiting" || connector.flag("busy")) CONNECTOR_POLL_SECONDS else null,
                "sections" to arr(listOfNotNull(
                    obj("footer" to if (status == "waiting") w("授权页面已在电脑的浏览器里打开。在电脑上完成后，这里会自动更新。") else null, "rows" to arr(listOfNotNull(
                        row("id" to "about", "title" to name, "icon" to connector.raw("icon"), "subtitle" to shown.line.takeIf { it.isNotEmpty() },
                            "detail" to shown.words?.takeIf { it.isNotEmpty() }, "tone" to if (shown.words.isNullOrEmpty()) null else shown.tone),
                        if (custom) field("name", w("名称"), name, "placeholder" to w("名称")) else null,
                        if (custom) field("text", w("粘贴地址或命令，或者写一句话说怎么读"), connector.str("text") ?: connector.optJSONObject("about")?.str("text") ?: "",
                            "placeholder" to w("粘贴地址或命令，或者写一句话说怎么读"), "multiline" to true, "mono" to true) else null))),
                    shown.verb?.let { verb -> obj("rows" to arr(listOf(row("id" to "verb", "kind" to "action", "title" to verbWord(verb),
                        "button" to obj("title" to verbWord(verb), "act" to act("verb", obj("id" to connector.raw("id"), "verb" to verb))))))) },
                    obj("rows" to arr(listOf(row("id" to "disconnect", "kind" to "action", "title" to w("断开"), "tone" to "bad",
                        "button" to obj("title" to w("断开"), "role" to "destructive", "act" to act("disconnect", obj("id" to connector.raw("id"))),
                            "confirm" to confirm(w("将要删除"), name, w("删除"))))))),
                )))
        }
        val waiting = connected.any { it.optJSONObject("state")?.str("status") == "waiting" || it.flag("busy") }
        val sections = mutableListOf(obj("rows" to arr(listOf(link(w("添加自定义连接器"), go("connectors", "add"), "id" to "add", "tone" to "muted")))))
        fun connectorRow(connector: JSONObject): JSONObject {
            val shown = describeState(connector.optJSONObject("state"), aboutLine(connector.optJSONObject("about")))
            val name = connector.str("name").orEmpty()
            val id = connector.raw("id")
            return link(name, go("connectors", "connector:${connector.str("id")}"), "id" to id, "icon" to connector.raw("icon"), "subtitle" to shown.line.takeIf { it.isNotEmpty() },
                "detail" to shown.words?.takeIf { it.isNotEmpty() }, "tone" to if (shown.words.isNullOrEmpty()) null else shown.tone,
                *menu(
                    shown.verb?.let { verb -> item(verbWord(verb), verbGlyph(verb), act("verb", obj("id" to id, "verb" to verb))) },
                    item(w("断开"), "unplug", act("disconnect", obj("id" to id)), role = "destructive", confirm = confirm(w("将要删除"), name, w("删除"))),
                ))
        }
        // 已连接 is what works; the others are listed as available, with what their connection says and the one thing to do about it.
        val (working, unconnected) = connected.partition(SettingsPages::isConnected)
        if (working.isNotEmpty()) sections += obj("header" to w("已连接"), "rows" to arr(working.map(::connectorRow)))
        if (unconnected.isNotEmpty()) sections += obj("header" to w("可用"), "rows" to arr(unconnected.map(::connectorRow)))
        val groups = catalog.rows("groups").associateBy { it.str("id").orEmpty() }
        for (id in GROUP_ORDER + groups.keys.filter { it !in GROUP_ORDER }) {
            val group = groups[id] ?: continue
            val items = group.rows("items")
            if (items.isEmpty()) continue
            sections += obj("header" to groupName(id), "rows" to arr(items.map { entry ->
                row("id" to entry.raw("id"), "title" to entry.str("name"), "icon" to entry.raw("icon"), "subtitle" to entry.str("line")?.takeIf { it.isNotEmpty() },
                    "button" to obj("title" to w("连接"), "act" to act("connect", obj("id" to entry.raw("id")))))
            }))
        }
        return obj("title" to w("连接器"), "poll" to if (waiting) CONNECTOR_POLL_SECONDS else null, "sections" to arr(sections))
    }

    // --- 收集器 ---------------------------------------------------------------------------------------------------------------------------------

    fun collectors(target: String?): JSONObject {
        val form = target.orEmpty().startsWith("edit:") || target == "add"
        val list = answer("collectors/list").rows("collectors")
        val available = answer("connectors/list").rows("connectors")
        val collected = if (form) JSONObject() else data.optJSONObject("dispatch/state") ?: JSONObject()
        val kind = target.orEmpty().substringBefore(':')
        val subject = if (target.orEmpty().contains(':')) target.orEmpty().substringAfter(':') else ""
        if (kind == "edit" || kind == "add") {
            val collector = if (kind == "edit") list.firstOrNull { it.str("id") == subject } else null
            val frequencyTitle = w("频率，如 30m、2h、1d，或 cron")
            return obj("title" to (collector?.str("name") ?: w("添加收集器")),
                "save" to obj("title" to w("保存"), "act" to act("save", if (collector != null) obj("id" to collector.raw("id")) else obj())),
                "sections" to arr(listOfNotNull(
                    obj("rows" to arr(listOf(
                        field("name", w("名称"), collector?.str("name") ?: "", "placeholder" to w("名称")),
                        obj("id" to "connector", "kind" to "choice", "key" to "connector", "title" to w("连接器"),
                            "selected" to (collector?.str("connector") ?: available.firstOrNull()?.str("id") ?: ""),
                            "options" to arr(available.map { entry ->
                                obj("id" to entry.raw("id"), "title" to entry.str("name"), "subtitle" to when (entry.str("kind")) { "prompt" -> "Prompt"; "mcp" -> "MCP"; else -> null })
                            })),
                        field("frequency", frequencyTitle, collector?.str("frequency") ?: "", "placeholder" to frequencyTitle, "mono" to true),
                        obj("id" to "common", "kind" to "choice", "key" to "common", "title" to w("常用频率"), "selected" to "",
                            "options" to arr(listOf(obj("id" to "", "title" to "—")) + PRESETS.map { obj("id" to it, "title" to presetWords(it), "subtitle" to it) })),
                        field("prompt", w("收集什么"), collector?.str("prompt") ?: "", "placeholder" to w("收集什么"), "multiline" to true)))),
                    // The delete is on the page of the collector too, not only a long press away.
                    collector?.let {
                        obj("rows" to arr(listOf(row("id" to "remove", "kind" to "action", "title" to w("删除"), "tone" to "bad",
                            "button" to obj("title" to w("删除"), "role" to "destructive", "act" to act("remove", obj("id" to it.raw("id"))),
                                "confirm" to confirm(w("将要删除"), it.str("name"), w("删除")))))))
                    })))
        }
        val reads = collected.rows("collectors").associate { it.str("id").orEmpty() to it.optJSONObject("lastRead") }
        fun lastLine(read: JSONObject?): String {
            val at = read?.number("at") ?: return ""
            val moment = words.time(at.toLong())
            val items = read.number("items")?.toInt() ?: 0
            return if (read.flag("ok")) (if (items > 0) w("上次 {0} · 新增 {1} 条", moment, items, count = items) else w("上次 {0} · 没有新的", moment)) else w("上次 {0} · 读取失败", moment)
        }
        val sections = mutableListOf(obj("rows" to arr(listOf(
            if (available.isNotEmpty()) link(w("添加收集器"), go("collectors", "add"), "id" to "add", "tone" to "muted")
            else row("id" to "needConnector", "title" to w("先添加一个连接器"), "tone" to "muted")))))
        sections += if (list.isNotEmpty()) obj("header" to w("收集器"), "rows" to arr(list.map { collector ->
            val id = collector.raw("id")
            val edit = go("collectors", "edit:${collector.str("id")}")
            link(collector.str("name").orEmpty(), edit, "id" to id, "icon" to available.firstOrNull { it.str("id") == collector.str("connector") }?.raw("icon"),
                "subtitle" to joined(firstLine(collector.str("prompt")), lastLine(reads[collector.str("id").orEmpty()])), "detail" to describeFrequency(collector.str("frequency")),
                "notification" to obj("title" to w("通知"), "on" to (collector.opt("notify") == true), "act" to act("notify", obj("id" to id))),
                *menu(item(w("编辑"), "pencil", to = edit),
                    item(w("删除"), "trash", act("remove", obj("id" to id)), role = "destructive", confirm = confirm(w("将要删除"), collector.str("name"), w("删除")))))
        }))
        else obj("rows" to arr(listOf(row("id" to "empty", "title" to w("没有收集器"), "tone" to "muted"))))
        return obj("title" to w("收集器"), "sections" to arr(sections))
    }

    // --- 规则 -----------------------------------------------------------------------------------------------------------------------------------

    fun rules(target: String?): JSONObject {
        val kept = answer("rules/get")
        val kind = target.orEmpty().substringBefore(':')
        val name = if (target.orEmpty().contains(':')) target.orEmpty().substringAfter(':') else ""
        val rules = kept.optJSONObject("rules")
        if (kind == "edit" && name in RULE_FILES) {
            val body = rules?.str(name)
            return obj("title" to name, "save" to obj("title" to w("保存"),
                "act" to act("save", obj("name" to name, "previous" to (body ?: JSONObject.NULL), "projectFolder" to (kept.raw("projectFolder") ?: JSONObject.NULL)))),
                "sections" to arr(listOf(obj("header" to ruleTitle(name), "rows" to arr(listOf(
                    obj("id" to "text", "kind" to "field", "key" to "text", "title" to name, "value" to (body ?: ""), "multiline" to true, "mono" to true)))))))
        }
        return obj("title" to w("规则"), "sections" to arr(RULE_FILES.map { file ->
            val body = rules?.str(file)
            obj("header" to ruleTitle(file), "rows" to arr(listOf(link(file, go("rules", "edit:$file"), "id" to file, "mono" to true,
                "subtitle" to if (!body.isNullOrEmpty()) firstLine(body) else if (body == null) w("未找到") else w("空")))))
        }))
    }

    // --- 记忆 -----------------------------------------------------------------------------------------------------------------------------------

    private fun summary(counts: JSONObject?): String {
        fun n(key: String) = counts?.number(key)?.toInt() ?: 0
        val updated = n("refine") + n("supersede") + n("corroborate")
        return listOfNotNull(
            if (updated != 0) w("更新 {0} 条", updated, count = updated) else null,
            if (n("new") != 0) w("新增 {0} 条", n("new"), count = n("new")) else null,
            if (n("skill") != 0) w("新增 {0} 项技能", n("skill"), count = n("skill")) else null,
        ).joinToString(if (words.inEnglish) ", " else "，").ifEmpty { w("没有变更") }
    }

    fun memory(target: String?): JSONObject {
        val list = answer("memory/records").rows("records")
        val reviews = answer("memory/reviews").rows("reviews")
        val kind = target.orEmpty().substringBefore(':')
        val subject = if (target.orEmpty().contains(':')) target.orEmpty().substringAfter(':') else ""
        val forgetNote = w("会删除本地记忆和相关引用。DSH 来源消息和模型历史会保留。")
        fun forgetting(record: JSONObject) = item(w("忘记"), "trash", act("forget", obj("id" to record.raw("id"))), role = "destructive",
            confirm = confirm(w("将要删除"), "${record.str("text").orEmpty()}\n$forgetNote", w("删除")))
        if (kind == "edit") {
            val record = list.firstOrNull { it.str("id") == subject }
            // 忘记 is on the page of the memory too, in red with what it deletes under it.
            return obj("title" to w("编辑"), "save" to obj("title" to w("保存"), "act" to act("save", obj("id" to record?.raw("id")))),
                "sections" to arr(listOfNotNull(
                    obj("rows" to arr(listOf(obj("id" to "text", "kind" to "field", "key" to "text", "title" to w("编辑"), "value" to (record?.str("text") ?: ""), "multiline" to true)))),
                    record?.let {
                        val forget = forgetting(it)
                        obj("footer" to forgetNote, "rows" to arr(listOf(row("id" to "forget", "kind" to "action", "title" to w("忘记"), "tone" to "bad",
                            "button" to obj("title" to w("忘记"), "role" to "destructive", "act" to forget.optJSONObject("act"), "confirm" to forget.optJSONObject("confirm"))))))
                    })))
        }
        return obj("title" to w("记忆"), "sections" to arr(listOf(
            if (list.isNotEmpty()) obj("header" to w("记忆"), "rows" to arr(list.map { record ->
                val edit = go("memory", "edit:${record.str("id")}")
                link(record.str("text").orEmpty(), edit, "id" to record.str("id"),
                    "subtitle" to joined(record.str("file"), record.str("since")?.let { w("自 {0}", it) }, if (record.str("status") == "superseded") w("已替代") else ""),
                    *menu(item(w("编辑"), "pencil", to = edit), forgetting(record)))
            })) else obj("rows" to arr(listOf(row("id" to "empty", "title" to w("还没有记住的事"), "tone" to "muted")))),
            obj("header" to w("整理记录"), "rows" to arr(if (reviews.isNotEmpty()) reviews.map { review ->
                row("id" to review.str("id"), "title" to summary(review.optJSONObject("summary")),
                    "subtitle" to (if (review.flag("at")) review.number("at")?.let { words.time(it.toLong()) } ?: "" else ""))
            } else listOf(row("id" to "noReviews", "title" to w("还没有整理记录"), "tone" to "muted")))),
        )))
    }

    // --- 技能 -----------------------------------------------------------------------------------------------------------------------------------

    fun skills(target: String?): JSONObject {
        val kind = target.orEmpty().substringBefore(':')
        if (kind == "skill") {
            val name = target.orEmpty().substringAfter(':')
            val one = answer("skills/read")
            return obj("title" to name, "sections" to arr(listOf(
                obj("header" to name, "rows" to arr(listOf(row("id" to "text", "title" to (one.str("text") ?: one.optJSONObject("skill")?.str("text") ?: ""), "mono" to true)))),
                obj("rows" to arr(listOf(row("id" to "delete", "kind" to "action", "title" to w("删除"), "tone" to "bad",
                    "button" to obj("title" to w("删除"), "role" to "destructive", "act" to act("remove", obj("name" to name)),
                        "confirm" to confirm(w("将要删除"), name, w("删除"))))))))))
        }
        val list = answer("skills/list").rows("skills")
        return obj("title" to w("技能"), "sections" to arr(listOf(
            if (list.isNotEmpty()) obj("header" to w("技能"), "rows" to arr(list.map { skill ->
                val name = skill.str("name").orEmpty()
                link(name, go("skills", "skill:$name"), "id" to name, "subtitle" to skill.str("description")?.takeIf { it.isNotEmpty() },
                    *menu(item(w("删除"), "trash", act("remove", obj("name" to name)), role = "destructive", confirm = confirm(w("将要删除"), name, w("删除")))))
            })) else obj("rows" to arr(listOf(row("id" to "empty", "title" to w("还没有技能"), "tone" to "muted")))))))
    }
}
