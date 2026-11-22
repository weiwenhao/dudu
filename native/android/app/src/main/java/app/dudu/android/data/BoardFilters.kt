package app.dudu.android.data

import java.time.Instant
import java.time.ZoneId
import org.json.JSONArray
import org.json.JSONObject

enum class BoardFilterField(val choices: List<String>? = null, val isDate: Boolean = false) {
    Status,
    Agent,
    SessionState(listOf("unread", "processing", "idle", "unassigned")),
    Priority(listOf("none", "urgent", "high", "medium", "low")),
    Due(listOf("overdue", "today", "next7", "next30"), isDate = true),
    Created(listOf("day", "week", "month"), isDate = true),
    Updated(listOf("day", "week", "month"), isDate = true),
    Project,
    Label,
    Source(listOf("owner", "dudu", "connector", "session"));

    /** Its name where the choices are kept, the iPhone's raw value (`status`, `sessionState`, …). */
    val wire: String get() = name.replaceFirstChar(Char::lowercaseChar)

    fun keys(row: Conversation): List<String?> {
        val issue = row.issue ?: return emptyList()
        return when (this) {
            Status -> listOf(issue.status)
            Agent -> listOf(issue.agent)
            SessionState -> listOf(if (row.sessionId != null) row.sessionState else issue.sessionState ?: "unassigned")
            Priority -> listOf(issue.priority)
            Project -> listOf(issue.project?.name)
            Label -> issue.labels.map { it.id.toString() }
            Source -> listOf(issue.source)
            Due, Created, Updated -> emptyList()
        }
    }

    fun timestamp(row: Conversation): Long? = when (this) {
        Due -> row.issue?.dueAt
        Created -> row.issue?.createdAt
        Updated -> row.receivedAt
        else -> null
    }

    fun bounds(key: String?, now: Long, zone: ZoneId): LongRange {
        if (this == Due) {
            val date = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
            val start = date.atStartOfDay(zone).toInstant().toEpochMilli()
            if (key == "overdue") return Long.MIN_VALUE until start
            val days = when (key) {
                "today" -> 1L
                "next7" -> 7L
                "next30" -> 30L
                else -> return LongRange.EMPTY
            }
            return start until date.plusDays(days).atStartOfDay(zone).toInstant().toEpochMilli()
        }
        val days = when (key) {
            "day" -> 1
            "week" -> 7
            "month" -> 30
            else -> return LongRange.EMPTY
        }
        // The same completed-message clock and rolling windows as the other clients.
        val hour = Math.floorDiv(now, 3_600_000L) * 3_600_000L
        return (hour - days * 86_400_000L)..Long.MAX_VALUE
    }
}

data class BoardFilterOption(val key: String?, val count: Int?)

data class BoardFilters(private val values: Map<BoardFilterField, Set<String?>> = emptyMap()) {
    val isEmpty: Boolean get() = values.isEmpty()

    fun selected(field: BoardFilterField): Set<String?> = values[field].orEmpty()

    /** The choices as the phone keeps them, per computer (`DuduViewModel.keepBoardFilters`): field → keys, null being the 无 choice; the iPhone's `BoardFilterStore` keeps the same. */
    fun saved(): String = JSONObject().apply {
        values.forEach { (field, keys) -> put(field.wire, JSONArray(keys.map { it ?: JSONObject.NULL })) }
    }.toString()

    companion object {
        /** What was kept, read back: a field this build does not know is dropped, a date field keeps only one of its own choices. */
        fun parse(text: String): BoardFilters = runCatching {
            val saved = JSONObject(text)
            BoardFilters(BoardFilterField.entries.mapNotNull { field ->
                val keys = saved.optJSONArray(field.wire) ?: return@mapNotNull null
                var selected = (0 until minOf(keys.length(), 256)).map { if (keys.isNull(it)) null else keys.optString(it) }.toSet()
                if (field.isDate) selected = selected.filterNotNull().filter { it in field.choices.orEmpty() }.take(1).toSet()
                if (selected.isEmpty()) null else field to selected
            }.toMap())
        }.getOrDefault(BoardFilters())
    }

    fun toggle(field: BoardFilterField, key: String?): BoardFilters {
        val current = selected(field)
        val next = when {
            key in current -> current - key
            field.isDate -> setOf(key)
            else -> current + key
        }
        return BoardFilters(if (next.isEmpty()) values - field else values + (field to next))
    }

    fun matching(
        rows: List<Conversation>,
        ignoring: BoardFilterField? = null,
        now: Long = System.currentTimeMillis(),
        zone: ZoneId = ZoneId.systemDefault(),
    ): List<Conversation> {
        val criteria = if (ignoring == null) values else values - ignoring
        if (criteria.isEmpty()) return rows
        val properties = criteria.filterKeys { !it.isDate }
        val dates = criteria.filterKeys { it.isDate }.mapValues { (field, keys) -> field.bounds(keys.first(), now, zone) }
        return rows.filter { row ->
            row.issue != null &&
                properties.all { (field, keys) -> field.keys(row).any { it in keys } } &&
                dates.all { (field, range) -> field.timestamp(row)?.let { it in range } == true }
        }
    }

    fun options(field: BoardFilterField, rows: List<Conversation>, statuses: List<Status>): List<BoardFilterOption> {
        if (field.isDate) return field.choices.orEmpty().map { BoardFilterOption(it, null) }
        val counts = mutableMapOf<String?, Int>()
        for (row in matching(rows, ignoring = field)) {
            for (key in field.keys(row)) counts[key] = (counts[key] ?: 0) + 1
        }
        val knownKeys = when (field) {
            BoardFilterField.Status -> statuses.map(Status::id)
            BoardFilterField.Agent, BoardFilterField.Project -> rows.flatMap(field::keys) + listOf(null)
            else -> field.choices ?: rows.flatMap(field::keys)
        }
        return (knownKeys.toSet() + selected(field)).map { key -> BoardFilterOption(key, counts[key] ?: 0) }
    }
}
